"""Real Firestore SDK task transactions with synthetic conflict RPCs."""

import unittest
from types import SimpleNamespace

from fixtures import BOOT, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc
from test_task_routes import CREATE, TASK, HttpTaskFixture, NoSources, result_value

from app.fences import FenceService
from app.store import FirestoreHubStore
from app.tasks import TaskService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key


class WriteConflictRpc(MemoryRpc):
    """Inject a collision only after a task write callback, not its read preflight."""

    def commit(self, **kwargs):
        if kwargs["request"]["writes"]:
            return super().commit(**kwargs)
        aborted, callback = self.aborts, self.before_abort
        self.aborts, self.before_abort = 0, None
        try:
            return super().commit(**kwargs)
        finally:
            self.aborts, self.before_abort = aborted, callback


class FirestoreTaskTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = WriteConflictRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.vaults = VaultService(self.store, clock=lambda: 1000)
        self.fixture = HttpTaskFixture()
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        self.service = TaskService(self.store, NoSources(), clock=lambda: 1000)
        self.rpc.calls.clear()

    def create(self, body=None, operation=CREATE):
        return result_value(
            self.service.create(
                UID,
                body or self.fixture.body(operation=operation),
                operation,
                self.fixture.kid("device_sig"),
            )
        )

    def inject(self, action):
        def win():
            self.rpc.before_abort = None
            action()

        self.rpc.aborts, self.rpc.before_abort = 1, win

    def test_create_commits_head_history_index_and_operation_atomically(self):
        created = self.create()
        batches = [
            kwargs["request"]["writes"]
            for kind, kwargs in self.rpc.calls
            if kind == "commit" and kwargs["request"]["writes"]
        ]
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(batches[0]), 4)
        collections = {
            write.update.name.split("/documents/")[1].split("/")[0] for write in batches[0]
        }
        self.assertTrue(all(name.startswith("hub_task") for name in collections))
        self.assertEqual(self.service.get(UID, TASK), created)
        self.assertEqual(self.service.get(UID, TASK, version=1), created)
        self.assertEqual(self.service.list(UID)["items"], [created["metadata"]])

    def test_competing_updates_retry_against_committed_cas_and_keep_one_version(self):
        first = self.create()
        winner_op = "synthetic_task_sdk_update_winner"
        loser_op = "synthetic_task_sdk_update_loser"
        winner = self.fixture.body(version=2, operation=winner_op)
        loser = self.fixture.body(version=2, operation=loser_op)
        accepted = []
        self.inject(
            lambda: accepted.append(
                result_value(
                    self.service.update(
                        UID, TASK, winner, winner_op, self.fixture.kid("device_sig")
                    )
                )
            )
        )
        with self.assertRaises(ContractError) as failed:
            self.service.update(UID, TASK, loser, loser_op, self.fixture.kid("device_sig"))
        self.assertEqual(failed.exception.code, "version_conflict")
        self.assertEqual(self.service.get(UID, TASK), accepted[0])
        self.assertEqual(self.service.get(UID, TASK, version=1), first)
        self.assertEqual(self.service.list(UID)["items"], [accepted[0]["metadata"]])

    def test_same_operation_commit_collision_recovers_exact_saved_snapshot(self):
        body = self.fixture.body()
        winner = []
        self.inject(lambda: winner.append(self.create(body)))
        self.assertEqual(self.create(body), winner[0])
        self.assertEqual(self.service.list(UID)["items"], [winner[0]["metadata"]])
        batches = [
            kwargs["request"]["writes"]
            for kind, kwargs in self.rpc.calls
            if kind == "commit" and kwargs["request"]["writes"]
        ]
        self.assertEqual([len(batch) for batch in batches], [4, 4])

    def test_registry_revocation_between_read_and_commit_refuses_stale_writer(self):
        self.fixture.add_key("new_sig", "device_sig", "new_device")
        self.fixture.add_key("new_enc", "device_enc", "new_device")
        bundle = self.fixture.make_bundle(
            previous=self.fixture.registry, revoked=("device_sig", "device_enc")
        )
        self.inject(
            lambda: self.vaults.update_registry(
                UID,
                self.fixture.vault,
                {
                    "contractVersion": self.fixture.bundle["contractVersion"],
                    "expectedVersion": 1,
                    "registryBundle": bundle,
                },
                "synthetic_task_sdk_rotate_0001",
            )
        )
        with self.assertRaises(ContractError):
            self.create()
        self.assertEqual(self.service.list(UID)["items"], [])
        self.assertFalse(any("/hub_task" in path for path in self.rpc.documents))

    def test_source_fence_wins_after_precheck_and_retried_task_never_commits(self):
        source = "holdings_task_fence"
        operation = "synthetic_source_task_fence_0001"
        ref = self.vaults.create_source(
            UID,
            self.fixture.vault,
            source,
            self.fixture.control(source, operation),
            operation,
            self.fixture.kid("device_sig"),
        )["source"]["resourceRef"]
        source_reads = []

        def source_catalogue(uid):
            source_reads.append(uid)
            return {"groups": [{"items": [{"ref": ref, "sourceEpoch": 1, "state": "active"}]}]}

        self.service.catalogue = SimpleNamespace(read=source_catalogue)
        fence = FenceService(self.store, clock=lambda: 1000)
        mutation = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": owner_key(UID),
            "mutationId": "synthetic_task_sdk_fence_0001",
            "ref": ref,
            "expectedSourceEpoch": 1,
            "newSourceEpoch": 2,
            "reason": "account_scope_changed",
        }
        self.inject(lambda: fence.invalidate(mutation, source_service="portfolio"))
        body = self.fixture.body(resources=[{"ref": ref, "sourceEpoch": 1}])
        with self.assertRaises(ContractError) as failed:
            self.create(body)
        self.assertEqual(failed.exception.code, "version_conflict")
        self.assertEqual(source_reads, [UID])
        self.assertEqual(self.service.list(UID)["items"], [])
        self.assertFalse(any("/hub_task" in path for path in self.rpc.documents))
