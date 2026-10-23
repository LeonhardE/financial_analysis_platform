"""Anonymous market snapshots, cached independently of private Firebase identity."""

import os
import re
import time
from datetime import datetime, timedelta
from functools import lru_cache

from fastapi import HTTPException

from .market_cache import CacheUnavailable, MarketCache, bounded_int, create_cache
from .mock_data import mock_range_candles
from .yahoo_provider import (
    ALIASES,
    DEFAULT_BY_SYMBOL,
    DEFAULT_INSTRUMENTS,
    HISTORY_RANGES,
    NEW_YORK,
    SYMBOL_PATTERN,
    Instrument,
    UpstreamError,
    YahooProvider,
    canonical_symbol,
    static_search,
)

UNAVAILABLE = "Market data is temporarily unavailable. Please try again later."
STALE = "Showing previously fetched Yahoo data while a refresh is unavailable."
SHARED_CACHE_WARNING = "Market refreshes are paused because the shared cache is unavailable."
CACHED_SNAPSHOT = "Cached snapshot; checking for newer data."
QUERY_PATTERN = re.compile(r"^[\w .&^+\-]{1,50}$", re.UNICODE)


class MarketService:
    def __init__(
        self, cache: MarketCache | None, provider=None, *, source="yfinance", clock=time.time
    ):
        self.cache = cache
        self.provider = provider or YahooProvider()
        self.source = source
        self.clock = clock
        self.fresh_seconds = bounded_int("MARKET_CACHE_TTL_SECONDS", 3600, 900, 86400)
        self.stale_seconds = 7 * 86400

    def cached(self, key, now, *, refresh=False):
        if self.cache is None:
            raise CacheUnavailable
        if refresh:
            self.cache.invalidate(key)
        entry = self.cache.get(key)
        return entry if entry and now - entry.updated_at <= self.stale_seconds else None

    def fresh(self, entry, now):
        return bool(
            entry and now < entry.value.get("_refreshAfter", entry.updated_at + self.fresh_seconds)
        )

    def refresh_after(self, now, data_date):
        local_now = datetime.fromtimestamp(now, NEW_YORK)
        next_open = local_now.replace(hour=9, minute=35, second=0, microsecond=0)
        before_open = (local_now.hour, local_now.minute) < (9, 30)
        after_close = (local_now.hour, local_now.minute) >= (16, 15)
        weekend = local_now.weekday() >= 5
        if weekend or before_open or (after_close and data_date == local_now.date().isoformat()):
            if not before_open or weekend:
                next_open += timedelta(days=1)
            while next_open.weekday() >= 5:
                next_open += timedelta(days=1)
            return next_open.timestamp()
        return now + self.fresh_seconds

    @staticmethod
    def public_payload(payload):
        return {key: value for key, value in payload.items() if not key.startswith("_")}

    def with_status(self, payload, updated_at, now, warning=None):
        result = self.public_payload(payload)
        # Existing production 1M cache entries predate interval metadata.
        result.setdefault("interval", "1d")
        result["isStale"] = now >= payload.get("_refreshAfter", updated_at + self.fresh_seconds)
        if warning:
            result["warning"] = warning
        return result

    def fallback_overview(self, now, previous=None, warning=UNAVAILABLE):
        if previous:
            result = self.public_payload(previous.value)
            stocks = []
            for item in result["stocks"]:
                fetched_at = item.get("fetchedAt")
                try:
                    age = (
                        now - datetime.fromisoformat(fetched_at.replace("Z", "+00:00")).timestamp()
                    )
                except (TypeError, ValueError, AttributeError):
                    age = self.stale_seconds + 1
                if age > self.stale_seconds:
                    stocks.append(
                        {
                            **item,
                            "latestClose": None,
                            "changePercent": None,
                            "dataDate": None,
                            "fetchedAt": None,
                            "isStale": False,
                        }
                    )
                else:
                    stocks.append({**item, "isStale": item["latestClose"] is not None})
            result["stocks"] = stocks
            result["warning"] = warning
            return result
        return {
            "stocks": [
                {
                    **item.public(),
                    "latestClose": None,
                    "changePercent": None,
                    "dataDate": None,
                    "fetchedAt": None,
                    "isStale": False,
                }
                for item in DEFAULT_INSTRUMENTS
            ],
            "source": "yfinance",
            "isMock": False,
            "warning": warning,
        }

    def overview(self, *, cached_only=False):
        if self.source == "mock":
            return {
                "stocks": [self.summary(self.mock_candles(item)) for item in DEFAULT_INSTRUMENTS],
                "source": "mock",
                "isMock": True,
                "warning": "Fictional demonstration data; not real market prices.",
                **({"refreshRequired": False} if cached_only else {}),
            }
        now = self.clock()
        previous = None
        try:
            previous = self.cached("overview:v1", now)
            if cached_only:
                if previous is None:
                    return None
                needs_refresh = not self.fresh(previous, now)
                # The aggregate can be newer than an individual quote after a
                # partial batch. Preserve each quote's own maximum usable age.
                result = self.fallback_overview(
                    now,
                    previous,
                    CACHED_SNAPSHOT if needs_refresh else previous.value.get("warning"),
                )
                if not any(item["latestClose"] is not None for item in result["stocks"]):
                    return None
                if not needs_refresh:
                    for item, original in zip(
                        result["stocks"], previous.value["stocks"], strict=True
                    ):
                        if item["latestClose"] is not None:
                            item["isStale"] = original["isStale"]
                return {**result, "refreshRequired": needs_refresh}
            if self.fresh(previous, now):
                return self.public_payload(previous.value)
            existing = {
                item.symbol: self.cached(f"candles:{item.symbol}", now)
                for item in DEFAULT_INSTRUMENTS
            }
            due = [
                item for item in DEFAULT_INSTRUMENTS if not self.fresh(existing[item.symbol], now)
            ]
            reason = self.cache.claim("overview:v1", now, cost=len(due))
            if reason:
                return self.fallback_overview(now, previous, reason)
            values = self.provider.history(due, now) if due else {}
            if due and not values:
                self.cache.fail("overview:v1", now)
                return self.fallback_overview(now, previous)
            stocks = []
            missing = []
            refresh_times = []
            for item in DEFAULT_INSTRUMENTS:
                payload = values.get(item.symbol)
                if payload:
                    payload["_refreshAfter"] = self.refresh_after(now, payload["dataDate"])
                    self.cache.put(f"candles:{item.symbol}", payload, now)
                    stocks.append(self.summary(payload))
                    refresh_times.append(payload["_refreshAfter"])
                else:
                    cached = existing[item.symbol]
                    needs_refresh = item in due
                    if needs_refresh:
                        missing.append(item.symbol)
                    if cached:
                        stocks.append({**self.summary(cached.value), "isStale": needs_refresh})
                        if not needs_refresh:
                            refresh_times.append(
                                cached.value.get(
                                    "_refreshAfter", cached.updated_at + self.fresh_seconds
                                )
                            )
                    else:
                        stocks.append(
                            next(
                                row
                                for row in self.fallback_overview(now)["stocks"]
                                if row["symbol"] == item.symbol
                            )
                        )
            warning = (
                f"Some quotes could not be refreshed: {', '.join(missing)}." if missing else None
            )
            result = {"stocks": stocks, "source": "yfinance", "isMock": False, "warning": warning}
            result["_refreshAfter"] = min(refresh_times) if refresh_times else now + 300
            if missing:
                result["_refreshAfter"] = min(result["_refreshAfter"], now + 300)
            self.cache.put("overview:v1", result, now)
            if missing:
                # A partial/empty batch often represents upstream throttling. Do
                # not immediately repeat the missing calls from the detail page.
                self.cache.fail("partial_batch", now)
                for symbol in missing:
                    self.cache.fail(f"candles:{symbol}", now)
            return self.public_payload(result)
        except UpstreamError as error:
            try:
                self.cache.fail("overview:v1", now, rate_limited=error.rate_limited)
            except CacheUnavailable:
                pass
            return self.fallback_overview(now, previous)
        except CacheUnavailable as error:
            if cached_only:
                raise HTTPException(503, SHARED_CACHE_WARNING) from error
            return self.fallback_overview(now, previous, SHARED_CACHE_WARNING)

    @staticmethod
    def summary(payload):
        return {
            key: payload[key]
            for key in (
                "symbol",
                "name",
                "instrumentType",
                "currency",
                "latestClose",
                "changePercent",
                "dataDate",
                "fetchedAt",
                "isStale",
            )
        }

    def search(self, query: str):
        query = query.strip()
        if not QUERY_PATTERN.fullmatch(query):
            raise HTTPException(400, "Enter a stock name or symbol of at most 50 characters")
        static = static_search(query)
        exact_default = (
            canonical_symbol(query) in DEFAULT_BY_SYMBOL
            or query in ALIASES
            or any(item.name.casefold() == query.casefold() for item in static)
        )
        if exact_default or self.source == "mock":
            return self.search_response(static)
        now = self.clock()
        previous = None
        key = f"search:{query.casefold()}"
        try:
            previous = self.cached(key, now)
            if self.fresh(previous, now):
                return previous.value
            reason = self.cache.claim(key, now)
            if reason:
                if previous:
                    return {**previous.value, "warning": reason}
                raise HTTPException(429, reason, headers={"Retry-After": "60"})
            instruments = self.provider.search(query)
            for item in instruments:
                self.cache.put(f"instrument:{item.symbol}", item.stored(), now)
            merged = {item.symbol: item for item in [*static, *instruments]}
            # An exact ticker result is first, even if it prefixes a default
            # company (MS/MSFT, APP/Apple, GOOG/GOOGL).
            ordered = sorted(merged.values(), key=lambda item: item.symbol != query.upper())
            result = self.search_response(ordered)
            self.cache.put(key, result, now)
            return result
        except UpstreamError as error:
            try:
                self.cache.fail(key, now, rate_limited=error.rate_limited)
            except CacheUnavailable:
                pass
            if previous:
                return {**previous.value, "warning": STALE}
            raise HTTPException(503, UNAVAILABLE) from error
        except CacheUnavailable as error:
            if previous:
                return {**previous.value, "warning": SHARED_CACHE_WARNING}
            raise HTTPException(503, SHARED_CACHE_WARNING) from error

    def search_response(self, instruments):
        return {
            "stocks": [item.public() for item in instruments][:10],
            "source": self.source,
            "isMock": self.source == "mock",
            "warning": None,
        }

    def resolve_instrument(self, symbol, now):
        if symbol in DEFAULT_BY_SYMBOL:
            return DEFAULT_BY_SYMBOL[symbol]
        cached = self.cached(f"instrument:{symbol}", now)
        if cached:
            return Instrument(**cached.value)
        # Only validated US equities returned by search can be downloaded. An
        # arbitrary path can never become a Yahoo URL or a foreign-market query.
        result = self.search(symbol)
        if any(item["symbol"] == symbol for item in result["stocks"]):
            cached = self.cached(f"instrument:{symbol}", now)
            if cached:
                return Instrument(**cached.value)
        raise HTTPException(404, "US stock symbol not found")

    def candles(self, raw_symbol, chart_range="1m", *, cached_only=False):
        if chart_range not in HISTORY_RANGES:
            raise HTTPException(400, "Choose one of these chart ranges: 1d, 1w, 1m, 3m, 1y")
        symbol = canonical_symbol(raw_symbol)
        if not SYMBOL_PATTERN.fullmatch(symbol):
            raise HTTPException(400, "Invalid stock symbol")
        if self.source == "mock":
            item = DEFAULT_BY_SYMBOL.get(symbol)
            if not item:
                raise HTTPException(404, "Stock symbol not found")
            result = self.mock_candles(item, chart_range)
            return {**result, "refreshRequired": False} if cached_only else result
        now = self.clock()
        # Preserve the shared overview/1M cache, while every other range has
        # its own lease and payload. Intraday data cannot overwrite daily bars.
        key = f"candles:{symbol}" if chart_range == "1m" else f"candles:{symbol}:{chart_range}"
        previous = None
        try:
            previous = self.cached(key, now)
            if cached_only:
                if previous is None:
                    return None
                needs_refresh = not self.fresh(previous, now)
                return {
                    **self.with_status(
                        previous.value,
                        previous.updated_at,
                        now,
                        CACHED_SNAPSHOT if needs_refresh else None,
                    ),
                    "refreshRequired": needs_refresh,
                }
            if self.fresh(previous, now):
                return self.with_status(previous.value, previous.updated_at, now)
            if symbol in DEFAULT_BY_SYMBOL and chart_range == "1m":
                # Default charts and the overview share one refresh lease.
                # This prevents separate page requests downloading AAPL twice
                # and a slower older response replacing a newer batch result.
                overview = self.overview()
                refreshed = self.cached(key, now, refresh=True)
                if refreshed:
                    return self.with_status(
                        refreshed.value, refreshed.updated_at, now, overview["warning"]
                    )
                raise HTTPException(
                    503,
                    overview["warning"] or UNAVAILABLE,
                    headers={"Retry-After": "5"},
                )
            item = self.resolve_instrument(symbol, now)
            reason = self.cache.claim(key, now)
            if reason:
                if previous:
                    return self.with_status(previous.value, previous.updated_at, now, reason)
                raise HTTPException(429, reason, headers={"Retry-After": "60"})
            values = self.provider.history([item], now, chart_range)
            payload = values.get(symbol)
            if not payload:
                raise UpstreamError
            payload["_refreshAfter"] = self.refresh_after(now, payload["dataDate"])
            self.cache.put(key, payload, now)
            return self.public_payload(payload)
        except UpstreamError as error:
            try:
                self.cache.fail(key, now, rate_limited=error.rate_limited)
            except CacheUnavailable:
                pass
            if previous:
                return self.with_status(previous.value, previous.updated_at, now, STALE)
            raise HTTPException(503, UNAVAILABLE) from error
        except CacheUnavailable as error:
            if previous:
                return self.with_status(
                    previous.value, previous.updated_at, now, SHARED_CACHE_WARNING
                )
            raise HTTPException(503, SHARED_CACHE_WARNING) from error

    @staticmethod
    def mock_candles(item, chart_range="1m"):
        # Index fixtures are intentionally derived fictional numbers and are
        # never substituted for failed Yahoo responses.
        candles = mock_range_candles(item.symbol, chart_range)
        interval = HISTORY_RANGES[chart_range][1]
        latest = candles[-1]["close"]
        previous = mock_range_candles(item.symbol, "1m")[-2]["close"]
        return {
            **item.public(),
            "range": chart_range,
            "interval": interval,
            "source": "mock",
            "isMock": True,
            "candles": candles,
            "latestClose": latest,
            "changePercent": round((latest / previous - 1) * 100, 2),
            "dataDate": (
                datetime.fromtimestamp(candles[-1]["time"], NEW_YORK).date().isoformat()
                if interval != "1d"
                else candles[-1]["time"]
            ),
            "fetchedAt": None,
            "isStale": False,
            "isPartial": False,
            "adjustment": "mock",
            "warning": "Fictional demonstration data; not real market prices.",
        }


@lru_cache(maxsize=4)
def service_for_configuration(configuration: tuple[str, ...]) -> MarketService:
    source = configuration[0]
    if source == "mock":
        return MarketService(None, source="mock")
    if source != "yfinance":
        raise CacheUnavailable("MARKET_DATA_SOURCE must be yfinance or mock")
    return MarketService(create_cache())


def get_market_service() -> MarketService:
    configuration = tuple(
        os.getenv(key, default)
        for key, default in (
            ("MARKET_DATA_SOURCE", "yfinance"),
            ("MARKET_CACHE_BACKEND", ""),
            ("MARKET_CACHE_PATH", ""),
            ("MARKET_FIRESTORE_DATABASE", ""),
            ("FIREBASE_PROJECT_ID", ""),
            ("GOOGLE_CLOUD_PROJECT", ""),
            ("K_SERVICE", ""),
            ("MARKET_UPSTREAM_DAILY_LIMIT", "200"),
            ("MARKET_CACHE_TTL_SECONDS", "3600"),
        )
    )
    try:
        return service_for_configuration(configuration)
    except CacheUnavailable:
        # Health and a public overview remain usable when Firestore has not yet
        # been provisioned. Methods still fail closed before any Yahoo request.
        return MarketService(None)
