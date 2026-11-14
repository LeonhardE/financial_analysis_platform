"""Private FX preferences: bounded ordered follows, CAS, namespace and default composition."""

import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.watchlist import (
    FirestoreWatchlistStore,
    FxPreferencesConflict,
    SQLiteWatchlistStore,
    WatchlistUnavailable,
    empty_fx,
    fx_owner,
    get_watchlist_store,
)
from folioview_shared import auth as app_auth
from folioview_shared.valuation import (
    CURRENCY_PROFILE,
    VALUATION_CONTRACT,
    effective_fx_pairs,
    fx_preferences_snapshot,
)

UID = "fx-owner"
USD_CNY = {"base": "USD", "quote": "CNY"}
USD_CAD = {"base": "USD", "quote": "CAD"}
CAD_USD = {"base": "CAD", "quote": "USD"}


def update(pairs=None, version=0, suppressed=None):
    return {
        "preferences": {
            "pairs": pairs if pairs is not None else [CAD_USD, USD_CNY],
            "suppressedDefault": suppressed,
        },
        "expectedVersion": version,
    }


def currency(code, generation=1):
    return {
        "contractVersion": VALUATION_CONTRACT,
        "profile": CURRENCY_PROFILE,
        "preferences": {"defaultPortfolioCurrency": code},
        "version": generation,
        "currencyGeneration": generation,
    }


class FxStoreTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "user.sqlite3")
        self.store = SQLiteWatchlistStore(self.path)

    def test_absence_and_composition_do_not_write_and_preserve_manual_order(self):
        self.assertEqual(self.store.get_fx(UID), empty_fx())
        self.assertEqual(
            effective_fx_pairs(self.store.get_fx(UID), currency("CNY")),
            [{**USD_CNY, "origin": "default"}],
        )
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM user_watchlists").fetchone()[0], 0)
        saved = self.store.save_fx(UID, update())
        self.assertEqual(saved["preferences"]["pairs"], [CAD_USD, USD_CNY])
        self.assertEqual(
            effective_fx_pairs(saved, currency("CNY")),
            [{**CAD_USD, "origin": "manual"}, {**USD_CNY, "origin": "manual"}],
        )
        self.assertEqual(
            effective_fx_pairs(saved, currency("CAD")),
            [
                {**USD_CAD, "origin": "default"},
                {**CAD_USD, "origin": "manual"},
                {**USD_CNY, "origin": "manual"},
            ],
        )
        self.assertEqual(len(effective_fx_pairs(saved, currency("USD"))), 2)
        self.assertEqual(
            effective_fx_pairs(saved, None),
            [{**CAD_USD, "origin": "manual"}, {**USD_CNY, "origin": "manual"}],
        )
        self.assertEqual(self.store.get_fx("other"), empty_fx())

    def test_default_dismissal_survives_restart_and_identical_config_save_context(self):
        saved = self.store.save_fx(
            UID, update([], suppressed={"currency": "CNY", "currencyGeneration": 1})
        )
        restarted = SQLiteWatchlistStore(self.path)
        same = {**currency("CNY"), "version": 2}
        self.assertEqual(effective_fx_pairs(restarted.get_fx(UID), same), [])
        self.assertEqual(
            effective_fx_pairs(saved, currency("CAD", 2)), [{**USD_CAD, "origin": "default"}]
        )
        self.assertEqual(
            effective_fx_pairs(saved, currency("CNY", 3)), [{**USD_CNY, "origin": "default"}]
        )
        same_save = restarted.save_fx(
            UID, update([], 1, {"currency": "CNY", "currencyGeneration": 1})
        )
        self.assertEqual(same_save["version"], 2)
        with self.assertRaises(FxPreferencesConflict):
            restarted.save_fx(UID, update([], 1))
        self.assertEqual(effective_fx_pairs(restarted.get_fx(UID), same), [])

    def test_concurrent_version_has_one_winner_and_fx_never_changes_stock_resource_revision(self):
        def save(index):
            try:
                return SQLiteWatchlistStore(self.path).save_fx(
                    UID, update([USD_CAD] if index % 2 else [USD_CNY])
                )
            except FxPreferencesConflict:
                return None

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(save, range(12)))
        self.assertEqual(sum(r is not None for r in results), 1)
        stock = {
            "symbol": "AAPL",
            "name": "Apple",
            "instrumentType": "stock",
            "currency": "USD",
            "addedAt": "2026-11-13T00:00:00Z",
        }
        self.store.change(UID, "AAPL", stock)
        with sqlite3.connect(self.path) as db:
            before = db.execute("SELECT owner,value FROM user_resource_versions").fetchall()
        saved = self.store.save_fx(UID, update([], 1))
        self.assertEqual(self.store.get(UID), [stock])
        self.store.change(UID, "AAPL", None)
        self.assertEqual(self.store.get_fx(UID), saved)
        with sqlite3.connect(self.path) as db:
            after_stock_change = db.execute(
                "SELECT owner,value FROM user_resource_versions"
            ).fetchall()
        self.assertNotEqual(before, after_stock_change)
        self.store.save_fx(UID, update([], 2))
        with sqlite3.connect(self.path) as db:
            self.assertEqual(
                db.execute("SELECT owner,value FROM user_resource_versions").fetchall(),
                after_stock_change,
            )

    def test_corrupt_saved_fx_data_is_not_absence_or_replaced_by_defaults(self):
        saved = self.store.save_fx(UID, update())
        for value in [
            None,
            {},
            empty_fx(),
            {**saved, "unexpected": "PRIVATE_CANARY"},
            {**saved, "version": True},
        ]:
            with sqlite3.connect(self.path) as db:
                db.execute(
                    "UPDATE user_watchlists SET value=? WHERE owner=?",
                    (json.dumps(value), fx_owner(UID)),
                )
            for action in [
                lambda: self.store.get_fx(UID),
                lambda: self.store.save_fx(UID, update()),
            ]:
                with self.subTest(value=value), self.assertRaises(WatchlistUnavailable):
                    action()
            with sqlite3.connect(self.path) as db:
                self.assertEqual(
                    json.loads(db.execute("SELECT value FROM user_watchlists").fetchone()[0]), value
                )


class FxFirestoreTests(unittest.TestCase):
    def test_existing_collection_namespace_bounded_cas_and_corruption_do_no_foreign_writes(self):
        client = MagicMock()
        reference = client.collection.return_value.document.return_value
        reference.get.return_value.to_dict.return_value = None
        transaction = MagicMock()
        with (
            patch("app.watchlist.firestore.Client", return_value=client),
            patch("app.watchlist.firestore.transactional", side_effect=lambda f: f),
            patch("app.watchlist.BoundedTransaction", return_value=transaction) as make,
        ):
            store = FirestoreWatchlistStore("unit-project", "(default)")
            self.assertEqual(store.get_fx(UID), empty_fx())
            reference.get.assert_called_with(timeout=4, retry=None)
            client.collection.assert_called_once_with("user_watchlists")
            client.collection.return_value.document.assert_called_with(fx_owner(UID))
            saved = store.save_fx(UID, update())
            transaction.set.assert_called_once_with(reference, saved)
            reference.get.assert_called_with(transaction=transaction, timeout=4, retry=None)
            make.assert_called_once_with(client, max_attempts=2)
            reference.get.return_value.to_dict.return_value = saved
            transaction.reset_mock()
            with self.assertRaises(FxPreferencesConflict):
                store.save_fx(UID, update())
            transaction.set.assert_not_called()
            reference.get.return_value.to_dict.return_value = {"private": "PRIVATE_CANARY"}
            with self.assertRaises(WatchlistUnavailable):
                store.get_fx(UID)
            with self.assertRaises(WatchlistUnavailable):
                store.save_fx(UID, update())
            transaction.set.assert_not_called()


class FxHttpTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLiteWatchlistStore(str(Path(directory.name) / "user.sqlite3"))
        app.dependency_overrides[get_watchlist_store] = lambda: self.store
        self.addCleanup(app.dependency_overrides.clear)
        for context in [
            patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "test-project"}, clear=True),
            patch.object(
                app_auth.firebase_admin,
                "get_app",
                return_value=SimpleNamespace(project_id="test-project"),
            ),
        ]:
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(
            app_auth.auth,
            "verify_id_token",
            return_value={"uid": UID, "firebase": {"sign_in_provider": "google.com"}},
        )
        self.verify = context.start()
        self.addCleanup(context.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def request(self, method="GET", **kwargs):
        return self.client.request(
            method, "/api/v1/fx-follows", headers={"Authorization": "Bearer test-token"}, **kwargs
        )

    def test_actual_auth_private_headers_owner_scope_and_watchlist_api_are_preserved(self):
        self.assertEqual(self.client.get("/api/v1/fx-follows?uid=" + UID).status_code, 401)
        self.verify.assert_not_called()
        self.assertEqual(self.request().json(), empty_fx())
        result = self.request("PUT", json=update())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["cache-control"], "no-store")
        fx_preferences_snapshot(result.json())
        self.assertEqual(
            self.client.get(
                "/api/v1/watchlist", headers={"Authorization": "Bearer test-token"}
            ).json()["items"],
            [],
        )
        self.verify.return_value = {"uid": "other", "firebase": {"sign_in_provider": "google.com"}}
        self.assertEqual(self.request().json(), empty_fx())
        self.assertEqual(self.store.get_fx(UID), result.json())
        paths = self.client.get("/openapi.json").json()["paths"]
        self.assertIn("requestBody", paths["/api/v1/fx-follows"]["put"])

    def test_duplicates_identity_pairs_bounds_and_unknown_fields_are_rejected_before_save(self):
        bodies = [
            update([USD_CNY, USD_CNY]),
            update([{"base": "USD", "quote": "USD"}]),
            update([USD_CNY] * 13),
            update([{"base": "XYZ", "quote": "CAD"}]),
            update([], suppressed={"currency": "USD", "currencyGeneration": 1}),
            update([], suppressed={"currency": "CNY", "currencyGeneration": 0}),
            update([], version=True),
            {**update(), "uid": "another"},
        ]
        with patch.object(self.store, "save_fx", side_effect=AssertionError("invalid write")):
            for value in bodies:
                self.assertEqual(self.request("PUT", json=value).status_code, 422)
        self.assertEqual(self.request("PUT", content=b" " * 4097).status_code, 415)
        response = self.client.put(
            "/api/v1/fx-follows",
            content=b" " * 4097,
            headers={"Authorization": "Bearer test-token", "Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.headers["cache-control"], "no-store")
        response = self.client.put(
            "/api/v1/fx-follows",
            content=b'{"preferences":{},"preferences":{}}',
            headers={"Authorization": "Bearer test-token", "Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 422)

    def test_unknown_commit_can_be_read_and_stale_original_cannot_overwrite_it(self):
        save = self.store.save_fx

        def committed_lost(uid, value):
            save(uid, value)
            raise WatchlistUnavailable

        with patch.object(self.store, "save_fx", side_effect=committed_lost):
            self.assertEqual(self.request("PUT", json=update()).status_code, 503)
        current = self.request().json()
        self.assertEqual(current["version"], 1)
        self.assertEqual(self.request("PUT", json=update([])).status_code, 409)
        self.assertEqual(self.request().json(), current)
