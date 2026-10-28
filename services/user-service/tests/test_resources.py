"""Source versions, initialization and signed metadata-only authorization."""

import asyncio
import json
import os
import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from jwcrypto import jwk, jws

from app.channel_follows import ChannelInput, SQLiteChannelFollowsStore, normalize_inputs
from app.main import app
from app.resource_api import configured_verifier, delegated_metadata, get_delegation_verifier
from app.resource_versions import version_key
from app.resources import (
    MAX_INITIALIZATION_OPERATIONS,
    FirestoreUserResourceStore,
    InitializationLimit,
    ResourceUnavailable,
    SQLiteUserResourceStore,
    create_resource_store,
    get_resource_store,
    initialization_key,
)
from app.watchlist import SQLiteWatchlistStore, WatchlistUnavailable
from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.delegated_keys import KeyCache
from folioview_shared.delegation import DELEGATION_TYPE, DelegationVerifier
from folioview_shared.encrypted import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key
from folioview_shared.service_identity import GOOGLE_JWKS_URL, GoogleCallerVerifier

UID = "owner_A"
OTHER = "owner_B"
AUDIENCE = "https://user.example.com"
LOGICAL_AUDIENCE = AUDIENCE + "/internal/v2"
ISSUER = "https://hub.example.com"
SUBJECT = "112010400000000710080"
EMAIL = "hub@synthetic-project.iam.gserviceaccount.com"


def watch_item(symbol="AAPL"):
    return {
        "symbol": symbol,
        "name": "Private watchlist name",
        "instrumentType": "stock",
        "currency": "USD",
        "addedAt": "2026-10-20T10:00:00Z",
    }


def follows():
    return normalize_inputs(
        [
            ChannelInput(
                name="Private source name",
                handleOrUrl="@private-source",
                note="Private follow note",
            )
        ]
    )


class ResourceStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / "user.sqlite3")
        self.resources = SQLiteUserResourceStore(self.path)
        self.watchlist = SQLiteWatchlistStore(self.path)
        self.follows = SQLiteChannelFollowsStore(self.path)

    def raw(self, table, key):
        with closing(sqlite3.connect(self.path)) as db:
            row = db.execute(f"SELECT value FROM {table} WHERE owner=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def seed_legacy(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "INSERT INTO user_watchlists VALUES (?, ?)",
                (owner_key(UID), json.dumps({"version": 1, "items": [watch_item()]})),
            )

    def test_legacy_read_has_no_write_and_explicit_init_preserves_exact_list(self):
        self.seed_legacy()
        before = self.raw("user_watchlists", owner_key(UID))
        self.assertEqual(
            self.resources.read(UID, ("watchlist",))["watchlist"]["state"], "uninitialized"
        )
        self.assertIsNone(self.raw("user_resource_versions", version_key(UID, "watchlist")))
        result = self.resources.initialize(UID, "watchlist", "initial_operation")
        self.assertEqual(result["revision"], 1)
        self.assertEqual(result["sourceEpoch"], 1)
        self.assertEqual(result["state"], "ready")
        self.assertEqual(self.raw("user_watchlists", owner_key(UID)), before)
        self.assertEqual(self.watchlist.get(UID), [watch_item()])
        self.assertEqual(self.resources.initialize(UID, "watchlist", "initial_operation"), result)
        self.assertEqual(self.resources.initialize(UID, "watchlist", "another_operation"), result)

    def test_empty_initialization_is_revision_zero_and_next_changes_are_atomic(self):
        for kind in ("watchlist", "channel_follows"):
            result = self.resources.initialize(UID, kind, "same_operation_in_distinct_kind")
            self.assertEqual(result["state"], "empty")
            self.assertEqual(result["revision"], 0)
            self.assertEqual(self.resources.read(UID, (kind,))[kind], result)
        self.watchlist.change(UID, "AAPL", watch_item())
        self.assertEqual(self.resources.read(UID, ("watchlist",))["watchlist"]["revision"], 1)
        self.assertEqual(self.follows.replace(UID, 0, follows())["revision"], 1)
        self.assertEqual(
            self.resources.read(UID, ("channel_follows",))["channel_follows"]["revision"], 1
        )

    def test_watchlist_mutations_preserve_wire_shape_and_only_actual_changes_advance(self):
        self.assertEqual(self.watchlist.change(UID, "AAPL", watch_item()), [watch_item()])
        first = self.resources.read(UID, ("watchlist",))["watchlist"]
        self.assertEqual(first["revision"], 1)
        metadata = self.raw("user_resource_versions", version_key(UID, "watchlist"))
        self.watchlist.change(UID, "AAPL", watch_item())
        self.watchlist.change(UID, "MSFT", None)
        self.assertEqual(
            self.raw("user_resource_versions", version_key(UID, "watchlist")), metadata
        )
        self.assertEqual(self.watchlist.change(UID, "AAPL", None), [])
        result = self.resources.read(UID, ("watchlist",))["watchlist"]
        self.assertEqual(result["revision"], 2)
        self.assertEqual(result["ref"], first["ref"])
        self.assertEqual(result["sourceEpoch"], 1)
        self.assertEqual(result["state"], "empty")

    def test_simultaneous_initializers_keep_one_resource_identity(self):
        self.seed_legacy()

        def initialize(index):
            return SQLiteUserResourceStore(self.path).initialize(
                UID,
                "watchlist",
                f"operation_{index % 2}",
            )

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(initialize, range(12)))
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(results[0]["revision"], 1)

    def test_old_writer_corruption_cannot_be_repaired_by_init_or_new_writer(self):
        self.seed_legacy()
        self.resources.initialize(UID, "watchlist", "first")
        with closing(sqlite3.connect(self.path)) as db, db:
            value = {"version": 1, "items": [watch_item("MSFT")]}
            db.execute("UPDATE user_watchlists SET value=?", (json.dumps(value),))
        before = self.raw("user_resource_versions", version_key(UID, "watchlist"))
        for operation in (
            lambda: self.resources.read(UID, ("watchlist",)),
            lambda: self.resources.initialize(UID, "watchlist", "first"),
            lambda: self.resources.initialize(UID, "watchlist", "fresh_key"),
        ):
            with self.assertRaises(ResourceUnavailable):
                operation()
        with self.assertRaises(WatchlistUnavailable):
            self.watchlist.change(UID, "MSFT", None)
        self.assertEqual(self.raw("user_resource_versions", version_key(UID, "watchlist")), before)
        self.assertEqual(self.watchlist.get(UID), [watch_item("MSFT")])

    def test_missing_initialized_empty_content_is_not_recreated_by_watchlist_writer(self):
        self.resources.initialize(UID, "watchlist", "initialize_empty")
        key = version_key(UID, "watchlist")
        metadata = self.raw("user_resource_versions", key)
        receipt = self.raw("user_resource_initializations", key)
        self.assertEqual(metadata["revision"], 0)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("DELETE FROM user_watchlists WHERE owner=?", (owner_key(UID),))
        with self.assertRaises(WatchlistUnavailable):
            self.watchlist.change(UID, "AAPL", watch_item())
        self.assertIsNone(self.raw("user_watchlists", owner_key(UID)))
        self.assertEqual(self.raw("user_resource_versions", key), metadata)
        self.assertEqual(self.raw("user_resource_initializations", key), receipt)

    def test_initialization_failure_rolls_back_content_metadata_and_receipt(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "CREATE TRIGGER deny_receipt BEFORE INSERT ON user_resource_initializations "
                "BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"
            )
        with self.assertRaises(ResourceUnavailable):
            self.resources.initialize(UID, "watchlist", "failed_operation")
        for table in ("user_watchlists", "user_resource_versions", "user_resource_initializations"):
            with closing(sqlite3.connect(self.path)) as db:
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)

    def test_initialization_original_receipt_never_bypasses_current_integrity_or_epoch(self):
        original = self.resources.initialize(UID, "watchlist", "init")
        self.watchlist.change(UID, "AAPL", watch_item())
        self.assertEqual(self.resources.initialize(UID, "watchlist", "init"), original)
        self.assertEqual(self.resources.read(UID, ("watchlist",))["watchlist"]["revision"], 1)
        with closing(sqlite3.connect(self.path)) as db, db:
            key = version_key(UID, "watchlist")
            meta = json.loads(
                db.execute(
                    "SELECT value FROM user_resource_versions WHERE owner=?", (key,)
                ).fetchone()[0]
            )
            meta["sourceEpoch"] = 2
            db.execute(
                "UPDATE user_resource_versions SET value=? WHERE owner=?", (json.dumps(meta), key)
            )
        with self.assertRaises(ResourceUnavailable):
            self.resources.initialize(UID, "watchlist", "init")
        latest = self.resources.initialize(UID, "watchlist", "new_operation")
        self.assertEqual(latest["sourceEpoch"], 2)
        self.assertEqual(latest["ref"], original["ref"])

    def test_receipt_partition_two_owners_and_metadata_response_excludes_content(self):
        first = self.resources.initialize(UID, "watchlist", "init")
        second = self.resources.initialize(OTHER, "watchlist", "init")
        self.assertNotEqual(first["ref"], second["ref"])
        self.watchlist.change(UID, "AAPL", watch_item())
        self.follows.replace(UID, 0, follows())
        serialized = json.dumps(self.resources.read(UID, ("watchlist", "channel_follows")))
        for private in ("Private", "AAPL", "private-source", "contentDigest", "itemCount"):
            self.assertNotIn(private, serialized)
        self.assertNotIn(UID, serialized)
        key = version_key(UID, "watchlist")
        receipt = self.raw("user_resource_initializations", key)
        receipt["operations"][initialization_key(UID, "watchlist", "init")]["items"] = [
            "should never leak"
        ]
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute(
                "UPDATE user_resource_initializations SET value=? WHERE owner=?",
                (json.dumps(receipt), key),
            )
        with self.assertRaises(ResourceUnavailable):
            self.resources.initialize(UID, "watchlist", "init")

    def test_receipt_budget_is_atomic_under_competing_new_keys_and_replay_still_works(self):
        first = self.resources.initialize(UID, "watchlist", "first")
        for number in range(MAX_INITIALIZATION_OPERATIONS - 2):
            self.resources.initialize(UID, "watchlist", f"fill_{number}")

        def initialize(number):
            try:
                SQLiteUserResourceStore(self.path).initialize(
                    UID,
                    "watchlist",
                    f"race_{number}",
                )
                return True
            except InitializationLimit:
                return False

        with ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(sum(pool.map(initialize, range(12))), 1)
        key = version_key(UID, "watchlist")
        before = self.raw("user_resource_initializations", key)
        self.assertEqual(len(before["operations"]), MAX_INITIALIZATION_OPERATIONS)
        self.assertEqual(self.resources.initialize(UID, "watchlist", "first"), first)
        with self.assertRaises(InitializationLimit):
            self.resources.initialize(UID, "watchlist", "over_limit")
        self.assertEqual(self.raw("user_resource_initializations", key), before)
        self.assertEqual(self.resources.read(UID, ("watchlist",))["watchlist"], first)
        # Each owner/kind has an independent small budget.
        self.assertEqual(self.resources.initialize(OTHER, "watchlist", "over_limit")["revision"], 0)
        self.assertEqual(
            self.resources.initialize(UID, "channel_follows", "over_limit")["revision"], 0
        )

    def test_configuration_rejects_cloud_local_modes_and_split_local_files(self):
        for config in (
            {"K_SERVICE": "", "USER_STORE_BACKEND": "sqlite"},
            {"K_SERVICE": "user", "FIRESTORE_EMULATOR_HOST": "localhost:8080"},
            {"K_SERVICE": "user", "FIREBASE_AUTH_EMULATOR_HOST": "localhost:9099"},
            {"USER_STORE_BACKEND": "firestore"},
            {"USER_STORE_BACKEND": "invalid"},
            {
                "USER_STORE_BACKEND": "sqlite",
                "WATCHLIST_DB_PATH": self.path,
                "CHANNEL_FOLLOWS_DB_PATH": self.path + ".different",
            },
        ):
            with self.subTest(config=config), patch.dict(os.environ, config, clear=True):
                with self.assertRaises(ResourceUnavailable):
                    create_resource_store()


class FirestoreResourceStoreTests(unittest.TestCase):
    def setUp(self):
        self.client, self.transaction = MagicMock(), MagicMock()
        self.documents = {}

        def collection(name):
            result = MagicMock()

            def document(key):
                if (name, key) not in self.documents:
                    value = MagicMock()
                    value.get.return_value.to_dict.return_value = None
                    self.documents[name, key] = value
                return self.documents[name, key]

            result.document.side_effect = document
            return result

        self.client.collection.side_effect = collection
        with patch("app.resources.firestore.Client", return_value=self.client):
            self.store = FirestoreUserResourceStore("synthetic-project", "synthetic-db")
        decorated = patch("app.resources.firestore.transactional", side_effect=lambda fn: fn)
        bounded = patch("app.resources.BoundedTransaction", return_value=self.transaction)
        decorated.start()
        bounded.start()
        self.addCleanup(decorated.stop)
        self.addCleanup(bounded.stop)

    def apply(self):
        for call in self.transaction.set.call_args_list:
            reference, value = call.args
            reference.get.return_value.to_dict.return_value = deepcopy(value)
        self.transaction.reset_mock()

    def test_catalogue_reads_at_most_four_docs_consistently_without_writes(self):
        result = self.store.read(UID, ("watchlist", "channel_follows"))
        self.assertTrue(all(value["state"] == "uninitialized" for value in result.values()))
        self.assertEqual(len(self.documents), 4)
        for reference in self.documents.values():
            reference.get.assert_called_once_with(
                transaction=self.transaction, timeout=4, retry=None
            )
        self.transaction.set.assert_not_called()

    def test_init_three_document_write_retry_noop_and_legacy_preservation(self):
        content_ref, _ = self.store.references(UID, "watchlist")
        legacy = {"version": 1, "items": [watch_item()]}
        content_ref.get.return_value.to_dict.return_value = deepcopy(legacy)
        saved = self.store.initialize(UID, "watchlist", "init")
        self.assertEqual(self.transaction.set.call_count, 3)
        self.assertEqual(self.transaction.set.call_args_list[0].args, (content_ref, legacy))
        self.apply()
        self.assertEqual(self.store.initialize(UID, "watchlist", "init"), saved)
        self.transaction.set.assert_not_called()
        self.assertEqual(self.store.read(UID, ("watchlist",))["watchlist"], saved)

    def test_firestore_receipt_budget_keeps_one_document_and_full_replays_do_not_write(self):
        first = self.store.initialize(UID, "watchlist", "first")
        self.apply()
        for number in range(MAX_INITIALIZATION_OPERATIONS - 1):
            self.store.initialize(UID, "watchlist", f"next_{number}")
            self.apply()
        # Content, version and one aggregate receipt, no per-operation documents.
        self.assertEqual(len(self.documents), 3)
        self.assertEqual(self.store.initialize(UID, "watchlist", "first"), first)
        self.transaction.set.assert_not_called()
        with self.assertRaises(InitializationLimit):
            self.store.initialize(UID, "watchlist", "one_too_many")
        self.transaction.set.assert_not_called()

    def test_bad_metadata_aborts_without_writing_even_with_another_key(self):
        self.store.initialize(UID, "watchlist", "init")
        self.apply()
        _, metadata_ref = self.store.references(UID, "watchlist")
        meta = deepcopy(metadata_ref.get.return_value.to_dict.return_value)
        meta["contentDigest"] = "0" * 64
        metadata_ref.get.return_value.to_dict.return_value = meta
        for action in (
            lambda: self.store.read(UID, ("watchlist",)),
            lambda: self.store.initialize(UID, "watchlist", "another"),
        ):
            with self.assertRaises(ResourceUnavailable):
                action()
        self.transaction.set.assert_not_called()


class SignedMetadataRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.google_key = jwk.JWK.generate(kty="RSA", size=2048)
        cls.hub_key = jwk.JWK.generate(kty="RSA", size=2048)
        cls.foreign_key = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = str(Path(self.temp.name) / "user.sqlite3")
        self.store = SQLiteUserResourceStore(path)
        SQLiteWatchlistStore(path).change(UID, "AAPL", watch_item())
        SQLiteChannelFollowsStore(path).replace(UID, 0, follows())
        self.now = int(time.time())
        self.key_fetches = []

        def key_cache(url, key, kid):
            public = key.export(private_key=False, as_dict=True)
            public = {name: public[name] for name in ("kty", "n", "e")}
            public.update(kid=kid, use="sig", alg="RS256")

            def transport(requested, **kwargs):
                self.key_fetches.append(requested)
                return json.dumps({"keys": [public]}).encode()

            return KeyCache(url, transport=transport)

        google = GoogleCallerVerifier(
            AUDIENCE, {SUBJECT: EMAIL}, keys=key_cache(GOOGLE_JWKS_URL, self.google_key, "google")
        )
        self.verifier = DelegationVerifier(
            issuer=ISSUER,
            audience=LOGICAL_AUDIENCE,
            source_service="user",
            caller_verifier=google,
            keys=key_cache(ISSUER + "/.well-known/jwks.json", self.hub_key, "hub"),
        )
        app.dependency_overrides[get_resource_store] = lambda: self.store
        app.dependency_overrides[get_delegation_verifier] = lambda: self.verifier
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def signed(self, key, claims, kid, typ):
        message = jws.JWS(json.dumps(claims).encode())
        message.add_signature(key, protected=json.dumps({"alg": "RS256", "kid": kid, "typ": typ}))
        return message.serialize(compact=True)

    def service(self, **changes):
        claims = {
            "iss": "https://accounts.google.com",
            "aud": AUDIENCE,
            "sub": SUBJECT,
            "email": EMAIL,
            "email_verified": True,
            "azp": SUBJECT,
            "iat": self.now - 10,
            "exp": self.now + 300,
            **changes,
        }
        return self.signed(self.google_key, claims, "google", "JWT")

    def delegation(self, **changes):
        claims = {
            "iss": ISSUER,
            "aud": LOGICAL_AUDIENCE,
            "sub": UID,
            "iat": self.now - 5,
            "exp": self.now + 45,
            "jti": "synthetic_catalogue",
            "caller": EMAIL,
            "purpose": "browser_catalog",
            "scopes": ["resources:catalog"],
            "resourceKinds": ["watchlist", "channel_follows"],
            **changes,
        }
        return self.signed(self.hub_key, claims, "hub", DELEGATION_TYPE)

    def headers(self, *, service=None, delegation=None, **changes):
        return {
            "Authorization": "Bearer " + (self.service() if service is None else service),
            "X-FolioView-Delegation": self.delegation() if delegation is None else delegation,
            "X-FolioView-Contract": CONTRACT_VERSION,
            **changes,
        }

    def assert_private(self, response, status):
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(response.headers.get("cache-control"), "no-store")
        if response.request.url.path.startswith("/internal/v2/") and status >= 400:
            validate_schema("Error", response.json())
            self.assertEqual(ContractError(response.json()["error"]["code"]).status, status)

    def catalogue(self, **kwargs):
        return self.client.get("/internal/v2/resources/catalogue", **kwargs)

    def test_valid_double_signatures_return_only_current_metadata_and_scope_filter(self):
        with patch("socket.create_connection", side_effect=AssertionError("Market/network access")):
            response = self.catalogue(headers=self.headers())
        self.assert_private(response, 200)
        self.assertEqual(response.json()["contractVersion"], CONTRACT_VERSION)
        self.assertEqual(
            {item["kind"] for item in response.json()["items"]}, {"watchlist", "channel_follows"}
        )
        for item in response.json()["items"]:
            self.assertEqual(
                set(item),
                {"kind", "sourceService", "state", "ref", "revision", "sourceEpoch", "updatedAt"},
            )
        for secret in (
            "Private",
            "AAPL",
            "private-source",
            "contentDigest",
            "itemCount",
            "owner_A",
        ):
            self.assertNotIn(secret, response.text)
        scoped = self.catalogue(
            headers=self.headers(delegation=self.delegation(resourceKinds=["watchlist"]))
        )
        self.assert_private(scoped, 200)
        self.assertEqual([item["kind"] for item in scoped.json()["items"]], ["watchlist"])
        forbidden = self.client.get(
            "/internal/v2/resources/catalogue?kind=channel_follows",
            headers=self.headers(delegation=self.delegation(resourceKinds=["watchlist"])),
        )
        self.assert_private(forbidden, 403)
        self.assertEqual(
            set(self.key_fetches), {GOOGLE_JWKS_URL, ISSUER + "/.well-known/jwks.json"}
        )

    def test_missing_firebase_forged_wrong_caller_and_wrong_audience_do_not_authorize(self):
        for headers, status in [
            ({"X-FolioView-Contract": CONTRACT_VERSION}, 401),
            (
                {
                    "Authorization": "Bearer " + self.service(),
                    "X-FolioView-Contract": CONTRACT_VERSION,
                },
                401,
            ),
            (self.headers(service="firebase-user-token"), 401),
            (self.headers(service=self.service(sub="99999999", azp="99999999")), 403),
            (
                self.headers(
                    service=self.service(email="other@synthetic-project.iam.gserviceaccount.com")
                ),
                403,
            ),
            (self.headers(service=self.service(aud="https://wrong.example.com")), 401),
            (self.headers(delegation=self.delegation(aud=AUDIENCE + "/internal/v1")), 401),
            (self.headers(delegation=self.delegation(exp=self.now - 1)), 401),
            (self.headers(delegation=self.delegation(caller="other@example.com")), 403),
            (self.headers(delegation=self.delegation(scopes=["watchlist:read"])), 401),
        ]:
            with self.subTest(status=status):
                self.assert_private(self.catalogue(headers=headers), status)
        forged = self.delegation().split(".")
        forged[2] = forged[2][:-3] + "AAA"
        self.assert_private(self.catalogue(headers=self.headers(delegation=".".join(forged))), 401)

    def test_foreign_owner_or_incarnation_and_scope_fail_before_content_can_escape(self):
        ref = self.store.read(UID, ("watchlist",))["watchlist"]["ref"]
        path = "/internal/v2/resources/projections/read"
        request = {"contractVersion": CONTRACT_VERSION, "refs": [ref]}
        for headers, body, status in [
            (self.headers(delegation=self.delegation(sub=OTHER)), request, 404),
            (self.headers(), {**request, "refs": [{**ref, "incarnation": "old_incarnation"}]}, 404),
            (
                self.headers(delegation=self.delegation(resourceKinds=["channel_follows"])),
                request,
                403,
            ),
            (self.headers(), {**request, "owner": OTHER}, 400),
            (self.headers(), {**request, "refs": [ref, ref]}, 400),
        ]:
            with self.subTest(status=status):
                self.assert_private(self.client.post(path, headers=headers, json=body), status)
        valid = self.client.post(path, headers=self.headers(), json=request)
        self.assert_private(valid, 200)
        self.assertNotIn("contentDigest", valid.text)
        self.assertNotIn("AAPL", valid.text)
        changed = deepcopy(ref)
        self.assertEqual(changed, ref)

    def test_current_revision_and_source_epoch_are_reloaded_for_every_state_read(self):
        ref = self.store.read(UID, ("watchlist",))["watchlist"]["ref"]
        request = {"contractVersion": CONTRACT_VERSION, "refs": [ref]}
        path = "/internal/v2/resources/states/read"
        headers = self.headers()
        first = self.client.post(path, headers=headers, json=request)
        self.assert_private(first, 200)
        self.assertEqual(first.json()["items"][0]["revision"], 1)
        SQLiteWatchlistStore(self.store.path).change(UID, "AAPL", None)
        second = self.client.post(path, headers=headers, json=request)
        self.assertEqual(second.json()["items"][0]["revision"], 2)
        with closing(sqlite3.connect(self.store.path)) as db, db:
            key = version_key(UID, "watchlist")
            meta = json.loads(
                db.execute(
                    "SELECT value FROM user_resource_versions WHERE owner=?", (key,)
                ).fetchone()[0]
            )
            meta["sourceEpoch"] = 2
            db.execute(
                "UPDATE user_resource_versions SET value=? WHERE owner=?", (json.dumps(meta), key)
            )
        third = self.client.post(path, headers=headers, json=request)
        self.assertEqual(third.json()["items"][0]["sourceEpoch"], 2)
        self.assertEqual(
            set(third.json()["items"][0]), {"ref", "revision", "sourceEpoch", "state", "observedAt"}
        )

    def test_agent_run_and_v1_or_unsigned_contracts_cannot_fallback(self):
        ref = self.store.read(UID, ("watchlist",))["watchlist"]["ref"]
        run_claims = {
            "iss": ISSUER,
            "aud": LOGICAL_AUDIENCE,
            "sub": UID,
            "iat": self.now - 5,
            "exp": self.now + 45,
            "jti": "agent_run",
            "caller": EMAIL,
            "purpose": "agent_run",
            "scopes": ["watchlist:read"],
            "resources": [{"ref": ref, "sourceEpoch": 1}],
            "runId": "run",
            "taskId": "task",
            "grantId": "grant",
            "grantEpoch": 1,
        }
        run = self.signed(self.hub_key, run_claims, "hub", DELEGATION_TYPE)
        self.assert_private(self.catalogue(headers=self.headers(delegation=run)), 403)
        missing = self.headers()
        missing.pop("X-FolioView-Contract")
        self.assert_private(self.catalogue(headers=missing), 400)
        self.assert_private(
            self.catalogue(headers=self.headers(**{"X-FolioView-Contract": "v1"})), 400
        )
        old = self.client.get("/internal/v1/resources/catalogue", headers=self.headers())
        self.assert_private(old, 404)
        for query in ("uid=owner_B", "kind=watchlist&kind=channel_follows", "q=AAPL"):
            self.assert_private(
                self.client.get(
                    "/internal/v2/resources/catalogue?" + query, headers=self.headers()
                ),
                400,
            )

    def test_initializer_is_user_authenticated_only_and_body_is_bounded(self):
        self.assert_private(
            self.client.post(
                "/api/v1/resource-initializations",
                json={
                    "kind": "watchlist",
                    "operationKey": "test",
                },
            ),
            401,
        )
        app.dependency_overrides[require_google_user] = lambda: CurrentUser(
            uid=OTHER,
            email=None,
            displayName=None,
            photoURL=None,
        )
        initialized = self.client.post(
            "/api/v1/resource-initializations",
            json={
                "kind": "watchlist",
                "operationKey": "user_init",
            },
        )
        self.assert_private(initialized, 201)
        self.assertEqual(initialized.json()["revision"], 0)
        for body in (
            {"kind": "watchlist", "operationKey": "x", "uid": UID},
            {"kind": "holdings", "operationKey": "x"},
        ):
            self.assert_private(
                self.client.post("/api/v1/resource-initializations", json=body), 422
            )
        self.assert_private(
            self.client.post("/api/v1/resource-initializations", content=b" " * 131_073), 413
        )
        self.assertEqual(self.store.read(UID, ("watchlist",))["watchlist"]["revision"], 1)

    def test_unconfigured_trust_and_source_failures_are_closed_and_private(self):
        app.dependency_overrides.pop(get_delegation_verifier)
        configured_verifier.cache_clear()
        self.addCleanup(configured_verifier.cache_clear)
        with patch.dict(os.environ, {}, clear=True):
            reply = self.catalogue(headers=self.headers())
        self.assert_private(reply, 503)
        self.assertNotIn(EMAIL, reply.text)
        app.dependency_overrides[get_delegation_verifier] = lambda: self.verifier
        self.store.read = MagicMock(side_effect=ResourceUnavailable("private details"))
        self.assert_private(self.catalogue(headers=self.headers()), 503)
        self.store.read.side_effect = RuntimeError("private token details")
        unexpected = self.catalogue(headers=self.headers())
        self.assert_private(unexpected, 503)
        self.assertNotIn("token", unexpected.text)
        self.assert_private(
            self.client.options(
                "/internal/v2/resources/catalogue",
                headers={
                    "Origin": "https://foreign.example",
                    "Access-Control-Request-Method": "POST",
                },
            ),
            400,
        )


class ResourceStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_stalled_init_and_v2_body_are_bounded_without_source_operation(self):
        store = MagicMock()
        app.dependency_overrides[get_resource_store] = lambda: store
        app.dependency_overrides[require_google_user] = lambda: CurrentUser(
            uid=UID,
            email=None,
            displayName=None,
            photoURL=None,
        )
        app.dependency_overrides[delegated_metadata] = lambda: SimpleNamespace(
            owner_uid=UID,
            resource_kinds=frozenset({"watchlist"}),
        )
        self.addCleanup(app.dependency_overrides.clear)
        original_timeout = asyncio.timeout
        for path, status in [
            ("/api/v1/resource-initializations", 408),
            ("/internal/v2/resources/projections/read", 400),
        ]:
            messages = []

            async def send(message, target=messages):
                target.append(message)

            async def receive():
                await asyncio.sleep(60)

            with patch(
                "app.resource_api.asyncio.timeout", side_effect=lambda _: original_timeout(0.01)
            ):
                await app(
                    {
                        "type": "http",
                        "asgi": {"version": "3.0"},
                        "http_version": "1.1",
                        "method": "POST",
                        "scheme": "http",
                        "path": path,
                        "raw_path": path.encode(),
                        "root_path": "",
                        "query_string": b"",
                        "headers": [(b"content-type", b"application/json")],
                        "server": ("testserver", 80),
                        "client": ("testclient", 1234),
                    },
                    receive,
                    send,
                )
            start = next(
                message for message in messages if message["type"] == "http.response.start"
            )
            raw = b"".join(
                message.get("body", b"")
                for message in messages
                if message["type"] == "http.response.body"
            )
            self.assertEqual(start["status"], status)
            self.assertIn((b"cache-control", b"no-store"), start["headers"])
            if status == 400:
                validate_schema("Error", json.loads(raw))
                self.assertEqual(json.loads(raw)["error"]["code"], "malformed_request")
        store.initialize.assert_not_called()
        store.read.assert_not_called()


class DelegationConfigurationTests(unittest.TestCase):
    def test_trust_configuration_is_explicit_versioned_and_construction_does_not_fetch(self):
        callers = json.dumps({SUBJECT: EMAIL})
        values = (AUDIENCE, LOGICAL_AUDIENCE, ISSUER, callers)
        configured_verifier.cache_clear()
        self.addCleanup(configured_verifier.cache_clear)
        with patch("socket.create_connection", side_effect=AssertionError("Network during config")):
            self.assertIsInstance(configured_verifier(values), DelegationVerifier)
            for invalid in [
                ("", "", "", ""),
                (AUDIENCE, AUDIENCE + "/internal/v1", ISSUER, callers),
                (AUDIENCE, LOGICAL_AUDIENCE, ISSUER, "{}"),
                (AUDIENCE, LOGICAL_AUDIENCE, ISSUER, json.dumps({"wrong-subject": EMAIL})),
                (AUDIENCE, LOGICAL_AUDIENCE, ISSUER, json.dumps({str(n): EMAIL for n in range(9)})),
                (AUDIENCE, LOGICAL_AUDIENCE, "http://untrusted.example", callers),
            ]:
                with self.subTest(config=invalid), self.assertRaises(ContractError) as error:
                    configured_verifier(invalid)
                self.assertEqual(error.exception.code, "authorization_unavailable")
