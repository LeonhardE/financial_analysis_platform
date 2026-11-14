"""Real SDK read budgets and current authority for retained owner snapshots."""

import copy
import unittest
from unittest.mock import patch

from fixtures import OPERATION, SOURCE, UID, HoldingsFixture
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.holdings import PortfolioError, PortfolioService
from app.store import FirestorePortfolioStore, StoreUnavailable, document_path
from folioview_shared.identity import owner_key


class SnapshotReadPathTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-portfolio", database="portfolio", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestorePortfolioStore("synthetic-portfolio", "portfolio", client=self.client)
        self.service = PortfolioService(self.store, clock=lambda: 1000)
        self.fixture = HoldingsFixture()
        self.fixture.install(self.service)
        self.receipt = self.fixture.write(self.service)
        self.expected = self.service.snapshot(UID, SOURCE)
        self.rpc.calls.clear()

    def reads(self):
        return [kw["request"]["documents"] for name, kw in self.rpc.calls if name == "get"]

    def row(self, collection):
        return next(
            value for name, value in self.rpc.documents.items() if f"/{collection}/" in name
        )

    def test_latest_and_explicit_snapshot_need_two_batches_and_keep_exact_response(self):
        for selected, initial in ((None, 3), ("snapshot_1", 2)):
            with self.subTest(snapshot=selected):
                self.rpc.calls.clear()
                self.assertEqual(self.service.snapshot(UID, SOURCE, selected), self.expected)
                self.assertEqual([len(batch) for batch in self.reads()], [initial, 1])
                first = self.reads()[0]
                self.assertFalse(any("/portfolio_snapshots/" in name for name in first))
                self.assertTrue(all("/portfolio_snapshots/" in name for name in self.reads()[1]))

    def test_original_receipt_uses_two_batches_without_duplicate_operation_reads(self):
        self.assertEqual(self.service.receipt(UID, SOURCE, OPERATION), self.receipt)
        self.assertEqual([len(batch) for batch in self.reads()], [2, 2])
        documents = [name for batch in self.reads() for name in batch]
        self.assertEqual(len(documents), len(set(documents)))

    def test_empty_current_head_does_not_read_any_ciphertext(self):
        fixture = HoldingsFixture(source="empty_source")
        fixture.install(self.service)
        self.rpc.calls.clear()
        with self.assertRaises(PortfolioError) as error:
            self.service.snapshot(UID, fixture.source)
        self.assertEqual(error.exception.code, "not_found")
        self.assertEqual([len(batch) for batch in self.reads()], [3])
        self.assertFalse(any("/portfolio_snapshots/" in name for name in self.reads()[0]))

    def test_next_request_rereads_authority_and_refuses_before_fetching_ciphertext(self):
        self.assertEqual(self.service.snapshot(UID, SOURCE), self.expected)
        self.row("portfolio_authorities")["active"] = False
        self.rpc.calls.clear()
        with self.assertRaises(PortfolioError) as error:
            self.service.snapshot(UID, SOURCE)
        self.assertEqual(error.exception.code, "insufficient_scope")
        self.assertEqual([len(batch) for batch in self.reads()], [3])

    def test_conflict_retry_does_not_reuse_prior_attempt_authority_or_content(self):
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.row("portfolio_authorities").update(active=False)
        with self.assertRaises(PortfolioError) as error:
            self.service.snapshot(UID, SOURCE)
        self.assertEqual(error.exception.code, "insufficient_scope")
        self.assertEqual([len(batch) for batch in self.reads()], [3, 1, 3])

    def test_incomplete_or_duplicate_batch_is_not_a_partial_success_or_negative_cache(self):
        original = self.rpc.batch_get_documents
        for mode in ("incomplete", "duplicate"):

            def broken(mode=mode, **kwargs):
                rows = list(original(**kwargs))
                return iter(rows[:-1] if mode == "incomplete" else [*rows, rows[0]])

            with (
                self.subTest(mode=mode),
                patch.object(self.rpc, "batch_get_documents", broken),
                self.assertRaises(StoreUnavailable),
            ):
                self.service.snapshot(UID, SOURCE)
            self.assertEqual(self.service.snapshot(UID, SOURCE), self.expected)

    def test_attempt_reuse_detaches_values_retains_absence_and_pending_write_snapshot(self):
        path = document_path("portfolio_operations", "read_copy")
        name = self.client.document(path)._document_path
        self.rpc.documents[name] = {"nested": {"value": 1}}
        absent = document_path("portfolio_operations", "absent")
        self.rpc.calls.clear()

        def read(unit):
            first = unit.get(path)
            first["nested"]["value"] = 2
            batch = unit.get_many([path, absent])
            self.assertEqual(batch[path]["nested"]["value"], 1)
            batch[path]["nested"]["value"] = 3
            self.assertEqual(unit.get(path)["nested"]["value"], 1)
            self.assertIsNone(unit.get(absent))
            unit.put(absent, {"created": True})
            self.assertIsNone(unit.get(absent))

        self.store.transact(read)
        self.assertEqual([len(batch) for batch in self.reads()], [1, 1])
        self.assertEqual(self.store.transact(lambda unit: unit.get(absent)), {"created": True})

    def test_cache_limits_leave_overflow_reads_live_and_do_not_allow_invalid_streams(self):
        paths = [document_path("portfolio_operations", f"limit-{i}") for i in range(129)]
        for i, path in enumerate(paths):
            self.rpc.documents[self.client.document(path)._document_path] = {"value": i}
        self.rpc.calls.clear()

        def read(unit):
            for offset in range(0, len(paths), 30):
                unit.get_many(paths[offset : offset + 30])
            self.assertEqual(len(unit._reads), 128)
            self.assertEqual(unit.get(paths[-1]), {"value": 128})

        self.store.transact(read)
        self.assertEqual([len(batch) for batch in self.reads()], [30, 30, 30, 30, 9, 1])
        large = paths[:13]
        for path in large:
            self.rpc.documents[self.client.document(path)._document_path] = {"opaque": "a" * 700000}
        self.rpc.calls.clear()

        def bounded(unit):
            unit.get_many(large)
            self.assertLessEqual(unit._read_bytes, 8 * 1024 * 1024)
            self.assertLess(len(unit._reads), len(large))
            unit.get(large[-1])

        self.store.transact(bounded)
        self.assertEqual([len(batch) for batch in self.reads()], [13, 1])

    def test_changed_lifecycle_is_checked_again_and_cannot_be_masked_by_prior_snapshot(self):
        from app.lifecycle import state_path
        from folioview_shared.encrypted.errors import ContractError

        self.assertEqual(self.service.snapshot(UID, SOURCE), self.expected)
        authority = self.row("portfolio_authorities")
        path = state_path(owner_key(UID), SOURCE)
        self.rpc.documents[self.client.document(path)._document_path] = {
            **{
                k: copy.deepcopy(authority[k])
                for k in ("ownerSubject", "sourceId", "resourceRef", "sourceEpoch")
            },
            "state": "deleted",
            "mutationCount": 1,
            "pendingMutationId": None,
            "lastMutationId": "synthetic_delete_operation_001",
        }
        with self.assertRaises(ContractError) as error:
            self.service.snapshot(UID, SOURCE)
        self.assertEqual(error.exception.code, "not_found")
