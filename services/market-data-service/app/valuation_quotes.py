"""Bounded native quotes with verified provider identity, never portfolio inputs."""

import hashlib
import json
import math
import re
import subprocess
import sys
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from folioview_shared.valuation import (
    VALUATION_CONTRACT,
    ValuationError,
    quote_request,
    validate_quote_batch,
)

from .cost_controls import MarketCostRoute
from .market_cache import CacheUnavailable
from .market_data import MarketService, get_market_service
from .stock_metrics import METRICS_LOCK
from .valuation_fx import stamp
from .valuation_http import public_request, unique_object

router = APIRouter(route_class=MarketCostRoute)
MAX_REFRESH = 4
WORKER_SECONDS = 7
WORK_SECONDS = 10
TTL = 900
# Narrow mapping from the pinned provider's MIC/suffix and exchange-code tables.
# A suffix is not identity evidence: returned symbol/exchange/currency must match.
MARKETS = {
    "XNYS": ("", {"NYQ", "NYSE"}),
    "XNAS": ("", {"NMS", "NGM", "NCM", "NAS", "NASDAQ"}),
    "ARCX": ("", {"PCX"}),
    "XASE": ("", {"ASE"}),
    "XTSE": (".TO", {"TOR"}),
    "XTSX": (".V", {"VAN"}),
    "CNSX": (".CN", {"CNQ"}),
    "NEOE": (".NE", {"NEO"}),
}
NATIVE_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.-]{0,24}$")
QUOTE_WORKER = """
import concurrent.futures
import contextlib
import io
import json
import sys
output = sys.stdout
with contextlib.redirect_stdout(io.StringIO()):
    import yfinance as yf
    def fetch(symbol):
        try:
            ticker = yf.Ticker(symbol)
            ticker.history(period="5d", interval="1d", auto_adjust=False,
                           actions=False, timeout=2, raise_errors=True, repair=False)
            meta = ticker.get_history_metadata(repair=False)
            keys = ("symbol", "exchangeName", "instrumentType", "currency", "regularMarketPrice",
                    "regularMarketTime", "exchangeTimezoneName")
            return {key: meta.get(key) for key in keys}
        except Exception as error:
            name = type(error).__name__.lower()
            return {"error": "rate_limited" if "ratelimit" in name else
                    "not_found" if "missing" in name or "delisted" in name
                    else "upstream_unavailable"}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {pool.submit(fetch, symbol): symbol for symbol in json.loads(sys.argv[1])}
        for job in concurrent.futures.as_completed(jobs):
            output.write(json.dumps({"symbol": jobs[job], "metadata": job.result()}) + "\\n")
            output.flush()
"""


def identity(item):
    return item["symbol"], item["market"], item["currency"]


def cache_key(item):
    return "valuation:quote:v1:" + hashlib.sha256(json.dumps(identity(item)).encode()).hexdigest()


def provider_symbol(item):
    config = MARKETS.get(item["market"])
    symbol = item["symbol"]
    if not config or not NATIVE_SYMBOL.fullmatch(symbol) or ".." in symbol:
        return None
    suffix = config[0]
    # The canonical symbol is native to its stated exchange, without a vendor suffix.
    if suffix and symbol.endswith(suffix):
        return None
    return symbol.replace(".", "-") + suffix


class YahooQuoteProvider:
    def fetch(self, symbols, timeout):
        if not 1 <= len(symbols) <= MAX_REFRESH or not 0 < timeout <= WORKER_SECONDS:
            raise ValueError
        try:
            result = subprocess.run(
                [sys.executable, "-c", QUOTE_WORKER, json.dumps(symbols)],
                capture_output=True,
                check=True,
                timeout=timeout,
            )
            raw = result.stdout
        except subprocess.TimeoutExpired as error:
            # subprocess.run already terminated/reaped it. Complete emitted lines
            # remain usable; an interrupted JSON line and unfinished work do not.
            raw = error.stdout or b""
        except (OSError, subprocess.SubprocessError):
            return {}
        if type(raw) not in (bytes, str) or len(raw) > 32768:
            return {}
        output = {}
        for line in raw.splitlines():
            try:
                record = json.loads(line, object_pairs_hook=unique_object)
                symbol, metadata = record["symbol"], record["metadata"]
                if symbol in symbols and symbol not in output and type(metadata) is dict:
                    output[symbol] = metadata
            except (ValueError, TypeError, KeyError, RecursionError):
                continue
        return output


def empty(item, now, reason="upstream_unavailable", *, unsupported=False):
    return {
        "instrument": item,
        "price": None,
        "source": "none",
        "status": "unsupported" if unsupported else "missing",
        "sourceAsOf": None,
        "sourceDate": None,
        "fetchedAt": stamp(now),
        "reason": reason,
    }


def checked_quote(item, metadata, now):
    result = empty(item, now)
    error = metadata.get("error")
    if error:
        result["reason"] = (
            error if error in ("rate_limited", "not_found") else "upstream_unavailable"
        )
        return result
    if (
        metadata.get("symbol") != provider_symbol(item)
        or metadata.get("exchangeName") not in tuple(MARKETS[item["market"]][1])
        or metadata.get("instrumentType") not in ("EQUITY", "ETF")
    ):
        return empty(item, now, "not_found")
    if metadata.get("currency") != item["currency"]:
        return empty(item, now, "currency_mismatch")
    observed = metadata.get("regularMarketTime")
    if (
        type(observed) not in (int, float)
        or not 0 < observed <= now
        or not math.isfinite(observed)
        or int(observed) != observed
    ):
        return empty(item, now, "unknown_time")
    if now - observed > 7 * 86400:
        return empty(item, now, "not_found")
    raw = metadata.get("regularMarketPrice")
    try:
        if type(raw) not in (int, float, str) or len(str(raw)) > 64:
            raise ValueError
        price = Decimal(str(raw))
        if (
            not price.is_finite()
            or price <= 0
            or price.adjusted() > 19
            or not -18 <= price.as_tuple().exponent <= 20
        ):
            raise ValueError
        text = format(price, "f")
        if len(text) > 40:
            raise ValueError
        source_date = None
        try:
            zone = ZoneInfo(metadata.get("exchangeTimezoneName", ""))
            source_date = datetime.fromtimestamp(observed, zone).date().isoformat()
        except (ZoneInfoNotFoundError, ValueError, TypeError):
            pass
        result.update(
            price=text,
            source="yahoo_finance",
            status="stale" if now - observed > 86400 else "available",
            sourceAsOf=stamp(observed),
            sourceDate=source_date,
            reason=None,
        )
        validate_quote_batch(batch([result], now), requested=[item])
        return result
    except (InvalidOperation, ValueError, ValuationError):
        return empty(item, now, "invalid_value")


def batch(items, now):
    return {
        "contractVersion": VALUATION_CONTRACT,
        "profile": "folioview.quote-batch.v1",
        "snapshotId": "quote_"
        + hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest(),
        "fetchedAt": stamp(now),
        "items": items,
    }


class QuoteService:
    def __init__(self, market: MarketService, provider=None, *, monotonic=time.monotonic):
        self.market = market
        self.provider = provider or YahooQuoteProvider()
        self.monotonic = monotonic

    @staticmethod
    def cached(entry, item, now):
        try:
            value = entry.value
            result = {k: v for k, v in value.items() if not k.startswith("_")}
            validate_quote_batch(batch([result], now), requested=[item])
            fetched = datetime.fromisoformat(result["fetchedAt"]).timestamp()
            if fetched > now or now - fetched > 7 * 86400:
                return None
            at = result["sourceAsOf"]
            if at and now - datetime.fromisoformat(at).timestamp() > 7 * 86400:
                return None
            until = value["_refreshAfter"]
            if type(until) not in (int, float) or not fetched <= until <= fetched + TTL:
                return None
            if result["price"] is not None and (
                now >= until or (at and now - datetime.fromisoformat(at).timestamp() > 86400)
            ):
                result["status"] = "stale"
            return result
        except (ValueError, TypeError, AttributeError, KeyError, ValuationError):
            return None

    def quotes(self, request, *, cached_only=False):
        instruments = quote_request(request)["instruments"]
        now, deadline = self.market.clock(), self.monotonic() + WORK_SECONDS
        results = {
            identity(i): empty(i, now, "unsupported_market", unsupported=True)
            for i in instruments
            if not provider_symbol(i)
        }
        supported = [i for i in instruments if provider_symbol(i)]
        cache = self.market.cache
        if self.market.source != "yfinance" or cache is None:
            return validate_quote_batch(
                batch([results.get(identity(i), empty(i, now)) for i in instruments], now),
                requested=instruments,
            )
        try:
            entries = cache.get_many([cache_key(i) for i in supported]) if supported else {}
        except CacheUnavailable:
            entries = {}
            cached_only = True
        pending = []
        for item in supported:
            key = cache_key(item)
            previous = self.cached(entries.get(key), item, now)
            results[identity(item)] = previous or empty(item, now)
            fresh = previous and now < entries[key].value.get("_refreshAfter", 0)
            if not fresh:
                pending.append(item)
        acquired = False
        try:
            if not cached_only and pending and self.monotonic() < deadline:
                acquired = METRICS_LOCK.acquire(blocking=False)
            if acquired:
                admitted = []
                for item in pending[:MAX_REFRESH]:
                    if self.monotonic() >= deadline:
                        break
                    reason = cache.claim(cache_key(item), self.market.clock(), cost=2)
                    if reason:
                        if results[identity(item)]["price"] is None:
                            results[identity(item)]["reason"] = (
                                "budget_exhausted"
                                if "daily market refresh limit" in reason
                                else "rate_limited"
                                if "temporarily limited" in reason
                                else "upstream_unavailable"
                            )
                        continue
                    admitted.append(item)
                remaining = min(WORKER_SECONDS, deadline - self.monotonic())
                if admitted and remaining > 0:
                    values = self.provider.fetch(
                        list(dict.fromkeys(provider_symbol(i) for i in admitted)), remaining
                    )
                    writable, cooled = True, False
                    for item in admitted:
                        at = self.market.clock()
                        current = checked_quote(
                            item,
                            values.get(provider_symbol(item), {"error": "upstream_unavailable"}),
                            at,
                        )
                        prior = results[identity(item)]
                        if (
                            current["price"] is not None
                            and prior["price"] is not None
                            and datetime.fromisoformat(current["sourceAsOf"])
                            < datetime.fromisoformat(prior["sourceAsOf"])
                        ):
                            results[identity(item)] = {**prior, "status": "stale"}
                            continue
                        if current["price"] is not None or prior["price"] is None:
                            results[identity(item)] = current
                        if not writable or self.monotonic() >= deadline:
                            continue
                        try:
                            if current["reason"] in {"rate_limited", "upstream_unavailable"}:
                                if not cooled:
                                    cache.fail(
                                        cache_key(item),
                                        at,
                                        rate_limited=current["reason"] == "rate_limited",
                                    )
                                    cooled = True
                            else:
                                cache.put(
                                    cache_key(item),
                                    {
                                        **current,
                                        "_refreshAfter": at
                                        + (TTL if current["price"] is not None else 300),
                                    },
                                    at,
                                )
                        except CacheUnavailable:
                            writable = False
        except CacheUnavailable:
            pass
        finally:
            if acquired:
                METRICS_LOCK.release()
        at = self.market.clock()
        return validate_quote_batch(
            batch([results[identity(i)] for i in instruments], at), requested=instruments
        )


def get_quote_service(market: Annotated[MarketService, Depends(get_market_service)]):
    return QuoteService(market)


async def read_quotes_request(request: Request):
    return await public_request(request, quote_request, 8192, "stock quote")


@router.post("/api/valuation/quotes")
async def batch_quotes(
    value: Annotated[dict, Depends(read_quotes_request)],
    response: Response,
    service: Annotated[QuoteService, Depends(get_quote_service)],
    cached: Annotated[bool, Query()] = False,
):
    response.headers["Cache-Control"] = "no-store"
    return await run_in_threadpool(service.quotes, value, cached_only=cached)
