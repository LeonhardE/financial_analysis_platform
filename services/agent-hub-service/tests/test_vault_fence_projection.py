"""Live source epochs share the vault transaction without changing creation anchors."""

import copy
import tempfile
import unittest
from pathlib import Path

import test_firestore_store as firestore_fixtures
from fixtures import BOOT, OTHER_UID, SOURCE, UID, VaultFixture

from app.catalogue import CatalogueService
from app.fences import FenceService, fence_path
from app.store import FirestoreHubStore, SQLiteHubStore, StoreUnavailable, document_path
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.identity import owner_key


class VaultFenceProjectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "hub.sqlite3"
        self.store = SQLiteHubStore(self.path)
        self.vaults = VaultService(self.store, clock=lambda: 1000)
        self.fences = FenceService(self.store, clock=lambda: 1000)
        self.fixture = VaultFixture()
        self.bootstrap = self.fixture.bootstrap()
        self.vaults.bootstrap(UID, self.bootstrap, BOOT)
        self.command = self.fixture.control()
        self.selected = self.source()["source"]

    def source(self, *, source=SOURCE, command=None, operation="synthetic_source_create_0001"):
        return self.vaults.create_source(
            UID,
            self.fixture.vault,
            source,
            self.command if command is None else command,
            operation,
            self.fixture.kid("device_sig"),
        )

    def invalidate(self, *, epoch=1, reason="account_scope_changed", operation=None, ref=None):
        request = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": owner_key(UID),
            "mutationId": operation or f"synthetic_source_fence_{epoch:04}",
            "ref": self.selected["resourceRef"] if ref is None else ref,
            "expectedSourceEpoch": epoch,
            "newSourceEpoch": epoch + 1,
            "reason": reason,
        }
        return self.fences.invalidate(request, source_service="portfolio")

    def assert_projection(self, epoch):
        current = self.vaults.current(UID)
        authority = self.vaults.authority(UID, SOURCE)["authority"]
        self.assertEqual(current["sources"][0], {**self.selected, "sourceEpoch": epoch})
        self.assertEqual(authority["sourceEpoch"], epoch)
        self.assertEqual(authority["resourceRef"], self.selected["resourceRef"])
        self.assertIs(authority["active"], True)
        self.assertEqual(current["vault"]["version"], 2)
        context = CatalogueService(self.vaults, None).context(UID)
        self.assertEqual(context["sources"][0]["fence"]["sourceEpoch"], epoch)
        return current, authority

    def test_real_fence_updates_current_authority_and_catalogue_without_mutating_vault(self):
        before = self.store.transact(
            lambda unit: unit.get(document_path("hub_vaults", owner_key(UID)))
        )
        self.assert_projection(1)
        self.invalidate()
        current, authority = self.assert_projection(2)
        after = self.store.transact(
            lambda unit: unit.get(document_path("hub_vaults", owner_key(UID)))
        )
        self.assertEqual(before, after)
        self.assertEqual(after["sources"][0]["sourceEpoch"], 1)
        self.assertEqual(authority["vaultId"], current["vault"]["vaultId"])
        self.assertEqual(set(current["sources"][0]), {"resourceRef", "sourceEpoch"})

    def test_restart_and_immutable_old_ack_cannot_roll_back_projection(self):
        ack = self.invalidate()
        self.invalidate(epoch=2)
        self.store = SQLiteHubStore(self.path)
        self.vaults = VaultService(self.store, clock=lambda: 1001)
        self.fences = FenceService(self.store, clock=lambda: 1001)
        self.assertEqual(self.invalidate(), ack)
        self.assert_projection(3)
        self.assertEqual(self.source()["source"]["sourceEpoch"], 3)

    def test_bootstrap_and_registry_replays_project_current_fence_epoch(self):
        self.invalidate()
        replayed = self.vaults.bootstrap(UID, self.bootstrap, BOOT)
        self.assertEqual(replayed["sources"][0]["sourceEpoch"], 2)
        bundle = self.fixture.make_bundle(previous=self.fixture.registry)
        body = {"contractVersion": CONTRACT_VERSION, "expectedVersion": 2, "registryBundle": bundle}
        operation = "synthetic_registry_after_fence_0001"
        saved = self.vaults.update_registry(UID, self.fixture.vault, body, operation)
        self.assertEqual(saved["sources"][0]["sourceEpoch"], 2)
        self.assertEqual(saved["vault"]["version"], 3)
        self.invalidate(epoch=2)
        replayed = self.vaults.update_registry(UID, self.fixture.vault, body, operation)
        self.assertEqual(replayed["sources"][0]["sourceEpoch"], 3)
        self.assertEqual(replayed["vault"], saved["vault"])
        self.assertEqual(
            self.vaults.bootstrap(UID, self.bootstrap, BOOT)["sources"], replayed["sources"]
        )

    def test_terminal_fences_do_not_lock_the_owner_vault_or_another_source(self):
        second_id = "holdings_second"
        second_op = "synthetic_second_source_create"
        second = self.source(
            source=second_id,
            operation=second_op,
            command=self.fixture.control(source=second_id, operation=second_op),
        )["source"]
        for epoch, reason in [(1, "disconnected"), (2, "deleted")]:
            self.invalidate(epoch=epoch, reason=reason)
            current = self.vaults.current(UID)
            authority = self.vaults.authority(UID, SOURCE)["authority"]
            self.assertIsNotNone(current["vault"])
            self.assertEqual(
                current["sources"], [{**self.selected, "sourceEpoch": epoch + 1}, second]
            )
            self.assertIs(authority["active"], True)
            self.assertTrue(authority["writerKeyIds"])
            self.assertTrue(authority["recipientKeyIds"])
            self.assertEqual(self.vaults.authority(UID, second_id)["authority"]["sourceEpoch"], 1)
            self.assertEqual(self.source()["source"]["sourceEpoch"], epoch + 1)
            context = CatalogueService(self.vaults, None).context(UID)
            self.assertEqual(context["sources"][0]["fence"]["state"], reason)

    def test_foreign_owner_fence_does_not_change_owner_projection(self):
        request = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": owner_key(OTHER_UID),
            "mutationId": "synthetic_foreign_owner_fence_0001",
            "ref": self.selected["resourceRef"],
            "expectedSourceEpoch": 1,
            "newSourceEpoch": 2,
            "reason": "deleted",
        }
        self.fences.invalidate(request, source_service="portfolio")
        self.assert_projection(1)

    def test_corrupt_fence_never_falls_back_to_the_creation_epoch(self):
        self.invalidate()
        path = fence_path(owner_key(UID), self.selected["resourceRef"])
        self.store.transact(lambda unit: unit.put(path, {**unit.get(path), "sourceEpoch": True}))
        for read in [
            lambda: self.vaults.current(UID),
            lambda: self.vaults.authority(UID, SOURCE),
            self.source,
        ]:
            with self.subTest(read=read), self.assertRaises(StoreUnavailable):
                read()


class VaultFenceFirestoreProjectionTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore_fixtures.firestore.Client(
            project="synthetic-hub",
            database="agent-hub",
            credentials=firestore_fixtures.AnonymousCredentials(),
        )
        self.addCleanup(self.client.close)
        self.rpc = firestore_fixtures.MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.vaults = VaultService(self.store, clock=lambda: 1000)
        self.fixture = VaultFixture()
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        self.selected = self.vaults.create_source(
            UID,
            self.fixture.vault,
            SOURCE,
            self.fixture.control(),
            "synthetic_source_create_0001",
            self.fixture.kid("device_sig"),
        )["source"]
        self.request = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": owner_key(UID),
            "mutationId": "synthetic_racing_fence_0001",
            "ref": self.selected["resourceRef"],
            "expectedSourceEpoch": 1,
            "newSourceEpoch": 2,
            "reason": "account_scope_changed",
        }

    def test_authority_retry_rechecks_fence_in_same_transaction_as_registry(self):
        self.rpc.calls.clear()
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: FenceService(self.store, clock=lambda: 1000).invalidate(
            copy.deepcopy(self.request), source_service="portfolio"
        )
        value = self.vaults.authority(UID, SOURCE)["authority"]
        self.assertEqual(value["sourceEpoch"], 2)
        vault_path = self.client.document(
            document_path("hub_vaults", owner_key(UID))
        )._document_path
        fence_name = self.client.document(
            fence_path(owner_key(UID), self.selected["resourceRef"])
        )._document_path
        reads = [call[1]["request"] for call in self.rpc.calls if call[0] == "get"]
        self.assertGreaterEqual(sum(vault_path in request["documents"] for request in reads), 2)
        self.assertGreaterEqual(sum(fence_name in request["documents"] for request in reads), 2)
        self.assertTrue(all(request["transaction"] for request in reads))

    def test_current_retry_rechecks_fence_without_advancing_vault_version(self):
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: FenceService(self.store, clock=lambda: 1000).invalidate(
            copy.deepcopy(self.request), source_service="portfolio"
        )
        current = self.vaults.current(UID)
        self.assertEqual(current["sources"][0]["sourceEpoch"], 2)
        self.assertEqual(current["vault"]["version"], 2)
        stored = self.rpc.documents[
            self.client.document(document_path("hub_vaults", owner_key(UID)))._document_path
        ]
        self.assertEqual(stored["sources"][0]["sourceEpoch"], 1)
