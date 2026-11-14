"""A full connection display keeps the original vault and credential checks together."""

import copy
import unittest
from unittest.mock import patch

import test_provider_state_batches as batches
from fixtures import OTHER_UID, UID

from app import vaults
from app.fences import fence_path
from app.provider_connections import DISPLAY_PROFILE
from app.store import StoreUnavailable, document_path
from app.vaults import VaultService
from folioview_shared.encrypted.budgets import check_size
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json

CAPABILITIES = {
    "agents": {
        "contractVersion": CONTRACT_VERSION,
        "profile": "folioview.persistent-agent-capabilities.v1",
        "enrollmentEnabled": False,
        "resourceConsentEnabled": False,
        "executionEnabled": False,
    },
    "account": {
        "contractVersion": CONTRACT_VERSION,
        "profile": "folioview.persistent-account.v1",
        "accountLinkEnabled": False,
        "scope": "runtime:connect",
        "runtimeReady": False,
    },
    "credentials": {
        "contractVersion": CONTRACT_VERSION,
        "profile": "folioview.agent-credential.v1",
        "enabled": False,
        "defaultValiditySeconds": 7776000,
        "noticeSeconds": 604800,
    },
}


class ConnectionDisplayTests(unittest.TestCase):
    setUp = batches.ProviderStateBatchTests.setUp
    row = batches.ProviderStateBatchTests.row
    reads = batches.ProviderStateBatchTests.reads
    populate = batches.ProviderStateBatchTests.populate

    def display(self):
        return self.fixture.service.display(UID, self.vault, copy.deepcopy(CAPABILITIES))

    def source(self):
        service = VaultService(self.store, clock=self.fixture.service.clock)
        source, operation = "holdings_display_source", "synthetic_display_source_0001"
        return service.create_source(
            UID,
            self.vault,
            source,
            self.fixture.f.control(source, operation),
            operation,
            self.fixture.f.kid("device_sig"),
        )["source"]

    def test_same_vault_and_summary_one_verification_no_writes_and_bounded_phases(self):
        expected_vault = VaultService(self.store, clock=self.fixture.service.clock).current(UID)
        expected_summary = self.fixture.service.summary(UID, self.vault)
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.calls.clear()
        with patch("app.vaults._verify_row", wraps=vaults._verify_row) as verify:
            result = self.display()
        self.assertEqual(verify.call_count, 1)
        self.assertEqual(
            result,
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": DISPLAY_PROFILE,
                "vaultId": self.vault,
                "mode": "complete",
                "vaultResponse": expected_vault,
                "summary": expected_summary,
                "capabilities": CAPABILITIES,
            },
        )
        self.assertEqual([len(b) for b in self.reads()], [4, 1, 1])
        self.assertEqual(before, self.rpc.documents)

    def test_source_fences_join_connection_batch_and_original_vault_projection(self):
        service = VaultService(self.store, clock=self.fixture.service.clock)
        self.source()
        expected = service.current(UID)
        self.rpc.calls.clear()
        result = self.display()
        self.assertEqual(result["vaultResponse"], expected)
        self.assertEqual(len(result["vaultResponse"]["sources"]), 1)
        self.assertEqual([len(b) for b in self.reads()], [4, 2, 1])
        self.assertEqual(result["summary"]["vaultId"], expected["vault"]["vaultId"])

    def test_thirty_two_connections_remain_one_snapshot_with_original_selection(self):
        self.populate(32)
        self.rpc.calls.clear()
        result = self.display()
        self.assertEqual(result["mode"], "complete")
        self.assertEqual(len(result["summary"]["connections"]), 32)
        self.assertEqual(len(result["summary"]["credentials"]), 1)
        self.assertEqual([len(b) for b in self.reads()], [4, 32, 32])

    def test_combined_budget_returns_only_explicit_separate_read_hint(self):
        original = self.display()
        # Both original DTOs fit independently; their combined envelope does not.
        maximum = max(len(canonical_json(original[k])) for k in ("summary", "vaultResponse")) + 64
        self.assertLessEqual(len(canonical_json(original["summary"])), maximum)
        self.assertLessEqual(len(canonical_json(original["vaultResponse"])), maximum)
        with patch(
            "app.provider_connections.check_read_response",
            side_effect=lambda value: check_size(value, maximum),
        ):
            result = self.display()
        self.assertEqual(result["mode"], "separate")
        self.assertIsNone(result["vaultResponse"])
        self.assertIsNone(result["summary"])
        self.assertEqual(result["capabilities"], CAPABILITIES)
        self.assertEqual(result["vaultId"], self.vault)

    def test_conflict_retry_rechecks_vault_and_current_connection(self):
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.row(
            document_path("hub_oauth_connections", self.owner, self.first)
        ).update(status="revoked")
        with patch("app.vaults._verify_row", wraps=vaults._verify_row) as verify:
            result = self.display()
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(result["summary"]["connections"][0]["status"], "revoked")
        self.assertEqual(result["summary"]["credentials"], [])

    def test_conflict_retry_loads_new_source_fence_without_any_display_write(self):
        source = self.source()
        ref = source["resourceRef"]
        name = self.client.document(fence_path(self.owner, ref))._document_path

        def invalidate():
            self.rpc.documents[name] = {
                "ownerSubject": self.owner,
                "ref": ref,
                "sourceEpoch": 2,
                "state": "disconnected",
                "mutationCount": 1,
                "lastMutationId": "synthetic_display_fence_0001",
            }

        self.rpc.calls.clear()
        self.rpc.aborts = 1
        self.rpc.before_abort = invalidate
        with patch("app.vaults._verify_row", wraps=vaults._verify_row) as verify:
            result = self.display()
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(result["vaultResponse"]["sources"], [{**source, "sourceEpoch": 2}])
        commits = [kw["request"]["writes"] for kind, kw in self.rpc.calls if kind == "commit"]
        self.assertEqual(commits, [[], []])

    def test_corrupt_source_fence_cannot_hide_behind_combined_budget_hint(self):
        source = self.source()
        original = self.display()
        maximum = max(len(canonical_json(original[k])) for k in ("summary", "vaultResponse")) + 64
        name = self.client.document(fence_path(self.owner, source["resourceRef"]))._document_path
        self.rpc.documents[name] = {"sourceEpoch": True}
        with (
            patch(
                "app.provider_connections.check_read_response",
                side_effect=lambda value: check_size(value, maximum),
            ),
            self.assertRaises(StoreUnavailable),
        ):
            self.display()

    def test_foreign_owner_vault_and_corruption_never_become_separate_hint(self):
        for uid, vault in ((OTHER_UID, self.vault), (UID, "other_vault")):
            with self.assertRaises(ContractError):
                self.fixture.service.display(uid, vault, CAPABILITIES)
        self.row(document_path("hub_oauth_connections", self.owner, self.first))["ownerSubject"] = (
            "other_owner"
        )
        with self.assertRaises(StoreUnavailable):
            self.display()
