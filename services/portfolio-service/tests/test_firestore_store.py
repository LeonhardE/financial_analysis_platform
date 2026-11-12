"""Actual SDK serialization/retry lifecycle against an in-memory RPC boundary."""

import copy
import os
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from fixtures import SOURCE, UID, HoldingsFixture
from google.api_core.exceptions import Aborted
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1._helpers import decode_dict, encode_dict
from google.cloud.firestore_v1.types import (
    BatchGetDocumentsResponse,
    BeginTransactionResponse,
    CommitResponse,
    Document,
    WriteResult,
)
from google.protobuf.empty_pb2 import Empty

from app.holdings import PortfolioError, PortfolioService
from app.lifecycle import state_path
from app.store import FirestorePortfolioStore, StoreUnavailable, document_path, get_store
from folioview_shared.encrypted.constants import MAX_STORED_DOCUMENT_BYTES
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.identity import owner_key


class MemoryRpc:
    def __init__(self, client):
        self.client = client
        self.documents = {}
        self.calls = []
        self.aborts = 0
        self.before_abort = None

    def record(self, name, kwargs):
        self.calls.append((name, kwargs))
        assert kwargs["timeout"] == 4
        assert kwargs["retry"] is None

    def begin_transaction(self, **kwargs):
        self.record("begin", kwargs)
        return BeginTransactionResponse(transaction=b"synthetic-transaction")

    def batch_get_documents(self, **kwargs):
        self.record("get", kwargs)
        result = []
        for name in kwargs["request"]["documents"]:
            if name not in self.documents:
                result.append(BatchGetDocumentsResponse(missing=name))
            else:
                result.append(
                    BatchGetDocumentsResponse(
                        found=Document(
                            name=name, fields=encode_dict(copy.deepcopy(self.documents[name]))
                        )
                    )
                )
        return iter(result)

    def commit(self, **kwargs):
        self.record("commit", kwargs)
        if self.aborts:
            self.aborts -= 1
            if self.before_abort:
                self.before_abort()
            raise Aborted("Synthetic transaction collision")
        updates = {
            write.update.name: decode_dict(write.update.fields, self.client)
            for write in kwargs["request"]["writes"]
        }
        self.documents.update(updates)
        now = datetime(2026, 10, 27, tzinfo=UTC)
        return CommitResponse(
            write_results=[WriteResult(update_time=now) for _ in updates], commit_time=now
        )

    def rollback(self, **kwargs):
        self.record("rollback", kwargs)
        return Empty()


class FirestorePortfolioTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-portfolio",
            database="portfolio",
            credentials=AnonymousCredentials(),
        )
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestorePortfolioStore("synthetic-portfolio", "portfolio", client=self.client)
        self.service = PortfolioService(self.store, clock=lambda: 1000)
        self.fixture = HoldingsFixture()
        self.fixture.install(self.service)

    def test_sdk_actual_document_names_atomic_three_writes_and_retry(self):
        self.rpc.aborts = 1
        receipt = self.fixture.write(self.service)
        self.assertEqual(receipt, self.service.snapshot(UID, SOURCE)["receipt"])
        commits = [
            kwargs
            for name, kwargs in self.rpc.calls
            if name == "commit" and kwargs["request"]["writes"]
        ]
        self.assertEqual(len(commits), 3)  # replica install, aborted attempt, retry
        for call in commits[1:]:
            self.assertEqual(len(call["request"]["writes"]), 3)
            for write in call["request"]["writes"]:
                self.assertTrue(
                    write.update.name.startswith(
                        "projects/synthetic-portfolio/databases/portfolio/documents/portfolio_"
                    )
                )
        self.assertEqual(len(self.rpc.documents), 4)

    def test_sdk_transaction_retry_rereads_changed_authority_and_writes_nothing(self):
        path = document_path("portfolio_authorities", owner_key(UID), SOURCE)
        name = f"projects/synthetic-portfolio/databases/portfolio/documents/{path}"

        def revoke():
            self.rpc.documents[name]["active"] = False
            self.rpc.documents[name]["version"] = 2

        self.rpc.aborts = 1
        self.rpc.before_abort = revoke
        with self.assertRaises(PortfolioError) as result:
            self.fixture.write(self.service)
        self.assertEqual(result.exception.status, 403)
        self.assertEqual(len(self.rpc.documents), 1)
        self.assertTrue(any(kind == "rollback" for kind, _ in self.rpc.calls))

    def test_sdk_fence_updates_authority_state_and_receipt_atomically_after_retry(self):
        self.rpc.aborts = 1
        pending = self.fixture.mutate(self.service)
        self.assertEqual(pending["state"], "pending")
        self.assertEqual(self.service.metadata(UID, SOURCE)["sourceEpoch"], 2)
        writes = [
            kwargs["request"]["writes"]
            for name, kwargs in self.rpc.calls
            if name == "commit" and kwargs["request"]["writes"]
        ]
        for batch in writes[-2:]:
            self.assertEqual(len(batch), 3)
            names = {write.update.name.split("/documents/")[1].split("/")[0] for write in batch}
            self.assertEqual(
                names,
                {"portfolio_authorities", "portfolio_source_states", "portfolio_source_mutations"},
            )
        self.assertEqual(len(self.rpc.documents), 3)

    def test_sdk_aborted_upload_rechecks_fence_and_does_not_save_old_carrier(self):
        def fence():
            self.rpc.before_abort = None
            self.fixture.mutate(self.service)

        self.rpc.aborts = 1
        self.rpc.before_abort = fence
        with self.assertRaises(ContractError) as result:
            self.fixture.write(self.service)
        self.assertEqual(result.exception.code, "insufficient_scope")
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "revoking")
        self.assertFalse(any("/portfolio_snapshots/" in name for name in self.rpc.documents))
        self.assertIn(
            "projects/synthetic-portfolio/databases/portfolio/documents/"
            + state_path(owner_key(UID), SOURCE),
            self.rpc.documents,
        )

    def test_document_budget_counts_actual_sdk_encoding_and_rejects_before_commit(self):
        with self.assertRaises(ContractError) as result:
            self.store.transact(
                lambda unit: unit.put(
                    document_path("portfolio_snapshots", "oversized"), {"opaque": "x" * 786_433}
                )
            )
        self.assertEqual(result.exception.code, "payload_too_large")
        self.assertEqual(len(self.rpc.documents), 1)
        # JSON remains below 768 KiB; the real SDK name/field encoding exceeds it.
        with self.assertRaises(ContractError) as result:
            self.store.transact(
                lambda unit: unit.put(
                    document_path("portfolio_snapshots", "wire-overhead"),
                    {"opaque": "x" * (786_432 - 20)},
                )
            )
        self.assertEqual(result.exception.code, "payload_too_large")
        self.assertEqual(len(self.rpc.documents), 1)

    def test_compact_authority_writes_and_legacy_reads_are_equivalent(self):
        name, row = next(iter(self.rpc.documents.items()))
        self.assertIn("/portfolio_authorities/", name)
        expected = self.service.metadata(UID, SOURCE)
        self.assertIsInstance(row["registryHistory"], bytes)
        original = row["registryHistory"]
        row["registryHistory"] = strict_json_loads(original)
        self.assertEqual(self.service.metadata(UID, SOURCE), expected)
        row["registryHistory"] = original
        self.assertEqual(self.service.metadata(UID, SOURCE), expected)
        receipt = self.fixture.write(self.service)
        self.assertEqual(self.service.snapshot(UID, SOURCE)["receipt"], receipt)
        self.assertEqual(self.rpc.documents[name]["registryHistory"], original)

    def test_compact_authority_rejects_invalid_noncanonical_oversized_and_tampered_history(self):
        name, row = next(iter(self.rpc.documents.items()))
        path = name.split("/documents/", 1)[1]
        altered = strict_json_loads(row["registryHistory"])
        altered[0]["checkpoint"]["signature"] = "A" * 86
        for payload in (b"{}", b"[ ]", b"[1,]", b"[\xff]", b" " * 786433):
            with self.subTest(payload=payload[:16]), self.assertRaises(StoreUnavailable):
                row["registryHistory"] = payload
                self.store.transact(lambda unit: unit.get(path))
        row["registryHistory"] = canonical_json(altered)
        with self.assertRaises(StoreUnavailable):
            self.service.metadata(UID, SOURCE)
        row["registryHistory"] = b"[]"
        row["opaque"] = "x" * 786432
        with self.assertRaises(StoreUnavailable):
            self.store.transact(lambda unit: unit.get(path))
        other = self.client.document(document_path("portfolio_heads", "unrelated"))
        self.rpc.documents[other._document_path] = {"registryHistory": b"[]"}
        with self.assertRaises(StoreUnavailable):
            self.store.transact(lambda unit: unit.get(other.path))

    def test_compact_full_signed_authority_history_fits_unchanged_logical_and_wire_budgets(self):
        name, stored = next(iter(self.rpc.documents.items()))
        history = strict_json_loads(stored["registryHistory"])
        previous = self.fixture.verify(history[-1])
        for i in range(10):
            for suffix, role in (("sig", "agent_sig"), ("enc", "agent_enc")):
                self.fixture.add_key(f"long_{i}_{suffix}", role, f"agent_{i}", f"connection_{i}")
        logical = {**stored, "registryHistory": history}
        for _ in range(31):
            candidate = self.fixture.make_bundle(previous=previous)
            proposed = {**logical, "registryHistory": [*history, candidate]}
            if len(canonical_json(proposed)) > MAX_STORED_DOCUMENT_BYTES - 2000:
                # Retain a fully signed consecutive final checkpoint, with the
                # owner keys plus as many Agent certificates as fit the budget.
                names = list(self.fixture.certificates)
                for count in range(len(names) - 1, 2, -1):
                    candidate = self.fixture.make_bundle(
                        previous=previous,
                        certificates={k: self.fixture.certificates[k] for k in names[:count]},
                    )
                    proposed = {**logical, "registryHistory": [*history, candidate]}
                    if len(canonical_json(proposed)) <= MAX_STORED_DOCUMENT_BYTES - 2000:
                        self.fixture.verify(candidate, previous=previous)
                        history.append(candidate)
                        break
                break
            previous = self.fixture.verify(candidate, previous=previous)
            history.append(candidate)
        logical = {**logical, "registryHistory": history}
        original = copy.deepcopy(logical)
        self.assertGreater(len(history), 20)
        self.assertLess(len(canonical_json(logical)), MAX_STORED_DOCUMENT_BYTES)
        legacy_wire = Document(name=name, fields=encode_dict(logical))._pb.SerializeToString()
        self.assertGreater(len(legacy_wire), MAX_STORED_DOCUMENT_BYTES)
        path = name.split("/documents/", 1)[1]
        self.store.transact(lambda unit: unit.put(path, logical))
        wire = Document(
            name=name, fields=encode_dict(self.rpc.documents[name])
        )._pb.SerializeToString()
        self.assertLess(len(wire), MAX_STORED_DOCUMENT_BYTES)
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "active")
        self.assertEqual(self.store.transact(lambda unit: unit.get(path)), original)
        self.assertEqual(logical, original)

    def test_production_never_falls_back_to_default_db_sqlite_or_emulator(self):
        for config in (
            {"K_SERVICE": "portfolio-api", "PORTFOLIO_STORE_BACKEND": "sqlite"},
            {"K_SERVICE": "", "PORTFOLIO_STORE_BACKEND": "unknown"},
            {"K_SERVICE": "portfolio-api", "FIRESTORE_EMULATOR_HOST": "localhost:8080"},
            {
                "PORTFOLIO_STORE_BACKEND": "firestore",
                "FIREBASE_PROJECT_ID": "synthetic",
                "FIRESTORE_DATABASE": "(default)",
            },
            {"PORTFOLIO_STORE_BACKEND": "firestore", "FIREBASE_PROJECT_ID": "synthetic"},
        ):
            get_store.cache_clear()
            with self.subTest(config=config), patch.dict(os.environ, config, clear=True):
                with self.assertRaises(StoreUnavailable):
                    get_store()
        get_store.cache_clear()
