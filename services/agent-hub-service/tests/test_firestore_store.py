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
from folioview_shared.encrypted.errors import ContractError


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
