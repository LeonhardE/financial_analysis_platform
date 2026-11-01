"""Read-only recovery of an original task operation under historical authority."""

import copy
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_firestore_store as firestore_fixtures
import test_tasks as task_fixtures
from fastapi.testclient import TestClient
from fixtures import BOOT, OTHER_UID, UID
from key_renewal_fixtures import RENEW, KeyRenewalFixture

from app.api import require_owner
from app.key_renewals import VaultKeyRenewalService
from app.main import app
from app.store import FirestoreHubStore, SQLiteHubStore, StoreUnavailable, document_path
from app.tasks import TaskService, get_task_service
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

TASK, OP = task_fixtures.TASK, task_fixtures.OP


class OperationFixture(task_fixtures.TaskFixture, KeyRenewalFixture):
    pass


class OperationSetup:
    def prepare(self, store):
        self.store, self.clock = store, 1000
        self.fixture = OperationFixture()
        self.vaults = VaultService(store, clock=lambda: self.clock)
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        self.service = TaskService(store, clock=lambda: self.clock)
        self.body = self.fixture.body()
        self.original = self.service.create(UID, self.body, OP, self.fixture.kid("device_sig"))[0]

    def op_path(self, operation=OP, task=TASK):
        return document_path(
            "hub_task_operations", owner_key(UID), self.fixture.vault, task, operation
        )

    def version_path(self, version=1):
        return document_path(
            "hub_task_versions", owner_key(UID), self.fixture.vault, TASK, str(version)
        )

    def head_path(self):
        return document_path("hub_tasks", owner_key(UID), self.fixture.vault, TASK)

    def later(self):
        for version, action, epoch in [(2, "pause", 2), (3, "archive", 3)]:
            operation = f"synthetic_original_task_{action}_0001"
            self.service.transition(
                UID,
                TASK,
                self.fixture.body(version=version, action=action, epoch=epoch, operation=operation),
                operation,
                self.fixture.kid("device_sig"),
            )
        return self.service.get(UID, TASK)

    def code(self, code, action):
        with self.assertRaises(ContractError) as failed:
            action()
        self.assertEqual(failed.exception.code, code)


class TaskOperationTests(OperationSetup, unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "task-operations.sqlite3"
        self.prepare(SQLiteHubStore(self.path))

    def snapshot(self):
        with sqlite3.connect(self.path) as connection:
            return connection.execute(
                "SELECT path, body FROM hub_documents ORDER BY path"
            ).fetchall()

    def test_restart_and_later_status_keep_exact_original_encrypted_task(self):
        latest = self.later()
        self.assertEqual(latest["metadata"]["status"], "archived")
        self.store = SQLiteHubStore(self.path)
        self.service = TaskService(self.store, clock=lambda: 5001)
        before = self.snapshot()
        recovered = self.service.operation(UID, TASK, OP)
        validate_schema("EncryptedTask", recovered)
        self.assertEqual(recovered, self.original)
        self.assertEqual(recovered["metadata"]["taskVersion"], 1)
        self.assertEqual(recovered["metadata"]["status"], "active")
        pause = "synthetic_original_task_pause_0001"
        self.assertEqual(self.service.operation(UID, TASK, pause)["metadata"]["taskVersion"], 2)
        self.assertEqual(self.snapshot(), before)

    def test_expired_writer_does_not_enable_replay_or_prune_expired_cursors(self):
        other_task, other_op = "synthetic_second_task", "synthetic_second_task_operation"
        self.service.create(
            UID,
            self.fixture.body(task=other_task, operation=other_op),
            other_op,
            self.fixture.kid("device_sig"),
        )
        self.assertIsNotNone(self.service.list(UID, limit=1)["nextCursor"])
        self.clock = 5001
        before = self.snapshot()
        with patch.object(self.service, "_fresh", side_effect=AssertionError("source RPC")):
            self.assertEqual(self.service.operation(UID, TASK, OP), self.original)
        self.code(
            "key_authorization_required",
            lambda: self.service.create(UID, self.body, OP, self.fixture.kid("device_sig")),
        )
        self.assertEqual(self.snapshot(), before)

    def test_revoked_writer_remains_historically_readable(self):
        self.fixture.add_key("replacement_sig", "device_sig", "replacement")
        bundle = self.fixture.make_bundle(previous=self.fixture.registry, revoked=("device_sig",))
        self.vaults.update_registry(
            UID,
            self.fixture.vault,
            {"contractVersion": CONTRACT_VERSION, "expectedVersion": 1, "registryBundle": bundle},
            "synthetic_operation_revoke_writer",
        )
        self.assertEqual(self.service.operation(UID, TASK, OP), self.original)
        self.code(
            "key_authorization_required",
            lambda: self.service.create(UID, self.body, OP, self.fixture.kid("device_sig")),
        )

    def test_real_root_key_renewal_keeps_original_ciphertext_and_operation(self):
        self.clock = 5001
        lifecycle = VaultLifecycleService(self.store, clock=lambda: self.clock)
        state = lifecycle.state(UID, self.fixture.vault)
        renewal = self.fixture.renewal(state, now=self.clock)
        VaultKeyRenewalService(self.store, clock=lambda: self.clock).renew(
            UID, self.fixture.vault, renewal, RENEW
        )
        before = self.snapshot()
        self.assertEqual(self.service.operation(UID, TASK, OP), self.original)
        self.assertEqual(self.snapshot(), before)
        self.code(
            "key_authorization_required",
            lambda: self.service.create(UID, self.body, OP, self.fixture.kid("device_sig")),
        )

    def test_valid_operation_boundaries_include_underscore_and_dash_prefixes(self):
        for index, operation in enumerate(["_" + "a" * 21, "-" + "b" * 127]):
            task = f"synthetic_operation_boundary_{index}"
            accepted = self.service.create(
                UID,
                self.fixture.body(task=task, operation=operation),
                operation,
                self.fixture.kid("device_sig"),
            )[0]
            self.assertEqual(self.service.operation(UID, task, operation), accepted)
        for invalid in ["x" * 21, "x" * 129, "x" * 21 + ".", "é" * 22, True]:
            with self.subTest(operation=invalid), self.assertRaises(ContractError):
                self.service.operation(UID, TASK, invalid)

    def test_missing_cross_owner_task_and_operation_are_not_found(self):
        other = OperationFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        for uid, task, operation in [
            (OTHER_UID, TASK, OP),
            (UID, "synthetic_missing_task", OP),
            (UID, TASK, "synthetic_missing_operation"),
        ]:
            self.code(
                "not_found",
                lambda uid=uid, task=task, operation=operation: self.service.operation(
                    uid, task, operation
                ),
            )

    def test_operation_row_binding_corruption_fails_closed_without_repair(self):
        saved = self.store.transact(lambda unit: unit.get(self.op_path()))
        for change in [
            {"ownerSubject": owner_key(OTHER_UID)},
            {"vaultId": "synthetic_other_vault"},
            {"taskId": "synthetic_other_task"},
            {"version": True},
            {"version": 2},
            {"authorKeyId": self.fixture.root_id},
            {"authorKeyId": "bad"},
            {"fingerprint": "bad"},
            {"unexpected": True},
        ]:
            with self.subTest(change=change):
                self.store.transact(
                    lambda unit, change=change: unit.put(self.op_path(), {**saved, **change})
                )
                before = self.snapshot()
                with self.assertRaises(StoreUnavailable):
                    self.service.operation(UID, TASK, OP)
                self.assertEqual(self.snapshot(), before)
        self.store.transact(lambda unit: unit.put(self.op_path(), saved))

    def test_operation_alias_cannot_repoint_to_valid_other_version_or_stable_id(self):
        self.later()
        saved = self.store.transact(lambda unit: unit.get(self.op_path()))
        self.store.transact(lambda unit: unit.put(self.op_path(), {**saved, "version": 2}))
        with self.assertRaises(StoreUnavailable):
            self.service.operation(UID, TASK, OP)
        other_op = "synthetic_task_operation_alias"
        self.store.transact(lambda unit: unit.put(self.op_path(other_op), saved))
        with self.assertRaises(StoreUnavailable):
            self.service.operation(UID, TASK, other_op)

    def test_missing_or_corrupt_committed_history_is_storage_failure(self):
        with sqlite3.connect(self.path) as connection:
            connection.execute("DELETE FROM hub_documents WHERE path = ?", (self.version_path(),))
        with self.assertRaises(StoreUnavailable):
            self.service.operation(UID, TASK, OP)


class TaskOperationRouteTests(OperationSetup, unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.prepare(SQLiteHubStore(Path(directory.name) / "http.sqlite3"))
        app.dependency_overrides[get_task_service] = lambda: self.service
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=UID)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.path = f"/api/v2/tasks/{TASK}/operations/{OP}"
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}

    def test_read_only_http_returns_original_after_expiry_and_later_status(self):
        self.later()
        self.clock = 5001
        response = self.client.get(self.path, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), self.original)
        validate_schema("EncryptedTask", response.json())

    def test_queries_write_selectors_duplicate_contract_and_bodies_are_rejected(self):
        cases = [
            (self.path + "?owner=foreign", self.headers, None, 400),
            (self.path + "?version=1&version=1", self.headers, None, 400),
            (self.path, {}, None, 400),
            (self.path, {"X-FolioView-Contract": "unsupported"}, None, 400),
            (self.path, [("X-FolioView-Contract", CONTRACT_VERSION)] * 2, None, 400),
            (self.path, {**self.headers, "Idempotency-Key": OP}, None, 400),
            (
                self.path,
                {**self.headers, "X-FolioView-Author-Key": self.fixture.kid("device_sig")},
                None,
                400,
            ),
            (self.path, {**self.headers, "X-FolioView-Delegation": "opaque"}, None, 403),
            (self.path, {**self.headers, "X-Serverless-Authorization": "Bearer a.b.c"}, None, 403),
            (self.path, self.headers, b"{}", 400),
        ]
        for path, headers, content, status in cases:
            with self.subTest(path=path, headers=headers):
                response = self.client.request("GET", path, headers=headers, content=content)
                self.assertEqual(response.status_code, status, response.text[:200])
                self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.service.operation(UID, TASK, OP), self.original)

    def test_missing_operation_and_corrupt_association_have_distinct_fail_closed_status(self):
        missing = self.client.get(self.path + "_missing", headers=self.headers)
        self.assertEqual(missing.status_code, 404, missing.text[:200])
        saved = self.store.transact(lambda unit: unit.get(self.op_path()))
        self.store.transact(lambda unit: unit.put(self.op_path(), {**saved, "version": 2}))
        failed = self.client.get(self.path, headers=self.headers)
        self.assertEqual(failed.status_code, 503, failed.text[:200])
        self.assertEqual(failed.headers["cache-control"], "no-store")
        self.assertNotIn("fingerprint", failed.text)

    def test_http_identity_partition_cannot_select_another_owner_operation(self):
        other = OperationFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=OTHER_UID)
        response = self.client.get(self.path, headers=self.headers)
        self.assertEqual(response.status_code, 404, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_missing_or_duplicate_identity_fails_before_storage_or_network(self):
        app.dependency_overrides.pop(require_owner)
        app.dependency_overrides[get_task_service] = lambda: (_ for _ in ()).throw(
            AssertionError("must not reach storage")
        )
        for headers in [
            self.headers,
            [
                *self.headers.items(),
                ("Authorization", "Bearer a.b.c"),
                ("Authorization", "Bearer d.e.f"),
            ],
        ]:
            with patch("socket.create_connection", side_effect=AssertionError("network")):
                response = self.client.get(self.path, headers=headers)
                self.assertEqual(response.status_code, 401, response.text[:200])
                self.assertEqual(response.headers["cache-control"], "no-store")


class FirestoreTaskOperationTests(OperationSetup, unittest.TestCase):
    def setUp(self):
        self.client = firestore_fixtures.firestore.Client(
            project="synthetic-hub",
            database="agent-hub",
            credentials=firestore_fixtures.AnonymousCredentials(),
        )
        self.addCleanup(self.client.close)
        self.rpc = firestore_fixtures.MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.prepare(FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client))

    def name(self, path):
        return self.client.document(path)._document_path

    def assert_no_writes(self):
        self.assertTrue(
            all(not call[1]["request"]["writes"] for call in self.rpc.calls if call[0] == "commit")
        )

    def test_original_projection_uses_one_transaction_and_no_mutations(self):
        self.later()
        self.clock = 5001
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.calls.clear()
        self.assertEqual(self.service.operation(UID, TASK, OP), self.original)
        self.assertEqual(self.rpc.documents, before)
        self.assert_no_writes()
        reads = [kwargs["request"] for kind, kwargs in self.rpc.calls if kind == "get"]
        required = [
            document_path("hub_vaults", owner_key(UID)),
            document_path("hub_task_indexes", owner_key(UID), self.fixture.vault),
            self.head_path(),
            self.op_path(),
            self.version_path(),
        ]
        self.assertEqual(
            {name for read in reads for name in read["documents"]},
            {self.name(path) for path in required},
        )
        self.assertTrue(all(read["transaction"] for read in reads))

    def test_missing_committed_components_fail_closed_without_repair(self):
        before = copy.deepcopy(self.rpc.documents)
        for path in [
            self.version_path(),
            self.head_path(),
            document_path("hub_task_indexes", owner_key(UID), self.fixture.vault),
        ]:
            with self.subTest(path=path):
                self.rpc.documents = copy.deepcopy(before)
                del self.rpc.documents[self.name(path)]
                missing = copy.deepcopy(self.rpc.documents)
                self.rpc.calls.clear()
                with self.assertRaises(StoreUnavailable):
                    self.service.operation(UID, TASK, OP)
                self.assertEqual(self.rpc.documents, missing)
                self.assert_no_writes()

    def test_corrupt_immutable_ciphertext_is_never_replaced_by_latest(self):
        self.later()
        row = self.rpc.documents[self.name(self.version_path())]
        row["carrierJson"] = "{}"
        self.rpc.calls.clear()
        with self.assertRaises(StoreUnavailable):
            self.service.operation(UID, TASK, OP)
        self.assert_no_writes()

    def test_conflict_retry_rechecks_operation_and_immutable_version_atomically(self):
        self.later()
        self.rpc.calls.clear()
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.rpc.documents[self.name(self.op_path())].update(
            version=2
        )
        with self.assertRaises(StoreUnavailable):
            self.service.operation(UID, TASK, OP)
        reads = [kwargs["request"]["documents"] for kind, kwargs in self.rpc.calls if kind == "get"]
        self.assertGreaterEqual(sum(self.name(self.op_path()) in read for read in reads), 2)
        self.assert_no_writes()
