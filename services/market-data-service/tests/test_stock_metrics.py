"""Valuation snapshots are optional, bounded, shared, and independent of charts."""

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.market_cache import CacheUnavailable, Entry, SQLiteMarketCache
from app.market_data import MarketService
from app.stock_metrics import (
    METRICS_LOCK,
    METRICS_TTL_SECONDS,
    StockMetricsService,
    YahooMetricsProvider,
    get_stock_metrics_service,
)
from app.yahoo_provider import DEFAULT_BY_SYMBOL, Instrument, UpstreamError

NOW = 1792494000.0
INFO = {
    "symbol": "AAPL",
    "quoteType": "EQUITY",
    "trailingPE": 31.2,
    "marketCap": 3_000_000_000_000,
    "currency": "USD",
}


class YahooMetricsProviderTests(unittest.TestCase):
    def test_info_runs_in_bounded_process_with_symbol_as_separate_argument(self):
        with patch("app.stock_metrics.subprocess.run") as run:
            run.return_value = SimpleNamespace(stdout=json.dumps(INFO))
            result = YahooMetricsProvider().fetch(DEFAULT_BY_SYMBOL["AAPL"])
        self.assertEqual(result, INFO)
        arguments, options = run.call_args
        self.assertEqual(arguments[0][-1], "AAPL")
        self.assertEqual(options["timeout"], 15)
        self.assertTrue(options["capture_output"])
        self.assertTrue(options["check"])
        self.assertNotIn("shell", options)

    def test_worker_rate_limit_is_preserved(self):
        with patch("app.stock_metrics.subprocess.run") as run:
            run.return_value = SimpleNamespace(stdout='{"error":true,"rateLimited":true}')
            with self.assertRaises(UpstreamError) as error:
                YahooMetricsProvider().fetch(DEFAULT_BY_SYMBOL["AAPL"])
        self.assertTrue(error.exception.rate_limited)

    def test_malformed_or_mismatched_provider_results_fail_closed(self):
        for value in ["not json", "[]", "{}", json.dumps({**INFO, "symbol": "MSFT"})]:
            with self.subTest(value=value), patch("app.stock_metrics.subprocess.run") as run:
                run.return_value = SimpleNamespace(stdout=value)
                with self.assertRaises(UpstreamError):
                    YahooMetricsProvider().fetch(DEFAULT_BY_SYMBOL["AAPL"])
        with patch("app.stock_metrics.subprocess.run", side_effect=OSError):
            with self.assertRaises(UpstreamError):
                YahooMetricsProvider().fetch(DEFAULT_BY_SYMBOL["AAPL"])

    def test_timed_out_worker_is_terminated_and_reaped(self):
        with tempfile.TemporaryDirectory() as folder:
            pid_file = Path(folder) / "worker.pid"
            script = (
                "import os, pathlib, time\n"
                f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
                "time.sleep(10)\n"
            )
            started = time.monotonic()
            with (
                patch("app.stock_metrics.INFO_WORKER", script),
                patch("app.stock_metrics.WORKER_TIMEOUT_SECONDS", 0.3),
                self.assertRaises(UpstreamError),
            ):
                YahooMetricsProvider().fetch(DEFAULT_BY_SYMBOL["AAPL"])
            self.assertLess(time.monotonic() - started, 2)
            pid = int(pid_file.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)


class StockMetricsTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.cache = SQLiteMarketCache(str(Path(self.folder.name) / "market.sqlite3"))
        self.now = NOW
        self.market = MarketService(self.cache, clock=lambda: self.now)
        self.provider = MagicMock()
        self.provider.fetch.return_value = INFO
        self.service = StockMetricsService(self.market, self.provider)

    def seed(self, age):
        payload = {
            **self.service.empty("AAPL", "yfinance"),
            "trailingPE": 25,
            "marketCap": 2_000_000_000_000,
            "currency": "USD",
            "fetchedAt": "2026-10-20T00:00:00Z",
            "_refreshAfter": self.now - age + METRICS_TTL_SECONDS,
        }
        self.cache.put("metrics:v1:AAPL", payload, self.now - age)
        return payload

    def test_successful_refresh_is_shared_for_24_hours_and_uses_five_budget_units(self):
        result = self.service.metrics("aapl")
        self.assertEqual(result["trailingPE"], 31.2)
        self.assertEqual(result["marketCap"], 3_000_000_000_000)
        self.assertEqual(result["currency"], "USD")
        self.assertNotIn("_refreshAfter", result)
        self.now += 23 * 3600
        self.assertEqual(self.service.metrics("AAPL"), result)
        self.provider.fetch.assert_called_once_with(DEFAULT_BY_SYMBOL["AAPL"])
        with self.cache.connection() as db:
            budget = json.loads(
                db.execute("SELECT value FROM market_state WHERE id=1").fetchone()[0]
            )
        self.assertEqual(budget["count"], 5)

    def test_stale_probe_is_one_read_and_preserves_snapshot_time_without_upstream_work(self):
        payload = self.seed(2 * 86400)
        cache = MagicMock()
        cache.get.return_value = Entry(payload, self.now - 2 * 86400)
        self.market.cache = cache
        result = self.service.metrics("AAPL", cached_only=True)
        self.assertTrue(result["isStale"])
        self.assertTrue(result["refreshRequired"])
        self.assertEqual(result["fetchedAt"], payload["fetchedAt"])
        self.assertEqual(cache.mock_calls, [unittest.mock.call.get("metrics:v1:AAPL")])
        self.provider.fetch.assert_not_called()

    def test_fresh_probe_does_not_request_refresh(self):
        self.seed(3600)
        result = self.service.metrics("AAPL", cached_only=True)
        self.assertFalse(result["isStale"])
        self.assertFalse(result["refreshRequired"])
        self.provider.fetch.assert_not_called()

    def test_probe_miss_does_not_resolve_instruments_and_old_snapshots_expire(self):
        self.assertIsNone(self.service.metrics("NFLX", cached_only=True))
        self.seed(8 * 86400)
        self.assertIsNone(self.service.metrics("AAPL", cached_only=True))
        self.provider.fetch.assert_not_called()

    def test_missing_invalid_nonpositive_or_nonfinite_metrics_are_null(self):
        for value in [None, 0, -3, True, "12", float("nan"), float("inf"), 10**400]:
            with self.subTest(value=value):
                self.provider.fetch.return_value = {**INFO, "trailingPE": value, "marketCap": value}
                self.now += 86401
                result = self.service.metrics("AAPL")
                self.assertIsNone(result["trailingPE"])
                self.assertIsNone(result["marketCap"])
                json.dumps(result, allow_nan=False)

    def test_market_cap_is_suppressed_when_its_currency_is_unknown(self):
        self.provider.fetch.return_value = {**INFO, "currency": None}
        result = self.service.metrics("AAPL")
        self.assertEqual(result["trailingPE"], 31.2)
        self.assertIsNone(result["marketCap"])
        self.assertIsNone(result["currency"])

    def test_indices_and_mock_metrics_make_no_provider_or_cache_calls(self):
        self.market.cache = MagicMock()
        result = self.service.metrics("^GSPC")
        self.assertEqual(result["symbol"], "SPX")
        self.assertIsNone(result["trailingPE"])
        self.assertIsNone(result["marketCap"])
        self.assertIsNone(result["fetchedAt"])
        self.market.cache.get.assert_not_called()
        self.provider.fetch.assert_not_called()
        self.market.source = "mock"
        self.assertTrue(self.service.metrics("AAPL")["isMock"])
        self.provider.fetch.assert_not_called()

    def test_non_default_symbols_must_have_a_previously_validated_instrument(self):
        with self.assertRaises(HTTPException) as error:
            self.service.metrics("NFLX")
        self.assertEqual(error.exception.status_code, 404)
        self.provider.fetch.assert_not_called()
        instrument = Instrument("NFLX", "Netflix", yahoo_symbol="NFLX")
        self.cache.put("instrument:NFLX", instrument.stored(), self.now)
        self.service.metrics("NFLX")
        self.provider.fetch.assert_called_once_with(instrument)

    def test_invalid_symbol_is_refused_before_any_cache_or_upstream_work(self):
        self.market.cache = MagicMock()
        with self.assertRaises(HTTPException) as error:
            self.service.metrics("../../https://example.com")
        self.assertEqual(error.exception.status_code, 400)
        self.market.cache.get.assert_not_called()
        self.provider.fetch.assert_not_called()

    def test_busy_worker_returns_stale_or_503_without_claiming_or_queueing(self):
        self.market.cache = MagicMock()
        self.market.cache.get.return_value = None
        with METRICS_LOCK:
            with self.assertRaises(HTTPException) as error:
                self.service.metrics("AAPL")
        self.assertEqual(error.exception.status_code, 503)
        self.market.cache.claim.assert_not_called()
        self.provider.fetch.assert_not_called()
        self.market.cache = self.cache
        self.seed(2 * 86400)
        with METRICS_LOCK:
            result = self.service.metrics("AAPL")
        self.assertTrue(result["isStale"])
        self.provider.fetch.assert_not_called()

    def test_upstream_failure_preserves_stale_data_and_sets_shared_cooldown(self):
        payload = self.seed(2 * 86400)
        self.provider.fetch.side_effect = UpstreamError(rate_limited=True)
        result = self.service.metrics("AAPL")
        self.assertEqual(result["trailingPE"], payload["trailingPE"])
        self.assertEqual(result["fetchedAt"], payload["fetchedAt"])
        self.assertTrue(result["isStale"])
        self.assertIn("refresh", result["warning"])
        self.assertIn("temporarily unavailable", self.cache.claim("candles:AAPL", self.now))

    def test_cache_outage_and_global_limits_fail_closed_before_provider(self):
        self.market.cache = MagicMock()
        self.market.cache.get.side_effect = CacheUnavailable
        with self.assertRaises(HTTPException) as error:
            self.service.metrics("AAPL")
        self.assertEqual(error.exception.status_code, 503)
        self.provider.fetch.assert_not_called()
        self.market.cache.get.side_effect = None
        self.market.cache.get.return_value = None
        self.market.cache.claim.return_value = (
            "The shared daily market refresh limit has been reached."
        )
        with self.assertRaises(HTTPException) as error:
            self.service.metrics("AAPL")
        self.assertEqual(error.exception.status_code, 429)
        self.provider.fetch.assert_not_called()

    def test_endpoint_returns_bodyless_probe_miss_then_complete_snapshot(self):
        app.dependency_overrides[get_stock_metrics_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)
        client = TestClient(app)
        probe = client.get("/api/stocks/AAPL/metrics?cached=true")
        self.assertEqual(probe.status_code, 204)
        self.assertEqual(probe.content, b"")
        self.assertEqual(probe.headers["cache-control"], "no-store")
        response = client.get("/api/stocks/AAPL/metrics")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["trailingPE"], 31.2)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertFalse(
            client.get("/api/stocks/AAPL/metrics?cached=true").json()["refreshRequired"]
        )


if __name__ == "__main__":
    unittest.main()
