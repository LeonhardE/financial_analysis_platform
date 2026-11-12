"""Real Firestore SDK serialization and transaction retries against synthetic RPCs."""

import copy
import os
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from fixtures import BOOT, UID, VaultFixture
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

from app.store import FirestoreHubStore, StoreUnavailable, document_path, get_store
from app.vaults import VaultService
from folioview_shared.encrypted.constants import MAX_STORED_DOCUMENT_BYTES
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json, strict_json_loads


class MemoryRpc:
    def __init__(self, client):
        self.client, self.documents, self.calls = client, {}, []
        self.aborts = 0
        self.before_abort = None

    def record(self, kind, kwargs):
        self.calls.append((kind, kwargs))
        assert kwargs["timeout"] == 4 and kwargs["retry"] is None

    def begin_transaction(self, **kwargs):
        self.record("begin", kwargs)
        return BeginTransactionResponse(transaction=b"synthetic-hub-transaction")

    def batch_get_documents(self, **kwargs):
        self.record("get", kwargs)
        return iter(
            [
                BatchGetDocumentsResponse(
                    found=Document(
                        name=name, fields=encode_dict(copy.deepcopy(self.documents[name]))
                    )
                )
                if name in self.documents
                else BatchGetDocumentsResponse(missing=name)
                for name in kwargs["request"]["documents"]
            ]
        )

    def commit(self, **kwargs):
        self.record("commit", kwargs)
        if self.aborts:
            self.aborts -= 1
            if self.before_abort:
                self.before_abort()
            raise Aborted("Synthetic Hub transaction collision")
        updates = {
            write.update.name: decode_dict(write.update.fields, self.client)
            for write in kwargs["request"]["writes"]
        }
        self.documents.update(updates)
        now = datetime(2026, 10, 28, tzinfo=UTC)
        return CommitResponse(
            write_results=[WriteResult(update_time=now) for _ in updates], commit_time=now
        )

    def rollback(self, **kwargs):
        self.record("rollback", kwargs)
        return Empty()


class FirestoreHubTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.service = VaultService(
            FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client), clock=lambda: 1000
        )
        self.f = VaultFixture()

    def test_bootstrap_atomic_two_writes_sdk_names_and_conflict_retry(self):
        self.rpc.aborts = 1
        result = self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.assertEqual(result, self.service.current(UID))
        batches = [
            kwargs["request"]["writes"]
            for name, kwargs in self.rpc.calls
            if name == "commit" and kwargs["request"]["writes"]
        ]
        self.assertEqual(len(batches), 2)
        for batch in batches:
            self.assertEqual(len(batch), 2)
            self.assertEqual(
                {write.update.name.split("/documents/")[1].split("/")[0] for write in batch},
                {"hub_vaults", "hub_operations"},
            )
            self.assertTrue(
                all(
                    write.update.name.startswith(
                        "projects/synthetic-hub/databases/agent-hub/documents/"
                    )
                    for write in batch
                )
            )
        self.assertEqual(len(self.rpc.documents), 2)

    def test_racing_bootstrap_rechecks_winner_and_never_overwrites(self):
        competing = VaultFixture(UID)

        def win():
            self.rpc.before_abort = None
            self.service.bootstrap(UID, competing.bootstrap(), BOOT + "_winner")

        self.rpc.aborts, self.rpc.before_abort = 1, win
        with self.assertRaises(ContractError) as result:
            self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.assertEqual(result.exception.code, "version_conflict")
        self.assertEqual(self.service.current(UID)["vault"]["rootKeyId"], competing.root_id)
        self.assertEqual(len(self.rpc.documents), 2)

    def test_serialized_document_budget_rejects_before_any_rpc_commit(self):
        for size in (786433, 786412):
            with self.subTest(size=size), self.assertRaises(ContractError) as result:
                self.service.store.transact(
                    lambda unit, size=size: unit.put(
                        document_path("hub_vaults", "oversized"), {"opaque": "x" * size}
                    )
                )
            self.assertEqual(result.exception.code, "payload_too_large")
        self.assertEqual(self.rpc.documents, {})
        self.assertFalse(any(name == "commit" for name, _ in self.rpc.calls))

    def test_compact_writes_and_legacy_history_read_identically(self):
        expected = self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        name, row = next(
            (name, row) for name, row in self.rpc.documents.items() if "/hub_vaults/" in name
        )
        self.assertIsInstance(row["registryHistory"], bytes)
        original = row["registryHistory"]
        row["registryHistory"] = strict_json_loads(original)
        self.assertEqual(self.service.current(UID), expected)
        row["registryHistory"] = original
        self.assertEqual(self.service.current(UID), expected)
        path = name.split("/documents/", 1)[1]
        both = self.service.store.transact(lambda unit: (unit.get(path), unit.get_many([path])))
        self.assertEqual(both[0], both[1][path])
        self.assertIsInstance(both[0]["registryHistory"], list)
        self.assertIsInstance(self.rpc.documents[name]["registryHistory"], bytes)
        run = self.client.document(document_path("hub_persistent_runs", "frozen"))
        self.rpc.documents[run._document_path] = {"registryHistory": row["registryHistory"]}
        frozen = self.service.store.transact(lambda unit: unit.get_many([run.path]))
        self.assertEqual(frozen[run.path]["registryHistory"], both[0]["registryHistory"])

    def test_compact_history_rejects_malformed_noncanonical_and_oversized_payloads(self):
        self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        name, row = next(
            (name, row) for name, row in self.rpc.documents.items() if "/hub_vaults/" in name
        )
        path = name.split("/documents/", 1)[1]
        valid = row["registryHistory"]
        for payload in (b"not json", b"{}", b"[ ]", b"[1,]", b"[\xff]", b" " * 786433):
            for batch in (False, True):
                with self.subTest(payload=payload[:16], batch=batch):
                    row["registryHistory"] = payload
                    with self.assertRaises(StoreUnavailable):
                        self.service.store.transact(
                            lambda unit, batch=batch: (
                                unit.get_many([path]) if batch else unit.get(path)
                            )
                        )
        row["registryHistory"] = valid
        row["opaque"] = "x" * 786432
        with self.assertRaises(StoreUnavailable):
            self.service.store.transact(lambda unit: unit.get(path))

    def test_compact_history_cannot_bypass_signatures_or_expand_to_other_collections(self):
        self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        name, row = next(
            (name, row) for name, row in self.rpc.documents.items() if "/hub_vaults/" in name
        )
        altered = strict_json_loads(row["registryHistory"])
        altered[0]["checkpoint"]["signature"] = "A" * 86
        row["registryHistory"] = canonical_json(altered)
        with self.assertRaises((StoreUnavailable, ContractError)):
            self.service.current(UID)
        unrelated = self.client.document(document_path("hub_tasks", "unrelated"))
        self.rpc.documents[unrelated._document_path] = {"registryHistory": b"[]"}
        with self.assertRaises(StoreUnavailable):
            self.service.store.transact(lambda unit: unit.get(unrelated.path))

    def test_compact_write_retains_complete_verified_history_inside_both_budgets(self):
        for i in range(10):
            for suffix, role in (("sig", "agent_sig"), ("enc", "agent_enc")):
                self.f.add_key(f"long_{i}_{suffix}", role, f"agent_{i}", f"connection_{i}")
        self.f.bundle = self.f.make_bundle()
        previous = self.f.verify(self.f.bundle)
        self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        name, row = next(
            (name, row) for name, row in self.rpc.documents.items() if "/hub_vaults/" in name
        )
        history = [self.f.bundle]
        for _ in range(31):
            bundle = self.f.make_bundle(previous=previous)
            if len(canonical_json({**row, "registryHistory": [*history, bundle]})) > (
                MAX_STORED_DOCUMENT_BYTES - 3000
            ):
                break
            previous = self.f.verify(bundle, previous=previous)
            history.append(bundle)
        self.assertGreater(len(history), 20)
        logical = {
            **row,
            "registryHistory": history,
            "version": len(history),
            "operationCount": len(history),
        }
        padding = MAX_STORED_DOCUMENT_BYTES - 2000 - len(canonical_json(logical))
        archive = logical["archive"]
        size = (len(archive["ciphertext"]) + padding) * 3 // 4
        self.assertLessEqual(size, 24576)
        logical["archive"] = {**archive, "ciphertext": b64url_encode(b"x" * size)}
        before = copy.deepcopy(logical)
        legacy_wire = Document(name=name, fields=encode_dict(logical))._pb.SerializeToString()
        self.assertLess(len(canonical_json(logical)), MAX_STORED_DOCUMENT_BYTES)
        self.assertGreater(len(legacy_wire), MAX_STORED_DOCUMENT_BYTES)
        path = name.split("/documents/", 1)[1]
        self.service.store.transact(lambda unit: unit.put(path, logical))
        stored = self.rpc.documents[name]
        actual_wire = Document(name=name, fields=encode_dict(stored))._pb.SerializeToString()
        self.assertLess(len(actual_wire), MAX_STORED_DOCUMENT_BYTES)
        self.assertIsInstance(stored["registryHistory"], bytes)
        self.assertEqual(logical, before, "serialization cannot mutate a caller's signed history")
        self.assertEqual(self.service.current(UID)["vault"]["registryHistory"], history)
        self.assertEqual(self.service.store.transact(lambda unit: unit.get(path)), logical)

    def test_cloud_configuration_never_falls_back_to_default_db_sqlite_or_emulator(self):
        for config in (
            {"K_SERVICE": "hub", "AGENT_HUB_STORE_BACKEND": "sqlite"},
            {"K_SERVICE": "hub", "FIRESTORE_EMULATOR_HOST": "localhost:9090"},
            {
                "AGENT_HUB_STORE_BACKEND": "firestore",
                "FIREBASE_PROJECT_ID": "synthetic-hub",
                "FIRESTORE_DATABASE": "(default)",
            },
            {"AGENT_HUB_STORE_BACKEND": "firestore", "FIREBASE_PROJECT_ID": "synthetic-hub"},
        ):
            get_store.cache_clear()
            with (
                self.subTest(config=config),
                patch.dict(os.environ, config, clear=True),
                self.assertRaises(StoreUnavailable),
            ):
                get_store()
        get_store.cache_clear()
