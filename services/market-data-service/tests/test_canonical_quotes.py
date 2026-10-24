"""Daily quote identity is separate from chart ranges, without live upstream calls."""

import tempfile
import unittest
from contextlib import ExitStack
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.market_cache import CacheUnavailable, SQLiteMarketCache
from app.market_data import MarketService, get_market_service
from app.yahoo_provider import DEFAULT_BY_SYMBOL, HISTORY_RANGES

NOW = datetime(2026, 10, 20, 15, 0, tzinfo=UTC).timestamp()


def payload(chart_range="1m"):
    daily = chart_range == "1m"
    return {
        **DEFAULT_BY_SYMBOL["MSFT"].public(),
        "range": chart_range,
        "interval": HISTORY_RANGES[chart_range][1],
        "source": "yfinance",
        "isMock": False,
        "candles": [
            {"time": "2026-10-19", "open": 520, "high": 525, "low": 519, "close": 521.07},
            {
                "time": "2026-10-20",
                "open": 522,
                "high": 526,
                "low": 520,
                "close": 524.51 if daily else 524.53,
            },
        ],
        "latestClose": 524.51 if daily else 524.53,
        "changePercent": 0.66 if daily else 0.56,
        "dataDate": "2026-10-20",
        "fetchedAt": "2026-10-20T14:55:00Z" if daily else "2026-10-20T15:00:00Z",
        "isStale": False,
        "isPartial": True,
        "adjustment": "split_and_dividend_adjusted",
        "warning": None,
    }


class CanonicalQuoteTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cache = SQLiteMarketCache(str(Path(directory.name) / "quotes.sqlite3"))
        self.provider = MagicMock()
        self.service = MarketService(self.cache, self.provider, clock=lambda: NOW)

    def put(self, chart_range="1m", value=None, updated=NOW):
        key = "candles:MSFT" + ("" if chart_range == "1m" else ":" + chart_range)
        self.cache.put(key, value or payload(chart_range), updated)
        return key

    def read_only(self):
        stack = ExitStack()
        for name in ("claim", "put", "fail"):
            stack.enter_context(
                patch.object(self.cache, name, side_effect=AssertionError("Read-only cache"))
            )
        for name in ("history", "search"):
            stack.enter_context(
                patch.object(self.provider, name, side_effect=AssertionError("No upstream quote"))
            )
        return stack

    def test_every_range_and_cached_probe_share_daily_quote_without_changing_bars_or_cache(self):
        before = {self.put(chart_range): payload(chart_range) for chart_range in HISTORY_RANGES}
        with self.read_only():
            for cached_only in (True, False):
                for chart_range in HISTORY_RANGES:
                    with self.subTest(chart_range=chart_range, cached_only=cached_only):
                        result = self.service.candles("MSFT", chart_range, cached_only=cached_only)
                        quote = result["quote"]
                        self.assertEqual(quote["latestClose"], 524.51)
                        self.assertEqual(quote["changePercent"], 0.66)
                        self.assertEqual(quote["previousClose"], 521.07)
                        self.assertEqual(quote["basis"], "daily_snapshot")
                        self.assertEqual(quote["interval"], "1d")
                        self.assertEqual(quote["adjustment"], "split_and_dividend_adjusted")
                        self.assertEqual(quote["fetchedAt"], "2026-10-20T14:55:00Z")
                        for field, value in payload(chart_range).items():
                            self.assertEqual(result[field], value)
        for key, original in before.items():
            self.assertEqual(self.cache.get(key).value, original)
            self.assertNotIn("quote", self.cache.get(key).value)

    def test_one_month_reuses_current_result_with_one_cache_read(self):
        self.put()
        with self.read_only(), patch.object(self.cache, "get", wraps=self.cache.get) as reads:
            result = self.service.candles("MSFT", cached_only=True)
        reads.assert_called_once_with("candles:MSFT")
        self.assertEqual(result["quote"]["latestClose"], result["latestClose"])

    def test_new_range_refresh_never_downloads_or_writes_another_quote(self):
        self.put()
        self.provider.history.return_value = {"MSFT": payload("1d")}
        with (
            patch.object(self.cache, "claim", wraps=self.cache.claim) as claims,
            patch.object(self.cache, "put", wraps=self.cache.put) as writes,
        ):
            result = self.service.candles("MSFT", "1d")
        self.provider.history.assert_called_once_with([DEFAULT_BY_SYMBOL["MSFT"]], NOW, "1d")
        claims.assert_called_once_with("candles:MSFT:1d", NOW)
        self.assertEqual(writes.call_count, 1)
        self.assertEqual(writes.call_args.args[0], "candles:MSFT:1d")
        self.assertNotIn("quote", writes.call_args.args[1])
        self.assertEqual(result["latestClose"], 524.53)
        self.assertEqual(result["quote"]["latestClose"], 524.51)

    def test_missing_expired_or_unavailable_canonical_cache_does_not_break_a_chart(self):
        self.put("1d")
        with self.read_only():
            missing = self.service.candles("MSFT", "1d", cached_only=True)
        self.assertIsNone(missing["quote"])
        self.assertEqual(missing["candles"], payload("1d")["candles"])
        self.put(updated=NOW - 7 * 86400 - 1)
        with self.read_only():
            expired = self.service.candles("MSFT", "1d", cached_only=True)
        self.assertIsNone(expired["quote"])

        read = self.cache.get

        def fail_quote_only(key):
            if key == "candles:MSFT":
                raise CacheUnavailable
            return read(key)

        with self.read_only(), patch.object(self.cache, "get", side_effect=fail_quote_only):
            unavailable = self.service.candles("MSFT", "1d", cached_only=True)
        self.assertIsNone(unavailable["quote"])
        self.assertEqual(unavailable["latestClose"], 524.53)

    def test_daily_and_chart_staleness_remain_independent(self):
        for stale_daily in (True, False):
            with self.subTest(stale_daily=stale_daily):
                daily = {**payload(), "_refreshAfter": NOW - 1 if stale_daily else NOW + 3600}
                chart = {
                    **payload("1d"),
                    "_refreshAfter": NOW + 3600 if stale_daily else NOW - 1,
                }
                self.put(value=daily)
                self.put("1d", chart)
                with self.read_only():
                    result = self.service.candles("MSFT", "1d", cached_only=True)
                self.assertEqual(result["quote"]["isStale"], stale_daily)
                self.assertEqual(result["isStale"], not stale_daily)
                self.assertEqual(result["refreshRequired"], not stale_daily)
                self.assertEqual(result["quote"]["fetchedAt"], daily["fetchedAt"])
                self.assertEqual(result["quote"]["dataDate"], daily["dataDate"])

    def test_missing_actual_prior_daily_bar_is_not_inferred_from_percentage(self):
        for prior in (None, {"time": "2026-10-20", "close": 520}, {"time": "2026-10-19"}):
            with self.subTest(prior=prior):
                daily = deepcopy(payload())
                daily["candles"] = ([prior] if prior else []) + daily["candles"][-1:]
                self.put(value=daily)
                with self.read_only():
                    result = self.service.candles("MSFT", cached_only=True)
                self.assertIsNone(result["quote"]["previousClose"])
                self.assertEqual(result["quote"]["changePercent"], 0.66)

    def test_route_preserves_chart_contract_and_exposes_optional_daily_quote(self):
        self.put("1d")
        self.put()
        app.dependency_overrides[get_market_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)
        with self.read_only(), TestClient(app) as client:
            response = client.get("/api/stocks/MSFT/candles?range=1d&cached=true")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["range"], "1d")
        self.assertEqual(result["interval"], "5m")
        self.assertEqual(result["latestClose"], 524.53)
        self.assertEqual(result["quote"]["latestClose"], 524.51)
        self.assertNotIn("_refreshAfter", result["quote"])

    def test_mock_quotes_reuse_daily_fixture_and_do_not_recurse_or_touch_cache(self):
        service = MarketService(None, source="mock")
        canonical = service.candles("MSFT")["quote"]
        self.assertEqual(canonical["adjustment"], "mock")
        self.assertIsNone(canonical["fetchedAt"])
        for cached_only in (True, False):
            for chart_range in HISTORY_RANGES:
                with self.subTest(chart_range=chart_range, cached_only=cached_only):
                    result = service.candles("MSFT", chart_range, cached_only=cached_only)
                    self.assertEqual(result["quote"], canonical)
                    self.assertTrue(result["isMock"])
                    self.assertEqual(result["source"], "mock")


if __name__ == "__main__":
    unittest.main()
