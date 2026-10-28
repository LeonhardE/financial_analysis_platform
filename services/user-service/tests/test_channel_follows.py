"""Manual follows: no remote lookup, atomic revisions, owner and input boundaries."""

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

from app.channel_follows import (
    LIMIT,
    MAX_BODY_BYTES,
    MAX_REVISION,
    ChannelFollowsUnavailable,
    ChannelInput,
    ChannelRevisionConflict,
    FirestoreChannelFollowsStore,
    SQLiteChannelFollowsStore,
    checked_pair,
    configured_store,
    create_channel_follows_store,
    get_channel_follows_store,
    normalize_inputs,
    version_key,
)
from app.main import app
from folioview_shared import auth as app_auth
from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.identity import owner_key

UID = "synthetic-owner-one"
OTHER = "synthetic-owner-two"
TOKEN = "synthetic-valid-id-token"


def inputs(*handles, name="Manual source", note="User-provided, not verified"):
    return normalize_inputs(
        [ChannelInput(name=name, handleOrUrl=handle, note=note) for handle in handles]
    )


def raw_inputs(*handles, **kwargs):
    return [
        {
            "name": kwargs.get("name", "Manual source"),
            "handleOrUrl": handle,
            "note": kwargs.get("note", "User-provided, not verified"),
        }
        for handle in handles
    ]


class SQLiteChannelFollowsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / "user.sqlite3")
        self.store = SQLiteChannelFollowsStore(self.path)

    def rows(self):
        with closing(sqlite3.connect(self.path)) as db:
            return {
                table: db.execute(f"SELECT owner,value FROM {table}").fetchall()
                for table in ("user_channel_follows", "user_resource_versions")
            }

    def test_empty_get_does_not_initialize_or_write_and_owners_are_isolated(self):
        self.assertEqual(self.store.get(UID), {"revision": 0, "items": [], "limit": LIMIT})
        self.assertEqual(self.store.replace(UID, 0, []), self.store.get(UID))
        self.assertEqual(self.rows(), {"user_channel_follows": [], "user_resource_versions": []})
        saved = self.store.replace(UID, 0, inputs("@First"))
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(saved["items"][0]["handleOrUrl"], "https://www.youtube.com/@first")
        self.assertEqual(saved["items"][0]["verification"], "user_provided")
        self.assertEqual(SQLiteChannelFollowsStore(self.path).get(UID), saved)
        self.assertEqual(self.store.get(OTHER)["items"], [])
        self.assertEqual(self.rows()["user_channel_follows"][0][0], owner_key(UID))
        self.assertEqual(self.rows()["user_resource_versions"][0][0], version_key(UID))
        self.assertNotIn(UID, json.dumps(self.rows()))

    def test_equivalent_url_reorder_and_noop_keep_revision_and_write_count(self):
        first = self.store.replace(UID, 0, inputs("@First", "@Second"))
        before = self.rows()
        result = self.store.replace(
            UID, 1, inputs("https://youtube.com/@SECOND", "https://www.youtube.com/@first")
        )
        self.assertEqual(result, first)
        self.assertEqual(self.rows(), before)
        with self.assertRaises(ChannelRevisionConflict):
            self.store.replace(UID, 0, inputs("@First", "@Second"))
        self.assertEqual(self.rows(), before)

    def test_edit_delete_readd_preserve_or_replace_identity_as_appropriate(self):
        first = self.store.replace(UID, 0, inputs("@One"))
        row = first["items"][0]
        edited = self.store.replace(UID, 1, inputs("@ONE", name="Edited", note="Changed"))
        self.assertEqual(edited["revision"], 2)
        self.assertEqual(edited["items"][0]["followId"], row["followId"])
        self.assertEqual(edited["items"][0]["addedAt"], row["addedAt"])
        self.assertEqual(self.store.replace(UID, 2, [])["revision"], 3)
        again = self.store.replace(UID, 3, inputs("@one"))
        self.assertEqual(again["revision"], 4)
        self.assertNotEqual(again["items"][0]["followId"], row["followId"])
        self.assertEqual(len(again["items"]), 1)

    def test_simultaneous_expected_revision_allows_only_one_winner(self):
        self.store.replace(UID, 0, inputs("@one"))

        def save(index):
            try:
                SQLiteChannelFollowsStore(self.path).replace(
                    UID, 1, inputs("@one", f"@additional{index}")
                )
                return True
            except ChannelRevisionConflict:
                return False

        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(save, range(12))), 1)
        self.assertEqual(self.store.get(UID)["revision"], 2)
        self.assertEqual(len(self.store.get(UID)["items"]), 2)

    def test_transaction_failure_rolls_back_content_and_metadata_together(self):
        self.store.replace(UID, 0, inputs("@one"))
        before = self.rows()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "CREATE TRIGGER deny_metadata BEFORE UPDATE ON user_resource_versions "
                "BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END"
            )
        with self.assertRaises(ChannelFollowsUnavailable):
            self.store.replace(UID, 1, inputs("@two"))
        self.assertEqual(self.rows(), before)
        self.assertEqual(
            self.store.get(UID)["items"][0]["handleOrUrl"], "https://www.youtube.com/@one"
        )

    def test_corrupt_missing_or_old_writer_metadata_fails_closed_without_repair(self):
        self.store.replace(UID, 0, inputs("@one"))
        with closing(sqlite3.connect(self.path)) as db, db:
            value = json.loads(db.execute("SELECT value FROM user_channel_follows").fetchone()[0])
            value["items"][0]["note"] = "Changed by an old writer"
            db.execute("UPDATE user_channel_follows SET value=?", (json.dumps(value),))
        before = self.rows()
        for action in (lambda: self.store.get(UID), lambda: self.store.replace(UID, 1, [])):
            with self.assertRaises(ChannelFollowsUnavailable):
                action()
        self.assertEqual(self.rows(), before)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("DELETE FROM user_resource_versions")
        with self.assertRaises(ChannelFollowsUnavailable):
            self.store.get(UID)

    def test_stored_pair_rejects_extra_fields_ids_timestamps_and_duplicate_rows(self):
        self.store.replace(UID, 0, inputs("@one"))
        rows = self.rows()
        content = json.loads(rows["user_channel_follows"][0][1])
        metadata = json.loads(rows["user_resource_versions"][0][1])
        mutations = [
            ({**content, "owner": UID}, metadata),
            (content, {**metadata, "revision": True}),
            (content, {**metadata, "updatedAt": "2026-10-27T10:00:00"}),
            (content, {**metadata, "sourceEpoch": 0}),
            (content, {**metadata, "ref": {**metadata["ref"], "kind": "watchlist"}}),
            ({**content, "items": [content["items"][0], content["items"][0]]}, metadata),
            (
                {**content, "items": [{**content["items"][0], "addedAt": "not a timestamp"}]},
                metadata,
            ),
            ({**content, "items": [{**content["items"][0], "verification": "verified"}]}, metadata),
        ]
        for data, meta in mutations:
            with self.subTest(data=data, meta=meta), self.assertRaises(ChannelFollowsUnavailable):
                checked_pair(data, meta)

    def test_revision_overflow_refuses_write_and_resource_ref_survives_normal_changes(self):
        self.store.replace(UID, 0, inputs("@one"))
        with closing(sqlite3.connect(self.path)) as db, db:
            meta = json.loads(db.execute("SELECT value FROM user_resource_versions").fetchone()[0])
            ref = deepcopy(meta["ref"])
            meta["revision"] = MAX_REVISION
            db.execute("UPDATE user_resource_versions SET value=?", (json.dumps(meta),))
        self.assertEqual(self.store.get(UID)["revision"], MAX_REVISION)
        with self.assertRaises(ChannelFollowsUnavailable):
            self.store.replace(UID, MAX_REVISION, inputs("@two"))
        self.assertEqual(json.loads(self.rows()["user_resource_versions"][0][1])["ref"], ref)


class FirestoreChannelFollowsTests(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.content = MagicMock()
        self.metadata = MagicMock()
        self.documents = {}

        def collection(name):
            value = MagicMock()
            value.document.return_value = (
                self.content if name == "user_channel_follows" else self.metadata
            )
            self.documents[name] = value
            return value

        self.client.collection.side_effect = collection
        self.content.get.return_value.to_dict.return_value = None
        self.metadata.get.return_value.to_dict.return_value = None
        with patch("app.channel_follows.firestore.Client", return_value=self.client) as create:
            self.store = FirestoreChannelFollowsStore("synthetic-project", "synthetic-database")
        create.assert_called_once_with(project="synthetic-project", database="synthetic-database")
        decorator = patch("app.channel_follows.firestore.transactional", side_effect=lambda fn: fn)
        decorator.start()
        self.addCleanup(decorator.stop)
        self.transaction = MagicMock()
        bounded = patch("app.channel_follows.BoundedTransaction", return_value=self.transaction)
        self.bounded = bounded.start()
        self.addCleanup(bounded.stop)

    def apply(self):
        for reference, value in (call.args for call in self.transaction.set.call_args_list):
            reference.get.return_value.to_dict.return_value = deepcopy(value)
        self.transaction.reset_mock()

    def test_get_consistent_pair_uses_bounded_transaction_without_writes(self):
        self.assertEqual(self.store.get(UID)["revision"], 0)
        self.bounded.assert_called_once_with(self.client, max_attempts=2)
        for ref in (self.content, self.metadata):
            ref.get.assert_called_once_with(transaction=self.transaction, timeout=4, retry=None)
        self.transaction.set.assert_not_called()
        self.documents["user_channel_follows"].document.assert_called_once_with(owner_key(UID))
        self.documents["user_resource_versions"].document.assert_called_once_with(version_key(UID))

    def test_mutation_writes_both_documents_and_noop_neither(self):
        saved = self.store.replace(UID, 0, inputs("@one"))
        self.assertEqual(self.transaction.set.call_count, 2)
        self.apply()
        self.assertEqual(self.store.replace(UID, 1, inputs("@ONE")), saved)
        self.transaction.set.assert_not_called()
        with self.assertRaises(ChannelRevisionConflict):
            self.store.replace(UID, 0, [])
        self.transaction.set.assert_not_called()
        self.assertEqual(self.store.replace(UID, 1, [])["revision"], 2)
        self.assertEqual(self.transaction.set.call_count, 2)

    def test_firestore_errors_and_mismatched_pairs_are_private_and_no_repair(self):
        self.content.get.side_effect = RuntimeError("synthetic SDK secret detail")
        for action in (lambda: self.store.get(UID), lambda: self.store.replace(UID, 0, [])):
            with self.assertRaises(ChannelFollowsUnavailable):
                action()
        self.transaction.set.assert_not_called()
        self.content.get.side_effect = None
        self.content.get.return_value.to_dict.return_value = {"version": 1, "items": []}
        with self.assertRaises(ChannelFollowsUnavailable):
            self.store.get(UID)
        self.transaction.set.assert_not_called()

    def test_configuration_cloud_refuses_local_and_emulator_bypasses(self):
        for env in [
            {"K_SERVICE": "user", "USER_STORE_BACKEND": "sqlite"},
            {"K_SERVICE": "", "USER_STORE_BACKEND": "sqlite"},
            {"K_SERVICE": "user", "FIRESTORE_EMULATOR_HOST": "localhost:8080"},
            {"K_SERVICE": "user", "FIREBASE_AUTH_EMULATOR_HOST": "localhost:9099"},
            {"USER_STORE_BACKEND": "unknown"},
            {"USER_STORE_BACKEND": "firestore"},
        ]:
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                with self.assertRaises(ChannelFollowsUnavailable):
                    create_channel_follows_store()
        with (
            patch.dict(
                os.environ,
                {
                    "K_SERVICE": "user",
                    "USER_STORE_BACKEND": "firestore",
                    "GOOGLE_CLOUD_PROJECT": "synthetic-project",
                    "FIRESTORE_DATABASE": "user-db",
                },
                clear=True,
            ),
            patch("app.channel_follows.FirestoreChannelFollowsStore") as create,
        ):
            create_channel_follows_store()
        create.assert_called_once_with("synthetic-project", "user-db")


class ChannelFollowsRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = SQLiteChannelFollowsStore(str(Path(self.temp.name) / "user.sqlite3"))
        environment = patch.dict(
            os.environ, {"FIREBASE_PROJECT_ID": "synthetic-project"}, clear=True
        )
        environment.start()
        self.addCleanup(environment.stop)
        app.dependency_overrides[get_channel_follows_store] = lambda: self.store
        self.addCleanup(app.dependency_overrides.clear)
        firebase_app = patch.object(
            app_auth.firebase_admin,
            "get_app",
            return_value=SimpleNamespace(project_id="synthetic-project"),
        )
        firebase_app.start()
        self.addCleanup(firebase_app.stop)
        verifier = patch.object(
            app_auth.auth,
            "verify_id_token",
            return_value={
                "uid": UID,
                "firebase": {"sign_in_provider": "google.com"},
            },
        )
        self.verifier = verifier.start()
        self.addCleanup(verifier.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def request(self, method="GET", **kwargs):
        return self.client.request(
            method,
            "/api/v1/channel-follows",
            headers={"Authorization": f"Bearer {TOKEN}"},
            **kwargs,
        )

    def assert_private(self, response, status):
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(response.headers.get("cache-control"), "no-store")

    def test_missing_expired_and_second_uid_cannot_access_first_owner(self):
        for method in ("GET", "PUT"):
            reply = self.client.request(
                method, "/api/v1/channel-follows?uid=" + UID, headers={"X-User-Id": UID}
            )
            self.assert_private(reply, 401)
            self.assertEqual(reply.json()["error"]["code"], "unauthenticated")
        first = self.request("PUT", json={"expectedRevision": 0, "items": raw_inputs("@one")})
        self.assert_private(first, 200)
        self.verifier.return_value = {"uid": OTHER, "firebase": {"sign_in_provider": "google.com"}}
        self.assertEqual(self.request().json(), {"revision": 0, "items": [], "limit": LIMIT})
        self.assert_private(self.request("PUT", json={"expectedRevision": 1, "items": []}), 409)
        self.assertEqual(self.store.get(UID), first.json())
        self.verifier.side_effect = auth.ExpiredIdTokenError("synthetic detail", None)
        self.assert_private(self.request(), 401)

    def test_round_trip_no_network_normalized_edits_and_conflict(self):
        with patch("socket.create_connection", side_effect=AssertionError("Outbound network")):
            self.assert_private(self.request(), 200)
            first = self.request("PUT", json={"expectedRevision": 0, "items": raw_inputs("@MiXeD")})
            self.assert_private(first, 200)
            self.assertEqual(first.json()["items"][0]["verification"], "user_provided")
            equivalent = self.request(
                "PUT",
                json={
                    "expectedRevision": 1,
                    "items": raw_inputs("https://youtube.com/@mixed"),
                },
            )
            self.assertEqual(first.json(), equivalent.json())
            self.assert_private(self.request("PUT", json={"expectedRevision": 0, "items": []}), 409)
            self.assert_private(self.request("PUT", json={"expectedRevision": 1, "items": []}), 200)
        self.assertEqual(self.request().json()["revision"], 2)

    def test_invalid_addresses_fields_duplicate_and_over_limit_requests_fail_without_write(self):
        for locator in [
            "https://attacker.example/@x",
            "http://youtube.com/@x",
            "@中文",
            "https://youtube.com/channel/UC123",
            "https://youtube.com/@x?secret=x",
            "https://youtube.com/@x/",
            "https://youtube.com@attacker.example/@x",
        ]:
            with self.subTest(locator=locator):
                self.assert_private(
                    self.request(
                        "PUT",
                        json={
                            "expectedRevision": 0,
                            "items": raw_inputs(locator),
                        },
                    ),
                    422,
                )
        malformed = [
            {"expectedRevision": True, "items": []},
            {"expectedRevision": -1, "items": []},
            {"expectedRevision": MAX_REVISION + 1, "items": []},
            {"expectedRevision": 0, "items": raw_inputs("@same", "https://youtube.com/@SAME")},
            {"expectedRevision": 0, "items": raw_inputs(*[f"@x{n}" for n in range(51)])},
            {"expectedRevision": 0, "items": raw_inputs("@a"), "uid": OTHER},
            {"expectedRevision": 0, "items": [{**raw_inputs("@a")[0], "followId": "spoof"}]},
            {"expectedRevision": 0, "items": raw_inputs("@a", name="a" * 121)},
            {"expectedRevision": 0, "items": raw_inputs("@a", note="a" * 1001)},
        ]
        for value in malformed:
            with self.subTest(value=value):
                result = self.request("PUT", json=value)
                self.assert_private(result, 422)
                self.assertEqual(result.json()["error"]["code"], "invalid_request")
        self.assertEqual(self.store.get(UID)["revision"], 0)

    def test_bounded_stream_strict_json_and_sensitive_failures(self):
        for raw, expected in [
            (b'{"expectedRevision":0,"expectedRevision":1,"items":[]}', 422),
            (b'{"expectedRevision":NaN,"items":[]}', 422),
            (b" " * (MAX_BODY_BYTES + 1), 413),
            (b'{"expectedRevision":0,"items":[]}' + b" " * MAX_BODY_BYTES, 413),
            (b"[" * 25 + b"]" * 25, 422),
            (
                b'{"expectedRevision":0,"items":[{"name":"\\ud800","note":"","handleOrUrl":"@x"}]}',
                422,
            ),
        ]:
            with self.subTest(expected=expected):
                self.assert_private(self.request("PUT", content=raw), expected)
        self.store.get = MagicMock(side_effect=RuntimeError("synthetic private SDK token"))
        response = self.request()
        self.assert_private(response, 503)
        self.assertNotIn("token", response.text)
        self.assertNotIn("SDK", response.text)
        self.assertTrue(response.json()["error"]["retryable"])

    def test_cors_and_unknown_methods_remain_private_and_health_available(self):
        preflight = self.client.options(
            "/api/v1/channel-follows",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "Authorization,Content-Type",
            },
        )
        self.assert_private(preflight, 200)
        self.assertEqual(preflight.headers["access-control-allow-origin"], "http://localhost:3000")
        rejected = self.client.options(
            "/api/v1/channel-follows",
            headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "PUT",
            },
        )
        self.assert_private(rejected, 400)
        self.assertNotIn("access-control-allow-origin", rejected.headers)
        self.assert_private(self.request("POST"), 405)
        self.assertEqual(self.client.get("/health").status_code, 200)
        self.assertEqual(self.client.get("/health").json(), {"status": "ok", "service": "user"})

    def test_missing_configuration_is_bounded_503_and_old_routes_unchanged(self):
        app.dependency_overrides.pop(get_channel_follows_store)
        configured_store.cache_clear()
        self.addCleanup(configured_store.cache_clear)
        with patch.dict(os.environ, {"USER_STORE_BACKEND": "invalid"}):
            self.assert_private(self.request(), 503)
        schema = self.client.get("/openapi.json").json()
        self.assertIn("requestBody", schema["paths"]["/api/v1/channel-follows"]["put"])
        self.assertIn("/api/v1/watchlist", schema["paths"])
        self.assertIn("/api/v1/me", schema["paths"])
        self.assertNotIn("/api/v1/preferences", schema["paths"])


class ChannelFollowsStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_stalled_body_returns_bounded_private_timeout_without_storage_write(self):
        store = MagicMock()
        app.dependency_overrides[require_google_user] = lambda: CurrentUser(
            uid=UID,
            email=None,
            displayName=None,
            photoURL=None,
        )
        app.dependency_overrides[get_channel_follows_store] = lambda: store
        self.addCleanup(app.dependency_overrides.clear)
        messages = []

        async def send(message):
            messages.append(message)

        async def receive():
            await asyncio.sleep(60)

        original_timeout = asyncio.timeout
        with patch(
            "app.channel_follows.asyncio.timeout", side_effect=lambda _: original_timeout(0.01)
        ):
            await app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0"},
                    "http_version": "1.1",
                    "method": "PUT",
                    "scheme": "http",
                    "path": "/api/v1/channel-follows",
                    "raw_path": b"/api/v1/channel-follows",
                    "root_path": "",
                    "query_string": b"",
                    "headers": [(b"content-type", b"application/json")],
                    "server": ("testserver", 80),
                    "client": ("testclient", 1234),
                },
                receive,
                send,
            )
        start = next(message for message in messages if message["type"] == "http.response.start")
        body = b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        )
        self.assertEqual(start["status"], 408)
        self.assertIn((b"cache-control", b"no-store"), start["headers"])
        self.assertEqual(json.loads(body)["error"]["code"], "request_timeout")
        store.replace.assert_not_called()
