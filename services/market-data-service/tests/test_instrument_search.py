"""Canonical identity and actual anonymous search boundary, without provider/network calls."""

import json
import os
import subprocess
import tempfile
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.cost_controls import CostControls, MarketLimited, get_cost_controls
from app.instrument_search import (
    InstrumentSearchService,
    YahooInstrumentProvider,
    cache_key,
    canonical_identity,
    get_instrument_search,
    search_request,
)
from app.main import app
from app.market_cache import CacheUnavailable, SQLiteMarketCache
from app.market_data import MarketService
from app.stock_metrics import METRICS_LOCK

NOW = datetime(2026, 11, 14, 1, tzinfo=UTC).timestamp()
US = {"symbol": "SHOP", "exchange": "NYQ", "currency": "USD", "name": "Shop", "kind": "EQUITY"}
CA = {**US, "symbol": "SHOP.TO", "exchange": "TOR", "currency": "CAD"}


class IdentityTests(unittest.TestCase):
    def test_canonical_identity_retains_market_currency_and_does_not_guess_from_suffix(self):
        self.assertEqual(
            canonical_identity(US),
            {
                "symbol": "SHOP",
                "market": "XNYS",
                "currency": "USD",
                "name": "Shop",
                "assetType": "stock",
            },
        )
        self.assertEqual(canonical_identity(CA)["market"], "XTSE")
        self.assertEqual(canonical_identity(CA)["symbol"], "SHOP")
        self.assertEqual(canonical_identity({**CA, "currency": "USD"})["currency"], "USD")
        self.assertEqual(canonical_identity({**US, "symbol": "BRK-B"})["symbol"], "BRK.B")
        self.assertEqual(canonical_identity({**CA, "kind": "ETF"})["assetType"], "etf")
        for value in [
            {**US, "exchange": "TOR"},
            {**CA, "symbol": "SHOP"},
            {**US, "currency": None},
            {**US, "currency": "ZZZ"},
            {**US, "exchange": "UNKNOWN"},
            {**US, "symbol": "../../url"},
            {**US, "kind": "FUTURE"},
            {**US, "kind": []},
            {**US, "name": "private\ntext"},
            {**US, "quantity": "1"},
        ]:
            self.assertIsNone(canonical_identity(value))

    def test_closed_query_is_bounded_and_never_accepts_private_fields_or_provider_urls(self):
        self.assertEqual(search_request({"query": " Apple "}), {"query": "Apple"})
        self.assertEqual(search_request({"query": "银行"}), {"query": "银行"})
        for value in [
            None,
            [],
            {},
            {"query": ""},
            {"query": "a" * 51},
            {"query": 1},
            {"query": "https://example.com"},
            {"query": "AAPL", "cost": "100"},
        ]:
            with self.assertRaises(ValueError):
                search_request(value)

    def test_provider_protocol_deduplicates_identity_but_keeps_cross_market_candidates(self):
        raw = "\n".join(
            json.dumps(x) for x in [{"item": US}, {"item": CA}, {"item": US}, {"complete": True}]
        )
        with patch(
            "app.instrument_search.subprocess.run",
            return_value=SimpleNamespace(stdout=raw.encode()),
        ) as run:
            result = YahooInstrumentProvider().search("SHOP")
        self.assertEqual(len(result["items"]), 2)
        self.assertTrue(result["complete"])
        self.assertEqual(run.call_args.kwargs["timeout"], 6)
        self.assertNotIn("shell", run.call_args.kwargs)
        self.assertEqual(json.loads(run.call_args.args[0][-1])[0], "SHOP")
        for raw in [
            b"private_canary",
            b"[]",
            b" " * 16385,
            b'{"complete":true,"complete":false}',
            json.dumps({"item": {**CA, "currency": None}}).encode(),
        ]:
            with (
                patch(
                    "app.instrument_search.subprocess.run", return_value=SimpleNamespace(stdout=raw)
                ),
                self.assertRaises(CacheUnavailable),
            ):
                YahooInstrumentProvider().search("SHOP")

    def test_actual_worker_uses_explicit_currency_and_verifies_missing_currency_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "yfinance.py").write_text("""
class Search:
    def __init__(self, query, **options):
        assert query == "SHOP"
        assert options == dict(max_results=10, news_count=0, lists_count=0,
                              recommended=0, include_cb=False, timeout=2)
        self.quotes = [dict(symbol="SHOP", exchange="NYQ", quoteType="EQUITY", currency="USD"),
                       dict(symbol="SHOP.TO", exchange="TOR", quoteType="EQUITY"),
                       dict(symbol="UNKNOWN", exchange="ZZZ", quoteType="EQUITY")]
class Ticker:
    def __init__(self, symbol):
        assert symbol == "SHOP.TO", "explicit search currency needs no redundant history request"
    def history(self, **options):
        assert options == dict(period="5d", interval="1d", auto_adjust=False, actions=False,
                               timeout=2, raise_errors=True, repair=False)
    def get_history_metadata(self, repair):
        assert repair is False
        return dict(symbol="SHOP.TO", exchangeName="TOR", currency="CAD", instrumentType="EQUITY")
""")
            with patch.dict(os.environ, {"PYTHONPATH": folder}):
                result = YahooInstrumentProvider().search("SHOP")
        self.assertTrue(result["complete"])
        self.assertEqual({x["market"] for x in result["items"]}, {"XNYS", "XTSE"})

    def test_timeout_reaps_child_retains_complete_lines_and_marks_candidate_set_incomplete(self):
        with tempfile.TemporaryDirectory() as folder:
            pid = Path(folder, "pid")
            line = json.dumps({"item": US})
            script = (
                "import os,time,pathlib\n"
                + f"pathlib.Path({str(pid)!r}).write_text(str(os.getpid()))\n"
                + f"print({line!r}, flush=True)\n"
                + "print('{',end='',flush=True)\ntime.sleep(10)\n"
            )
            start = time.monotonic()
            with (
                patch("app.instrument_search.SEARCH_WORKER", script),
                patch("app.instrument_search.PROVIDER_SECONDS", 0.3),
            ):
                result = YahooInstrumentProvider().search("SHOP")
            self.assertLess(time.monotonic() - start, 2)
            self.assertFalse(result["complete"])
            self.assertEqual(result["items"], [canonical_identity(US)])
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid.read_text()), 0)
        with (
            patch("app.instrument_search.subprocess.run", side_effect=subprocess.SubprocessError),
            self.assertRaises(CacheUnavailable),
        ):
            YahooInstrumentProvider().search("SHOP")


class SearchServiceTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.cache = SQLiteMarketCache(str(Path(folder.name, "cache.sqlite3")))
        self.now = NOW
        self.market = MarketService(self.cache, clock=lambda: self.now)
        self.provider = MagicMock()
        self.provider.search.return_value = {
            "items": [canonical_identity(US), canonical_identity(CA)],
            "complete": True,
        }
        self.service = InstrumentSearchService(self.market, self.provider)

    def test_cache_only_is_one_read_with_no_lease_provider_or_write_and_fresh_reuse(self):
        with (
            patch.object(self.cache, "claim", wraps=self.cache.claim) as claim,
            patch.object(self.cache, "put", wraps=self.cache.put) as put,
        ):
            self.assertEqual(
                self.service.search({"query": "SHOP"}, cached_only=True)["reason"], "not_cached"
            )
            claim.assert_not_called()
            put.assert_not_called()
            self.provider.search.assert_not_called()
            first = self.service.search({"query": "SHOP"})
            self.assertEqual(claim.call_args.kwargs["cost"], 9)
            self.assertEqual(first["status"], "available")
            self.assertEqual(self.service.search({"query": "shop"}, cached_only=True), first)
            self.assertEqual(self.service.search({"query": "SHOP"}), first)
            self.assertEqual(self.provider.search.call_count, 1)

    def test_stale_outage_preserves_original_collection_time_and_missing_is_not_false_empty(self):
        first = self.service.search({"query": "SHOP"})
        self.now += 86401
        self.provider.search.side_effect = CacheUnavailable
        stale = self.service.search({"query": "SHOP"})
        self.assertEqual(stale["status"], "stale")
        self.assertEqual(stale["fetchedAt"], first["fetchedAt"])
        self.assertEqual(stale["items"], first["items"])
        self.assertEqual(stale["reason"], "unavailable")
        self.now += 7 * 86400
        self.assertEqual(
            self.service.search({"query": "SHOP"}, cached_only=True)["status"], "missing"
        )
        fresh = self.service.search({"query": "OTHER"})
        self.assertFalse(fresh["complete"])
        self.assertIsNone(fresh["fetchedAt"])

    def test_provider_busy_budget_and_storage_failures_never_launch_extra_work(self):
        METRICS_LOCK.acquire()
        try:
            self.assertEqual(self.service.search({"query": "SHOP"})["reason"], "busy")
        finally:
            METRICS_LOCK.release()
        self.provider.search.assert_not_called()
        with patch.object(self.cache, "claim", return_value="limited"):
            self.assertEqual(self.service.search({"query": "SHOP"})["reason"], "limited")
        self.provider.search.assert_not_called()
        with patch.object(self.cache, "get", side_effect=CacheUnavailable):
            self.assertEqual(self.service.search({"query": "SHOP"})["status"], "missing")
        with (
            patch.object(self.cache, "get", side_effect=MarketLimited(1)),
            self.assertRaises(MarketLimited),
        ):
            self.service.search({"query": "SHOP"})
        self.provider.search.assert_not_called()

    def test_empty_completed_search_is_different_from_unavailable_and_partial_stays_explicit(self):
        self.provider.search.return_value = {"items": [], "complete": True}
        empty = self.service.search({"query": "NONE"})
        self.assertEqual(empty["status"], "available")
        self.assertTrue(empty["complete"])
        self.provider.search.return_value = {"items": [canonical_identity(US)], "complete": False}
        partial = self.service.search({"query": "PART"})
        self.assertFalse(partial["complete"])
        self.assertEqual(len(partial["items"]), 1)

    def test_untrusted_cached_shape_and_timestamp_never_become_an_identity(self):
        self.service.search({"query": "SHOP"})
        original = self.cache.get(cache_key("SHOP")).value
        for change in [
            {"_collectedAt": self.now + 1},
            {"_refreshAfter": self.now + 999999},
            {"items": [{**canonical_identity(US), "cost": "private"}]},
            {"items": [{**canonical_identity(US), "symbol": []}]},
        ]:
            self.cache.put(cache_key("SHOP"), {**original, **change}, self.now)
            value = self.service.search({"query": "SHOP"}, cached_only=True)
            self.assertEqual(value["status"], "missing")

    def test_real_http_body_boundary_diagnostics_and_cache_mode(self):
        app.dependency_overrides[get_instrument_search] = lambda: self.service
        app.dependency_overrides[get_cost_controls] = lambda: CostControls()
        self.addCleanup(app.dependency_overrides.clear)
        with TestClient(app) as client:
            first = client.post(
                "/api/valuation/instruments/search?cached=true", json={"query": "SHOP"}
            )
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.headers["cache-control"], "no-store")
            self.provider.search.assert_not_called()
            result = client.post("/api/valuation/instruments/search", json={"query": "SHOP"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(len(result.json()["items"]), 2)
            for body in [
                '{"query":"SHOP","cost":"private_canary"}',
                '{"query":"A","query":"B"}',
                "[]",
                "{",
            ]:
                rejected = client.post(
                    "/api/valuation/instruments/search",
                    content=body,
                    headers={"content-type": "application/json"},
                )
                self.assertEqual(rejected.status_code, 400)
                self.assertNotIn("private_canary", rejected.text)
                self.assertEqual(rejected.headers["cache-control"], "no-store")
            self.assertEqual(
                client.post(
                    "/api/valuation/instruments/search",
                    content="x" * 1025,
                    headers={"content-type": "application/json"},
                ).status_code,
                413,
            )
            self.assertEqual(
                client.post(
                    "/api/valuation/instruments/search",
                    content='{"query":"SHOP"}',
                    headers={"content-type": "text/plain"},
                ).status_code,
                415,
            )
            self.assertEqual(self.provider.search.call_count, 1)
