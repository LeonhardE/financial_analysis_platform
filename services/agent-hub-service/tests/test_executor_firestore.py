"""Actual Firestore SDK transactions with controlled commit collisions, no cloud calls."""

import test_executor_ciphertext as fixtures
from fixtures import UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_task_firestore import WriteConflictRpc

from app.fences import FenceService
from app.persistent_results import result_path
from app.store import FirestoreHubStore
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_STORED_DOCUMENT_BYTES


class ExecutorFirestoreTests(fixtures.ExecutorCiphertextTests):
    def make_store(self):
        client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(client.close)
        self.rpc = WriteConflictRpc(client)
        client._firestore_api_internal = self.rpc
        return FirestoreHubStore("synthetic-hub", "agent-hub", client=client)

    def inject(self, action):
        def win():
            self.rpc.before_abort = None
            action()

        self.rpc.aborts, self.rpc.before_abort = 1, win

    def test_parallel_report_cas_and_original_publication_bytes(self):
        # A competing transaction commits after our reads, before our write.
        winner = []
        self.inject(lambda: winner.append(self.submit()))
        result = self.submit()
        self.assertEqual(winner, [result])
        self.assertEqual(len(self.history.owner_list(UID, self.f.vault)["items"]), 1)

    def test_report_batch_is_atomic_bounded_and_contains_only_existing_result_run_collections(self):
        self.rpc.calls.clear()
        receipt = self.submit()
        batches = [
            kw["request"]["writes"]
            for method, kw in self.rpc.calls
            if method == "commit" and kw["request"]["writes"]
        ]
        self.assertEqual(len(batches), 1)
        self.assertEqual(
            {w.update.name.split("/documents/")[1].split("/")[0] for w in batches[0]},
            {
                "hub_persistent_results",
                "hub_persistent_result_content",
                "hub_persistent_result_operations",
                "hub_persistent_result_indexes",
                "hub_persistent_result_pages",
                "hub_persistent_runs",
                "hub_persistent_plans",
            },
        )
        self.assertTrue(
            all(
                len(w.update._pb.SerializeToString()) <= MAX_STORED_DOCUMENT_BYTES
                for w in batches[0]
            )
        )
        self.assertLess(sum(len(w._pb.SerializeToString()) for w in batches[0]), 10 * 1024 * 1024)
        self.assertEqual(
            self.history.owner_get(UID, self.f.vault, receipt["resultId"])["envelope"], self.carrier
        )

    def test_identity_revocation_between_read_and_commit_wins(self):
        self.inject(self.revoke)
        self.rejects("key_authorization_required", self.submit)
        self.assertIsNone(
            self.store.transact(
                lambda u: u.get(result_path(self.f.owner, self.f.vault, self.context["objectId"]))
            )
        )

    def test_source_fence_between_read_and_commit_wins(self):
        self.inject(
            lambda: FenceService(self.store).invalidate(
                {
                    "contractVersion": CONTRACT_VERSION,
                    "ownerSubject": self.f.owner,
                    "mutationId": "synthetic_executor_sdk_source_deleted_01",
                    "ref": self.f.resource,
                    "expectedSourceEpoch": 1,
                    "newSourceEpoch": 2,
                    "reason": "deleted",
                },
                source_service="portfolio",
            )
        )
        self.rejects("version_conflict", self.submit)
        self.assertEqual(self.history.owner_list(UID, self.f.vault)["items"], [])

    def test_competing_task_publication_cas_wins_against_stale_report(self):
        self.inject(lambda: self.p.publish(self.p.context("task")))
        self.rejects("version_conflict", self.submit)
        self.assertEqual(self.history.owner_list(UID, self.f.vault)["items"], [])


class ExecutorEnrollmentFirestoreTests(fixtures.ExecutorFixture):
    make_store = ExecutorFirestoreTests.make_store
    inject = ExecutorFirestoreTests.inject

    def test_registration_parent_identity_operation_and_index_commit_together(self):
        self.rpc.calls.clear()
        winner = []
        self.inject(lambda: winner.append(self.enroll()))
        receipt = self.enroll()
        self.assertEqual(winner, [receipt])
        # One winning write batch and one aborted candidate, both complete.
        batches = [
            kw["request"]["writes"]
            for method, kw in self.rpc.calls
            if method == "commit" and kw["request"]["writes"]
        ]
        self.assertEqual(len(batches), 2)
        for batch in batches:
            self.assertEqual(
                {w.update.name.split("/documents/")[1].split("/")[0] for w in batch},
                {
                    "hub_executor_connections",
                    "hub_executor_owners",
                    "hub_agent_identities",
                    "hub_agent_identity_operations",
                },
            )
