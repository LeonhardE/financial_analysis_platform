"""Offline cost boundaries: real request flow, concurrent admission and SDK seams."""

import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.cost_controls import (
    SETTINGS,
    CostConfigurationUnavailable,
    CostControls,
    MarketLimited,
    TokenBudget,
    configured_controls,
    get_cost_controls,
)
from app.main import app
from app.market_cache import FirestoreMarketCache, SQLiteMarketCache
from app.market_data import MarketService, get_market_service
from app.stock_metrics import StockMetricsService
from app.yahoo_provider import Instrument

NOW = 1792494000.0


class Reference:
    def __init__(self, client, identity):
        self.client, self.identity = client, identity

    def get(self, **kwargs):
        self.client.reads += 1
        self.client.read_options.append(kwargs)
        value = deepcopy(self.client.documents.get(self.identity))
        return SimpleNamespace(to_dict=lambda: value)


class Transaction:
    def __init__(self, client):
        self.client = client
        self.pending = []

    def set(self, reference, value, *, merge=False):
        self.pending.append((reference.identity, deepcopy(value), merge))

    def commit(self):
        for identity, value, merge in self.pending:
            self.client.documents[identity] = (
                {**self.client.documents.get(identity, {}), **value} if merge else value
            )
        self.client.writes += len(self.pending)
        self.pending.clear()


class FirestoreFixture:
    def __init__(self):
        self.documents = {}
        self.reads = self.writes = 0
        self.read_options = []
        self.transaction = Transaction(self)

    def collection(self, name):
        return self

    def document(self, identity):
        return Reference(self, identity)

    def batch(self):
        self.batch_instance = MagicMock()
        return self.batch_instance

    def transactional(self, function):
        def run(transaction):
            try:
                result = function(transaction)
                transaction.commit()
                return result
            except Exception:
                transaction.pending.clear()
                raise

        return run


class BudgetTests(unittest.TestCase):
    def test_concurrent_charges_never_exceed_capacity(self):
        budget = TokenBudget(7, clock=lambda: 0)

        def charge(_):
            try:
                budget.charge()
                return True
            except MarketLimited:
                return False

        with ThreadPoolExecutor(max_workers=12) as pool:
            self.assertEqual(sum(pool.map(charge, range(40))), 7)
        self.assertEqual(budget.tokens, 0)

    def test_refill_retry_delay_and_backwards_clock_are_bounded(self):
        now = [0]
        budget = TokenBudget(2, clock=lambda: now[0])
        budget.charge(2)
        with self.assertRaises(MarketLimited) as failure:
            budget.charge()
        self.assertEqual(failure.exception.retry_after, 30)
        now[0] = 30
        budget.charge()
        now[0] = 0
        with self.assertRaises(MarketLimited):
            budget.charge()
        now[0] = 600
        budget.charge(2)
        self.assertEqual(budget.tokens, 0)

    def test_settings_cannot_disable_or_raise_versioned_ceilings(self):
        for index, (name, _default, maximum) in enumerate(SETTINGS):
            for invalid in ("0", "-1", str(maximum + 1), "unbounded", "1.5"):
                values = [str(setting[1]) for setting in SETTINGS]
                values[index] = invalid
                with (
                    self.subTest(name=name, invalid=invalid),
                    self.assertRaises(CostConfigurationUnavailable),
                ):
                    configured_controls(tuple(values))
        with patch.dict(os.environ, {}, clear=True):
            self.assertIs(get_cost_controls(), get_cost_controls())

    def test_inflight_limit_releases_on_failure(self):
        controls = CostControls(max_inflight=1, clock=lambda: 0)
        with self.assertRaises(RuntimeError), controls.admit():
            with self.assertRaises(MarketLimited):
                with controls.admit():
                    self.fail("Concurrency bypass")
            raise RuntimeError("synthetic failure")
        self.assertEqual(controls.inflight, 0)
        with controls.admit():
            self.assertEqual(controls.inflight, 1)


class StorageCostTests(unittest.TestCase):
    def setUp(self):
        self.client = FirestoreFixture()
        self.now = 0.0
        self.controls = CostControls(storage_limit=32, clock=lambda: self.now)
        self.patches = [
            patch("app.market_cache.firestore.Client", return_value=self.client),
            patch("app.market_cache.firestore.transactional", self.client.transactional),
            patch("app.market_cache.BoundedTransaction", return_value=self.client.transaction),
            patch("app.market_cache.time.monotonic", side_effect=lambda: self.now),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.cache = FirestoreMarketCache("synthetic-project", controls=self.controls)

    def test_original_129_key_probe_is_capped_without_any_upstream_or_writes(self):
        market = MarketService(self.cache, clock=lambda: NOW)
        provider = MagicMock()
        metrics = StockMetricsService(market, provider)
        denials = 0
        with patch.object(self.cache, "claim", wraps=self.cache.claim) as claim:
            for _ in range(2):
                for index in range(129):
                    try:
                        self.assertIsNone(metrics.metrics(f"ZZ{index:03d}", cached_only=True))
                    except MarketLimited:
                        denials += 1
            claim.assert_not_called()
        self.assertEqual(self.client.reads, 32)
        self.assertEqual(denials, 2 * (129 - 32))
        self.assertEqual(self.client.writes, 0)
        provider.fetch.assert_not_called()
        market.provider.history = MagicMock(side_effect=AssertionError("Unexpected Yahoo"))
        with self.assertRaises(MarketLimited):
            market.overview()
        market.provider.history.assert_not_called()
        self.assertEqual(self.client.reads, 32)

    def test_local_positive_and_negative_hits_are_free_but_expiry_is_charged(self):
        self.client.documents[self.cache.document("positive").identity] = {
            "value": {"price": 100},
            "updated": NOW,
        }
        self.assertEqual(self.cache.get("positive").value, {"price": 100})
        self.assertIsNone(self.cache.get("negative"))
        self.controls.storage.charge(30)
        self.assertEqual(self.cache.get("positive").value, {"price": 100})
        self.assertIsNone(self.cache.get("negative"))
        self.assertEqual(self.client.reads, 2)
        self.now = 31
        self.assertEqual(self.cache.get("positive").value, {"price": 100})
        self.assertEqual(self.client.reads, 3)
        self.assertEqual(self.client.read_options[-1], {"timeout": 4, "retry": None})

    def test_optional_daily_quote_limit_keeps_an_already_usable_chart_without_more_work(self):
        key = self.cache.document("candles:MSFT:3m").identity
        self.client.documents[key] = {
            "value": {
                "symbol": "MSFT",
                "range": "3m",
                "interval": "1d",
                "latestClose": 100,
                "changePercent": 0,
                "_refreshAfter": NOW + 3600,
            },
            "updated": NOW,
        }
        self.controls.storage.charge(31)
        provider = MagicMock()
        market = MarketService(self.cache, provider, clock=lambda: NOW)
        result = market.candles("MSFT", "3m", cached_only=True)
        self.assertEqual(result["latestClose"], 100)
        self.assertIsNone(result["quote"])
        self.assertEqual(self.client.reads, 1)
        self.assertEqual(self.client.writes, 0)
        provider.history.assert_not_called()
        provider.search.assert_not_called()

    def test_batch_request_work_is_charged_per_document_not_per_http_call(self):
        self.controls.storage.charge(29)
        provider = MagicMock()
        service = MarketService(self.cache, provider, clock=lambda: NOW)
        with self.assertRaises(MarketLimited):
            service.overview()
        self.assertEqual(self.client.reads, 3)
        self.assertEqual(self.client.writes, 0)
        provider.history.assert_not_called()

    def test_insufficient_transaction_write_budget_stages_nothing(self):
        self.controls.storage.charge(29)
        with self.assertRaises(MarketLimited):
            self.cache.claim("prices", NOW)
        self.assertEqual(self.client.reads, 2)
        self.assertEqual(self.client.writes, 0)
        self.assertEqual(self.client.transaction.pending, [])
        self.assertEqual(self.client.documents, {})

    def test_transaction_callback_retry_is_recharged_and_abort_does_not_commit(self):
        self.controls.storage.charge(26)

        def retrying(function):
            def run(transaction):
                function(transaction)
                # The SDK aborts the first attempt; its queued writes never commit.
                transaction.pending.clear()
                try:
                    return function(transaction)
                finally:
                    transaction.pending.clear()

            return run

        with patch("app.market_cache.firestore.transactional", retrying):
            with self.assertRaises(MarketLimited):
                self.cache.claim("prices", NOW)
        self.assertEqual(self.client.reads, 4)
        self.assertEqual(self.client.writes, 0)
        self.assertEqual(self.client.documents, {})

    def test_put_and_fail_cannot_make_half_writes_when_budget_is_exhausted(self):
        self.controls.storage.charge(31)
        with self.assertRaises(MarketLimited):
            self.cache.put("prices", {"price": 100}, NOW)
        self.assertEqual(self.client.reads, 1)
        self.assertEqual(self.client.documents, {})
        self.assertEqual(self.cache.read_cache, {})
        with self.assertRaises(MarketLimited):
            self.cache.fail("prices", NOW)
        self.client.batch_instance.set.assert_not_called()
        self.client.batch_instance.commit.assert_not_called()

    def test_accepted_search_keeps_nondefault_metrics_supported(self):
        item = Instrument("NFLX", "Netflix", yahoo_symbol="NFLX")
        provider = MagicMock()
        provider.search.return_value = [item]
        market = MarketService(self.cache, provider, clock=lambda: NOW)
        self.assertEqual(market.search("Netflix")["stocks"][0]["symbol"], "NFLX")
        metrics_provider = MagicMock()
        metrics_provider.fetch.return_value = {
            "trailingPE": 30,
            "marketCap": 200,
            "currency": "USD",
        }
        metrics = StockMetricsService(market, metrics_provider)
        self.assertIsNone(metrics.metrics("NFLX", cached_only=True))
        self.assertEqual(metrics.metrics("NFLX")["trailingPE"], 30)
        metrics_provider.fetch.assert_called_once_with(item)
        self.assertLessEqual(self.client.reads + self.client.writes, 32)


class HttpAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.controls = CostControls(request_limit=2, clock=lambda: 0)
        self.control_patch = patch(
            "app.cost_controls.get_cost_controls", return_value=self.controls
        )
        self.control_patch.start()
        self.addCleanup(self.control_patch.stop)
        app.dependency_overrides[get_market_service] = lambda: MarketService(None, source="mock")
        self.addCleanup(app.dependency_overrides.clear)

    def test_rate_rejection_is_before_dependencies_with_retry_cors_and_no_store(self):
        calls = MagicMock(return_value=MarketService(None, source="mock"))
        app.dependency_overrides[get_market_service] = lambda: calls()
        with TestClient(app) as client:
            for _ in range(2):
                self.assertEqual(
                    client.get(
                        "/api/stocks?cached=true", headers={"X-Forwarded-For": str(_)}
                    ).status_code,
                    200,
                )
            response = client.get(
                "/api/stocks?cached=true", headers={"Origin": "http://localhost:3000"}
            )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "30")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["access-control-expose-headers"], "Retry-After")
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")
        self.assertEqual(calls.call_count, 2)
        self.assertEqual(self.controls.inflight, 0)
        self.assertNotIn("cached", response.text)

    def test_concurrent_request_is_rejected_and_capacity_recovers(self):
        self.controls.max_inflight = 1
        started, release = threading.Event(), threading.Event()
        service = MarketService(None, source="mock")

        def overview(*, cached_only=False):
            started.set()
            self.assertTrue(release.wait(timeout=2))
            return {"stocks": []}

        service.overview = overview
        app.dependency_overrides[get_market_service] = lambda: service
        with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(client.get, "/api/stocks")
            self.assertTrue(started.wait(timeout=1))
            try:
                self.assertEqual(client.get("/api/stocks").status_code, 429)
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=2).status_code, 200)
            self.assertEqual(client.get("/api/stocks").status_code, 200)
        self.assertEqual(self.controls.inflight, 0)

    def test_health_ignores_invalid_controls_but_api_fails_closed(self):
        with patch("app.cost_controls.get_cost_controls", side_effect=CostConfigurationUnavailable):
            with TestClient(app) as client:
                self.assertEqual(client.get("/health").status_code, 200)
                response = client.get("/api/stocks")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("MARKET_", response.text)

    def test_metrics_http_probe_cannot_bypass_actual_storage_admission(self):
        client_store = FirestoreFixture()
        controls = CostControls(storage_limit=32, clock=lambda: 0)
        with patch("app.market_cache.firestore.Client", return_value=client_store):
            cache = FirestoreMarketCache("synthetic-project", controls=controls)
        market = MarketService(cache, clock=lambda: NOW)
        app.dependency_overrides[get_market_service] = lambda: market
        responses = []
        with patch("app.cost_controls.get_cost_controls", return_value=controls):
            with TestClient(app) as client:
                for _ in range(2):
                    for index in range(129):
                        response = client.get(f"/api/stocks/ZZ{index:03d}/metrics?cached=true")
                        responses.append(response.status_code)
                        if response.status_code == 429:
                            self.assertEqual(response.headers["cache-control"], "no-store")
                            self.assertIn("retry-after", response.headers)
                            self.assertNotIn(f"ZZ{index:03d}", response.text)
        self.assertEqual(responses.count(204), 64)
        self.assertEqual(responses.count(429), 194)
        self.assertEqual(client_store.reads, 32)
        self.assertEqual(client_store.writes, 0)

    def test_storage_throttling_is_not_converted_to_cache_unavailable_or_yahoo(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = SQLiteMarketCache(str(Path(directory) / "market.sqlite3"))
            cache.get = MagicMock(side_effect=MarketLimited(7))
            provider = MagicMock()
            service = MarketService(cache, provider)
            app.dependency_overrides[get_market_service] = lambda: service
            with TestClient(app) as client:
                response = client.get("/api/stocks?cached=true")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "7")
        provider.history.assert_not_called()
        cache.get.assert_called_once()
