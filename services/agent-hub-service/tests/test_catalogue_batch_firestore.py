"""Catalogue contexts use real SDK batched fence reads, including absent fences."""

import unittest
from types import SimpleNamespace

from fixtures import BOOT, UID, VaultFixture
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.catalogue import CatalogueService
from app.store import FirestoreHubStore
from app.vaults import VaultService


class CatalogueContextBatchTests(unittest.TestCase):
    def test_one_two_ten_fences_use_one_batch_after_current_vault_read(self):
        for count in (1, 2, 10):
            with self.subTest(count=count):
                client = firestore.Client(
                    project="synthetic-hub",
                    database="agent-hub",
                    credentials=AnonymousCredentials(),
                )
                self.addCleanup(client.close)
                rpc = MemoryRpc(client)
                client._firestore_api_internal = rpc
                vaults = VaultService(
                    FirestoreHubStore("synthetic-hub", "agent-hub", client=client),
                    clock=lambda: 1000,
                )
                fixture = VaultFixture()
                vaults.bootstrap(UID, fixture.bootstrap(), BOOT)
                for i in range(count):
                    source, operation = f"holdings_{i}", f"synthetic_context_source_{i:04}"
                    vaults.create_source(
                        UID,
                        fixture.vault,
                        source,
                        fixture.control(source, operation),
                        operation,
                        fixture.kid("device_sig"),
                    )
                rpc.calls.clear()
                context = CatalogueService(vaults, SimpleNamespace()).context(UID)
                self.assertEqual(len(context["sources"]), count)
                self.assertTrue(
                    all(row["fence"]["state"] == "active" for row in context["sources"])
                )
                reads = [args for kind, args in rpc.calls if kind == "get"]
                self.assertEqual([len(row["request"]["documents"]) for row in reads], [1, count])
