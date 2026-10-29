"""Actual Firestore SDK transaction retry/serialization with synthetic RPC races."""

import unittest

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_fences import OWNER, REF, mutation
from test_firestore_store import MemoryRpc

from app.fences import FenceService, fence_path, require_current_bindings
from app.store import FirestoreHubStore, document_path
from folioview_shared.encrypted.errors import ContractError


class FirestoreFenceTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.service = FenceService(self.store, clock=lambda: 1000)
        self.marker = document_path("hub_operations", OWNER, "synthetic_writer_probe")

    def invalidate(self, value=None):
        return self.service.invalidate(
            mutation() if value is None else value, source_service="portfolio"
        )

    def guarded_write(self, epoch=1):
        def write(unit):
            require_current_bindings(unit, OWNER, [{"ref": REF, "sourceEpoch": epoch}])
            unit.put(self.marker, {"sourceEpoch": epoch})

        return self.store.transact(write)

    def inject_winner(self, action):
        def win():
            self.rpc.before_abort = None
            action()

        self.rpc.aborts, self.rpc.before_abort = 1, win

    def test_fence_and_receipt_are_one_atomic_sdk_batch_with_exact_names(self):
        ack = self.invalidate()
        self.assertEqual(self.invalidate(), ack)
        batches = [
            kwargs["request"]["writes"]
            for name, kwargs in self.rpc.calls
            if name == "commit" and kwargs["request"]["writes"]
        ]
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(batches[0]), 2)
        self.assertEqual(
            {write.update.name.split("/documents/")[1].split("/")[0] for write in batches[0]},
            {"hub_source_fences", "hub_fence_mutations"},
        )
        self.assertTrue(
            all(
                write.update.name.startswith(
                    "projects/synthetic-hub/databases/agent-hub/documents/"
                )
                for write in batches[0]
            )
        )

    def test_absent_fence_read_conflict_retries_and_rejects_stale_writer(self):
        # A real SDK callback read the absent initial fence and queued a probe.
        # Another transaction commits invalidation before its commit. Firestore
        # reports Aborted; the retry must reread epoch 2 and drop the old write.
        self.inject_winner(self.invalidate)
        with self.assertRaises(ContractError) as result:
            self.guarded_write()
        self.assertEqual(result.exception.code, "version_conflict")
        self.assertIsNone(self.store.transact(lambda unit: unit.get(self.marker)))
        self.assertEqual(
            self.store.transact(lambda unit: unit.get(fence_path(OWNER, REF)))["sourceEpoch"], 2
        )
        gets = [kwargs["request"]["documents"] for name, kwargs in self.rpc.calls if name == "get"]
        self.assertGreaterEqual(
            sum(any(name.endswith(fence_path(OWNER, REF)) for name in batch) for batch in gets), 3
        )

    def test_writer_commits_before_fence_retry_and_remains_before_ack(self):
        self.inject_winner(self.guarded_write)
        ack = self.invalidate()
        self.assertEqual(ack["acknowledgedSourceEpoch"], 2)
        self.assertEqual(
            self.store.transact(lambda unit: unit.get(self.marker)), {"sourceEpoch": 1}
        )
        with self.assertRaises(ContractError) as result:
            self.guarded_write()
        self.assertEqual(result.exception.code, "version_conflict")

    def test_competing_fence_same_expected_epoch_cannot_overwrite_winner(self):
        competitor = mutation(mutationId="synthetic_competing_fence_0001")
        self.inject_winner(lambda: self.invalidate(competitor))
        with self.assertRaises(ContractError) as result:
            self.invalidate()
        self.assertEqual(result.exception.code, "version_conflict")
        self.assertEqual(len(self.rpc.documents), 2)
        self.assertEqual(
            self.store.transact(lambda unit: unit.get(fence_path(OWNER, REF)))["lastMutationId"],
            competitor["mutationId"],
        )

    def test_same_operation_collision_returns_committed_exact_ack(self):
        winner = []
        self.inject_winner(lambda: winner.append(self.invalidate()))
        self.assertEqual(self.invalidate(), winner[0])
        self.assertEqual(len(self.rpc.documents), 2)
        batches = [
            kwargs["request"]["writes"]
            for name, kwargs in self.rpc.calls
            if name == "commit" and kwargs["request"]["writes"]
        ]
        # The first batch aborted without a write. Only the competing exact
        # operation committed; the retried callback did not queue another ACK.
        self.assertEqual([len(batch) for batch in batches], [2, 2])

    def test_rpc_fault_before_commit_keeps_both_records_absent_and_retry_recovers(self):
        self.rpc.aborts = 3
        with self.assertRaises(ValueError):
            self.invalidate()
        self.assertEqual(self.rpc.documents, {})
        self.assertEqual(self.invalidate()["acknowledgedSourceEpoch"], 2)
