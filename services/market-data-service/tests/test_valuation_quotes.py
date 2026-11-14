"""Canonical quote identity, bounded batch work and actual public HTTP flow, offline."""

import json
import os
import tempfile
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.cost_controls import CostControls, MarketLimited
from app.main import app
from app.market_cache import CacheUnavailable, FirestoreMarketCache, SQLiteMarketCache
from app.market_data import MarketService, get_market_service
from app.stock_metrics import METRICS_LOCK
from app.valuation_quotes import (
    QuoteService,
    YahooQuoteProvider,
    checked_quote,
    get_quote_service,
    provider_symbol,
)
from folioview_shared.valuation import ValuationError, validate_quote_batch

NOW = datetime(2026, 11, 13, 23, 0, tzinfo=UTC).timestamp()
US = {"symbol": "AAPL", "market": "XNAS", "currency": "USD"}
CA = {"symbol": "SHOP", "market": "XTSE", "currency": "CAD"}
META = {
    "symbol": "AAPL",
    "exchangeName": "NMS",
    "instrumentType": "EQUITY",
    "currency": "USD",
    "regularMarketPrice": 123.45,
    "regularMarketTime": int(NOW - 3600),
    "exchangeTimezoneName": "America/New_York",
}
CA_META = {**META, "symbol": "SHOP.TO", "exchangeName": "TOR", "currency": "CAD"}


class BatchCacheTests(unittest.TestCase):
    def test_sqlite_batch_reads_deduplicate_bound_and_parameterize(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = SQLiteMarketCache(str(Path(folder) / "cache.sqlite3"))
            key = "a'); DROP TABLE market_entries;--"
            cache.put(key, {"price": "10"}, NOW)
            rows = cache.get_many([key, "missing", key])
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[key].value, {"price": "10"})
            self.assertIsNone(rows["missing"])
            self.assertEqual(cache.get(key), rows[key])
            self.assertEqual(cache.get_many([]), {})
            for invalid in [["a"] * 51, [None], ["a" * 129], "a"]:
                with self.assertRaises(CacheUnavailable):
                    cache.get_many(invalid)

    def fixture(self, limit=50):
        client = MagicMock()
        controls = CostControls(storage_limit=limit, clock=lambda: 0)
        client.collection.return_value.document.side_effect = lambda identity: SimpleNamespace(
            id=identity
        )
        with patch("app.market_cache.firestore.Client", return_value=client):
            cache = FirestoreMarketCache("unit-test", controls=controls)

        def snapshots(refs, **_options):
            return [SimpleNamespace(reference=r, to_dict=lambda: None) for r in refs]

        client.get_all.side_effect = snapshots
        return cache, client, controls

    def test_firestore_one_stream_charged_per_document_with_free_positive_and_negative_hits(self):
        cache, client, controls = self.fixture()
        keys = ["one", "two", "three"]
        cache.remember("one", SimpleNamespace(value={"price": "1"}, updated_at=NOW))
        first = cache.get_many(keys + ["two"])
        self.assertEqual(len(first), 3)
        self.assertIsNone(first["two"])
        self.assertEqual(controls.storage.tokens, 48)
        args, options = client.get_all.call_args
        self.assertEqual(len(args[0]), 2)
        self.assertEqual(options, {"timeout": 4, "retry": None})
        self.assertEqual(cache.get_many(keys), first)
        self.assertEqual(client.get_all.call_count, 1)
        self.assertEqual(controls.storage.tokens, 48)

    def test_bulk_admission_rejects_before_sdk_and_failed_partial_stream_does_not_cache_misses(
        self,
    ):
        cache, client, controls = self.fixture(1)
        with self.assertRaises(MarketLimited):
            cache.get_many(["a", "b"])
        client.get_all.assert_not_called()
        cache, client, _ = self.fixture()

        def failed(refs, **_options):
            yield SimpleNamespace(reference=refs[0], to_dict=lambda: None)
            raise OSError("private upstream text")

        client.get_all.side_effect = failed
        with self.assertRaises(CacheUnavailable):
            cache.get_many(["a", "b"])
        self.assertEqual(len(cache.read_cache), 0)
        client.get_all.side_effect = lambda refs, **_options: []
        with self.assertRaises(CacheUnavailable):
            cache.get_many(["a"])
        self.assertEqual(len(cache.read_cache), 0)


class QuoteProviderTests(unittest.TestCase):
    def test_mapping_never_guesses_us_for_unknown_market_or_accepts_vendor_suffix_as_native(self):
        self.assertEqual(provider_symbol(CA), "SHOP.TO")
        self.assertEqual(provider_symbol({**CA, "symbol": "DLR.U", "currency": "USD"}), "DLR-U.TO")
        self.assertIsNone(provider_symbol({**CA, "symbol": "SHOP.TO"}))
        self.assertIsNone(provider_symbol({**US, "market": "ZZZZ"}))
        self.assertIsNone(provider_symbol({**US, "symbol": "^GSPC"}))

    def test_actual_currency_exchange_time_and_positive_bounded_native_price_are_required(self):
        result = checked_quote(CA, CA_META, NOW)
        self.assertEqual(result["price"], "123.45")
        self.assertEqual(result["source"], "yahoo_finance")
        for changes, reason in [
            ({"symbol": "SHOP"}, "not_found"),
            ({"exchangeName": "NMS"}, "not_found"),
            ({"currency": "USD"}, "currency_mismatch"),
            ({"regularMarketTime": None}, "unknown_time"),
            ({"regularMarketTime": NOW + 1}, "unknown_time"),
            ({"regularMarketTime": 10**400}, "unknown_time"),
        ]:
            value = checked_quote(CA, {**CA_META, **changes}, NOW)
            self.assertIsNone(value["price"])
            self.assertEqual(value["reason"], reason)
        for raw in [
            None,
            True,
            0,
            -1,
            float("nan"),
            float("inf"),
            "1e999999999",
            "0.0000000000000000001",
        ]:
            value = checked_quote(US, {**META, "regularMarketPrice": raw}, NOW)
            self.assertIsNone(value["price"])
            self.assertEqual(value["reason"], "invalid_value")
        self.assertEqual(
            checked_quote(US, {**META, "regularMarketPrice": "0.0000001"}, NOW)["price"],
            "0.0000001",
        )
        self.assertEqual(
            checked_quote(US, {**META, "instrumentType": []}, NOW)["reason"], "not_found"
        )

    def test_actual_worker_uses_unadjusted_history_and_reuses_metadata_with_two_threads(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "yfinance.py").write_text("""
class Ticker:
    def __init__(self, symbol): self.symbol = symbol
    def history(self, **kwargs):
        assert kwargs == dict(period="5d", interval="1d", auto_adjust=False, actions=False,
                              timeout=2, raise_errors=True, repair=False)
        self.loaded = True
    def get_history_metadata(self, repair):
        assert self.loaded and repair is False
        return dict(symbol=self.symbol, currency="USD", exchangeName="NMS")
""")
            with patch.dict(os.environ, {"PYTHONPATH": folder}):
                result = YahooQuoteProvider().fetch(["AAPL", "MSFT"], 2)
        self.assertEqual(set(result), {"AAPL", "MSFT"})
        self.assertEqual(result["AAPL"]["symbol"], "AAPL")

    def test_timeout_reaps_worker_and_keeps_only_completed_metadata_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            pid = Path(folder) / "pid"
            record = json.dumps({"symbol": "AAPL", "metadata": META})
            script = (
                "import os,pathlib,time\n"
                + f"pathlib.Path({str(pid)!r}).write_text(str(os.getpid()))\n"
                + f"print({record!r},flush=True)\n"
                + "time.sleep(10)\n"
            )
            start = time.monotonic()
            with patch("app.valuation_quotes.QUOTE_WORKER", script):
                result = YahooQuoteProvider().fetch(["AAPL", "MSFT"], 0.3)
            self.assertLess(time.monotonic() - start, 2)
            self.assertEqual(result, {"AAPL": META})
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid.read_text()), 0)
        with patch(
            "app.valuation_quotes.subprocess.run",
            return_value=SimpleNamespace(stdout=b"bad-json\n"),
        ):
            self.assertEqual(YahooQuoteProvider().fetch(["AAPL"], 1), {})
        with patch(
            "app.valuation_quotes.subprocess.run", return_value=SimpleNamespace(stdout=b"x" * 32769)
        ):
            self.assertEqual(YahooQuoteProvider().fetch(["AAPL"], 1), {})


class QuoteServiceTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.cache = SQLiteMarketCache(str(Path(folder.name) / "cache.sqlite3"))
        self.now = NOW
        self.market = MarketService(self.cache, clock=lambda: self.now)
        self.provider = MagicMock()
        self.provider.fetch.return_value = {"AAPL": META, "SHOP.TO": CA_META}
        self.service = QuoteService(self.market, self.provider)
        self.request = {"instruments": [US, CA]}

    def test_native_us_ca_quotes_share_one_batch_read_and_cache_while_preserving_order(self):
        with patch.object(self.cache, "get_many", wraps=self.cache.get_many) as get:
            result = self.service.quotes({"instruments": [CA, US, CA]})
        self.assertEqual(get.call_count, 1)
        validate_quote_batch(result, requested=[CA, US])
        self.assertEqual([i["instrument"] for i in result["items"]], [CA, US])
        self.assertEqual(self.provider.fetch.call_count, 1)
        self.assertEqual(len(self.provider.fetch.call_args.args[0]), 2)
        self.assertEqual(self.service.quotes({"instruments": [CA, US]}), result)
        self.assertEqual(self.provider.fetch.call_count, 1)
        with self.cache.connection() as db:
            self.assertEqual(
                json.loads(db.execute("SELECT value FROM market_state").fetchone()[0])["count"], 4
            )

    def test_cached_only_and_busy_worker_do_no_provider_claim_or_write_and_old_dates_survive(self):
        original = self.service.quotes(self.request)
        self.now += 901
        self.provider.fetch.reset_mock()
        with (
            patch.object(self.cache, "claim", side_effect=AssertionError),
            patch.object(self.cache, "put", side_effect=AssertionError),
        ):
            result = self.service.quotes(self.request, cached_only=True)
            with METRICS_LOCK:
                self.service.quotes(self.request)
        self.assertTrue(all(i["status"] == "stale" for i in result["items"]))
        self.assertEqual(result["items"][0]["sourceAsOf"], original["items"][0]["sourceAsOf"])
        self.assertEqual(result["items"][0]["fetchedAt"], original["items"][0]["fetchedAt"])
        self.provider.fetch.assert_not_called()

    def test_provider_failure_does_not_erase_a_prior_usable_quote_and_only_cools_once(self):
        original = self.service.quotes(self.request)
        self.now += 901
        self.provider.fetch.return_value = {}
        with patch.object(self.cache, "fail", wraps=self.cache.fail) as fail:
            result = self.service.quotes(self.request)
        self.assertEqual(fail.call_count, 1)
        self.assertEqual(
            [i["price"] for i in result["items"]], [i["price"] for i in original["items"]]
        )
        self.assertTrue(all(i["status"] == "stale" for i in result["items"]))
        self.assertIn("Yahoo", self.cache.claim("other", self.now))
        self.assertIsNone(self.cache.claim("fx", self.now, provider="bank_of_canada"))

    def test_four_refresh_cap_unknown_markets_and_actual_currency_mismatch_are_explicit(self):
        request = {"instruments": [{**US, "symbol": f"S{i}"} for i in range(8)]}
        self.provider.fetch.return_value = {}
        result = self.service.quotes(request)
        self.assertEqual(len(result["items"]), 8)
        self.assertEqual(len(self.provider.fetch.call_args.args[0]), 4)
        with patch.object(self.cache, "get_many", side_effect=AssertionError):
            row = self.service.quotes({"instruments": [{**US, "market": "UNKNOWN"}]})["items"][0]
        self.assertEqual(row["status"], "unsupported")
        self.assertIsNone(row["price"])
        self.now += 1000
        self.provider.fetch.return_value = {"SHOP.TO": {**CA_META, "currency": "USD"}}
        row = self.service.quotes({"instruments": [CA]})["items"][0]
        self.assertEqual(row["reason"], "currency_mismatch")

    def test_cache_admission_and_outages_stop_paid_work_and_soft_deadline_stops_new_provider_work(
        self,
    ):
        with (
            patch.object(self.cache, "get_many", side_effect=MarketLimited(1)),
            self.assertRaises(MarketLimited),
        ):
            self.service.quotes(self.request)
        self.provider.fetch.assert_not_called()
        with (
            patch.object(self.cache, "get_many", side_effect=CacheUnavailable),
            patch.object(self.cache, "claim", side_effect=AssertionError),
        ):
            self.service.quotes(self.request)
        self.provider.fetch.assert_not_called()
        ticks = iter([0, 1, 2, 11, 12])
        service = QuoteService(self.market, self.provider, monotonic=lambda: next(ticks))
        service.quotes(self.request)
        self.provider.fetch.assert_not_called()

    def test_older_observation_does_not_replace_a_newer_cached_price(self):
        original = self.service.quotes(self.request)
        self.now += 901
        self.provider.fetch.return_value = {
            "AAPL": {**META, "regularMarketTime": META["regularMarketTime"] - 100}
        }
        row = self.service.quotes({"instruments": [US]})["items"][0]
        self.assertEqual(row["sourceAsOf"], original["items"][0]["sourceAsOf"])
        self.assertEqual(row["status"], "stale")

    def test_private_fields_and_fifty_one_inputs_fail_before_storage_and_mock_has_no_live_prices(
        self,
    ):
        with patch.object(self.cache, "get_many", side_effect=AssertionError):
            for value in [{"instruments": [US], "holdings": []}, {"instruments": [US] * 51}]:
                with self.assertRaises(ValuationError):
                    self.service.quotes(value)
            self.market.source = "mock"
            result = self.service.quotes(self.request)
        self.assertTrue(all(i["price"] is None for i in result["items"]))
        self.provider.fetch.assert_not_called()


class QuoteHttpTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_actual_batch_route_and_validation_precede_storage_without_echoing_private_values(self):
        market = MagicMock()
        market.clock.return_value = NOW
        market.source = "yfinance"
        market.cache.get_many.return_value = {}
        service = QuoteService(market, MagicMock())
        app.dependency_overrides[get_quote_service] = lambda: service
        with TestClient(app) as client:
            result = client.post(
                "/api/valuation/quotes?cached=true", json={"instruments": [US, CA]}
            )
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.headers["cache-control"], "no-store")
            validate_quote_batch(result.json(), requested=[US, CA])
            market.cache.claim.assert_not_called()
            service.provider.fetch.assert_not_called()
            for body, code in [
                (b'{"instruments":[],"instruments":[]}', 400),
                (b'{"instruments":[],"private":"PRIVATE_CANARY"}', 400),
                (b" " * 8193, 413),
            ]:
                result = client.post(
                    "/api/valuation/quotes",
                    content=body,
                    headers={"content-type": "application/json"},
                )
                self.assertEqual(result.status_code, code)
                self.assertNotIn("PRIVATE_CANARY", result.text)
        app.dependency_overrides.clear()
        app.dependency_overrides[get_market_service] = lambda: (_ for _ in ()).throw(
            AssertionError("cache factory")
        )
        with TestClient(app) as client:
            self.assertEqual(
                client.post("/api/valuation/quotes", json={"instruments": []}).status_code, 400
            )
