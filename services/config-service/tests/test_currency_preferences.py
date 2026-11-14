"""Independent currency namespace, existing private auth/CAS and read-time defaults."""

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
from app.preferences import (
    FirestorePreferencesStore,
    PreferencesConflict,
    PreferencesUnavailable,
    SQLitePreferencesStore,
    checked_currency_record,
    currency_owner,
    empty_currency,
    get_preferences_store,
)
from folioview_shared import auth as app_auth
from folioview_shared.valuation import currency_snapshot, resolve_preferences

UID = "currency-owner"
CUSTOM = {"theme": "dark", "language": "zh", "defaultChartRange": "1y"}


def update(code="CNY", version=0):
    return {"defaultPortfolioCurrency": code, "expectedVersion": version}


class CurrencyStoreTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "preferences.sqlite3")
        self.store = SQLitePreferencesStore(self.path)

    def test_absence_defaults_are_read_time_only_and_existing_ui_values_are_preserved(self):
        self.assertEqual(self.store.get_currency(UID), empty_currency())
        combined = resolve_preferences(self.store.get(UID), self.store.get_currency(UID))
        self.assertEqual(
            combined,
            {
                "defaultPortfolioCurrency": "USD",
                "language": "en",
                "theme": "light",
                "defaultChartRange": "1m",
            },
        )
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM user_preferences").fetchone()[0], 0)
        self.store.save(UID, CUSTOM, 0)
        self.store.save_currency(UID, update())
        self.assertEqual(
            resolve_preferences(self.store.get(UID), self.store.get_currency(UID)),
            {**CUSTOM, "defaultPortfolioCurrency": "CNY"},
        )
        self.store.save(UID, {**CUSTOM, "language": "en"}, 1)
        self.assertEqual(
            self.store.get_currency(UID)["preferences"], {"defaultPortfolioCurrency": "CNY"}
        )
        self.assertEqual(self.store.get_currency("other"), empty_currency())

    def test_identical_currency_advances_cas_without_restarting_default_follow_context(self):
        first = self.store.save_currency(UID, update())
        self.assertEqual((first["version"], first["currencyGeneration"]), (1, 1))
        same = self.store.save_currency(UID, update("CNY", 1))
        self.assertEqual((same["version"], same["currencyGeneration"]), (2, 1))
        changed = self.store.save_currency(UID, update("CAD", 2))
        self.assertEqual((changed["version"], changed["currencyGeneration"]), (3, 2))
        with self.assertRaises(PreferencesConflict):
            self.store.save_currency(UID, update("USD", 1))
        self.assertEqual(SQLitePreferencesStore(self.path).get_currency(UID), changed)

    def test_concurrent_currency_writes_have_one_winner_and_independent_ui_fences(
        self,
    ):
        def save(index):
            try:
                return SQLitePreferencesStore(self.path).save_currency(
                    UID, update("CAD" if index % 2 else "CNY")
                )
            except PreferencesConflict:
                return None

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(save, range(12)))
        self.assertEqual(sum(r is not None for r in results), 1)
        self.assertEqual(self.store.get_currency(UID)["version"], 1)
        self.assertEqual(self.store.save(UID, CUSTOM, 0)["version"], 1)
        self.assertEqual(self.store.get_currency(UID)["version"], 1)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM user_preferences").fetchone()[0], 2)

    def test_malformed_stored_state_is_not_absence_and_never_overwritten(self):
        good = self.store.save_currency(UID, update())
        for value in [
            None,
            {},
            empty_currency(),
            {**good, "currencyGeneration": 2},
            {**good, "private": "PRIVATE_CANARY"},
        ]:
            with sqlite3.connect(self.path) as db:
                db.execute(
                    "UPDATE user_preferences SET value=? WHERE owner=?",
                    (json.dumps(value), currency_owner(UID)),
                )
            for action in [
                lambda: self.store.get_currency(UID),
                lambda: self.store.save_currency(UID, update()),
            ]:
                with self.subTest(value=value), self.assertRaises(PreferencesUnavailable):
                    action()
            with sqlite3.connect(self.path) as db:
                self.assertEqual(
                    json.loads(db.execute("SELECT value FROM user_preferences").fetchone()[0]),
                    value,
                )
        with self.assertRaises(PreferencesUnavailable):
            checked_currency_record(None)


class CurrencyFirestoreTests(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.reference = self.client.collection.return_value.document.return_value
        self.reference.get.return_value.to_dict.return_value = None
        with patch("app.preferences.firestore.Client", return_value=self.client):
            self.store = FirestorePreferencesStore("unit-project", "(default)")
        self.tx = MagicMock()
        for context in [
            patch("app.preferences.firestore.transactional", side_effect=lambda f: f),
            patch("app.preferences.BoundedTransaction", return_value=self.tx),
        ]:
            context.start()
            self.addCleanup(context.stop)

    def test_same_existing_collection_distinct_owner_key_and_bounded_transaction(self):
        self.assertEqual(self.store.get_currency(UID), empty_currency())
        self.reference.get.assert_called_with(timeout=4, retry=None)
        self.client.collection.assert_called_once_with("user_preferences")
        self.client.collection.return_value.document.assert_called_with(currency_owner(UID))
        result = self.store.save_currency(UID, update())
        currency_snapshot(result)
        self.tx.set.assert_called_once_with(self.reference, result)
        self.reference.get.assert_called_with(transaction=self.tx, timeout=4, retry=None)
        self.assertEqual(result["currencyGeneration"], 1)
        self.reference.get.return_value.to_dict.return_value = result
        self.tx.reset_mock()
        with self.assertRaises(PreferencesConflict):
            self.store.save_currency(UID, update())
        self.tx.set.assert_not_called()

    def test_corrupt_storage_does_not_return_default_or_write_a_migration(self):
        self.reference.get.return_value.to_dict.return_value = {
            "preferences": None,
            "private": "PRIVATE_CANARY",
        }
        with self.assertRaises(PreferencesUnavailable):
            self.store.get_currency(UID)
        with self.assertRaises(PreferencesUnavailable):
            self.store.save_currency(UID, update())
        self.tx.set.assert_not_called()
        self.reference.set.assert_not_called()


class CurrencyHttpTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLitePreferencesStore(str(Path(directory.name) / "preferences.sqlite3"))
        app.dependency_overrides[get_preferences_store] = lambda: self.store
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
            method,
            "/api/v2/preferences/currency",
            headers={"Authorization": "Bearer test-token"},
            **kwargs,
        )

    def test_actual_auth_owner_isolation_and_legacy_request_shape_unchanged(self):
        self.assertEqual(
            self.client.get("/api/v2/preferences/currency", headers={"X-User-Id": UID}).status_code,
            401,
        )
        self.verify.assert_not_called()
        first = self.request()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers["cache-control"], "no-store")
        self.assertEqual(first.json(), empty_currency())
        saved = self.request("PUT", json=update())
        self.assertEqual(saved.status_code, 200)
        currency_snapshot(saved.json())
        self.verify.assert_called_with("test-token", app=unittest.mock.ANY, check_revoked=True)
        headers = {"Authorization": "Bearer test-token"}
        old = self.client.put(
            "/api/v1/preferences", json={**CUSTOM, "expectedVersion": 0}, headers=headers
        )
        self.assertEqual(old.status_code, 200)
        self.assertEqual(self.request().json(), saved.json())
        old = self.client.put(
            "/api/v1/preferences", json={**CUSTOM, **update("CAD", 1)}, headers=headers
        )
        self.assertEqual(old.status_code, 422)
        self.verify.return_value = {
            "uid": "another-owner",
            "firebase": {"sign_in_provider": "google.com"},
        }
        self.assertEqual(self.request().json(), empty_currency())
        self.assertEqual(self.store.get_currency(UID), saved.json())

    def test_closed_supported_currency_body_versions_conflicts_and_size_limit(self):
        for body in [
            update("XYZ"),
            update("usd"),
            update("USD", True),
            update("USD", "0"),
            {**update(), "uid": "other"},
            {**update(), "theme": "light"},
            {},
            None,
        ]:
            self.assertEqual(self.request("PUT", json=body).status_code, 422)
        self.assertEqual(self.request("PUT", content=b" " * 1025).status_code, 413)
        self.assertEqual(self.request("PUT", json=update()).status_code, 200)
        conflict = self.request("PUT", json=update("CAD"))
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.headers["cache-control"], "no-store")

    def test_unknown_commit_recovers_by_current_read_without_late_stale_overwrite(self):
        save = self.store.save_currency

        def committed_but_lost(uid, value):
            save(uid, value)
            raise PreferencesUnavailable

        with patch.object(self.store, "save_currency", side_effect=committed_but_lost):
            self.assertEqual(self.request("PUT", json=update()).status_code, 503)
        current = self.request().json()
        self.assertEqual(current["preferences"], {"defaultPortfolioCurrency": "CNY"})
        self.assertEqual((current["version"], current["currencyGeneration"]), (1, 1))
        self.assertEqual(self.request("PUT", json=update("CAD")).status_code, 409)
        self.assertEqual(self.request().json(), current)
