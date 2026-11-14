"""Public canonical identities for holdings entry; never portfolio amounts or accounts."""

import hashlib
import json
import re
import subprocess
import sys
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from .cost_controls import MarketCostRoute
from .market_cache import CacheUnavailable
from .market_data import QUERY_PATTERN, MarketService, get_market_service
from .stock_metrics import METRICS_LOCK
from .valuation_fx import stamp
from .valuation_http import public_request, unique_object
from .valuation_quotes import MARKETS, provider_symbol

router = APIRouter(route_class=MarketCostRoute)
PROFILE = "folioview.instrument-search.v1"
LIMIT = 4
PROVIDER_SECONDS = 6
FRESH_SECONDS = 86400
MAX_AGE = 7 * 86400
CURRENCIES = {"USD", "CAD", "CNY", "EUR", "GBP", "JPY", "HKD", "AUD", "CHF", "NZD", "SGD", "TWD"}
EXCHANGES = {code: market for market, (_, codes) in MARKETS.items() for code in codes}
VENDOR_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.-]{0,29}$")
# Fixed-host provider library only. The query is data in argv, never code or a URL.
# Currency is taken from an explicit provider field, with metadata fallback only
# when search omits it. Country/exchange never implies currency.
SEARCH_WORKER = """
import concurrent.futures
import contextlib
import io
import json
import sys
out = sys.stdout
with contextlib.redirect_stdout(io.StringIO()):
    import yfinance as yf
    query, exchanges = json.loads(sys.argv[1])
    rows = yf.Search(query, max_results=10, news_count=0, lists_count=0,
                     recommended=0, include_cb=False, timeout=2).quotes
    seen = set()
    candidates = []
    for row in rows:
        symbol = row.get("symbol")
        if (row.get("quoteType") in ("EQUITY", "ETF") and row.get("exchange") in exchanges
                and isinstance(symbol, str) and symbol not in seen):
            seen.add(symbol)
            candidates.append(row)
    def identity(row):
        symbol = row["symbol"]
        currency = row.get("currency")
        exchange, kind = row["exchange"], row["quoteType"]
        if currency is None:
            ticker = yf.Ticker(symbol)
            ticker.history(period="5d", interval="1d", auto_adjust=False, actions=False,
                           timeout=2, raise_errors=True, repair=False)
            meta = ticker.get_history_metadata(repair=False)
            if meta.get("symbol") != symbol or meta.get("exchangeName") != exchange:
                return None
            currency, kind = meta.get("currency"), meta.get("instrumentType")
        return dict(symbol=symbol, exchange=exchange, currency=currency,
                    name=row.get("longname") or row.get("shortname") or symbol, kind=kind)
    complete = len(candidates) <= 4
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(identity, row) for row in candidates[:4]]
        for job in jobs:
            try:
                item = job.result()
                if item is None:
                    complete = False
                else:
                    out.write(json.dumps(dict(item=item)) + "\\n")
                    out.flush()
            except Exception:
                complete = False
    out.write(json.dumps(dict(complete=complete)) + "\\n")
    out.flush()
"""


def search_request(value):
    if type(value) is not dict or set(value) != {"query"}:
        raise ValueError
    query = value["query"]
    if type(query) is not str or not QUERY_PATTERN.fullmatch(query.strip()):
        raise ValueError
    return {"query": query.strip()}


def canonical_identity(value):
    if type(value) is not dict or set(value) != {"symbol", "exchange", "currency", "name", "kind"}:
        return None
    symbol, exchange, currency = (value[k] for k in ("symbol", "exchange", "currency"))
    if (
        type(symbol) is not str
        or not VENDOR_SYMBOL.fullmatch(symbol)
        or type(exchange) is not str
        or exchange not in EXCHANGES
        or type(currency) is not str
        or currency not in CURRENCIES
        or value["kind"] not in ("EQUITY", "ETF")
        or type(value["name"]) is not str
        or not 1 <= len(value["name"].strip()) <= 180
        or any(ord(c) < 32 for c in value["name"])
    ):
        return None
    market = EXCHANGES[exchange]
    suffix = MARKETS[market][0]
    if suffix and not symbol.endswith(suffix):
        return None
    native = symbol[: -len(suffix)] if suffix else symbol
    # Reverse only the provider's supported class punctuation and verified suffix.
    instrument = {"symbol": native.replace("-", "."), "market": market, "currency": currency}
    if provider_symbol(instrument) != symbol:
        return None
    return {
        **instrument,
        "name": value["name"].strip(),
        "assetType": "etf" if value["kind"] == "ETF" else "stock",
    }


class YahooInstrumentProvider:
    def search(self, query):
        timed_out = False
        try:
            result = subprocess.run(
                [sys.executable, "-c", SEARCH_WORKER, json.dumps([query, list(EXCHANGES)])],
                capture_output=True,
                check=True,
                timeout=PROVIDER_SECONDS,
            )
            raw = result.stdout
        except subprocess.TimeoutExpired as error:
            raw = error.stdout or b""
            timed_out = True
        except (OSError, subprocess.SubprocessError):
            raise CacheUnavailable from None
        if type(raw) not in (bytes, str) or len(raw) > 16384:
            raise CacheUnavailable
        if timed_out and raw and not raw.endswith(b"\n" if isinstance(raw, bytes) else "\n"):
            raw = raw.rsplit(b"\n" if isinstance(raw, bytes) else "\n", 1)[0]
        items, seen, complete = [], set(), False
        for line in raw.splitlines():
            try:
                row = json.loads(line, object_pairs_hook=unique_object)
                if type(row) is not dict:
                    raise ValueError
                if set(row) == {"complete"} and type(row["complete"]) is bool:
                    complete = row["complete"]
                elif set(row) == {"item"}:
                    item = canonical_identity(row["item"])
                    if item is None or len(items) >= LIMIT:
                        raise ValueError
                    identity = tuple(item[k] for k in ("symbol", "market", "currency"))
                    if identity not in seen:
                        items.append(item)
                        seen.add(identity)
                else:
                    raise ValueError
            except (ValueError, TypeError, KeyError, RecursionError, UnicodeError):
                raise CacheUnavailable from None
        if not items and not complete:
            raise CacheUnavailable
        return {"items": items, "complete": complete and not timed_out}


def cache_key(query):
    return "valuation:instruments:v1:" + hashlib.sha256(query.casefold().encode()).hexdigest()


def checked_result(value, now):
    if (
        type(value) is not dict
        or set(value) != {"items", "complete", "fetchedAt", "_refreshAfter", "_collectedAt"}
        or type(value["complete"]) is not bool
        or type(value["items"]) is not list
        or len(value["items"]) > LIMIT
        or type(value["_collectedAt"]) not in (int, float)
        or not now - MAX_AGE <= value["_collectedAt"] <= now
        or value["fetchedAt"] != stamp(value["_collectedAt"])
        or type(value["_refreshAfter"]) not in (int, float)
        or not value["_collectedAt"]
        <= value["_refreshAfter"]
        <= value["_collectedAt"] + FRESH_SECONDS
    ):
        raise CacheUnavailable
    seen = set()
    for item in value["items"]:
        if type(item) is not dict or set(item) != {
            "symbol",
            "market",
            "currency",
            "name",
            "assetType",
        }:
            raise CacheUnavailable
        market = item["market"]
        if type(market) is not str or market not in MARKETS:
            raise CacheUnavailable
        vendor = provider_symbol(item)
        if not vendor:
            raise CacheUnavailable
        original = {
            "symbol": vendor,
            "exchange": sorted(MARKETS[market][1])[0],
            "currency": item["currency"],
            "name": item["name"],
            "kind": "ETF"
            if item["assetType"] == "etf"
            else "EQUITY"
            if item["assetType"] == "stock"
            else None,
        }
        if canonical_identity(original) != item:
            raise CacheUnavailable
        identity = tuple(item[k] for k in ("symbol", "market", "currency"))
        if identity in seen:
            raise CacheUnavailable
        seen.add(identity)
    return value


def response(value, now, reason=None):
    return {
        "profile": PROFILE,
        "items": value["items"] if value else [],
        "complete": value["complete"] if value else False,
        "fetchedAt": value["fetchedAt"] if value else None,
        "status": "missing"
        if not value
        else "stale"
        if now >= value["_refreshAfter"]
        else "available",
        "reason": reason,
    }


class InstrumentSearchService:
    def __init__(self, market, provider=None):
        self.market = market
        self.provider = provider or YahooInstrumentProvider()

    def search(self, request, *, cached_only=False):
        query = search_request(request)["query"]
        now, cache = self.market.clock(), self.market.cache
        previous = None
        if self.market.source != "yfinance" or cache is None:
            return response(None, now, "unavailable")
        key = cache_key(query)
        try:
            entry = cache.get(key)
            if entry:
                try:
                    previous = checked_result(entry.value, now)
                except (CacheUnavailable, ValueError, TypeError, KeyError, OverflowError):
                    pass
            if cached_only or (previous and now < previous["_refreshAfter"]):
                return response(previous, now, None if previous else "not_cached")
            if not METRICS_LOCK.acquire(blocking=False):
                return response(previous, now, "busy")
            try:
                # One search plus at most four two-request metadata fallbacks.
                # Reserve the maximum before work; never create a separate budget.
                if cache.claim(key, now, cost=1 + 2 * LIMIT):
                    return response(previous, now, "limited")
                try:
                    result = self.provider.search(query)
                    collected = self.market.clock()
                    ttl = FRESH_SECONDS if result["items"] and result["complete"] else 300
                    value = checked_result(
                        {
                            **result,
                            "fetchedAt": stamp(collected),
                            "_collectedAt": collected,
                            "_refreshAfter": collected + ttl,
                        },
                        collected,
                    )
                except (CacheUnavailable, ValueError, TypeError, KeyError, OverflowError):
                    cache.fail(key, now)
                    return response(previous, self.market.clock(), "unavailable")
                try:
                    cache.put(key, value, collected)
                except CacheUnavailable:
                    pass
                return response(value, collected)
            finally:
                METRICS_LOCK.release()
        except CacheUnavailable:
            return response(previous, now, "unavailable")


def get_instrument_search(market: Annotated[MarketService, Depends(get_market_service)]):
    return InstrumentSearchService(market)


async def read_search_request(request: Request):
    return await public_request(request, search_request, 1024, "instrument search")


@router.post("/api/valuation/instruments/search")
async def search_instruments(
    value: Annotated[dict, Depends(read_search_request)],
    response: Response,
    service: Annotated[InstrumentSearchService, Depends(get_instrument_search)],
    cached: Annotated[bool, Query()] = False,
):
    response.headers["Cache-Control"] = "no-store"
    return await run_in_threadpool(service.search, value, cached_only=cached)
