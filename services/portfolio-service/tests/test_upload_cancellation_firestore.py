"""Real Firestore SDK retries at the in-memory RPC boundary, without cloud access."""

import unittest

from cancellation_fixtures import CANCEL, CancellationFixture
from fixtures import OPERATION, SOURCE, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.holdings import PortfolioService, _operation_path
from app.store import FirestorePortfolioStore, document_path
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError


class UploadCancellationFirestoreTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-portfolio", database="portfolio", credentials=AnonymousCredentials()
        )
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestorePortfolioStore("synthetic-portfolio", "portfolio", client=self.client)
        self.service = PortfolioService(self.store, clock=lambda: 1000)
        self.f = CancellationFixture()
        self.f.install(self.service)
        self.body, self.carrier = self.f.cancellation()

    def cancel(self):
        return self.service.cancel_upload(UID, SOURCE, self.body, CANCEL)

    def test_aborted_cancel_retries_and_commits_ledger_and_global_fence_together(self):
        self.rpc.aborts = 1
        response = self.cancel()
        self.assertEqual(response["receipt"]["outcome"], "cancelled")
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), response)
        commits = [
            args["request"]["writes"]
            for kind, args in self.rpc.calls
            if kind == "commit" and args["request"]["writes"]
        ]
        for batch in commits[-2:]:
            self.assertEqual(len(batch), 2)
            self.assertEqual(
                {write.update.name.split("/documents/")[1].split("/")[0] for write in batch},
                {"portfolio_operations", "portfolio_upload_cancellations"},
            )
        self.assertFalse(any("/portfolio_snapshots/" in path for path in self.rpc.documents))

    def test_upload_loses_to_cancel_during_sdk_conflict_retry(self):
        self.rpc.aborts = 1
        self.rpc.before_abort = self.cancel
        with self.assertRaises(ContractError) as failed:
            self.f.write(self.service, carrier=self.carrier)
        self.assertEqual(failed.exception.code, "version_conflict")
        self.assertEqual(
            self.service.upload_cancellation(UID, SOURCE, CANCEL)["receipt"]["outcome"], "cancelled"
        )
        self.assertFalse(
            any(
                "/portfolio_snapshots/" in path or "/portfolio_heads/" in path
                for path in self.rpc.documents
            )
        )

    def test_cancel_loses_to_saved_upload_during_sdk_conflict_retry(self):
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.f.write(self.service, carrier=self.carrier)
        response = self.cancel()
        self.assertEqual(response["receipt"]["outcome"], "saved")
        self.assertEqual(self.service.snapshot(UID, SOURCE)["carrier"], self.carrier)
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), response)

    def test_legacy_writer_read_dependency_sees_the_same_global_operation_fence_after_retry(self):
        # The pre-cancellation writer reads this exact document inside its upload
        # transaction. A new cancellation collection alone would not conflict.
        path = _operation_path(self.f.owner, self.f.vault, OPERATION)
        reads = []

        def legacy_writer(unit):
            previous = unit.get(path)
            reads.append(previous)
            if previous is not None:
                if (
                    previous.get("ownerSubject") != self.f.owner
                    or previous.get("sourceId") != SOURCE
                    or previous.get("fingerprint")
                    != signing_input_fingerprint(self.carrier["signedObject"])
                ):
                    raise ContractError("idempotency_conflict")
            unit.put(path, {"legacyWriter": "must never commit"})
            unit.put(
                document_path("portfolio_snapshots", self.f.owner, SOURCE, "legacy"),
                {"legacyWriter": "must never commit"},
            )

        self.rpc.aborts = 1
        self.rpc.before_abort = self.cancel
        with self.assertRaises(ContractError) as failed:
            self.store.transact(legacy_writer)
        self.assertEqual(failed.exception.code, "idempotency_conflict")
        self.assertEqual(len(reads), 2)
        self.assertIsNone(reads[0])
        self.assertEqual(reads[1]["kind"], "holdings_upload_cancelled")
        read_names = [
            name
            for kind, args in self.rpc.calls
            if kind == "get"
            for name in args["request"]["documents"]
        ]
        self.assertGreaterEqual(sum(name.endswith("/" + path) for name in read_names), 3)
        self.assertFalse(any("/portfolio_snapshots/" in name for name in self.rpc.documents))

    def test_sdk_read_and_repeat_cancel_never_prune_or_rewrite_any_record(self):
        response = self.cancel()
        before = dict(self.rpc.documents)
        offset = len(self.rpc.calls)
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), response)
        self.assertEqual(self.cancel(), response)
        self.assertEqual(self.rpc.documents, before)
        self.assertFalse(
            any(
                kind == "commit" and args["request"]["writes"]
                for kind, args in self.rpc.calls[offset:]
            )
        )
