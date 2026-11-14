"""Single owner display snapshot preserves the existing provider/credential checks."""

import copy
import unittest
from unittest.mock import patch

import test_provider_state_batches as batches
from fixtures import OTHER_UID, UID

from app import vaults
from app.native_transport import NativeConnectionOwnerService
from app.persistent_agents import identity_path
from app.provider_connections import SUMMARY_PROFILE, ProviderConnectionService, slot_path
from app.store import StoreUnavailable, document_path
from folioview_shared.encrypted.errors import ContractError


class ConnectionSummaryTests(unittest.TestCase):
    setUp = batches.ProviderStateBatchTests.setUp
    row = batches.ProviderStateBatchTests.row
    reads = batches.ProviderStateBatchTests.reads
    populate = batches.ProviderStateBatchTests.populate

    def summary(self):
        return self.fixture.service.summary(UID, self.vault)

    def test_same_existing_projections_in_one_transaction_and_no_writes(self):
        service = self.fixture.service
        expected_providers = {p: service.state(UID, self.vault, p) for p in ("muse", "chatgpt")}
        native = NativeConnectionOwnerService(self.store, clock=service.clock)
        expected_connections = native.native_connections(UID)["connections"]
        expected_credential = self.fixture.fx.service.state(UID, self.vault, self.first)
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.calls.clear()
        with patch("app.vaults._verify_row", wraps=vaults._verify_row) as verify:
            result = self.summary()
        self.assertEqual(verify.call_count, 1)
        self.assertEqual(result["profile"], SUMMARY_PROFILE)
        self.assertEqual(result["vaultId"], self.vault)
        self.assertEqual(result["connections"], expected_connections)
        self.assertEqual(result["providers"], expected_providers)
        self.assertEqual(
            result["credentials"], [{"connectionId": self.first, "state": expected_credential}]
        )
        self.assertEqual(before, self.rpc.documents)
        self.assertEqual([len(batch) for batch in self.reads()], [4, 1, 1])
        self.assertTrue(
            all(not kw["request"]["writes"] for name, kw in self.rpc.calls if name == "commit")
        )
        sqlite_service = ProviderConnectionService(
            self.fixture.store,
            audience=service.audience,
            client_ids=service.client_ids,
            clock=service.clock,
        )
        self.assertEqual(sqlite_service.summary(UID, self.vault), result)

    def test_bounded_three_read_phases_and_only_current_slot_credential(self):
        for count in (1, 2, 32):
            with self.subTest(count=count):
                self.populate(count)
                self.rpc.calls.clear()
                result = self.summary()
                self.assertEqual(len(result["connections"]), count)
                self.assertEqual([c["connectionId"] for c in result["credentials"]], [self.first])
                self.assertEqual([len(batch) for batch in self.reads()], [4, count, count])
                paths = [name for batch in self.reads() for name in batch]
                self.assertEqual(len(paths), len(set(paths)))

    def test_legacy_ambiguity_and_foreign_vault_blockers_are_preserved(self):
        ids = self.populate(3)
        del self.rpc.documents[self.client.document(slot_path(self.owner, "muse"))._document_path]
        self.row(document_path("hub_oauth_connections", self.owner, self.first)).pop(
            "providerSlotId"
        )
        self.row(document_path("hub_oauth_connections", self.owner, ids[2]))["vaultId"] = (
            "foreign_vault"
        )
        result = self.summary()
        self.assertIsNone(result["providers"]["muse"]["slot"])
        self.assertEqual(result["providers"]["muse"]["legacyBlockers"], [ids[2]])
        self.assertEqual([c["connectionId"] for c in result["credentials"]], ids[:2])
        self.assertEqual(result["credentials"][1]["state"]["status"], "reauthorization_required")

    def test_current_status_expiry_and_conflict_retry_are_fresh(self):
        self.fixture.fx.fx.now = 5001
        result = self.summary()
        self.assertEqual(result["connections"][0]["accountState"], "relogin_required")
        self.assertEqual(result["credentials"][0]["state"]["status"], "expired")
        self.rpc.calls.clear()
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.row(
            document_path("hub_oauth_connections", self.owner, self.first)
        ).update(status="revoked")
        with patch("app.vaults._verify_row", wraps=vaults._verify_row) as verify:
            result = self.summary()
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(result["connections"][0]["status"], "revoked")
        self.assertEqual(result["credentials"], [])

    def test_current_slot_cannot_borrow_another_generation_or_fingerprint(self):
        original = copy.deepcopy(self.rpc.documents)
        for field, value in (("credentialGeneration", 2), ("credentialFingerprint", "0" * 64)):
            with self.subTest(field=field):
                self.rpc.documents = copy.deepcopy(original)
                slot = self.row(slot_path(self.owner, "muse"))["slot"]
                slot["currentCredential"][field] = value
                slot["lastCredential"][field] = value
                with self.assertRaises(StoreUnavailable):
                    self.summary()

    def test_cross_owner_corrupt_index_identity_and_partial_rpc_fail_closed(self):
        with self.assertRaises(ContractError):
            self.fixture.service.summary(OTHER_UID, self.vault)
        original = copy.deepcopy(self.rpc.documents)
        for mutate in (
            lambda: self.index.update(connectionIds=[self.first, self.first]),
            lambda: self.row(document_path("hub_oauth_connections", self.owner, self.first)).update(
                ownerSubject="other_owner"
            ),
            lambda: self.row(identity_path(self.owner, self.vault, self.first))["identity"].update(
                connectionId="other_connection"
            ),
            lambda: self.row(slot_path(self.owner, "muse"))["slot"].update(vaultId="other_vault"),
        ):
            self.rpc.documents = copy.deepcopy(original)
            self.index = self.row(document_path("hub_oauth_owners", self.owner))
            mutate()
            with self.assertRaises((StoreUnavailable, ContractError)):
                self.summary()
        self.rpc.documents = original
        batch_get = self.rpc.batch_get_documents
        with patch.object(
            self.rpc,
            "batch_get_documents",
            side_effect=lambda **kw: iter(list(batch_get(**kw))[:-1]),
        ):
            with self.assertRaises(StoreUnavailable):
                self.summary()

    def test_empty_account_has_no_synthetic_identity_or_slot(self):
        for path in list(self.rpc.documents):
            if "/hub_vaults/" not in path and "/hub_operations/" not in path:
                del self.rpc.documents[path]
        result = self.summary()
        self.assertEqual(result["connections"], [])
        self.assertEqual(result["credentials"], [])
        self.assertTrue(
            all(
                p["slot"] is None and not p["retirementCandidates"]
                for p in result["providers"].values()
            )
        )
