"""Actual Firestore SDK batch encoding and retry atomicity without a live database."""

import unittest

import test_private_display_name_store as name_fixture
from fixtures import BOOT, SOURCE, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.private_display_names import PrivateDisplayNameService
from app.store import FirestoreHubStore
from app.vaults import VaultService


class DisplayNameFirestoreTests(unittest.TestCase):
    def test_two_document_atomic_commit_retry_and_one_batch_including_missing_fences(self):
        fixture = name_fixture.DisplayNameStoreTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(client.close)
        rpc = MemoryRpc(client)
        client._firestore_api_internal = rpc
        store = FirestoreHubStore("synthetic-hub", "agent-hub", client=client)
        vaults = VaultService(store, clock=lambda: fixture.now)
        vaults.bootstrap(UID, fixture.f.bootstrap(), BOOT)
        vaults.create_source(
            UID,
            fixture.f.vault,
            SOURCE,
            fixture.f.control(),
            "synthetic_source_create_0001",
            fixture.f.kid("device_sig"),
        )
        # Same signed creation has the same source/incarnation in both stores.
        names = PrivateDisplayNameService(store, clock=lambda: fixture.now)
        rpc.calls.clear()
        rpc.aborts = 1
        saved = names.write(UID, fixture.f.vault, SOURCE, *fixture.packet())
        commits = [args for kind, args in rpc.calls if kind == "commit"]
        self.assertEqual(len(commits), 2)
        self.assertEqual([len(r["request"]["writes"]) for r in commits], [2, 2])
        rpc.calls.clear()
        self.assertEqual(names.listing(UID, fixture.f.vault)["items"], [saved["item"]])
        reads = [args for kind, args in rpc.calls if kind == "get"]
        self.assertEqual([len(r["request"]["documents"]) for r in reads], [1, 2])
        self.assertTrue(all(r["request"]["transaction"] for r in reads))

    def test_retry_observes_a_racing_delete_and_stages_no_alias_or_receipt(self):
        from app.fences import fence_path
        from app.private_display_names import name_path
        from folioview_shared.encrypted.errors import ContractError

        fixture = name_fixture.DisplayNameStoreTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(client.close)
        rpc = MemoryRpc(client)
        client._firestore_api_internal = rpc
        store = FirestoreHubStore("synthetic-hub", "agent-hub", client=client)
        vaults = VaultService(store, clock=lambda: fixture.now)
        vaults.bootstrap(UID, fixture.f.bootstrap(), BOOT)
        vaults.create_source(
            UID,
            fixture.f.vault,
            SOURCE,
            fixture.f.control(),
            "synthetic_source_create_0001",
            fixture.f.kid("device_sig"),
        )
        names = PrivateDisplayNameService(store, clock=lambda: fixture.now)
        path = client.document(fence_path(fixture.f.owner, fixture.ref))._document_path

        def concurrent_delete():
            rpc.documents[path] = {
                "ownerSubject": fixture.f.owner,
                "ref": fixture.ref,
                "sourceEpoch": 2,
                "state": "deleted",
                "mutationCount": 1,
                "lastMutationId": "synthetic_source_delete_0001",
            }

        rpc.aborts, rpc.before_abort = 1, concurrent_delete
        with self.assertRaises(ContractError) as error:
            names.write(UID, fixture.f.vault, SOURCE, *fixture.packet())
        self.assertEqual(error.exception.code, "not_found")
        alias_path = client.document(
            name_path(fixture.f.owner, fixture.f.vault, fixture.f.root_id, fixture.ref)
        )._document_path
        self.assertNotIn(alias_path, rpc.documents)
        self.assertFalse(any("/hub_private_display_name_operations/" in p for p in rpc.documents))

    def test_ten_known_sources_still_use_one_alias_and_fence_batch(self):
        fixture = name_fixture.DisplayNameStoreTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(client.close)
        rpc = MemoryRpc(client)
        client._firestore_api_internal = rpc
        store = FirestoreHubStore("synthetic-hub", "agent-hub", client=client)
        vaults = VaultService(store, clock=lambda: fixture.now)
        vaults.bootstrap(UID, fixture.f.bootstrap(), BOOT)
        for i in range(10):
            source, op = f"holdings_{i}", f"synthetic_display_source_{i:04d}"
            vaults.create_source(
                UID,
                fixture.f.vault,
                source,
                fixture.f.control(source, op),
                op,
                fixture.f.kid("device_sig"),
            )
        names = PrivateDisplayNameService(store, clock=lambda: fixture.now)
        rpc.calls.clear()
        self.assertEqual(names.listing(UID, fixture.f.vault)["items"], [])
        reads = [args for kind, args in rpc.calls if kind == "get"]
        self.assertEqual([len(r["request"]["documents"]) for r in reads], [1, 20])
