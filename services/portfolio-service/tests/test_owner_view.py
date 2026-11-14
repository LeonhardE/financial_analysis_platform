"""Owner read preconditions combine original DTOs, never enroll authority or bypass recovery."""

import copy
import json
import sqlite3
import unittest
from unittest.mock import patch

import test_routes as route_fixtures
from fixtures import OTHER_UID, SOURCE, UID, HoldingsFixture
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.holdings import PortfolioService, verify_registry
from app.owner_view import PROFILE, _owner_selection, read_view
from app.store import FirestorePortfolioStore, document_path
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key


class OwnerViewTests(unittest.TestCase):
    assert_private = route_fixtures.HoldingsRouteTests.assert_private

    def setUp(self):
        route_fixtures.HoldingsRouteTests.setUp(self)
        self.fixture.write(self.service)
        self.headers = {
            key: value
            for key, value in self.headers.items()
            if key not in {"X-FolioView-Author-Key", "Idempotency-Key"}
        }
        self.url = f"/api/v3/holdings/sources/{SOURCE}/view/query"
        self.body = {"contractVersion": CONTRACT_VERSION, "expected": self.expected()}

    def expected(self, fixture=None, epoch=1):
        fixture = fixture or self.fixture
        return {
            "vaultId": fixture.vault,
            "rootJwk": fixture.root_public,
            "rootKeyId": fixture.registry.root_key_id,
            "registrySequence": fixture.registry.registry_sequence,
            "checkpointDigest": fixture.registry.checkpoint_digest,
            "keyEpoch": fixture.registry.key_epoch,
            "resourceRef": fixture.resource,
            "sourceEpoch": epoch,
            "recipientKeyIds": _owner_selection(fixture.registry, 1000)[1],
        }

    def read(self, body=None, headers=None):
        return self.client.post(
            self.url,
            headers=self.headers if headers is None else headers,
            json=self.body if body is None else body,
        )

    def use_firestore(self):
        client = firestore.Client(
            project="synthetic-portfolio", database="portfolio", credentials=AnonymousCredentials()
        )
        self.addCleanup(client.close)
        rpc = MemoryRpc(client)
        client._firestore_api_internal = rpc
        self.service = PortfolioService(
            FirestorePortfolioStore("synthetic-portfolio", "portfolio", client=client),
            clock=lambda: 1000,
        )
        self.fixture.install(self.service)
        self.fixture.write(self.service)
        rpc.calls.clear()
        return rpc

    def row(self, rpc, collection):
        return next(row for path, row in rpc.documents.items() if f"/{collection}/" in path)

    def test_complete_contains_exact_original_metadata_and_snapshot_without_sync(self):
        metadata = self.service.metadata(UID, SOURCE)
        snapshot = self.service.snapshot(UID, SOURCE)
        with (
            patch.object(self.service, "synchronize_authority", side_effect=AssertionError("sync")),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            response = self.read()
        self.assert_private(response, 200)
        self.assertEqual(
            response.json(),
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "vaultId": self.fixture.vault,
                "sourceId": SOURCE,
                "mode": "complete",
                "metadata": metadata,
                "snapshot": snapshot,
            },
        )

    def test_real_sdk_two_read_phases_one_history_check_and_no_writes(self):
        rpc = self.use_firestore()
        with patch("app.holdings.verify_registry", wraps=verify_registry) as verification:
            response = self.read()
        self.assert_private(response, 200)
        self.assertEqual(response.json()["mode"], "complete")
        self.assertEqual(verification.call_count, 1)
        reads = [kw["request"]["documents"] for kind, kw in rpc.calls if kind == "get"]
        self.assertEqual([len(batch) for batch in reads], [3, 1])
        self.assertEqual(len({path for batch in reads for path in batch}), 4)
        self.assertTrue(
            all(not kw["request"]["writes"] for kind, kw in rpc.calls if kind == "commit")
        )

    def test_platform_identity_header_preserves_independent_owner_authentication(self):
        platform = {"X-Serverless-Authorization": "Bearer synthetic-platform-identity"}
        response = self.read(headers={**self.headers, **platform})
        self.assert_private(response, 200)
        self.assertEqual(response.json()["mode"], "complete")
        with patch.object(self.service.store, "transact", side_effect=AssertionError("storage")):
            self.assert_private(
                self.read(headers={**platform, "X-FolioView-Contract": CONTRACT_VERSION}), 401
            )
        self.assert_private(
            self.read(headers={**self.headers, **platform, "Authorization": "Bearer synthetic-B"}),
            503,
        )

    def test_sqlite_also_uses_two_queries_and_keeps_original_dtos(self):
        expected_meta = self.service.metadata(UID, SOURCE)
        expected_snapshot = self.service.snapshot(UID, SOURCE)
        connect = sqlite3.connect
        statements = []

        def traced(*args, **kwargs):
            connection = connect(*args, **kwargs)
            connection.set_trace_callback(statements.append)
            return connection

        with patch("app.store.sqlite3.connect", side_effect=traced):
            result = read_view(self.service, UID, SOURCE, self.body["expected"])
        self.assertEqual(result["metadata"], expected_meta)
        self.assertEqual(result["snapshot"], expected_snapshot)
        self.assertEqual(
            sum(statement.lstrip().upper().startswith("SELECT") for statement in statements), 2
        )
        self.assertFalse(
            any(
                statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
                for statement in statements
            )
        )

    def test_retry_reloads_authority_and_cannot_publish_the_prior_complete_pair(self):
        rpc = self.use_firestore()
        rpc.aborts = 1
        rpc.before_abort = lambda: self.row(rpc, "portfolio_authorities").update(active=False)
        with patch("app.holdings.verify_registry", wraps=verify_registry) as verification:
            response = self.read()
        self.assert_private(response, 403)
        self.assertNotIn('"mode"', response.text)
        self.assertEqual(verification.call_count, 2)
        self.assertEqual(
            [len(kw["request"]["documents"]) for kind, kw in rpc.calls if kind == "get"], [3, 1, 3]
        )
        self.assertTrue(
            all(not kw["request"]["writes"] for kind, kw in rpc.calls if kind == "commit")
        )

    def test_duplicate_or_partial_stream_is_not_a_hint_or_a_negative_cache(self):
        rpc = self.use_firestore()
        original = rpc.batch_get_documents
        for mode in ("partial", "duplicate"):

            def broken(mode=mode, **kwargs):
                rows = list(original(**kwargs))
                return iter(rows[:-1] if mode == "partial" else [*rows, rows[0]])

            with self.subTest(mode=mode), patch.object(rpc, "batch_get_documents", broken):
                response = self.read()
                self.assert_private(response, 503)
                self.assertNotIn('"mode"', response.text)
            self.assertEqual(self.read().json()["mode"], "complete")

    def test_legacy_head_epoch_remains_unknown_and_each_request_reads_new_content(self):
        rpc = self.use_firestore()
        head = self.row(rpc, "portfolio_heads")
        head.pop("sourceEpoch")
        first = self.read()
        self.assert_private(first, 200)
        saved = copy.deepcopy(first.json())
        self.assertIsNone(saved["metadata"]["snapshotSourceEpoch"])
        self.fixture.write(
            self.service, snapshot="snapshot_2", revision=2, operation="synthetic_operation_000002"
        )
        second = self.read()
        self.assert_private(second, 200)
        self.assertEqual(second.json()["snapshot"]["receipt"]["snapshotId"], "snapshot_2")
        self.assertEqual(second.json()["metadata"]["revision"], 2)
        self.assertEqual(saved["snapshot"]["receipt"]["snapshotId"], "snapshot_1")

    def test_empty_source_is_explicitly_complete_and_never_reads_ciphertext(self):
        rpc = self.use_firestore()
        empty = HoldingsFixture(source="empty_view_source")
        empty.install(self.service)
        rpc.calls.clear()
        result = read_view(self.service, UID, empty.source, self.expected(empty))
        self.assertEqual(result["mode"], "complete")
        self.assertEqual(
            (result["metadata"]["revision"], result["metadata"]["snapshotId"], result["snapshot"]),
            (0, None, None),
        )
        self.assertEqual(
            [len(kw["request"]["documents"]) for kind, kw in rpc.calls if kind == "get"], [3]
        )

    def test_every_valid_public_precondition_mismatch_returns_no_partial_dto(self):
        rpc = self.use_firestore()
        other = HoldingsFixture()
        changes = [
            {"vaultId": "other_vault"},
            {"rootJwk": other.root_public, "rootKeyId": other.registry.root_key_id},
            {"registrySequence": self.fixture.registry.registry_sequence + 1},
            {"checkpointDigest": "0" * 64},
            {"keyEpoch": self.fixture.registry.key_epoch + 1},
            {"resourceRef": {**self.fixture.resource, "incarnation": "other_incarnation"}},
            {"sourceEpoch": 2},
            {"recipientKeyIds": self.body["expected"]["recipientKeyIds"][:1]},
        ]
        for change in changes:
            with self.subTest(change=change):
                rpc.calls.clear()
                response = self.read({**self.body, "expected": {**self.body["expected"], **change}})
                self.assert_private(response, 200)
                value = response.json()
                self.assertEqual(
                    (value["mode"], value["metadata"], value["snapshot"]),
                    ("sync_required", None, None),
                )
                self.assertEqual(
                    [len(kw["request"]["documents"]) for kind, kw in rpc.calls if kind == "get"],
                    [3],
                )

    def test_revoking_ahead_epoch_disconnected_and_deleted_require_original_recovery(self):
        self.fixture.mutate(self.service, action="disconnect")
        for state in ("revoking", "disconnected"):
            response = self.read()
            self.assert_private(response, 200)
            value = response.json()
            self.assertEqual(
                (value["mode"], value["metadata"], value["snapshot"]), ("sync_required", None, None)
            )
            self.assertEqual(self.service.metadata(UID, SOURCE)["state"], state)
            if state == "revoking":
                self.fixture.ack(self.service)
        self.fixture.mutate(
            self.service, action="delete", operation="synthetic_delete_000001", version=3, epoch=2
        )
        self.fixture.ack(self.service, operation="synthetic_delete_000001", epoch=3)
        self.assertEqual(self.read().json()["mode"], "sync_required")
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "deleted")

    def test_acknowledged_fence_retains_original_historical_owner_snapshot_epoch(self):
        self.fixture.mutate(self.service)
        self.fixture.ack(self.service)
        response = self.read({**self.body, "expected": self.expected(epoch=2)})
        self.assert_private(response, 200)
        value = response.json()
        self.assertEqual(value["mode"], "complete")
        self.assertEqual(value["metadata"]["sourceEpoch"], 2)
        self.assertEqual(value["metadata"]["snapshotSourceEpoch"], 1)
        self.assertEqual(value["snapshot"]["receipt"]["sourceEpoch"], 1)
        self.assertEqual(value["snapshot"], self.service.snapshot(UID, SOURCE))

    def test_live_acl_replica_mismatch_never_grants_a_complete_view(self):
        rpc = self.use_firestore()
        row = self.row(rpc, "portfolio_authorities")
        for field, value in (
            ("writerKeyIds", [self.fixture.kid("device_enc")]),
            ("recipientKeyIds", [self.fixture.kid("device_sig")]),
        ):
            with self.subTest(field=field):
                old = row[field]
                row[field] = value
                response = self.read()
                self.assert_private(response, 200)
                self.assertEqual(response.json()["mode"], "sync_required")
                row[field] = old

    def test_other_owner_and_corrupt_snapshot_do_not_leak_a_partial_pair(self):
        response = self.read(headers={**self.headers, "Authorization": "Bearer synthetic-B"})
        self.assert_private(response, 503)
        rpc = self.use_firestore()
        snapshot = self.row(rpc, "portfolio_snapshots")
        for field, value in (
            ("ownerSubject", owner_key(OTHER_UID)),
            ("snapshotId", "wrong_snapshot"),
            ("fingerprint", "A" * 43),
        ):
            with self.subTest(field=field):
                old = snapshot[field]
                snapshot[field] = value
                response = self.read()
                self.assertIn(response.status_code, (404, 503))
                self.assert_private(response, response.status_code)
                self.assertNotIn('"metadata"', response.text)
                self.assertNotIn('"mode"', response.text)
                snapshot[field] = old

    def test_corrupt_current_authority_head_or_lifecycle_is_not_hidden_by_mismatch(self):
        rpc = self.use_firestore()
        mismatch = {**self.body, "expected": {**self.body["expected"], "sourceEpoch": 2}}
        authority = self.row(rpc, "portfolio_authorities")
        old = authority["rootKeyId"]
        authority["rootKeyId"] = "A" * 43
        self.assert_private(self.read(mismatch), 503)
        authority["rootKeyId"] = old
        head = self.row(rpc, "portfolio_heads")
        old = head["revision"]
        head["revision"] = True
        self.assert_private(self.read(mismatch), 400)
        head["revision"] = old
        path = self.service.store.client.document(
            document_path("portfolio_source_states", owner_key(UID), SOURCE)
        )._document_path
        rpc.documents[path] = {"state": "invalid"}
        self.assert_private(self.read(mismatch), 503)

    def test_only_combined_budget_can_emit_separate_and_bad_snapshot_is_never_hidden(self):
        from app.owner_view import check_read_response

        def combined_only(value):
            if value.get("profile") == PROFILE:
                raise ContractError("payload_too_large")
            return check_read_response(value)

        with patch("app.owner_view.check_read_response", side_effect=combined_only):
            response = self.read()
            self.assert_private(response, 200)
            self.assertEqual(
                (response.json()["mode"], response.json()["metadata"], response.json()["snapshot"]),
                ("separate", None, None),
            )
        with patch(
            "app.holdings.check_read_response", side_effect=ContractError("payload_too_large")
        ):
            self.assert_private(self.read(), 413)
        with patch.object(
            self.service, "_snapshot_response", side_effect=ContractError("invalid_signature")
        ):
            self.assertNotEqual(self.read().status_code, 200)

    def test_head_receipt_association_is_checked_before_the_combined_size_hint(self):
        from app.owner_view import check_read_response

        def combined_only(value):
            if value.get("profile") == PROFILE:
                raise ContractError("payload_too_large")
            return check_read_response(value)

        for field in ("revision", "sourceEpoch"):
            with self.subTest(field=field):
                rpc = self.use_firestore()
                if field == "sourceEpoch":
                    self.fixture.mutate(self.service)
                    self.fixture.ack(self.service)
                    self.body["expected"] = self.expected(epoch=2)
                else:
                    self.body["expected"] = self.expected()
                self.row(rpc, "portfolio_heads")[field] = 2
                self.assert_private(self.read(), 503)
                with patch("app.owner_view.check_read_response", side_effect=combined_only):
                    response = self.read()
                    self.assert_private(response, 503)
                    self.assertNotIn('"mode"', response.text)

    def test_closed_body_scope_and_transport_fail_before_store(self):
        bodies = (
            {**self.body, "uid": UID},
            {**self.body, "expected": {**self.body["expected"], "active": True}},
            {**self.body, "expected": {**self.body["expected"], "sourceEpoch": True}},
            {
                **self.body,
                "expected": {
                    **self.body["expected"],
                    "rootJwk": {**self.fixture.root_public, "d": "PRIVATE"},
                },
            },
            {
                **self.body,
                "expected": {
                    **self.body["expected"],
                    "recipientKeyIds": self.body["expected"]["recipientKeyIds"] * 2,
                },
            },
        )
        with patch.object(self.service.store, "transact", side_effect=AssertionError("storage")):
            for body in bodies:
                with self.subTest(body=body):
                    self.assert_private(self.read(body), 400)
            self.assert_private(self.read(headers={}), 401)
            for header in (
                "X-FolioView-Authority-Delegation",
                "X-FolioView-Delegation",
                "X-FolioView-Author-Key",
                "Idempotency-Key",
            ):
                self.assert_private(self.read(headers={**self.headers, header: "FORBIDDEN"}), 400)
            self.assert_private(
                self.client.post(self.url + "?uid=other", headers=self.headers, json=self.body), 400
            )
            self.assert_private(
                self.client.post(self.url, headers=self.headers, content=json.dumps(self.body)), 415
            )
            self.assert_private(
                self.client.post(
                    self.url,
                    headers={**self.headers, "Content-Type": "application/json"},
                    content=b" " * 16_385,
                ),
                413,
            )
