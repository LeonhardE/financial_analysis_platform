"""Optional, daily Yahoo valuation snapshots outside the chart loading path."""

import json
import math
import re
import subprocess
import sys
from threading import Lock
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .cost_controls import MarketCostRoute
from .market_cache import CacheUnavailable
from .market_data import (
    CACHED_SNAPSHOT,
    SHARED_CACHE_WARNING,
    STALE,
    UNAVAILABLE,
    MarketService,
    get_market_service,
)
from .yahoo_provider import (
    DEFAULT_BY_SYMBOL,
    SYMBOL_PATTERN,
    Instrument,
    UpstreamError,
    canonical_symbol,
    iso_time,
)

router = APIRouter(route_class=MarketCostRoute)
METRICS_LOCK = Lock()
METRICS_TTL_SECONDS = 86400
WORKER_TIMEOUT_SECONDS = 15
# Ticker.get_info() has no timeout argument. Isolate its network requests and
# pandas imports, then terminate and reap the process on timeout. Never mutate
# yfinance's shared session or hold the candle downloader's process-wide lock.
INFO_WORKER = """
import contextlib
import io
import json
import sys

try:
    with contextlib.redirect_stdout(io.StringIO()):
        import yfinance as yf
        info = yf.Ticker(sys.argv[1]).get_info()
    keys = ("symbol", "quoteType", "currency", "trailingPE", "marketCap")
    result = {key: info.get(key) for key in keys}
except Exception as error:
    result = {"error": True, "rateLimited": "ratelimit" in type(error).__name__.lower()}
print(json.dumps(result))
"""


def positive_number(value):
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        return value if math.isfinite(value) and value > 0 else None
    except OverflowError:
        return None


class YahooMetricsProvider:
    def fetch(self, instrument: Instrument):
        try:
            worker = subprocess.run(
                [sys.executable, "-c", INFO_WORKER, instrument.yahoo_symbol],
                capture_output=True,
                text=True,
                check=True,
                timeout=WORKER_TIMEOUT_SECONDS,
            )
            result = json.loads(worker.stdout)
            if not isinstance(result, dict):
                raise UpstreamError
            if result.get("error"):
                raise UpstreamError(rate_limited=result.get("rateLimited") is True)
            if (
                result.get("symbol") != instrument.yahoo_symbol
                or result.get("quoteType") != "EQUITY"
            ):
                raise UpstreamError
            return result
        except UpstreamError:
            raise
        except (OSError, subprocess.SubprocessError, ValueError, TypeError) as error:
            raise UpstreamError from error


class StockMetricsService:
    def __init__(self, market: MarketService, provider=None):
        self.market = market
        self.provider = provider or YahooMetricsProvider()

    @staticmethod
    def empty(symbol, source):
        return {
            "symbol": symbol,
            "trailingPE": None,
            "marketCap": None,
            "currency": None,
            "fetchedAt": None,
            "source": source,
            "isMock": source == "mock",
            "isStale": False,
            "warning": None,
        }

    @staticmethod
    def status(entry, now, warning=None, *, probe=False):
        stale = now >= entry.updated_at + METRICS_TTL_SECONDS
        return {
            **MarketService.public_payload(entry.value),
            "isStale": stale,
            "warning": warning,
            **({"refreshRequired": stale} if probe else {}),
        }

    def metrics(self, raw_symbol, *, cached_only=False):
        symbol = canonical_symbol(raw_symbol)
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise HTTPException(400, "Invalid stock symbol")
        item = DEFAULT_BY_SYMBOL.get(symbol)
        if self.market.source == "mock" or (item and item.instrument_type == "index"):
            if not item:
                raise HTTPException(404, "Stock symbol not found")
            result = self.empty(symbol, self.market.source)
            return {**result, "refreshRequired": False} if cached_only else result
        now = self.market.clock()
        key = f"metrics:v1:{symbol}"
        previous = None
        acquired = False
        try:
            previous = self.market.cached(key, now)
            if cached_only:
                return (
                    self.status(
                        previous,
                        now,
                        CACHED_SNAPSHOT
                        if now >= previous.updated_at + METRICS_TTL_SECONDS
                        else None,
                        probe=True,
                    )
                    if previous
                    else None
                )
            if previous and now < previous.updated_at + METRICS_TTL_SECONDS:
                return self.status(previous, now)
            if item is None:
                # Metrics must never turn an arbitrary path into a Yahoo search.
                # Non-default symbols have already passed US-equity validation
                # when the user selected them from search results.
                instrument = self.market.cached(f"instrument:{symbol}", now)
                if not instrument:
                    raise HTTPException(404, "US stock symbol not found")
                item = Instrument(**instrument.value)
            acquired = METRICS_LOCK.acquire(blocking=False)
            if not acquired:
                if previous:
                    return self.status(previous, now, STALE)
                raise HTTPException(503, UNAVAILABLE, headers={"Retry-After": "15"})
            # get_info() can issue multiple Yahoo requests. These five units
            # conservatively share the existing logical refresh budget; they
            # are not an exact count of HTTP requests, cookies, or retries.
            reason = self.market.cache.claim(key, now, cost=5)
            if reason:
                if previous:
                    return self.status(previous, now, reason)
                raise HTTPException(429, reason, headers={"Retry-After": "60"})
            info = self.provider.fetch(item)
            currency = info.get("currency")
            currency = (
                currency
                if isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency)
                else None
            )
            payload = {
                **self.empty(symbol, "yfinance"),
                "trailingPE": positive_number(info.get("trailingPE")),
                "marketCap": positive_number(info.get("marketCap")) if currency else None,
                "currency": currency,
                "fetchedAt": iso_time(now),
                "_refreshAfter": now + METRICS_TTL_SECONDS,
            }
            self.market.cache.put(key, payload, now)
            return MarketService.public_payload(payload)
        except UpstreamError as error:
            try:
                self.market.cache.fail(key, now, rate_limited=error.rate_limited)
            except CacheUnavailable:
                pass
            if previous:
                return self.status(previous, now, STALE)
            raise HTTPException(503, UNAVAILABLE) from error
        except CacheUnavailable as error:
            if previous:
                return self.status(previous, now, SHARED_CACHE_WARNING)
            raise HTTPException(503, SHARED_CACHE_WARNING) from error
        finally:
            if acquired:
                METRICS_LOCK.release()


def get_stock_metrics_service(
    market: Annotated[MarketService, Depends(get_market_service)],
) -> StockMetricsService:
    return StockMetricsService(market)


@router.get("/api/stocks/{symbol}/metrics", response_model=None)
def stock_metrics(
    symbol: str,
    service: Annotated[StockMetricsService, Depends(get_stock_metrics_service)],
    response: Response,
    cached: Annotated[bool, Query()] = False,
) -> dict | Response:
    result = service.metrics(symbol, cached_only=cached)
    response.headers["Cache-Control"] = "no-store"
    return (
        result
        if result is not None
        else Response(status_code=204, headers={"Cache-Control": "no-store"})
    )
