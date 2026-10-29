"""Bulk Inbox storage reads use real SDK masks and handle unordered synthetic streams."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1.types import BatchGetDocumentsResponse
from test_firestore_store import MemoryRpc

from app.store import FirestoreHubStore, SQLiteHubStore, StoreUnavailable, document_path

FIELDS = ("ownerSubject", "resultId", "revision", "receipt")


class InboxBatchTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.sqlite = SQLiteHubStore(Path(directory.name) / "bulk.sqlite3")
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.firestore = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.paths = [document_path("hub_results", "synthetic_owner", str(i)) for i in range(129)]
        self.absent = document_path("hub_results", "synthetic_owner", "missing")

    def seed(self, store):
        def write(unit):
            for number, path in enumerate(self.paths):
                unit.put(path, {"ordinal": number})

        store.transact(write)

    def test_sqlite_bulk_reads_cross_chunk_boundaries_and_preserve_missing_rows(self):
        self.seed(self.sqlite)
        values = self.sqlite.transact(lambda unit: unit.get_many([*self.paths, self.absent]))
        self.assertEqual(len(values), 130)
        self.assertIsNone(values[self.absent])
        self.assertEqual([values[path]["ordinal"] for path in self.paths], list(range(129)))

    def test_sdk_bulk_reads_reorder_streams_and_use_bounded_transaction_batches(self):
        self.seed(self.firestore)
        self.rpc.calls.clear()
        original = self.rpc.batch_get_documents

        def reversed_stream(**kwargs):
            return iter(reversed(list(original(**kwargs))))

        with patch.object(self.rpc, "batch_get_documents", side_effect=reversed_stream):
            values = self.firestore.transact(lambda unit: unit.get_many([*self.paths, self.absent]))
        self.assertEqual([values[path]["ordinal"] for path in self.paths], list(range(129)))
        self.assertIsNone(values[self.absent])
        reads = [kwargs["request"] for name, kwargs in self.rpc.calls if name == "get"]
        self.assertEqual([len(request["documents"]) for request in reads], [128, 2])
        self.assertTrue(all(request["transaction"] for request in reads))

    def test_history_projection_sends_an_sdk_mask_and_returns_no_ciphertext_fields(self):
        path = document_path("hub_result_revisions", "synthetic_owner", "result", "1")
        value = {
            "ownerSubject": "synthetic_owner",
            "resultId": "synthetic_result",
            "revision": 1,
            "receipt": {"synthetic": "public receipt metadata"},
            "carrierJson": "synthetic-opaque-carrier" * 9000,
            "proof": {"synthetic": "not requested"},
        }
        for store in (self.sqlite, self.firestore):
            store.transact(lambda unit: unit.put(path, value))
            result = store.transact(lambda unit: unit.get_many([path], field_paths=FIELDS))
            self.assertEqual(result[path], {field: value[field] for field in FIELDS})
            self.assertNotIn("carrierJson", str(result))
            self.assertNotIn("proof", str(result))
        requests = [kwargs["request"] for name, kwargs in self.rpc.calls if name == "get"]
        self.assertEqual(set(requests[-1]["mask"].field_paths), set(FIELDS))

    def test_incomplete_duplicate_or_unrequested_sdk_streams_never_return_a_result(self):
        original = self.rpc.batch_get_documents
        for kind in ("incomplete", "duplicate", "unrequested"):
            with self.subTest(kind=kind):

                def malformed(*, stream_kind=kind, **kwargs):
                    rows = list(original(**kwargs))
                    if stream_kind == "incomplete":
                        return iter(rows[:-1])
                    if stream_kind == "duplicate":
                        return iter([*rows, rows[0]])
                    extra = self.client.document(self.paths[2])._document_path
                    return iter([*rows, BatchGetDocumentsResponse(missing=extra)])

                with (
                    patch.object(self.rpc, "batch_get_documents", side_effect=malformed),
                    self.assertRaises((StoreUnavailable, ValueError)),
                ):
                    self.firestore.transact(lambda unit: unit.get_many(self.paths[:2]))
