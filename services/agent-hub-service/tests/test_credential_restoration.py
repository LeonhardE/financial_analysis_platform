"""Owner reauthorization can rebuild prior scope without either side's local Agent file."""

import unittest

import test_agent_credential_fences as fences
import test_native_credentials as native
import test_owned_credentials as credentials
from fixtures import OTHER_UID, UID
from test_persistent_identity_store import CONNECTION

from app.credential_restoration import descriptor, head, lineage_path, source
from app.persistent_agents import stored_identity
from app.resource_consents import ResourceConsentService
from app.store import StoreUnavailable
from folioview_shared.encrypted.errors import ContractError


class CredentialRestorationTests(unittest.TestCase):
    def setUp(self):
        self.case = fences.CredentialExecutionFenceTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.h = self.case.helper

    def read(self, connection=CONNECTION, ref=None, uid=UID):
        ref = ref or head(self.h.service, uid, self.h.f.vault, connection)["source"]
        return source(
            self.h.service,
            uid,
            self.h.f.vault,
            connection,
            ref["connectionId"],
            ref["bindingFingerprint"],
        )

    def test_original_consent_and_revocation_chain_are_readable_after_replacement_and_expiry(self):
        before = self.read()
        self.assertIsNotNone(before["resourceState"]["consent"])
        self.h.fresh_keys()
        self.h.approve()
        current = self.read()
        self.assertIsNone(current["resourceState"]["consent"])
        self.assertEqual(current["predecessor"], before["source"])
        archived = self.read(ref=current["predecessor"])
        self.assertEqual(archived["resourceState"]["consent"], before["resourceState"]["consent"])
        self.assertTrue(archived["historical"])
        self.assertEqual(archived["identityState"]["binding"], before["identityState"]["binding"])
        self.h.fx.now = self.h.row()["credentialLease"]["expiresAt"]
        self.assertEqual(
            self.read(ref=current["predecessor"])["resourceState"]["consent"],
            before["resourceState"]["consent"],
        )
        receipts = ResourceConsentService(self.h.store, clock=lambda: self.h.fx.now)
        for operation in archived["resourceState"]["operations"]:
            self.assertEqual(
                receipts.receipt(UID, self.h.f.vault, CONNECTION, operation)["operationId"],
                operation,
            )
        self.assertNotIn("privateKey", str(archived))

    def test_incomplete_reauthorizations_retain_sources_without_granting_scope(
        self,
    ):
        first = self.read()
        self.h.fresh_keys()
        self.h.approve()
        second = self.read()
        self.h.fresh_keys("third")
        self.h.approve()
        third = self.read()
        self.assertEqual(third["predecessor"], second["source"])
        prior = self.read(ref=third["predecessor"])
        self.assertEqual(prior["predecessor"], first["source"])
        self.assertIsNone(third["resourceState"]["consent"])
        self.assertIsNone(prior["resourceState"]["consent"])
        self.assertIsNotNone(self.read(ref=prior["predecessor"])["resourceState"]["consent"])

    def test_wrong_owner_namespace_unknown_history_and_corrupt_link_fail_closed(self):
        with self.assertRaises(ContractError):
            self.read(uid=OTHER_UID)
        with self.assertRaises(ContractError):
            self.read(ref={"connectionId": CONNECTION, "bindingFingerprint": "b" * 64})
        self.h.fresh_keys()
        self.h.approve()
        current = self.h.row()
        path = lineage_path(
            self.h.f.owner, self.h.f.vault, CONNECTION, current["identity"]["bindingFingerprint"]
        )
        original = self.h.store.transact(lambda u: u.get(path))
        for changed in (
            {**original, "ownerSubject": "other"},
            {
                **original,
                "predecessor": {**original["predecessor"], "credentialFingerprint": "b" * 64},
            },
            {**original, "predecessor": None},
        ):
            self.h.store.transact(lambda u, value=changed: u.put(path, value))
            with self.assertRaises(StoreUnavailable):
                self.read()
        self.h.store.transact(lambda u: u.put(path, original))
        self.assertEqual(self.read()["predecessor"], original["predecessor"])


class InitialAndLegacyRestorationTests(unittest.TestCase):
    def test_first_managed_slot_has_no_fabricated_predecessor_or_permission(self):
        case = credentials.AgentCredentialTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        self.assertIsNone(head(case.service, UID, case.f.vault, CONNECTION)["source"])
        case.approve()
        value = source(
            case.service,
            UID,
            case.f.vault,
            CONNECTION,
            CONNECTION,
            case.row()["identity"]["bindingFingerprint"],
        )
        self.assertIsNone(value["predecessor"])
        self.assertIsNone(value["resourceState"]["consent"])

    def test_firestore_retry_commits_lineage_with_the_exact_current_credential(self):
        case = credentials.FirestoreAgentCredentialTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.rpc.aborts = 1
        first = case.approve()
        batches = [
            kwargs["request"]["writes"]
            for kind, kwargs in case.rpc.calls
            if kind == "commit" and kwargs["request"]["writes"]
        ]
        self.assertTrue(
            any(
                any("/hub_credential_lineage/" in write.update.name for write in batch)
                and any("/hub_agent_identities/" in write.update.name for write in batch)
                for batch in batches
            )
        )
        case.fresh_keys()
        case.approve()
        current = source(
            case.service,
            UID,
            case.f.vault,
            CONNECTION,
            CONNECTION,
            case.row()["identity"]["bindingFingerprint"],
        )
        self.assertEqual(
            current["predecessor"]["credentialFingerprint"], first["lease"]["credentialFingerprint"]
        )
        self.assertEqual(current["predecessor"]["generation"], 1)

    def test_legacy_migration_retains_exact_original_binding_after_old_parent_stops(self):
        case = native.NativeCredentialTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        old = case.a.store.transact(
            lambda u: stored_identity(u, case.f.owner, case.f.vault, case.old)
        )
        case.domain.offer(case.token, case.setup["setupIntentId"], native.PACKET)
        command, operation = case.command()
        case.domain.credentials.command(UID, case.f.vault, case.new, command, operation)
        current = source(
            case.domain.credentials,
            UID,
            case.f.vault,
            case.new,
            case.new,
            case.domain.credentials.state(UID, case.f.vault, case.new)["identity"][
                "bindingFingerprint"
            ],
        )
        self.assertEqual(current["predecessor"], descriptor(old))
        previous = source(
            case.domain.credentials,
            UID,
            case.f.vault,
            case.new,
            case.old,
            old["identity"]["bindingFingerprint"],
        )
        self.assertTrue(previous["identityState"]["connectionRevoked"])
        self.assertEqual(previous["identityState"]["binding"], old["binding"])
        self.assertIsNone(previous["credential"])
