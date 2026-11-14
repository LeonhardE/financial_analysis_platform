"""Offline daily FX, shared cost isolation and the actual anonymous HTTP boundary."""

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
from test_cost_controls import FirestoreFixture

from app.cost_controls import CostControls, MarketLimited, get_cost_controls
from app.main import app
from app.market_cache import CacheUnavailable, FirestoreMarketCache, SQLiteMarketCache
from app.market_data import MarketService, get_market_service
from app.valuation_fx import (
    FX_KEY,
    FX_LOCK,
    PROVIDER,
    BankOfCanadaProvider,
    FxService,
    get_fx_service,
    observation,
    publication_after,
)
from folioview_shared.valuation import ValuationError, validate_fx_batch

NOW = datetime(2026, 11, 13, 23, 0, tzinfo=UTC).timestamp()
ROW = {"sourceDate": "2026-11-13", "rates": {"USD": "1.4", "CNY": "0.2", "EUR": "1.5"}}
PAIRS = {
    "pairs": [
        {"base": "USD", "quote": "CAD"},
        {"base": "CAD", "quote": "USD"},
        {"base": "USD", "quote": "CNY"},
        {"base": "CNY", "quote": "CNY"},
    ]
}


class FxProviderTests(unittest.TestCase):
    def test_group_parser_preserves_one_actual_date_and_decimal_strings(self):
        raw = {
            "observations": [
                {"d": "2026-11-13", "FXUSDCAD": {"v": "1.4000"}, "FXCNYCAD": {"v": "0.2000"}}
            ]
        }
        with patch(
            "app.valuation_fx.subprocess.run",
            return_value=SimpleNamespace(stdout=json.dumps(raw).encode()),
        ) as run:
            result = BankOfCanadaProvider().fetch(NOW)
        self.assertEqual(
            result, {"sourceDate": "2026-11-13", "rates": {"USD": "1.4000", "CNY": "0.2000"}}
        )
        args, options = run.call_args
        self.assertNotIn("shell", options)
        self.assertEqual(options["timeout"], 5)
        self.assertEqual(len(args[0]), 3, "no client-controlled URL or provider argument")
        self.assertIn("FX_RATES_DAILY/json?recent=1", args[0][-1])

    def test_mixed_observations_future_dates_and_invalid_rates_are_not_spliced(self):
        rows = [
            [],
            [{"d": "2026-11-13"}, {"d": "2026-11-12"}],
            [{"d": "2027-01-01", "FXUSDCAD": {"v": "1.4"}}],
        ]
        for value in [None, 0, -1, True, "0", "-1", "NaN", "1e3", "Infinity"]:
            rows.append([{"d": "2026-11-13", "FXUSDCAD": {"v": value}}])
        for row in rows:
            with self.subTest(row=row), self.assertRaises(CacheUnavailable):
                observation({"observations": row}, NOW)

    def test_whole_worker_deadline_kills_and_reaps_a_slow_response(self):
        with tempfile.TemporaryDirectory() as folder:
            pid_file = Path(folder) / "pid"
            worker = (
                "import os,time,pathlib\n"
                f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
                "time.sleep(10)\n"
            )
            start = time.monotonic()
            with (
                patch("app.valuation_fx.FX_WORKER", worker),
                patch("app.valuation_fx.PROVIDER_TIMEOUT", 0.3),
                self.assertRaises(CacheUnavailable),
            ):
                BankOfCanadaProvider().fetch(NOW)
            self.assertLess(time.monotonic() - start, 2)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid_file.read_text()), 0)

    def test_invalid_oversized_and_subprocess_failure_never_expose_upstream_text(self):
        for raw in [b"private-canary", b"[]", b"{}", b" " * 65537]:
            with (
                patch("app.valuation_fx.subprocess.run", return_value=SimpleNamespace(stdout=raw)),
                self.assertRaises(CacheUnavailable),
            ):
                BankOfCanadaProvider().fetch(NOW)
        with (
            patch("app.valuation_fx.subprocess.run", side_effect=subprocess.SubprocessError),
            self.assertRaises(CacheUnavailable),
        ):
            BankOfCanadaProvider().fetch(NOW)


class FxServiceTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.cache = SQLiteMarketCache(str(Path(folder.name) / "cache.sqlite3"))
        self.now = NOW
        self.market = MarketService(self.cache, clock=lambda: self.now)
        self.provider = MagicMock()
        self.provider.fetch.return_value = ROW
        self.service = FxService(self.market, self.provider)

    def test_direct_inverse_cross_and_identity_share_one_provider_row_and_budget(self):
        result = self.service.rates(PAIRS)
        validate_fx_batch(result, requested=PAIRS["pairs"])
        self.assertEqual(
            [i["rate"] for i in result["items"]], ["1.4", "0.714285714285714286", "7", "1"]
        )
        self.assertEqual(
            [i["route"]["kind"] for i in result["items"]],
            ["direct", "inverse", "cross", "identity"],
        )
        self.assertEqual(result["items"][2]["route"]["via"], "CAD")
        self.assertTrue(all(i["sourceAsOf"] is None for i in result["items"]))
        self.assertEqual(result["items"][0]["sourceDate"], "2026-11-13")
        again = self.service.rates(PAIRS)
        self.assertEqual(again, result)
        self.provider.fetch.assert_called_once()
        with self.cache.connection() as db:
            state = json.loads(db.execute("SELECT value FROM market_state").fetchone()[0])
        self.assertEqual(state["count"], 1)
        self.assertGreater(publication_after("2026-11-13"), NOW + 2 * 86400)

    def test_cached_probe_and_identity_only_never_claim_write_or_fetch(self):
        with (
            patch.object(self.cache, "claim", side_effect=AssertionError),
            patch.object(self.cache, "put", side_effect=AssertionError),
        ):
            cold = self.service.rates(PAIRS, cached_only=True)
            self.assertEqual(cold["items"][0]["status"], "missing")
            self.assertEqual(cold["items"][-1]["rate"], "1")
        self.provider.fetch.assert_not_called()
        with patch.object(self.cache, "get", side_effect=AssertionError):
            self.service.rates({"pairs": [{"base": "USD", "quote": "USD"}]})

    def test_refresh_failure_retains_the_original_date_time_and_marks_stale(self):
        original = self.service.rates(PAIRS)
        self.now = publication_after("2026-11-13") + 1
        self.provider.fetch.side_effect = CacheUnavailable
        current = self.service.rates(PAIRS)
        self.assertEqual(current["items"][0]["status"], "stale")
        self.assertEqual(current["items"][0]["sourceDate"], original["items"][0]["sourceDate"])
        self.assertEqual(current["items"][0]["fetchedAt"], original["items"][0]["fetchedAt"])
        self.assertIsNone(
            self.cache.claim("unrelated-yahoo", self.now), "BOC outage must not stop Yahoo"
        )
        self.service.rates(PAIRS)
        self.assertEqual(self.provider.fetch.call_count, 2, "cooldown prevents a refresh loop")

    def test_missing_leg_old_or_invalid_cache_never_substitutes_zero_or_another_date(self):
        self.provider.fetch.return_value = {"sourceDate": "2026-11-13", "rates": {"USD": "1.4"}}
        current = self.service.rates(PAIRS)
        self.assertEqual(current["items"][2]["reason"], "missing_leg")
        self.assertIsNone(current["items"][2]["rate"])
        self.now += 8 * 86400
        self.provider.fetch.side_effect = CacheUnavailable
        current = self.service.rates(PAIRS)
        self.assertEqual(current["items"][0]["status"], "missing")
        self.assertIsNone(current["items"][0]["rate"])
        with patch.object(
            self.cache, "get", return_value=SimpleNamespace(value={"private": "CANARY"})
        ):
            current = self.service.rates(PAIRS, cached_only=True)
        self.assertNotIn("CANARY", json.dumps(current))

    def test_unrepresentable_cross_is_missing_without_losing_other_pairs(self):
        self.provider.fetch.return_value = {
            "sourceDate": "2026-11-13",
            "rates": {"USD": "99999999999999999999", "CNY": "0.000000000000000001"},
        }
        items = self.service.rates(PAIRS)["items"]
        self.assertEqual(items[2]["reason"], "invalid_value")
        self.assertIsNone(items[2]["rate"])
        self.assertEqual(items[-1]["rate"], "1")

    def test_busy_lease_daily_budget_and_cache_outage_never_bypass_admission(self):
        with FX_LOCK:
            self.assertEqual(self.service.rates(PAIRS)["items"][0]["status"], "missing")
        self.provider.fetch.assert_not_called()
        with patch.object(
            self.cache,
            "claim",
            return_value="The shared daily market refresh limit has been reached.",
        ):
            self.assertEqual(self.service.rates(PAIRS)["items"][0]["reason"], "budget_exhausted")
        self.provider.fetch.assert_not_called()
        with patch.object(self.cache, "get", side_effect=CacheUnavailable):
            self.assertEqual(self.service.rates(PAIRS)["items"][0]["status"], "missing")
        self.provider.fetch.assert_not_called()
        with (
            patch.object(self.cache, "get", side_effect=MarketLimited(1)),
            self.assertRaises(MarketLimited),
        ):
            self.service.rates(PAIRS)

    def test_invalid_private_requests_are_rejected_before_cache_access_and_pairs_deduplicate(self):
        with patch.object(self.cache, "get", side_effect=AssertionError):
            for invalid in [
                {"pairs": PAIRS["pairs"], "holdings": []},
                {"pairs": []},
                {"pairs": PAIRS["pairs"] * 6},
            ]:
                with self.assertRaises(ValuationError):
                    self.service.rates(invalid)
        self.assertEqual(len(self.service.rates({"pairs": [PAIRS["pairs"][0]] * 2})["items"]), 1)

    def test_mock_mode_does_not_request_real_fx_or_present_fictional_prices(self):
        self.market.source = "mock"
        with patch.object(self.cache, "get", side_effect=AssertionError):
            items = self.service.rates(PAIRS)["items"]
        self.assertEqual(items[0]["status"], "missing")
        self.assertEqual(items[-1]["rate"], "1")
        self.provider.fetch.assert_not_called()


class ProviderBudgetIsolationTests(unittest.TestCase):
    def test_sqlite_sources_share_total_budget_but_not_availability_cooldown(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = SQLiteMarketCache(str(Path(folder) / "cache.sqlite3"))
            cache.fail("yahoo-failure", NOW)
            self.assertIsNone(cache.claim(FX_KEY, NOW, provider=PROVIDER))
            cache.fail(FX_KEY, NOW, provider=PROVIDER)
            self.assertIn("Yahoo", cache.claim("yahoo-other", NOW))
            self.assertIn("Reference", cache.claim("fx-other", NOW, provider=PROVIDER))
            cache.daily_limit = 1
            self.assertIn("daily", cache.claim("yahoo-later", NOW + 1000))
            self.assertIn("daily", cache.claim("fx-later", NOW + 1000, provider=PROVIDER))

    def test_firestore_provider_failure_preserves_yahoo_cooldown_and_charges_all_operations(self):
        client = FirestoreFixture()
        controls = CostControls(storage_limit=100, clock=lambda: 0)
        with patch("app.market_cache.firestore.Client", return_value=client):
            cache = FirestoreMarketCache("unit-test", controls=controls)
        cache.fail(FX_KEY, NOW, provider=PROVIDER)
        writes = client.batch_instance.set.call_args_list
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[1].args[1], {"bank_of_canada_cooldown": NOW + 300})
        self.assertEqual(controls.storage.tokens, 98)
        cache.fail("old-yahoo", NOW)
        self.assertEqual(
            client.batch_instance.set.call_args_list[1].args[1], {"cooldown": NOW + 300}
        )
        client.documents["shared_upstream_budget"] = {"bank_of_canada_cooldown": NOW + 300}
        with (
            patch("app.market_cache.firestore.transactional", client.transactional),
            patch("app.market_cache.BoundedTransaction", return_value=client.transaction),
        ):
            self.assertIsNone(cache.claim("new-yahoo", NOW))
            self.assertIn("Reference", cache.claim("new-fx", NOW, provider=PROVIDER))
        self.assertEqual(client.documents["shared_upstream_budget"]["count"], 1)


class FxHttpTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_actual_post_cors_no_store_closed_body_and_no_user_sdk(self):
        market = MagicMock()
        market.source = "yfinance"
        market.clock.return_value = NOW
        market.cache = MagicMock()
        market.cache.get.return_value = None
        service = FxService(market)
        service.provider = MagicMock()
        service.provider.fetch.side_effect = CacheUnavailable
        app.dependency_overrides[get_fx_service] = lambda: service
        app.dependency_overrides[get_cost_controls] = lambda: CostControls(clock=lambda: 0)
        with TestClient(app) as client:
            r = client.post("/api/valuation/fx?cached=true", json=PAIRS)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.headers["cache-control"], "no-store")
            validate_fx_batch(r.json(), requested=PAIRS["pairs"])
            market.cache.claim.assert_not_called()
            service.provider.fetch.assert_not_called()
            r = client.options(
                "/api/valuation/fx",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                },
            )
            self.assertEqual(r.status_code, 200)
            self.assertIn("POST", r.headers["access-control-allow-methods"])
            for raw, status in [
                (b'{"pairs":[],"pairs":[]}', 400),
                (b'{"pairs":[],"private":"CANARY"}', 400),
                (b" " * 4097, 413),
                (b"[" * 1100 + b"]" * 1100, 400),
            ]:
                r = client.post(
                    "/api/valuation/fx", content=raw, headers={"Content-Type": "application/json"}
                )
                self.assertEqual(r.status_code, status)
                self.assertNotIn("CANARY", r.text)
                self.assertEqual(r.headers["cache-control"], "no-store")
            self.assertEqual(client.post("/api/valuation/fx", content="x").status_code, 415)

    def test_invalid_body_does_not_even_construct_a_market_cache_and_storage_denial_is_429(self):
        app.dependency_overrides[get_market_service] = lambda: (_ for _ in ()).throw(
            AssertionError("cache factory")
        )
        with TestClient(app) as client:
            self.assertEqual(client.post("/api/valuation/fx", json={"pairs": []}).status_code, 400)
        app.dependency_overrides.clear()
        market = MagicMock()
        market.source = "yfinance"
        market.clock.return_value = NOW
        market.cache.get.side_effect = MarketLimited(17)
        app.dependency_overrides[get_fx_service] = lambda: FxService(market)
        with TestClient(app) as client:
            result = client.post("/api/valuation/fx", json=PAIRS)
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.headers["retry-after"], "17")
        self.assertEqual(result.headers["cache-control"], "no-store")
        market.cache.claim.assert_not_called()
