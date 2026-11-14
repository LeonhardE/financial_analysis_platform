"""Traditional Chinese preference persistence without changing the frozen v1 UI contract."""

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
    MAX_VERSION,
    FirestorePreferencesStore,
    PreferencesConflict,
    PreferencesUnavailable,
    SQLitePreferencesStore,
    checked_language_record,
    empty_language,
    get_preferences_store,
    language_owner,
)
from folioview_shared import auth as app_auth

UID = "language-owner"
LEGACY = {"theme": "system", "language": "zh", "defaultChartRange": "1m"}


def update(language="zh-Hant", version=0):
    return {"language": language, "expectedVersion": version}


class LanguageStoreTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.path = str(Path(scratch.name) / "preferences.sqlite3")
        self.store = SQLitePreferencesStore(self.path)

    def test_absence_does_not_write_and_v1_currency_writes_cannot_erase_language(self):
        self.assertEqual(self.store.get_language(UID), empty_language())
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM user_preferences").fetchone()[0], 0)
        self.store.save(UID, LEGACY, 0)
        self.store.save_currency(UID, {"defaultPortfolioCurrency": "CAD", "expectedVersion": 0})
        saved = self.store.save_language(UID, update())
        self.assertEqual(saved, {"preferences": {"language": "zh-Hant"}, "version": 1})
        self.assertEqual(self.store.get(UID)["preferences"], LEGACY)
        self.store.save(UID, {**LEGACY, "theme": "light"}, 1)
        self.assertEqual(self.store.get_language(UID), saved)
        self.assertEqual(
            self.store.get_currency(UID)["preferences"], {"defaultPortfolioCurrency": "CAD"}
        )
        self.assertEqual(SQLitePreferencesStore(self.path).get_language(UID), saved)
        self.assertEqual(self.store.get_language("another-owner"), empty_language())
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM user_preferences").fetchone()[0], 3)
            stored = db.execute(
                "SELECT value FROM user_preferences WHERE owner=?", (language_owner(UID),)
            ).fetchone()[0]
            self.assertNotIn(UID, stored)

    def test_identical_saves_advance_the_fence_and_old_unknown_writes_cannot_win(self):
        for version, code in enumerate(["zh-Hant", "zh-Hant", "en", "zh"], start=1):
            saved = self.store.save_language(UID, update(code, version - 1))
            self.assertEqual(saved["version"], version)
            self.assertEqual(saved["preferences"], {"language": code})
        with self.assertRaises(PreferencesConflict):
            self.store.save_language(UID, update("zh-Hant", 1))
        self.assertEqual(self.store.get_language(UID), saved)

    def test_concurrent_writers_have_exactly_one_winner(self):
        def save(index):
            try:
                return SQLitePreferencesStore(self.path).save_language(
                    UID, update("en" if index % 2 else "zh-Hant")
                )
            except PreferencesConflict:
                return None

        with ThreadPoolExecutor(max_workers=4) as pool:
            saved = list(pool.map(save, range(12)))
        self.assertEqual(sum(v is not None for v in saved), 1)
        self.assertEqual(self.store.get_language(UID)["version"], 1)

    def test_corrupt_and_absent_shaped_stored_records_are_not_silently_overwritten(self):
        self.store.save_language(UID, update())
        for value in [
            None,
            {},
            empty_language(),
            {"preferences": {"language": "zh-TW"}, "version": 1},
            {"preferences": {"language": "en"}, "version": True},
            {"preferences": {"language": "en", "owner": "other"}, "version": 1},
            {"preferences": {"language": "en"}, "version": MAX_VERSION + 1},
        ]:
            with sqlite3.connect(self.path) as db:
                db.execute(
                    "UPDATE user_preferences SET value=? WHERE owner=?",
                    (json.dumps(value), language_owner(UID)),
                )
            for action in [
                lambda: self.store.get_language(UID),
                lambda: self.store.save_language(UID, update()),
            ]:
                with self.subTest(value=value), self.assertRaises(PreferencesUnavailable):
                    action()
            with sqlite3.connect(self.path) as db:
                self.assertEqual(
                    json.loads(db.execute("SELECT value FROM user_preferences").fetchone()[0]),
                    value,
                )
        with self.assertRaises(PreferencesUnavailable):
            checked_language_record(None)


class LanguageFirestoreTests(unittest.TestCase):
    def test_existing_collection_and_bounded_transaction_preserve_closed_language_record(self):
        client, transaction = MagicMock(), MagicMock()
        ref = client.collection.return_value.document.return_value
        ref.get.return_value.to_dict.return_value = None
        with patch("app.preferences.firestore.Client", return_value=client):
            store = FirestorePreferencesStore("unit-project", "(default)")
        with (
            patch("app.preferences.firestore.transactional", side_effect=lambda f: f),
            patch("app.preferences.BoundedTransaction", return_value=transaction) as bounded,
        ):
            self.assertEqual(store.get_language(UID), empty_language())
            ref.get.assert_called_with(timeout=4, retry=None)
            result = store.save_language(UID, update())
            client.collection.assert_called_once_with("user_preferences")
            client.collection.return_value.document.assert_called_with(language_owner(UID))
            bounded.assert_called_with(client, max_attempts=2)
            ref.get.assert_called_with(transaction=transaction, timeout=4, retry=None)
            transaction.set.assert_called_once_with(ref, result)
            ref.get.return_value.to_dict.return_value = result
            transaction.reset_mock()
            with self.assertRaises(PreferencesConflict):
                store.save_language(UID, update())
            transaction.set.assert_not_called()
            ref.get.return_value.to_dict.return_value = empty_language()
            with self.assertRaises(PreferencesUnavailable):
                store.save_language(UID, update())
            transaction.set.assert_not_called()


class LanguageHttpTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.store = SQLitePreferencesStore(str(Path(scratch.name) / "preferences.sqlite3"))
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
            "/api/v2/preferences/language",
            headers={"Authorization": "Bearer test-token"},
            **kwargs,
        )

    def test_real_auth_private_headers_owner_isolation_and_legacy_shape(self):
        self.assertEqual(
            self.client.get("/api/v2/preferences/language", headers={"X-User-Id": UID}).status_code,
            401,
        )
        self.verify.assert_not_called()
        loaded = self.request()
        self.assertEqual(loaded.json(), empty_language())
        self.assertEqual(loaded.headers["cache-control"], "no-store")
        saved = self.request("PUT", json=update())
        self.assertEqual(saved.status_code, 200)
        self.verify.assert_called_with("test-token", app=unittest.mock.ANY, check_revoked=True)
        headers = {"Authorization": "Bearer test-token"}
        self.assertEqual(
            self.client.put(
                "/api/v1/preferences", headers=headers, json={**LEGACY, "expectedVersion": 0}
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.put(
                "/api/v1/preferences",
                headers=headers,
                json={**LEGACY, "language": "zh-Hant", "expectedVersion": 1},
            ).status_code,
            422,
        )
        self.assertEqual(self.request().json(), saved.json())
        self.verify.return_value = {
            "uid": "another-owner",
            "firebase": {"sign_in_provider": "google.com"},
        }
        self.assertEqual(self.request().json(), empty_language())

    def test_closed_language_versions_size_conflicts_and_unknown_commit_recovery(self):
        for value in [
            None,
            {},
            update("zh-TW"),
            update("ZH"),
            update("en", True),
            update("en", "0"),
            update("en", -1),
            {**update(), "uid": "other"},
            {**update(), "theme": "dark"},
        ]:
            self.assertEqual(self.request("PUT", json=value).status_code, 422)
        self.assertEqual(self.request("PUT", content=b" " * 1025).status_code, 413)
        original = self.store.save_language

        def lost_reply(uid, value):
            original(uid, value)
            raise PreferencesUnavailable

        with patch.object(self.store, "save_language", side_effect=lost_reply):
            self.assertEqual(self.request("PUT", json=update()).status_code, 503)
        self.assertEqual(
            self.request().json(), {"preferences": {"language": "zh-Hant"}, "version": 1}
        )
        self.assertEqual(self.request("PUT", json=update("en")).status_code, 409)
        self.assertEqual(self.request("PUT", json=update("en", 1)).status_code, 200)
