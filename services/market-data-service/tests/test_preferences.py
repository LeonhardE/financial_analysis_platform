"""Private UI preference persistence, identity isolation, and bounded requests."""

import asyncio
import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from firebase_admin import auth

from app import auth as app_auth
from app.main import app
from app.preferences import (
    MAX_BODY_BYTES,
    MAX_VERSION,
    FirestorePreferencesStore,
    PreferencesConflict,
    PreferencesUnavailable,
    SQLitePreferencesStore,
    checked_preferences,
    configured_preferences_store,
    create_preferences_store,
    get_preferences_store,
)
from app.watchlist import owner_key

USER = "preferences-owner"
TOKEN = "verified-id-token"
CLAIMS = {"uid": USER, "firebase": {"sign_in_provider": "google.com"}}
DEFAULTS = {"theme": "system", "language": "en", "defaultChartRange": "1m"}
CUSTOM = {"theme": "dark", "language": "zh", "defaultChartRange": "1y"}


def snapshot(preferences=None, version=0):
    return {"preferences": preferences, "version": version}


def document(preferences, version):
    return {"version": 1, "revision": version, "preferences": preferences}


def update(preferences, version=0):
    return {**preferences, "expectedVersion": version}


class SQLitePreferencesTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "private" / "preferences.sqlite3")
        self.store = SQLitePreferencesStore(self.path)

    def test_missing_preferences_read_does_not_save_defaults(self):
        self.assertEqual(self.store.get(USER), snapshot())
        self.assertEqual(self.store.get(USER), snapshot())
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM user_preferences").fetchone()[0], 0)
        self.assertEqual(Path(self.path).stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(self.path).parent.stat().st_mode & 0o777, 0o700)

    def test_persistence_account_isolation_and_no_identity_fields(self):
        self.assertEqual(self.store.save(USER, CUSTOM, 0), snapshot(CUSTOM, 1))
        restarted = SQLitePreferencesStore(self.path)
        self.assertEqual(restarted.get(USER), snapshot(CUSTOM, 1))
        self.assertEqual(restarted.get("another-user"), snapshot())
        restarted.save("another-user", DEFAULTS, 0)
        self.assertEqual(restarted.get(USER), snapshot(CUSTOM, 1))
        with closing(sqlite3.connect(self.path)) as db:
            owner, value = db.execute(
                "SELECT owner,value FROM user_preferences WHERE owner=?", (owner_key(USER),)
            ).fetchone()
        self.assertEqual(owner, owner_key(USER))
        self.assertEqual(json.loads(value), document(CUSTOM, 1))
        for sensitive in (USER, "uid", "email", "token"):
            self.assertNotIn(sensitive, value)

    def test_identical_saves_advance_the_fence_and_reject_older_pending_writes(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE writes (value INTEGER)")
            for event in ("INSERT", "UPDATE"):
                db.execute(
                    f"CREATE TRIGGER trace_{event} AFTER {event} ON user_preferences "
                    "BEGIN INSERT INTO writes VALUES (1); END"
                )
        self.assertEqual(self.store.save(USER, DEFAULTS, 0), snapshot(DEFAULTS, 1))
        # An older, timed-out request still carries version 1. A newer explicit
        # confirmation of identical values must fence it out too.
        self.assertEqual(self.store.save(USER, dict(DEFAULTS), 1), snapshot(DEFAULTS, 2))
        with self.assertRaises(PreferencesConflict):
            self.store.save(USER, CUSTOM, 1)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM writes").fetchone()[0], 2)
        self.assertEqual(self.store.get(USER), snapshot(DEFAULTS, 2))

    def test_concurrent_writers_with_same_version_cannot_overwrite_one_another(self):
        choices = [DEFAULTS, CUSTOM]

        def save(index):
            try:
                return SQLitePreferencesStore(self.path).save(USER, choices[index % 2], 0)
            except PreferencesConflict:
                return None

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(save, range(16)))
        self.assertEqual(sum(result is not None for result in results), 1)
        winner = next(result for result in results if result is not None)
        self.assertEqual(self.store.get(USER), winner)
        self.assertEqual(winner["version"], 1)
        self.assertIn(winner["preferences"], choices)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM user_preferences").fetchone()[0], 1)

    def test_malformed_stored_document_is_not_overwritten(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("INSERT INTO user_preferences VALUES (?, ?)", (owner_key(USER), "broken"))
        for operation in (lambda: self.store.get(USER), lambda: self.store.save(USER, CUSTOM, 0)):
            with self.assertRaises(PreferencesUnavailable):
                operation()
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(
                db.execute("SELECT value FROM user_preferences").fetchone()[0], "broken"
            )

    def test_unknown_fields_invalid_enums_and_versions_fail_closed(self):
        for value in (
            {},
            {"version": True, "preferences": CUSTOM},
            {"version": "1", "preferences": CUSTOM},
            {"version": 2, "preferences": CUSTOM},
            {"version": 1, "preferences": None},
            {"version": 1, "preferences": {**CUSTOM, "uid": USER}},
            {"version": 1, "preferences": {**CUSTOM, "theme": "other"}},
            {"version": 1, "preferences": {**CUSTOM, "language": "fr"}},
            {"version": 1, "preferences": {**CUSTOM, "defaultChartRange": "2y"}},
            {"version": 1, "preferences": {"theme": "dark"}},
            {"version": 1, "preferences": CUSTOM, "email": "private@example.com"},
            {"version": 1, "preferences": CUSTOM, "revision": True},
            {"version": 1, "preferences": CUSTOM, "revision": 0},
            {"version": 1, "preferences": CUSTOM, "revision": MAX_VERSION + 1},
        ):
            with self.subTest(value=value), self.assertRaises(PreferencesUnavailable):
                checked_preferences(value)

    def test_legacy_local_document_is_read_without_write_and_next_save_adds_revision(self):
        legacy = {"version": 1, "preferences": CUSTOM}
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "INSERT INTO user_preferences VALUES (?, ?)", (owner_key(USER), json.dumps(legacy))
            )
        self.assertEqual(self.store.get(USER), snapshot(CUSTOM, 1))
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(
                json.loads(db.execute("SELECT value FROM user_preferences").fetchone()[0]), legacy
            )
        self.assertEqual(self.store.save(USER, DEFAULTS, 1), snapshot(DEFAULTS, 2))


class FirestorePreferencesTests(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.document = self.client.collection.return_value.document.return_value
        self.document.get.return_value.to_dict.return_value = None
        with patch("app.preferences.firestore.Client", return_value=self.client) as constructor:
            self.store = FirestorePreferencesStore("test-project", "(default)")
        constructor.assert_called_once_with(project="test-project", database="(default)")
        self.transaction = MagicMock()
        decorator = patch("app.preferences.firestore.transactional", side_effect=lambda fn: fn)
        decorator.start()
        self.addCleanup(decorator.stop)
        transaction = patch("app.preferences.BoundedTransaction", return_value=self.transaction)
        self.transaction_constructor = transaction.start()
        self.addCleanup(transaction.stop)

    def test_get_has_bounded_timeout_no_response_cache_and_no_write(self):
        self.assertEqual(self.store.get(USER), snapshot())
        self.document.get.return_value.to_dict.return_value = document(CUSTOM, 7)
        self.assertEqual(self.store.get(USER), snapshot(CUSTOM, 7))
        self.assertEqual(self.document.get.call_count, 2)
        self.document.get.assert_called_with(timeout=4, retry=None)
        self.client.collection.assert_called_once_with("user_preferences")
        self.client.collection.return_value.document.assert_called_with(owner_key(USER))
        self.document.set.assert_not_called()
        self.transaction.set.assert_not_called()

    def test_atomic_save_and_identical_fence_use_verified_owner_document(self):
        self.assertEqual(self.store.save(USER, CUSTOM, 0), snapshot(CUSTOM, 1))
        self.transaction_constructor.assert_called_once_with(self.client, max_attempts=2)
        self.document.get.assert_called_with(transaction=self.transaction, timeout=4, retry=None)
        self.transaction.set.assert_called_once_with(self.document, document(CUSTOM, 1))
        self.document.get.return_value.to_dict.return_value = document(CUSTOM, 1)
        self.transaction.reset_mock()
        self.assertEqual(self.store.save(USER, dict(CUSTOM), 1), snapshot(CUSTOM, 2))
        self.transaction.set.assert_called_once_with(self.document, document(CUSTOM, 2))

    def test_stale_expected_version_does_not_write_even_when_payload_matches(self):
        self.document.get.return_value.to_dict.return_value = document(CUSTOM, 2)
        for preferences in (CUSTOM, DEFAULTS):
            with self.assertRaises(PreferencesConflict):
                self.store.save(USER, preferences, 1)
        self.transaction.set.assert_not_called()

    def test_transaction_retry_rechecks_version_after_another_request_commits(self):
        def retry_after_concurrent_commit(function):
            def retry(transaction):
                first = function(transaction)
                self.assertEqual(first, snapshot(CUSTOM, 1))
                # Simulate Firestore aborting the first attempt: another client
                # committed before it, so a retry must re-read and fail the CAS.
                transaction.reset_mock()
                self.document.get.return_value.to_dict.return_value = document(DEFAULTS, 1)
                return function(transaction)

            return retry

        with patch(
            "app.preferences.firestore.transactional", side_effect=retry_after_concurrent_commit
        ):
            with self.assertRaises(PreferencesConflict):
                self.store.save(USER, CUSTOM, 0)
        self.transaction.set.assert_not_called()

    def test_corrupt_docs_and_sdk_failures_are_not_overwritten(self):
        self.document.get.return_value.to_dict.return_value = {"version": 1, "preferences": {}}
        with self.assertRaises(PreferencesUnavailable):
            self.store.save(USER, CUSTOM, 0)
        self.transaction.set.assert_not_called()
        self.document.get.side_effect = RuntimeError("private SDK details")
        for operation in (lambda: self.store.get(USER), lambda: self.store.save(USER, CUSTOM, 0)):
            with self.assertRaises(PreferencesUnavailable):
                operation()

    def test_cloud_run_refuses_local_backends_and_emulators(self):
        for configuration in (
            {"K_SERVICE": "market-api", "MARKET_CACHE_BACKEND": "sqlite"},
            {"K_SERVICE": "", "MARKET_CACHE_BACKEND": "sqlite"},
            {"K_SERVICE": "market-api", "FIRESTORE_EMULATOR_HOST": "localhost:8085"},
            {"K_SERVICE": "market-api", "FIREBASE_AUTH_EMULATOR_HOST": "localhost:9099"},
            {"K_SERVICE": "market-api", "MARKET_CACHE_BACKEND": "unknown"},
            {"MARKET_CACHE_BACKEND": "firestore"},
        ):
            with (
                self.subTest(configuration=configuration),
                patch.dict(os.environ, configuration, clear=True),
            ):
                with self.assertRaises(PreferencesUnavailable):
                    create_preferences_store()

    def test_cloud_run_reuses_existing_project_database_and_credentials(self):
        with (
            patch.dict(
                os.environ,
                {
                    "K_SERVICE": "market-api",
                    "FIREBASE_PROJECT_ID": "test-project",
                    "MARKET_FIRESTORE_DATABASE": "(default)",
                },
                clear=True,
            ),
            patch("app.preferences.FirestorePreferencesStore") as constructor,
        ):
            create_preferences_store()
        constructor.assert_called_once_with("test-project", "(default)")


class PreferencesRouteTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "test-project"}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLitePreferencesStore(str(Path(directory.name) / "preferences.sqlite3"))
        app.dependency_overrides[get_preferences_store] = lambda: self.store
        self.addCleanup(app.dependency_overrides.clear)
        app_patch = patch.object(
            app_auth.firebase_admin,
            "get_app",
            return_value=SimpleNamespace(project_id="test-project"),
        )
        app_patch.start()
        self.addCleanup(app_patch.stop)
        verifier = patch.object(app_auth.auth, "verify_id_token", return_value=deepcopy(CLAIMS))
        self.verifier = verifier.start()
        self.addCleanup(verifier.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def request(self, method="GET", suffix="", **kwargs):
        return self.client.request(
            method,
            f"/api/v1/preferences{suffix}",
            headers={"Authorization": f"Bearer {TOKEN}"},
            **kwargs,
        )

    def assert_private(self, response, expected):
        self.assertEqual(response.status_code, expected, response.text)
        self.assertEqual(response.headers.get("cache-control"), "no-store")

    def test_missing_preferences_are_null_and_only_explicit_save_writes(self):
        first = self.request()
        self.assert_private(first, 200)
        self.assertEqual(first.json(), snapshot())
        self.assertEqual(self.store.get(USER), snapshot())
        saved = self.request("PUT", json=update(DEFAULTS))
        self.assert_private(saved, 200)
        self.assertEqual(saved.json(), snapshot(DEFAULTS, 1))
        self.assertEqual(self.request().json(), saved.json())
        self.assertEqual(self.request("PUT", json=update(CUSTOM, 1)).json(), snapshot(CUSTOM, 2))

    def test_authentication_and_server_uid_are_required_for_reads_and_saves(self):
        for method in ("GET", "PUT"):
            response = self.client.request(
                method,
                f"/api/v1/preferences?uid={USER}",
                headers={"X-User-Id": USER},
                json=update(CUSTOM) if method == "PUT" else None,
            )
            self.assert_private(response, 401)
        self.verifier.assert_not_called()
        self.assert_private(self.request("PUT", "?uid=other-user", json=update(CUSTOM)), 200)
        self.assertEqual(self.store.get(USER), snapshot(CUSTOM, 1))
        self.assertEqual(self.store.get("other-user"), snapshot())
        self.verifier.return_value = {
            "uid": "other-user",
            "firebase": {"sign_in_provider": "google.com"},
        }
        self.assertEqual(self.request().json(), snapshot())
        self.request("PUT", json=update(DEFAULTS))
        self.assertEqual(self.store.get(USER), snapshot(CUSTOM, 1))

    def test_request_schema_rejects_unknown_identity_missing_fields_and_invalid_enums(self):
        for payload in (
            {**update(CUSTOM), "uid": "other-user"},
            {**update(CUSTOM), "email": "private@example.com"},
            {**update(CUSTOM), "theme": 1},
            {**update(CUSTOM), "language": "EN"},
            {**update(CUSTOM), "defaultChartRange": "1M"},
            CUSTOM,
            update(CUSTOM, -1),
            update(CUSTOM, True),
            update(CUSTOM, "0"),
            update(CUSTOM, 1.5),
            update(CUSTOM, MAX_VERSION + 1),
            {"theme": "dark"},
            {"preferences": CUSTOM},
            [],
            None,
        ):
            with self.subTest(payload=payload):
                self.assert_private(self.request("PUT", json=payload), 422)
        self.assertEqual(self.store.get(USER), snapshot())

    def test_older_timed_out_save_cannot_overwrite_newer_confirmed_values(self):
        first = self.request("PUT", json=update(CUSTOM))
        self.assert_private(first, 200)
        # The old request retained version 0 while the second request won.
        stale = self.request("PUT", json=update(DEFAULTS))
        self.assert_private(stale, 409)
        self.assertEqual(
            stale.json(), {"detail": "Your preferences changed. Reload them before saving again."}
        )
        self.assertEqual(self.request().json(), snapshot(CUSTOM, 1))
        # A current client can reread and explicitly save; then an older writer
        # cannot roll back that newer confirmation, even to identical values.
        self.assertEqual(self.request("PUT", json=update(CUSTOM, 1)).json(), snapshot(CUSTOM, 2))
        self.assert_private(self.request("PUT", json=update(DEFAULTS, 1)), 409)
        self.assertEqual(self.request().json(), snapshot(CUSTOM, 2))

    def test_large_and_streamed_payloads_are_rejected_before_storage(self):
        for content in (
            b"x" * (MAX_BODY_BYTES + 1),
            iter([b"x" * 600, b"x" * 600]),
        ):
            self.assert_private(self.request("PUT", content=content), 413)
        self.assertEqual(self.store.get(USER), snapshot())
        self.verifier.assert_not_called()

    def test_malformed_json_method_errors_and_redirects_are_private(self):
        self.assert_private(self.request("PUT", content=b'{"theme":'), 422)
        self.assert_private(self.request("POST", json=CUSTOM), 405)
        self.assert_private(self.request("DELETE"), 405)
        self.assert_private(self.request("GET", "/unknown"), 404)
        self.assert_private(self.request("GET", "/", follow_redirects=False), 307)

    def test_expired_identity_and_storage_failures_do_not_expose_details(self):
        self.verifier.side_effect = auth.ExpiredIdTokenError("private token", None)
        self.assert_private(self.request(), 401)
        self.verifier.side_effect = None
        self.store.get = MagicMock(side_effect=PreferencesUnavailable)
        self.assert_private(self.request(), 503)
        self.store.get.side_effect = RuntimeError("private SDK detail")
        unexpected = self.request()
        self.assert_private(unexpected, 503)
        self.assertNotIn("private SDK", unexpected.text)
        self.assertIn("preferences", unexpected.text)

    def test_cors_preflight_supports_authenticated_json_and_stays_private(self):
        for method in ("GET", "PUT"):
            response = self.client.options(
                "/api/v1/preferences",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": method,
                    "Access-Control-Request-Headers": "Authorization, Content-Type",
                },
            )
            self.assert_private(response, 200)
            self.assertEqual(
                response.headers.get("access-control-allow-origin"), "http://localhost:3000"
            )
            self.assertNotIn("access-control-allow-credentials", response.headers)
        denied = self.client.options(
            "/api/v1/preferences",
            headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "PUT",
            },
        )
        self.assert_private(denied, 400)
        self.assertNotIn("access-control-allow-origin", denied.headers)

    def test_invalid_storage_configuration_is_private_503(self):
        app.dependency_overrides.pop(get_preferences_store)
        configured_preferences_store.cache_clear()
        self.addCleanup(configured_preferences_store.cache_clear)
        with patch.dict(os.environ, {"MARKET_CACHE_BACKEND": "unknown"}):
            self.assert_private(self.request(), 503)
        self.assertEqual(self.client.get("/health").status_code, 200)


class PreferencesStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, receive):
        messages = []

        async def send(message):
            messages.append(message)

        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "PUT",
                "scheme": "http",
                "path": "/api/v1/preferences",
                "raw_path": b"/api/v1/preferences",
                "root_path": "",
                "query_string": b"",
                "headers": [(b"content-type", b"application/json")],
                "server": ("testserver", 80),
                "client": ("testclient", 1234),
            },
            receive,
            send,
        )
        return next(message for message in messages if message["type"] == "http.response.start")

    async def test_streaming_limit_stops_reading_when_body_exceeds_limit(self):
        reads = 0

        async def receive():
            nonlocal reads
            reads += 1
            if reads > 2:
                self.fail("An oversized request must not continue reading the body")
            return {"type": "http.request", "body": b"x" * 600, "more_body": True}

        start = await self.request(receive)
        self.assertEqual(start["status"], 413)
        self.assertEqual(reads, 2)
        self.assertIn((b"cache-control", b"no-store"), start["headers"])

    async def test_stalled_body_returns_bounded_private_timeout(self):
        original_timeout = asyncio.timeout

        async def receive():
            await asyncio.sleep(60)

        with patch("app.preferences.asyncio.timeout", side_effect=lambda _: original_timeout(0.01)):
            start = await self.request(receive)
        self.assertEqual(start["status"], 408)
        self.assertIn((b"cache-control", b"no-store"), start["headers"])


if __name__ == "__main__":
    unittest.main()
