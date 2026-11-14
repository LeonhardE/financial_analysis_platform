"""Demand-only daily reference FX; public pairs never contain portfolio facts."""

import hashlib
import json
import re
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta
from threading import Lock
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from folioview_shared.valuation import (
    VALUATION_CONTRACT,
    ValuationError,
    cross_rate,
    fx_request,
    validate_fx_batch,
)

from .cost_controls import MarketCostRoute
from .market_cache import CacheUnavailable
from .market_data import MarketService, get_market_service
from .valuation_http import public_request, unique_object

router = APIRouter(route_class=MarketCostRoute)
FX_LOCK = Lock()
FX_KEY = "valuation:fx:bank-of-canada:v1"
PROVIDER = "bank_of_canada"
PROVIDER_TIMEOUT = 5
BODY_BYTES = 4096
CURRENCIES = ("USD", "CAD", "CNY", "EUR", "GBP", "JPY", "HKD", "AUD", "CHF", "NZD", "SGD", "TWD")
FX_SERIES = ",".join("FX" + currency + "CAD" for currency in CURRENCIES if currency != "CAD")
FX_URL = "https://www.bankofcanada.ca/valet/observations/" + FX_SERIES + "/json?recent=1"
POSITIVE = re.compile(r"^(?:0|[1-9][0-9]{0,19})(?:\.[0-9]{1,18})?$")
TORONTO = ZoneInfo("America/Toronto")
# A socket timeout alone cannot bound a slow-drip response. The standard-library
# child has a whole-process deadline and is killed/reaped by subprocess.run().
# The URL/parameters/headers are constants; callers cannot select another host.
FX_WORKER = """
import json
import urllib.request
request = urllib.request.Request(
    __FX_URL__,
    headers={"Accept": "application/json", "User-Agent": "FolioView-reference-FX/1.0"},
)
try:
    with urllib.request.urlopen(request, timeout=3) as response:
        if response.status != 200:
            raise ValueError()
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError()
    print(raw.decode("utf-8"))
except Exception:
    print('{"error":true}')
""".replace("__FX_URL__", repr(FX_URL))


def stamp(now):
    return datetime.fromtimestamp(now, UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def positive(value):
    if type(value) is not str or not POSITIVE.fullmatch(value):
        return False
    return cross_rate(value, "1") != "0"


def observation(value, now):
    """One actual observation date, with no per-currency older-row fallback."""
    try:
        rows = value["observations"]
        if type(rows) is not list or len(rows) != 1 or type(rows[0]) is not dict:
            raise ValueError
        row = rows[0]
        observed = date.fromisoformat(row["d"])
        if row["d"] != observed.isoformat() or observed > datetime.fromtimestamp(now, UTC).date():
            raise ValueError
        rates = {}
        for currency in CURRENCIES:
            if currency == "CAD":
                continue
            item = row.get("FX" + currency + "CAD")
            rate = item.get("v") if type(item) is dict else None
            if positive(rate):
                rates[currency] = rate
        if not rates:
            raise ValueError
        return {"sourceDate": observed.isoformat(), "rates": rates}
    except (ValueError, TypeError, KeyError, ValuationError):
        raise CacheUnavailable from None


class BankOfCanadaProvider:
    def fetch(self, now):
        try:
            result = subprocess.run(
                [sys.executable, "-c", FX_WORKER],
                capture_output=True,
                check=True,
                timeout=PROVIDER_TIMEOUT,
            )
            if len(result.stdout) > 65536:
                raise ValueError
            value = json.loads(result.stdout, object_pairs_hook=unique_object)
            return observation(value, now)
        except (OSError, subprocess.SubprocessError, ValueError, TypeError, RecursionError):
            raise CacheUnavailable from None


def publication_after(source_date):
    next_day = date.fromisoformat(source_date) + timedelta(days=1)
    while next_day.weekday() >= 5:
        next_day += timedelta(days=1)
    # Five minutes after the documented daily publication, without claiming to
    # know holiday publication schedules. A holiday can remain visibly stale.
    return (
        datetime.combine(next_day, datetime.min.time(), TORONTO)
        .replace(hour=16, minute=35)
        .timestamp()
    )


class FxService:
    def __init__(self, market: MarketService, provider=None):
        self.market = market
        self.provider = provider or BankOfCanadaProvider()

    @staticmethod
    def usable(value, now):
        try:
            if set(value) != {"sourceDate", "rates", "fetchedAt", "_refreshAfter"}:
                return False
            observed = date.fromisoformat(value["sourceDate"])
            today = datetime.fromtimestamp(now, UTC).date()
            fetched = datetime.fromisoformat(value["fetchedAt"])
            return (
                0 <= (today - observed).days <= 7
                and value["fetchedAt"].endswith("Z")
                and fetched.timestamp() <= now
                and observed <= fetched.date()
                and type(value["rates"]) is dict
                and 1 <= len(value["rates"]) <= len(CURRENCIES) - 1
                and all(
                    k in CURRENCIES and k != "CAD" and positive(v)
                    for k, v in value["rates"].items()
                )
                and type(value["_refreshAfter"]) in (int, float)
                and fetched.timestamp() <= value["_refreshAfter"] <= fetched.timestamp() + 4 * 86400
            )
        except (TypeError, KeyError, ValueError, ValuationError):
            return False

    def snapshot(self, now, cached_only):
        cache = self.market.cache
        if cache is None or self.market.source == "mock":
            return None, "upstream_unavailable"
        previous = None
        acquired = False
        try:
            entry = cache.get(FX_KEY)
            previous = entry.value if entry and self.usable(entry.value, now) else None
            if cached_only or (previous and now < previous["_refreshAfter"]):
                return previous, "upstream_unavailable"
            acquired = FX_LOCK.acquire(blocking=False)
            if not acquired:
                return previous, "upstream_unavailable"
            reason = cache.claim(FX_KEY, now, provider=PROVIDER)
            if reason:
                # Another instance may have won after our process-local read.
                # Do not loop, invalidate or queue another provider call.
                return previous, (
                    "budget_exhausted"
                    if "daily market refresh limit" in reason
                    else "rate_limited"
                    if "temporarily limited" in reason
                    else "upstream_unavailable"
                )
            try:
                value = self.provider.fetch(now)
                # Providers and injected test seams must satisfy the same parser.
                raw = {
                    "observations": [
                        {
                            "d": value["sourceDate"],
                            **{
                                "FX" + currency + "CAD": {"v": rate}
                                for currency, rate in value["rates"].items()
                            },
                        }
                    ]
                }
                parsed = observation(raw, now)
                after = self.market.clock()
                payload = {
                    **parsed,
                    "fetchedAt": stamp(after),
                    "_refreshAfter": max(publication_after(parsed["sourceDate"]), after + 3600),
                }
                if not self.usable(payload, after):
                    raise CacheUnavailable
            except (CacheUnavailable, KeyError, ValueError, TypeError):
                cache.fail(FX_KEY, now, provider=PROVIDER)
                return previous, "upstream_unavailable"
            cache.put(FX_KEY, payload, after)
            return payload, None
        except CacheUnavailable:
            return previous, "upstream_unavailable"
        finally:
            if acquired:
                FX_LOCK.release()

    def rates(self, request, *, cached_only=False):
        pairs = fx_request(request)["pairs"]
        now = self.market.clock()
        value, missing_reason = (
            self.snapshot(now, cached_only)
            if any(p["base"] != p["quote"] for p in pairs)
            else (None, None)
        )
        at = stamp(self.market.clock())
        items = []
        for pair in pairs:
            base, quote = pair["base"], pair["quote"]
            item = {
                **pair,
                "rate": None,
                "source": "none",
                "route": None,
                "status": "missing",
                "sourceAsOf": None,
                "sourceDate": None,
                "fetchedAt": at,
                "reason": missing_reason,
            }
            if base == quote:
                item.update(
                    rate="1",
                    source="identity",
                    status="available",
                    reason=None,
                    route={"kind": "identity", "via": None, "legs": []},
                )
            elif value:
                rates = {"CAD": "1", **value["rates"]}
                item.update(fetchedAt=value["fetchedAt"], sourceDate=value["sourceDate"])
                if base not in rates or quote not in rates:
                    item["reason"] = "missing_leg"
                else:
                    try:
                        rate = cross_rate(rates[base], rates[quote])
                    except ValuationError:
                        item["reason"] = "invalid_value"
                        items.append(item)
                        continue
                    direct, inverse = quote == "CAD", base == "CAD"
                    legs = [
                        {
                            "base": c,
                            "quote": "CAD",
                            "rate": rates[c],
                            "sourceDate": value["sourceDate"],
                        }
                        for c in [base, quote]
                        if c != "CAD"
                    ]
                    stale = now >= min(
                        value["_refreshAfter"], publication_after(value["sourceDate"])
                    )
                    item.update(
                        rate=rate,
                        source=PROVIDER,
                        status="stale" if stale else "available",
                        reason=None,
                        route={
                            "kind": "direct" if direct else "inverse" if inverse else "cross",
                            "via": None if direct or inverse else "CAD",
                            "legs": legs,
                        },
                    )
            items.append(item)
        batch = {
            "contractVersion": VALUATION_CONTRACT,
            "profile": "folioview.fx-batch.v1",
            "snapshotId": "fx_"
            + hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest(),
            "fetchedAt": at,
            "items": items,
        }
        return validate_fx_batch(batch, requested=pairs)


def get_fx_service(market: Annotated[MarketService, Depends(get_market_service)]):
    return FxService(market)


async def read_fx_request(request: Request):
    return await public_request(request, fx_request, BODY_BYTES, "FX pair")


@router.post("/api/valuation/fx")
async def batch_fx(
    value: Annotated[dict, Depends(read_fx_request)],
    response: Response,
    service: Annotated[FxService, Depends(get_fx_service)],
    cached: Annotated[bool, Query()] = False,
):
    response.headers["Cache-Control"] = "no-store"
    return await run_in_threadpool(service.rates, value, cached_only=cached)
