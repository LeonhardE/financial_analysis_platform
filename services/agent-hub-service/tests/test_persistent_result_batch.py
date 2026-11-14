"""Real SDK bounded owner-report reads, unchanged validators and SQLite parity."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_persistent_results as domain
from fixtures import OTHER_UID, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1.types import Value
from test_firestore_store import MemoryRpc

from app.persistent_results import (
    PersistentOwnerResultService,
    _OwnerResultSnapshot,
    result_id,
    result_path,
)
from app.store import FirestoreHubStore, SQLiteHubStore, StoreUnavailable, document_path
from app.task_lifecycle import lifecycle_path
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.encrypted.persistent_content import digest


class PersistentResultBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Publish once through the real signed producer; all following storage is synthetic.
        fixture = domain.PersistentResultTests()
        fixture.setUp()
        try:
            receipt = fixture.submit()
            cls.owner, cls.vault, cls.now = fixture.f.owner, fixture.f.vault, fixture.fx.now
            connection = fixture.fx.store.connect()
            try:
                cls.documents = {
                    path: strict_json_loads(body)
                    for path, body in connection.execute("SELECT path, body FROM hub_documents")
                }
            finally:
                connection.close()
            cls.template = cls.documents[result_path(cls.owner, cls.vault, receipt["resultId"])]
        finally:
            fixture.doCleanups()

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.sqlite = SQLiteHubStore(Path(folder.name) / "hub.sqlite")
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.firestore = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.service = PersistentOwnerResultService(self.firestore, clock=lambda: self.now)
        self.index = document_path("hub_persistent_result_indexes", self.owner, self.vault)
        self.page_id = "pidx_" + digest(["synthetic-report-batch"])
        self.page_path = document_path(
            "hub_persistent_result_pages", self.owner, self.vault, self.page_id
        )
        self.documents = copy.deepcopy(type(self).documents)

    def name(self, path):
        return self.client.document(path)._document_path

    def seed(self, count):
        self.ids = []
        self.rows = []
        for i in range(count):
            row = copy.deepcopy(self.template)
            run = f"synthetic_batch_run_{i:04d}"
            task = f"synthetic_batch_task_{i:04d}"
            result = result_id(self.owner, self.vault, run)
            row["context"].update(runId=run, taskId=task, objectId=result)
            row["metadata"].update(resultId=result, runId=run, taskId=task, receivedAt=1000 + i)
            row["receipt"].update(resultId=result, runId=run, taskId=task, receivedAt=1000 + i)
            self.documents[result_path(self.owner, self.vault, result)] = row
            self.ids.append(result)
            self.rows.append(row)
        self.documents[self.index] = {"pageId": self.page_id}
        self.documents[self.page_path] = {
            "pageId": self.page_id,
            "previous": None,
            "resultIds": list(self.ids),
        }
        self.documents[lifecycle_path(self.owner, self.vault)] = {"version": 1, "tasks": {}}
        self.sqlite.transact(lambda unit: [unit.put(p, row) for p, row in self.documents.items()])
        self.rpc.documents = {self.name(p): copy.deepcopy(row) for p, row in self.documents.items()}
        self.rpc.calls.clear()

    def reads(self):
        return [kw["request"]["documents"] for kind, kw in self.rpc.calls if kind == "get"]

    def assert_read_only(self):
        self.assertTrue(
            all(not kw["request"]["writes"] for kind, kw in self.rpc.calls if kind == "commit")
        )

    def test_one_two_and_twenty_rows_are_one_batch_and_exact_original_dto(self):
        class PointReads:
            """The previous access pattern, with the same stored_result validator."""

            def __init__(self, unit, paths):
                self.unit = unit

            def get(self, path):
                return self.unit.get(path)

        for count in (1, 2, 20):
            with self.subTest(count=count):
                self.seed(count)
                with patch("app.persistent_results._OwnerResultSnapshot", PointReads):
                    original = self.service.owner_list(UID, self.vault)
                self.assertEqual(len(self.reads()), count + 4)
                self.assert_read_only()
                self.rpc.calls.clear()
                expected = copy.deepcopy(self.rpc.documents)
                # Firestore response order is unrelated to the requested page order.
                original_batch = self.rpc.batch_get_documents

                def reversed_rows(original_batch=original_batch, **kwargs):
                    return iter(reversed(list(original_batch(**kwargs))))

                self.rpc.batch_get_documents = reversed_rows
                try:
                    actual = self.service.owner_list(UID, self.vault)
                finally:
                    self.rpc.batch_get_documents = original_batch
                self.assertEqual(actual, original)
                self.assertEqual([len(group) for group in self.reads()], [1, 1, 1, count + 1])
                self.assertEqual(
                    self.reads()[-1],
                    [self.name(result_path(self.owner, self.vault, r)) for r in reversed(self.ids)]
                    + [self.name(lifecycle_path(self.owner, self.vault))],
                )
                self.assertEqual(self.rpc.documents, expected)
                self.assert_read_only()

    def test_sqlite_uses_one_batch_not_per_result_queries_and_matches_firestore(self):
        for count in (1, 2, 20):
            with self.subTest(count=count):
                self.seed(count)
                expected = self.service.owner_list(UID, self.vault)
                statements = []
                original_connect = self.sqlite.connect

                def traced(original_connect=original_connect, statements=statements):
                    connection = original_connect()
                    connection.set_trace_callback(statements.append)
                    return connection

                with patch.object(self.sqlite, "connect", side_effect=traced):
                    actual = PersistentOwnerResultService(
                        self.sqlite, clock=lambda: self.now
                    ).owner_list(UID, self.vault)
                self.assertEqual(actual, expected)
                reads = [sql for sql in statements if sql.startswith("SELECT")]
                self.assertEqual(len(reads), 4)
                self.assertEqual(sum("WHERE path IN (" in sql for sql in reads), 1)
                self.assertFalse(
                    any(sql.startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
                )

    def test_wrong_owner_or_vault_does_not_read_the_index(self):
        self.seed(2)
        for uid, vault in ((OTHER_UID, self.vault), (UID, "synthetic_other_vault")):
            with self.subTest(uid=uid, vault=vault):
                self.rpc.calls.clear()
                with self.assertRaises(ContractError) as caught:
                    self.service.owner_list(uid, vault)
                self.assertEqual(caught.exception.code, "not_found")
                self.assertEqual(len(self.reads()), 1)
                self.assertFalse(any("/hub_persistent_result" in p for p in self.reads()[0]))
                self.assert_read_only()

    def test_missing_wrong_id_context_receipt_or_lifecycle_never_returns_partial_rows(self):
        for mode in ("missing", "wrong_id", "foreign_owner", "receipt", "lifecycle"):
            with self.subTest(mode=mode):
                self.seed(2)
                path = result_path(self.owner, self.vault, self.ids[0])
                row = self.rpc.documents[self.name(path)]
                if mode == "missing":
                    del self.rpc.documents[self.name(path)]
                elif mode == "wrong_id":
                    row["metadata"]["resultId"] = self.ids[1]
                elif mode == "foreign_owner":
                    row["context"]["ownerSubject"] = "foreign_owner"
                elif mode == "receipt":
                    row["receipt"]["fingerprint"] = "f" * 64
                else:
                    self.rpc.documents[self.name(lifecycle_path(self.owner, self.vault))][
                        "tasks"
                    ] = {"synthetic_task": "unknown"}
                with self.assertRaises((StoreUnavailable, ContractError)):
                    self.service.owner_list(UID, self.vault)
                self.assert_read_only()

    def test_duplicate_index_and_incomplete_duplicate_malformed_batch_fail_closed(self):
        self.seed(2)
        self.rpc.documents[self.name(self.page_path)]["resultIds"][1] = self.ids[0]
        with self.assertRaises(StoreUnavailable):
            self.service.owner_list(UID, self.vault)
        self.assertEqual(len(self.reads()), 3)
        original = self.rpc.batch_get_documents
        for mode in ("partial", "duplicate", "malformed"):
            with self.subTest(mode=mode):
                self.seed(2)

                def broken(mode=mode, **kwargs):
                    rows = list(original(**kwargs))
                    if len(rows) == 1:
                        return iter(rows)
                    if mode == "partial":
                        return iter(rows[:-1])
                    if mode == "duplicate":
                        return iter([*rows[:-1], rows[0]])
                    rows[-1].found.fields["invalid"] = Value(bytes_value=b"not-json")
                    return iter(rows)

                self.rpc.batch_get_documents = broken
                try:
                    with self.assertRaises(StoreUnavailable):
                        self.service.owner_list(UID, self.vault)
                finally:
                    self.rpc.batch_get_documents = original
                self.assert_read_only()
                # A later request must read a complete fresh batch, not partial old rows.
                self.assertEqual(len(self.service.owner_list(UID, self.vault)["items"]), 2)

    def test_conflict_and_next_request_reread_metadata_and_lifecycle(self):
        self.seed(2)
        path = self.name(result_path(self.owner, self.vault, self.ids[1]))
        lifecycle = self.name(lifecycle_path(self.owner, self.vault))

        def change():
            self.rpc.documents[path]["metadata"].update(read=True, stateVersion=1)
            self.rpc.documents[lifecycle]["tasks"][self.rows[0]["metadata"]["taskId"]] = "trashed"

        self.rpc.aborts = 1
        self.rpc.before_abort = change
        actual = self.service.owner_list(UID, self.vault)
        self.assertEqual(len(actual["items"]), 1)
        self.assertTrue(actual["items"][0]["read"])
        self.assertEqual(actual["items"][0]["stateVersion"], 1)
        self.assertEqual([len(group) for group in self.reads()], [1, 1, 1, 3] * 2)
        self.assert_read_only()
        self.rpc.documents[path]["metadata"].update(read=False, stateVersion=2)
        self.rpc.documents[lifecycle]["tasks"] = {}
        self.rpc.calls.clear()
        again = self.service.owner_list(UID, self.vault)
        self.assertEqual(len(again["items"]), 2)
        self.assertFalse(again["items"][0]["read"])
        self.assertEqual(again["items"][0]["stateVersion"], 2)
        self.assertEqual([len(group) for group in self.reads()], [1, 1, 1, 3])

    def test_pagination_and_boundary_keep_original_cursor(self):
        self.seed(20)
        page = self.service.owner_list(UID, self.vault, limit=2)
        self.assertEqual([row["resultId"] for row in page["items"]], list(reversed(self.ids[-2:])))
        self.assertEqual(page["nextCursor"], self.page_id + ":18")
        second = self.service.owner_list(UID, self.vault, limit=2, cursor=page["nextCursor"])
        self.assertEqual(
            [row["resultId"] for row in second["items"]], list(reversed(self.ids[-4:-2]))
        )
        previous = "pidx_" + digest(["previous-page"])
        self.rpc.documents[self.name(self.page_path)]["previous"] = previous
        self.rpc.documents[
            self.name(
                document_path("hub_persistent_result_pages", self.owner, self.vault, previous)
            )
        ] = {"pageId": previous, "previous": None, "resultIds": [self.ids[0]]}
        self.rpc.calls.clear()
        page = self.service.owner_list(UID, self.vault)
        self.assertEqual(page["nextCursor"], previous + ":1")
        self.assertEqual([len(group) for group in self.reads()], [1, 1, 1, 21, 1])
        self.assert_read_only()

    def test_snapshot_detaches_rows_and_does_not_fall_back_to_an_unselected_read(self):
        self.seed(1)
        path = result_path(self.owner, self.vault, self.ids[0])

        def read(unit):
            view = _OwnerResultSnapshot(unit, [path])
            view.get(path)["metadata"]["read"] = True
            self.assertFalse(view.get(path)["metadata"]["read"])
            with self.assertRaises(StoreUnavailable):
                view.get(self.index)
            self.assertFalse(hasattr(view, "put"))

        self.sqlite.transact(read)
