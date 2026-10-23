"""Cached first paint is read-only and never waits for a Yahoo refresh."""

import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.market_cache import CacheUnavailable, SQLiteMarketCache
from app.market_data import CACHED_SNAPSHOT, MarketService, get_market_service
from app.yahoo_provider import DEFAULT_INSTRUMENTS, HISTORY_RANGES

NOW = datetime(2026, 10, 20, 15, 0, tzinfo=UTC).timestamp()


def fixture_payload(instrument, chart_range="1m"):
    return {
        **instrument.public(),
        "range": chart_range,
        "interval": HISTORY_RANGES[chart_range][1],
        "source": "yfinance",
        "isMock": False,
        "candles": [
            {"time": "2026-10-19", "open": 100, "high": 102, "low": 99, "close": 101},
            {"time": "2026-10-20", "open": 101, "high": 103, "low": 100, "close": 102},
        ],
        "latestClose": 102,
        "changePercent": 0.99,
        "dataDate": "2026-10-20",
        "fetchedAt": "2026-10-20T15:00:00Z",
        "isStale": False,
        "isPartial": True,
        "adjustment": "split_and_dividend_adjusted",
        "warning": None,
    }


class CachedLoadingTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cache = SQLiteMarketCache(str(Path(directory.name) / "market.sqlite3"))
        self.provider = MagicMock()
        self.provider.history.side_effect = lambda items, now, chart_range="1m": {
            item.symbol: fixture_payload(item, chart_range) for item in items
        }
        self.now = NOW
        self.service = MarketService(self.cache, self.provider, clock=lambda: self.now)

    def read_only(self):
        stack = ExitStack()
        for name in ("claim", "put", "fail"):
            stack.enter_context(
                patch.object(self.cache, name, side_effect=AssertionError("Cache-only write"))
            )
        for name in ("history", "search"):
            stack.enter_context(
                patch.object(self.provider, name, side_effect=AssertionError("Cache-only Yahoo"))
            )
        return stack

    def test_missing_cache_never_resolves_searches_or_reserves_upstream(self):
        with self.read_only():
            self.assertIsNone(self.service.overview(cached_only=True))
            for chart_range in HISTORY_RANGES:
                self.assertIsNone(self.service.candles("AAPL", chart_range, cached_only=True))
            self.assertIsNone(self.service.candles("UNKNOWN", cached_only=True))

    def test_fresh_cache_returns_prices_without_refresh_and_one_read_per_resource(self):
        overview = self.service.overview()
        with self.read_only(), patch.object(self.cache, "get", wraps=self.cache.get) as reads:
            current = self.service.overview(cached_only=True)
            self.assertEqual(reads.call_count, 1)
            chart = self.service.candles("aapl", cached_only=True)
            self.assertEqual(reads.call_count, 2)
        self.assertFalse(current["refreshRequired"])
        self.assertFalse(chart["refreshRequired"])
        self.assertFalse(chart["isStale"])
        self.assertEqual(current["stocks"], overview["stocks"])
        self.assertEqual(chart["latestClose"], 102)
        self.assertNotIn("_refreshAfter", current)
        self.assertNotIn("_refreshAfter", chart)

    def test_stale_snapshot_is_immediate_preserves_dates_and_requests_refresh(self):
        original = self.service.overview()
        self.now += 4000
        with self.read_only():
            overview = self.service.overview(cached_only=True)
            chart = self.service.candles("AAPL", cached_only=True)
        self.assertTrue(overview["refreshRequired"])
        self.assertTrue(chart["refreshRequired"])
        self.assertTrue(all(item["isStale"] for item in overview["stocks"]))
        self.assertTrue(chart["isStale"])
        self.assertTrue(chart["isPartial"])
        self.assertEqual(chart["warning"], CACHED_SNAPSHOT)
        self.assertEqual(overview["warning"], CACHED_SNAPSHOT)
        for current, previous in zip(overview["stocks"], original["stocks"], strict=True):
            self.assertEqual(current["latestClose"], previous["latestClose"])
            self.assertEqual(current["dataDate"], previous["dataDate"])
            self.assertEqual(current["fetchedAt"], previous["fetchedAt"])

    def test_all_ranges_read_their_own_snapshot_and_missing_range_does_not_fall_back(self):
        self.service.overview()
        self.service.candles("AAPL", "1y")
        with self.read_only():
            yearly = self.service.candles("AAPL", "1y", cached_only=True)
            self.assertEqual(yearly["range"], "1y")
            self.assertIsNone(self.service.candles("AAPL", "1w", cached_only=True))

    def test_cache_older_than_seven_days_is_not_displayed(self):
        self.service.overview()
        self.now += 7 * 86400 + 1
        with self.read_only():
            self.assertIsNone(self.service.overview(cached_only=True))
            self.assertIsNone(self.service.candles("AAPL", cached_only=True))

    def test_new_aggregate_cannot_keep_individually_expired_prices_alive(self):
        original = self.service.overview()
        self.now += 8 * 86400
        newer = deepcopy(original)
        newer["stocks"][0]["fetchedAt"] = datetime.fromtimestamp(self.now, UTC).isoformat()
        newer["_refreshAfter"] = self.now + 60
        self.cache.put("overview:v1", newer, self.now)
        with self.read_only():
            overview = self.service.overview(cached_only=True)
        self.assertFalse(overview["refreshRequired"])
        self.assertFalse(overview["stocks"][0]["isStale"])
        self.assertEqual(overview["stocks"][0]["latestClose"], 102)
        self.assertTrue(all(item["latestClose"] is None for item in overview["stocks"][1:]))

    def test_cache_outage_fails_without_upstream_or_fabricated_quotes(self):
        with self.read_only(), patch.object(self.cache, "get", side_effect=CacheUnavailable):
            for call in (
                lambda: self.service.overview(cached_only=True),
                lambda: self.service.candles("AAPL", cached_only=True),
            ):
                with self.assertRaises(HTTPException) as failure:
                    call()
                self.assertEqual(failure.exception.status_code, 503)

    def test_invalid_symbols_and_ranges_are_rejected_before_cache_access(self):
        with patch.object(self.cache, "get", side_effect=AssertionError("Invalid cache read")):
            for symbol, chart_range in (("AAPL?x=1", "1m"), ("AAPL", "2y")):
                with self.assertRaises(HTTPException) as failure:
                    self.service.candles(symbol, chart_range, cached_only=True)
                self.assertEqual(failure.exception.status_code, 400)

    def test_legacy_daily_cache_gets_interval_without_mutating_shared_payload(self):
        value = fixture_payload(DEFAULT_INSTRUMENTS[3])
        value.pop("interval")
        self.cache.put("candles:AAPL", value, NOW)
        with self.read_only():
            chart = self.service.candles("AAPL", cached_only=True)
        self.assertEqual(chart["interval"], "1d")
        self.assertNotIn("interval", self.cache.get("candles:AAPL").value)

    def test_route_cache_miss_is_bodyless_204_then_normal_request_refreshes(self):
        app.dependency_overrides[get_market_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)
        with TestClient(app) as client:
            for path in ("/api/stocks", "/api/stocks/AAPL/candles?range=1y"):
                with self.subTest(path=path):
                    response = client.get(path, params={"cached": "true"})
                    self.assertEqual(response.status_code, 204)
                    self.assertEqual(response.content, b"")
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.provider.history.assert_not_called()
            self.assertEqual(client.get("/api/stocks").status_code, 200)
            cached = client.get("/api/stocks/AAPL/candles", params={"cached": "true"})
            self.assertEqual(cached.status_code, 200)
            self.assertFalse(cached.json()["refreshRequired"])
            self.assertEqual(cached.headers["Cache-Control"], "no-store")
            self.assertEqual(client.get("/api/v1/me?cached=true").status_code, 401)
            self.assertEqual(client.get("/api/v1/watchlist?cached=true").status_code, 401)

    def test_mock_mode_remains_explicit_and_never_requests_refresh(self):
        service = MarketService(None, source="mock")
        for result in (
            service.overview(cached_only=True),
            service.candles("AAPL", cached_only=True),
        ):
            self.assertTrue(result["isMock"])
            self.assertEqual(result["source"], "mock")
            self.assertFalse(result["refreshRequired"])


class StartupTests(unittest.TestCase):
    def test_app_startup_does_not_import_yahoo_or_dataframe_dependencies(self):
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import app.main, json, sys; print(json.dumps("
                "[name for name in ('yfinance', 'pandas', 'numpy') if name in sys.modules]))",
            ],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout), [])


if __name__ == "__main__":
    unittest.main()
