"""Real SDK provider-state reads stay bounded as retained connections grow."""

import copy
import unittest
from unittest.mock import patch

import test_provider_slot_store as providers
from fixtures import OTHER_UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.persistent_agents import identity_path
from app.provider_connections import slot_path
from app.store import FirestoreHubStore, StoreUnavailable, document_path
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads


class ProviderStateBatchTests(unittest.TestCase):
    def setUp(self):
        self.fixture = providers.ProviderConnectionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        packet, operation = self.fixture.packet()
        self.fixture.apply(packet, operation)
        self.expected = self.fixture.state()
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        connection = self.fixture.store.connect()
        try:
            for path, body in connection.execute("SELECT path, body FROM hub_documents"):
                self.rpc.documents[self.client.document(path)._document_path] = strict_json_loads(
                    body
                )
        finally:
            connection.close()
        self.fixture.service.store = self.store
        self.owner = self.fixture.f.owner
        self.vault = self.fixture.f.vault
        self.index = self.row(document_path("hub_oauth_owners", self.owner))
        self.first = self.index["connectionIds"][0]
        self.original = copy.deepcopy(
            self.row(document_path("hub_oauth_connections", self.owner, self.first))
        )

    def row(self, path):
        return self.rpc.documents[self.client.document(path)._document_path]

    def reads(self):
        return [kw["request"]["documents"] for name, kw in self.rpc.calls if name == "get"]

    def populate(self, count, provider="muse"):
        ids = [self.first] + [f"synthetic_bootstrap_{i}" for i in range(1, count)]
        self.index["connectionIds"] = ids
        for connection in ids[1:]:
            row = {**self.original, "connectionId": connection, "provider": provider}
            row.pop("providerSlotId", None)
            row.pop("credentialMode", None)
            path = document_path("hub_oauth_connections", self.owner, connection)
            self.rpc.documents[self.client.document(path)._document_path] = row
        return ids

    def test_one_two_thirty_two_connections_use_only_three_read_phases_and_same_result(self):
        for count in (1, 2, 32):
            with self.subTest(count=count):
                self.populate(count)
                self.rpc.calls.clear()
                self.assertEqual(self.fixture.state(), self.expected)
                self.assertEqual([len(batch) for batch in self.reads()], [3, count, count])
                flattened = [name for batch in self.reads() for name in batch]
                self.assertEqual(len(flattened), len(set(flattened)))

    def test_other_provider_identities_are_not_loaded_and_revoked_history_is_not_expanded(self):
        ids = self.populate(32, "chatgpt")
        self.rpc.calls.clear()
        self.assertEqual(self.fixture.state(), self.expected)
        self.assertEqual([len(batch) for batch in self.reads()], [3, 32, 1])
        for connection in ids[1:]:
            self.row(document_path("hub_oauth_connections", self.owner, connection)).update(
                provider="muse", status="revoked"
            )
        self.rpc.calls.clear()
        self.assertEqual(self.fixture.state(), self.expected)
        self.assertEqual([len(batch) for batch in self.reads()], [3, 32, 1])

    def test_foreign_vault_remains_a_blocker_without_loading_its_identity(self):
        ids = self.populate(2)
        self.row(document_path("hub_oauth_connections", self.owner, ids[1]))["vaultId"] = (
            "other_synthetic_vault"
        )
        self.rpc.calls.clear()
        result = self.fixture.state()
        self.assertEqual(result["legacyBlockers"], [ids[1]])
        self.assertEqual(result["slot"], self.expected["slot"])
        self.assertEqual([len(batch) for batch in self.reads()], [3, 2, 1])
        forbidden = self.client.document(
            identity_path(self.owner, self.vault, ids[1])
        )._document_path
        self.assertNotIn(forbidden, [name for batch in self.reads() for name in batch])

    def test_conflict_retry_reloads_current_owner_connection_and_refuses_corruption(self):
        self.rpc.aborts = 1
        path = document_path("hub_oauth_connections", self.owner, self.first)
        self.rpc.before_abort = lambda: self.row(path).update(ownerSubject="foreign_owner")
        with self.assertRaises(StoreUnavailable):
            self.fixture.state()
        self.assertEqual([len(batch) for batch in self.reads()], [3, 1, 1, 3, 1])

    def test_incomplete_or_duplicate_batch_refuses_state_without_partial_success(self):
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
                self.fixture.state()

    def test_index_corruption_and_cross_owner_cannot_borrow_a_valid_slot(self):
        for values in ([self.first] * 2, [f"connection_{i}" for i in range(33)]):
            self.index["connectionIds"] = values
            self.rpc.calls.clear()
            with self.assertRaises(StoreUnavailable):
                self.fixture.state()
            self.assertEqual([len(batch) for batch in self.reads()], [3])
        self.index["connectionIds"] = [self.first]
        with self.assertRaises(ContractError) as missing:
            self.fixture.service.state(OTHER_UID, self.vault, "muse")
        self.assertEqual(missing.exception.code, "not_found")
        self.row(slot_path(self.owner, "muse"))["slot"]["vaultId"] = "another_vault"
        with self.assertRaises(ContractError) as stale:
            self.fixture.state()
        self.assertEqual(stale.exception.code, "version_conflict")
