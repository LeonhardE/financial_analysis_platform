"""Real SDK conflicts order new and rolling legacy writers against cancellation."""

import copy
import unittest
from unittest.mock import patch

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from task_cancellation_fixtures import CANCEL, OP, TASK
from test_task_firestore import WriteConflictRpc
from test_task_upload_cancellations import CancellationSetup

from app.store import FirestoreHubStore, StoreUnavailable


class TaskCancellationFirestoreTests(CancellationSetup, unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = WriteConflictRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.prepare(FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client))
        self.rpc.calls.clear()

    def name(self, path):
        return self.client.document(path)._document_path

    def inject(self, action):
        def win():
            self.rpc.before_abort = None
            action()

        self.rpc.aborts, self.rpc.before_abort = 1, win

    def batches(self):
        return [
            kwargs["request"]["writes"]
            for kind, kwargs in self.rpc.calls
            if kind == "commit" and kwargs["request"]["writes"]
        ]

    def test_cancel_atomically_writes_original_op_fence_and_single_vault_ledger(self):
        result = self.cancel()
        batches = self.batches()
        self.assertEqual(len(batches), 1)
        self.assertEqual(
            {write.update.name for write in batches[0]},
            {self.name(self.op_path()), self.name(self.ledger_path())},
        )
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.calls.clear()
        self.assertEqual(self.receipt(), result)
        self.assertEqual(self.rpc.documents, before)
        self.assertFalse(self.batches())

    def test_cancel_wins_against_upload_final_commit_and_retry_does_not_save(self):
        accepted = []
        self.inject(lambda: accepted.append(self.cancel()))
        self.code("idempotency_conflict", self.save)
        self.assertEqual(accepted[0]["receipt"]["outcome"], "cancelled")
        self.assertFalse(
            any(
                "/hub_tasks/" in name or "/hub_task_versions/" in name
                for name in self.rpc.documents
            )
        )
        self.assertEqual(self.receipt(), accepted[0])

    def test_upload_wins_and_cancel_retry_returns_saved_without_rewriting_original_op(self):
        saved = []
        self.inject(lambda: saved.append(self.save()[0]))
        result = self.cancel()
        self.assertEqual(result["receipt"]["outcome"], "saved")
        self.assertEqual(self.tasks.operation(self.f.uid, TASK, OP), saved[0])
        row = self.rpc.documents[self.name(self.op_path())]
        self.assertNotIn("artifactType", row)
        self.assertEqual(self.batches()[-1][0].update.name, self.name(self.ledger_path()))

    def test_rolling_legacy_writer_reads_same_op_document_and_is_fenced_after_conflict(self):
        accepted = []
        self.inject(lambda: accepted.append(self.cancel()))
        # Disable only the newly introduced guard. The unchanged legacy branch
        # still reads the original op document and rejects its unknown shape.
        with (
            patch("app.tasks.operation_cancelled", return_value=False),
            self.assertRaises(StoreUnavailable),
        ):
            self.save()
        self.assertEqual(accepted[0]["receipt"]["outcome"], "cancelled")
        reads = [kwargs["request"]["documents"] for kind, kwargs in self.rpc.calls if kind == "get"]
        self.assertGreaterEqual(sum(self.name(self.op_path()) in read for read in reads), 2)
        self.assertFalse(
            any(
                "/hub_tasks/" in name or "/hub_task_versions/" in name
                for name in self.rpc.documents
            )
        )

    def test_two_cancellation_ids_retry_without_overwriting_first_fence_or_losing_record(self):
        other_id = "synthetic_racing_cancellation_id"
        other_body = self.f.cancellation(self.target, other_id)
        accepted = []
        self.inject(lambda: accepted.append(self.cancel(other_body, other_id)))
        result = self.cancel()
        self.assertEqual(result["receipt"]["outcome"], "cancelled")
        self.assertEqual(self.receipt(other_id), accepted[0])
        self.assertEqual(len(self.rpc.documents[self.name(self.ledger_path())]["records"]), 2)
        self.assertEqual(self.rpc.documents[self.name(self.op_path())]["cancellationId"], other_id)

    def test_capacity_conflict_retry_never_commits_a_thirty_third_record(self):
        for i in range(31):
            cancellation = f"synthetic_capacity_cancel_{i:04}"
            self.cancel(self.f.cancellation(self.target, cancellation), cancellation)
        winner_id = "synthetic_last_capacity_winner"
        self.inject(lambda: self.cancel(self.f.cancellation(self.target, winner_id), winner_id))
        self.code("version_conflict", self.cancel)
        records = self.rpc.documents[self.name(self.ledger_path())]["records"]
        self.assertEqual(len(records), 32)
        self.assertNotIn(CANCEL, records)
        self.assertEqual(self.receipt(winner_id)["receipt"]["outcome"], "cancelled")

    def test_saved_missing_immutable_version_or_corrupt_fingerprint_is_not_cancelled(self):
        self.save()
        original = copy.deepcopy(self.rpc.documents)
        version_names = [name for name in original if "/hub_task_versions/" in name]
        del self.rpc.documents[version_names[0]]
        with self.assertRaises(StoreUnavailable):
            self.cancel()
        self.assertNotIn(self.name(self.ledger_path()), self.rpc.documents)
        self.rpc.documents = original
        self.rpc.documents[self.name(self.op_path())]["fingerprint"] = "bad"
        with self.assertRaises(StoreUnavailable):
            self.cancel()
