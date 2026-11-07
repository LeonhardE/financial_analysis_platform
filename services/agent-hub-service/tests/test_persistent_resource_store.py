"""Root-only consent CAS, immutable history and independent resource revocation."""

import copy
import unittest

import test_persistent_identity_store as identities
from fixtures import OTHER_UID, UID

from app.fences import FenceService
from app.resource_consents import ResourceConsentService, consent_path, operation_path
from app.store import StoreUnavailable
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.resource_consents import (
    RESOURCE_CONSENT_PROFILE,
    resource_consent_digest,
)


class Catalogue:
    def __init__(self, refs):
        self.refs = refs
        self.calls = 0
        self.revision = 3
        self.callback = None
        self.unavailable = False

    def read(self, uid):
        self.calls += 1
        if self.callback:
            action, self.callback = self.callback, None
            action()
        if self.unavailable:
            raise ContractError("source_unavailable")
        return {
            "groups": [
                {
                    "items": [
                        {"ref": ref, "state": "active", "revision": self.revision, "sourceEpoch": 1}
                        for ref in self.refs
                    ]
                }
            ]
        }


class ResourceConsentStoreTests(unittest.TestCase):
    make_store = identities.PersistentAgentTests.make_store
    rejects = identities.PersistentAgentTests.rejects

    def setUp(self):
        identities.PersistentAgentTests.setUp(self)
        self.identity = identities.PersistentAgentTests.enroll(self)["identity"]
        self.identities = self.service
        self.a = copy.deepcopy(self.f.resource)
        self.b = {**self.a, "resourceId": "holdings_B", "incarnation": "incarnation_B"}
        self.catalogue = Catalogue([self.a, self.b])
        self.service = ResourceConsentService(self.store, self.catalogue, clock=lambda: self.now)
        self.serial = 0

    def state(self):
        return self.service.state(UID, self.f.vault, identities.CONNECTION)

    def proposal(self, *, ref=None, ident="permission_A", floor=3, epoch=0):
        return {
            "permissionId": ident,
            "ref": self.a if ref is None else ref,
            "sourceEpoch": 1,
            "fromRevision": floor,
            "versionPolicy": "current_and_future",
            "selectedHistory": [],
            "expectedPermissionEpoch": epoch,
        }

    def command(self, *, resources=None, targets=None, prior=None, author="root", **changes):
        self.serial += 1
        prior = self.state()["consent"] if prior is None else prior
        payload = {
            "contractVersion": CONTRACT_VERSION,
            "profile": RESOURCE_CONSENT_PROFILE,
            **{
                k: self.identity[k]
                for k in (
                    "ownerSubject",
                    "vaultId",
                    "rootKeyId",
                    "connectionId",
                    "agentId",
                    "clientId",
                    "identityEpoch",
                    "agentSigningKeyId",
                    "agentEncryptionKeyId",
                    "bindingFingerprint",
                )
            },
            "artifactType": "persistent_resource_revocation"
            if targets is not None
            else "persistent_resource_approval",
            "consentId": "consent_A",
            "purpose": "analysis",
            "authorKeyId": self.f.root_id if author == "root" else self.f.kid(author),
            "stableOperationId": f"synthetic_consent_operation_{self.serial:04d}",
            "expectedVersion": 0 if prior is None else prior["version"],
            "expectedConsentDigest": None if prior is None else resource_consent_digest(prior),
            "issuedAt": self.now,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            **(
                {"targets": targets}
                if targets is not None
                else {"resources": resources or [self.proposal()]}
            ),
        }
        payload.update(changes)
        return self.f.sign(payload, author), payload["stableOperationId"]

    def apply(self, packet, *, revoke=False):
        return self.service.command(
            UID, self.f.vault, identities.CONNECTION, *packet, revoke=revoke
        )

    def revoke_target(self):
        p = self.state()["consent"]["permissions"][0]
        return {
            "permissionId": p["permissionId"],
            "ref": p["ref"],
            "expectedPermissionEpoch": p["permissionEpoch"],
        }

    def test_root_approval_returns_detached_policy_and_original_control_receipt(self):
        packet = self.command()
        result = self.apply(packet)
        self.assertEqual(result["consent"]["permissions"][0]["fromRevision"], 3)
        receipt = self.service.receipt(UID, self.f.vault, identities.CONNECTION, packet[1])
        self.assertEqual(receipt["command"], packet[0])
        self.assertEqual(receipt["sourceStates"][0]["currentRevision"], 3)
        self.assertEqual(receipt["consent"], result["consent"])
        result["consent"]["permissions"].clear()
        self.assertEqual(len(self.state()["consent"]["permissions"]), 1)
        self.assertNotIn("grant", result)

    def test_bounded_device_cannot_issue_indefinite_approval(self):
        self.rejects(
            "key_authorization_required", lambda: self.apply(self.command(author="device_sig"))
        )
        self.assertIsNone(self.state()["consent"])

    def test_normal_version_updates_do_not_change_policy_or_require_another_control(self):
        result = self.apply(self.command())
        self.catalogue.revision = 4
        self.assertEqual(self.state()["consent"], result["consent"])
        self.assertEqual(self.catalogue.calls, 1)

    def test_exact_retry_uses_original_receipt_without_source_rpc_even_after_expiry(self):
        packet = self.command()
        first = self.apply(packet)
        self.now = 1400
        self.catalogue.unavailable = True
        self.assertEqual(self.apply(packet), first)
        self.assertEqual(self.catalogue.calls, 1)

    def test_unknown_outcome_retry_cannot_revive_revoked_resource(self):
        packet = self.command()
        first = self.apply(packet)
        revoked = self.apply(self.command(targets=[self.revoke_target()]), revoke=True)
        self.assertEqual(self.apply(packet), first)
        self.assertEqual(self.state()["consent"], revoked["consent"])
        self.rejects(
            "version_conflict", lambda: self.apply(self.command(resources=[self.proposal(epoch=2)]))
        )
        self.assertEqual(len(self.state()["operations"]), 2)

    def test_per_resource_revocation_keeps_other_resource_identical(self):
        first = self.apply(
            self.command(
                resources=[self.proposal(), self.proposal(ref=self.b, ident="permission_B")]
            )
        )
        other = first["consent"]["permissions"][1]
        revoked = self.apply(
            self.command(targets=[self.revoke_target()], author="device_sig"), revoke=True
        )
        self.assertEqual(revoked["consent"]["permissions"][1], other)
        self.assertEqual(revoked["consent"]["permissions"][0]["permissionEpoch"], 2)

    def test_new_consent_id_cannot_reset_current_or_revoked_slot(self):
        self.apply(self.command())
        self.apply(self.command(targets=[self.revoke_target()]), revoke=True)
        self.rejects(
            "recipient_binding_mismatch",
            lambda: self.apply(self.command(consentId="new_consent_id")),
        )

    def test_stale_revision_digest_and_same_operation_collision_reject_without_partial_state(self):
        self.rejects(
            "version_conflict", lambda: self.apply(self.command(resources=[self.proposal(floor=2)]))
        )
        self.assertIsNone(self.state()["consent"])
        packet = self.command()
        result = self.apply(packet)
        self.rejects(
            "version_conflict", lambda: self.apply(self.command(expectedConsentDigest="a" * 64))
        )
        self.rejects(
            "idempotency_conflict", lambda: self.apply(self.command(stableOperationId=packet[1]))
        )
        self.assertEqual(self.state()["consent"], result["consent"])

    def test_owner_boundary_and_invalid_signatures_cannot_commit(self):
        packet = self.command()
        self.rejects(
            "not_found",
            lambda: self.service.command(OTHER_UID, self.f.vault, identities.CONNECTION, *packet),
        )
        damaged = copy.deepcopy(packet[0])
        damaged["signature"] = "A" * 86
        self.rejects("invalid_signature", lambda: self.apply((damaged, packet[1])))
        self.assertIsNone(self.state()["consent"])
        self.assertIsNone(
            self.store.transact(
                lambda u: u.get(operation_path(self.f.owner, self.f.vault, packet[1]))
            )
        )

    def test_source_fence_blocks_approval_but_not_revocation_or_original_receipt(self):
        packet = self.command()
        result = self.apply(packet)
        FenceService(self.store, clock=lambda: self.now).invalidate(
            {
                "contractVersion": CONTRACT_VERSION,
                "ownerSubject": self.f.owner,
                "mutationId": "synthetic_resource_disconnect_01",
                "ref": self.a,
                "expectedSourceEpoch": 1,
                "newSourceEpoch": 2,
                "reason": "disconnected",
            },
            source_service="portfolio",
        )
        self.assertEqual(self.apply(packet), result)
        self.rejects(
            "version_conflict", lambda: self.apply(self.command(resources=[self.proposal(epoch=1)]))
        )
        self.catalogue.unavailable = True
        self.assertEqual(
            self.apply(self.command(targets=[self.revoke_target()]), revoke=True)["consent"][
                "permissions"
            ][0]["status"],
            "revoked",
        )

    def test_approval_budget_reserves_all_narrowing_operations(self):
        self.apply(self.command())
        for _ in range(63):
            self.apply(self.command(resources=[self.proposal(epoch=1)]))
        self.rejects(
            "version_conflict", lambda: self.apply(self.command(resources=[self.proposal(epoch=1)]))
        )
        revoked = self.apply(self.command(targets=[self.revoke_target()]), revoke=True)
        self.assertEqual(revoked["consent"]["permissions"][0]["status"], "revoked")
        self.assertEqual(len(self.state()["operations"]), 65)

    def test_tampered_stored_counters_fail_unavailable(self):
        self.apply(self.command())
        path = consent_path(self.f.owner, self.f.vault, identities.CONNECTION)
        row = self.store.transact(lambda u: u.get(path))
        row["approvalCount"] += 1
        self.store.transact(lambda u: u.put(path, row))
        with self.assertRaises(StoreUnavailable):
            self.state()

    def test_current_agent_key_revocation_blocks_approval_but_not_root_narrowing(self):
        self.apply(self.command())
        self.now = 1100
        old = self.f.registry
        bundle = self.f.make_bundle(
            previous=old,
            revoked=("A1_sig", "A1_enc"),
            issued_at=self.now,
        )
        self.vaults.update_registry(
            UID,
            self.f.vault,
            {"contractVersion": CONTRACT_VERSION, "expectedVersion": 2, "registryBundle": bundle},
            "synthetic_revoke_agent_keys_01",
        )
        self.f.registry = self.f.verify(bundle, previous=old, now=self.now)
        self.rejects(
            "key_authorization_required",
            lambda: self.apply(self.command(resources=[self.proposal(epoch=1)])),
        )
        result = self.apply(self.command(targets=[self.revoke_target()]), revoke=True)
        self.assertEqual(result["consent"]["permissions"][0]["status"], "revoked")

    def test_parent_disconnect_preserves_history_and_allows_explicit_narrowing(self):
        from app.oauth import OwnerConnectionService

        packet = self.command()
        original = self.apply(packet)
        OwnerConnectionService(self.store).revoke_connection(UID, identities.CONNECTION)
        self.assertTrue(self.state()["parentRevoked"])
        self.assertEqual(self.apply(packet), original)
        calls = self.catalogue.calls
        self.rejects(
            "key_authorization_required",
            lambda: self.apply(self.command(resources=[self.proposal(epoch=1)])),
        )
        self.assertEqual(self.catalogue.calls, calls)
        self.assertEqual(
            self.apply(self.command(targets=[self.revoke_target()]), revoke=True)["consent"][
                "permissions"
            ][0]["status"],
            "revoked",
        )


class FirestoreResourceConsentTests(ResourceConsentStoreTests):
    make_store = identities.FirestorePersistentAgentTests.make_store

    def test_cas_loser_does_not_overwrite_winning_policy_or_create_receipt(self):
        losing = self.command()
        winner = self.command()
        result = []

        def race():
            def commit():
                self.rpc.before_abort = None
                result.append(self.apply(winner))

            self.rpc.aborts, self.rpc.before_abort = 1, commit

        self.catalogue.callback = race
        self.rejects("version_conflict", lambda: self.apply(losing))
        self.assertEqual(self.state()["consent"], result[0]["consent"])
        self.assertIsNone(
            self.store.transact(
                lambda u: u.get(operation_path(self.f.owner, self.f.vault, losing[1]))
            )
        )

    def test_source_invalidation_wins_against_approval_commit(self):
        packet = self.command()

        def race():
            def invalidate():
                self.rpc.before_abort = None
                FenceService(self.store, clock=lambda: self.now).invalidate(
                    {
                        "contractVersion": CONTRACT_VERSION,
                        "ownerSubject": self.f.owner,
                        "mutationId": "synthetic_fence_racing_approval",
                        "ref": self.a,
                        "expectedSourceEpoch": 1,
                        "newSourceEpoch": 2,
                        "reason": "disconnected",
                    },
                    source_service="portfolio",
                )

            self.rpc.aborts, self.rpc.before_abort = 1, invalidate

        self.catalogue.callback = race
        self.rejects("version_conflict", lambda: self.apply(packet))
        self.assertIsNone(self.state()["consent"])
        self.assertIsNone(
            self.store.transact(
                lambda u: u.get(operation_path(self.f.owner, self.f.vault, packet[1]))
            )
        )

    def test_exact_concurrent_approval_returns_the_winner_receipt(self):
        packet = self.command()
        result = []

        def race():
            def commit():
                self.rpc.before_abort = None
                result.append(self.apply(packet))

            self.rpc.aborts, self.rpc.before_abort = 1, commit

        self.catalogue.callback = race
        self.assertEqual(self.apply(packet), result[0])
        self.assertEqual(len(self.state()["operations"]), 1)
