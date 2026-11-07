"""Logical-resource policy with real in-memory owner signatures; no service or secrets."""

import copy
import unittest

from test_encrypted_authority import AuthorityFixture

from folioview_shared.encrypted.authority import VerifiedGrant
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_SAFE_INTEGER
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_agents import (
    PERSISTENT_AGENT_PROFILE,
    initial_agent_identity,
    revoke_agent_identity,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.resource_consents import (
    RESOURCE_CONSENT_PROFILE,
    approve_resource_consent,
    check_resource_consent,
    load_resource_consent_schema,
    resource_consent_digest,
    revoke_resource_consent,
    validate_resource_consent_schema,
)
from folioview_shared.encrypted.schema import validate_schema

_UNSET = object()


class ResourceConsentTests(unittest.TestCase):
    def setUp(self):
        self.f = AuthorityFixture()
        self.context = {
            "registry": self.f.registry,
            "owner_subject": self.f.owner,
            "vault_id": self.f.vault,
            "connection_id": "connection_A1",
            "client_id": "muse_synthetic",
        }
        self.binding = {
            **self.f.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": self.f.root_id,
            "connectionId": "connection_A1",
            "agentId": "A1",
            "clientId": "muse_synthetic",
            "identityEpoch": 1,
            "agentSigningKeyId": self.f.kid("A1_sig"),
            "agentEncryptionKeyId": self.f.kid("A1_enc"),
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "stableOperationId": "identity_operation_0000001",
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": 950,
        }
        verified = verify_agent_identity_binding(
            self.f.sign(self.binding), agent_id="A1", now=1000, **self.context
        )
        self.identity = initial_agent_identity(verified)
        self.a = copy.deepcopy(self.f.resource)
        self.b = {**self.a, "resourceId": "holdings_B", "incarnation": "incarnation_B"}
        self.source_a = self.source(self.a, 3)
        self.source_b = self.source(self.b, 7)
        self.current = self.approve([self.proposal()], current=None, states=[self.source_a])

    def source(self, ref, revision, epoch=1, state="active"):
        return {
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "ref": copy.deepcopy(ref),
            "sourceEpoch": epoch,
            "currentRevision": revision,
            "state": state,
        }

    def proposal(self, permission_id="permission_A", ref=None, revision=3, history=None, epoch=0):
        return {
            "permissionId": permission_id,
            "ref": copy.deepcopy(self.a if ref is None else ref),
            "sourceEpoch": 1,
            "fromRevision": revision,
            "versionPolicy": "current_and_future",
            "selectedHistory": [] if history is None else history,
            "expectedPermissionEpoch": epoch,
        }

    def control(self, artifact, current, now=1000, **changes):
        reg = self.context["registry"]
        result = {
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
            "consentId": "consent_A",
            "purpose": "analysis",
            "artifactType": artifact,
            "authorKeyId": self.f.root_id
            if artifact == "persistent_resource_approval"
            else self.f.kid("device_sig"),
            "stableOperationId": "consent_operation_00000001",
            "expectedVersion": current["version"] if current else 0,
            "expectedConsentDigest": resource_consent_digest(current) if current else None,
            "issuedAt": now,
            "registrySequence": reg.registry_sequence,
            "checkpointDigest": reg.checkpoint_digest,
            "keyEpoch": reg.key_epoch,
        }
        return {**result, **changes}

    def approve(
        self, resources=None, *, current=_UNSET, states=None, now=1000, changes=None, **context
    ):
        current = self.current if current is _UNSET else current
        payload = self.control(
            "persistent_resource_approval",
            current,
            now,
            resources=resources or [self.proposal()],
            **(changes or {}),
        )
        return approve_resource_consent(
            self.f.sign(payload, "root"),
            root_jwk=self.f.root_public,
            current_consent=current,
            current_identity=self.identity,
            source_states=states or [self.source_a],
            consent_id="consent_A",
            now=now,
            **{**self.context, **context},
        )

    def revoke(self, targets=None, *, current=_UNSET, now=1000, changes=None):
        current = self.current if current is _UNSET else current
        targets = targets or [
            {"permissionId": "permission_A", "ref": self.a, "expectedPermissionEpoch": 1}
        ]
        payload = self.control(
            "persistent_resource_revocation", current, now, targets=targets, **(changes or {})
        )
        return revoke_resource_consent(
            self.f.sign(payload),
            root_jwk=self.f.root_public,
            current_consent=current,
            current_identity=self.identity,
            consent_id="consent_A",
            now=now,
            **self.context,
        )

    def read(
        self,
        *,
        current=_UNSET,
        identity=None,
        source=None,
        revision=3,
        permission_id="permission_A",
        permission_epoch=1,
        ref=None,
        source_epoch=1,
        purpose="analysis",
        now=1000,
        **context,
    ):
        current = self.current if current is _UNSET else current
        return check_resource_consent(
            current_consent=current,
            current_identity=identity or self.identity,
            current_source=source or self.source_a,
            consent_id="consent_A",
            permission_id=permission_id,
            permission_epoch=permission_epoch,
            resource_ref=self.a if ref is None else ref,
            source_epoch=source_epoch,
            revision=revision,
            purpose=purpose,
            now=now,
            **{**self.context, **context},
        )

    def test_normal_versions_reuse_permission_without_new_owner_signature_or_task_selection(self):
        before = copy.deepcopy(self.current)
        first = self.read()
        self.read(source=self.source(self.a, 5), revision=4)
        self.read(source=self.source(self.a, 5), revision=5)
        self.assertEqual(self.current, before)
        self.assertEqual(first.permission_epoch, 1)
        self.assertNotIsInstance(first, VerifiedGrant)
        for field in ("expiresAt", "familyId", "taskId", "taskVersion", "oauthToken", "runId"):
            self.assertNotIn(field, self.current)

    def test_new_permission_does_not_implicitly_include_old_history_or_an_uncommitted_future(self):
        for revision in (1, 2, 4):
            with self.subTest(revision=revision), self.assertRaises(ContractError):
                self.read(revision=revision)
        current = self.approve([self.proposal(history=[1])], current=None)
        self.read(current=current, revision=1)
        with self.assertRaises(ContractError):
            self.read(current=current, revision=2)

    def test_history_expansion_is_explicit_additive_and_fences_only_that_permission(self):
        self.current = self.approve(
            [self.proposal("permission_B", self.b, 7)], states=[self.source_b]
        )
        old_b = copy.deepcopy(self.current["permissions"][1])
        expanded = self.approve(
            [self.proposal(history=[1], epoch=1)], states=[self.source(self.a, 5)]
        )
        self.assertEqual(expanded["permissions"][0]["fromRevision"], 3)
        self.assertEqual(expanded["permissions"][1], old_b)
        self.read(current=expanded, revision=1, permission_epoch=2)
        with self.assertRaises(ContractError):
            self.read(current=expanded)
        self.read(
            current=expanded,
            permission_id="permission_B",
            ref=self.b,
            source=self.source_b,
            revision=7,
        )
        with self.assertRaises(ContractError):
            self.approve([self.proposal(history=[], epoch=2)], current=expanded)

    def test_adding_a_resource_or_reapproving_same_scope_keeps_unrelated_fences(self):
        old = copy.deepcopy(self.current["permissions"][0])
        updated = self.approve([self.proposal("permission_B", self.b, 7)], states=[self.source_b])
        self.assertEqual(updated["permissions"][0], old)
        self.assertEqual(updated["version"], 2)
        self.read(current=updated)
        noop = self.approve(
            [self.proposal(epoch=1)], current=updated, states=[self.source(self.a, 4)]
        )
        self.assertEqual(noop["permissions"], updated["permissions"])

    def test_partial_revocation_preserves_other_resource_access_and_prior_state(self):
        self.current = self.approve(
            [self.proposal("permission_B", self.b, 7)], states=[self.source_b]
        )
        before = copy.deepcopy(self.current)
        revoked = self.revoke()
        self.assertEqual(self.current, before)
        self.assertEqual(revoked["permissions"][0]["permissionEpoch"], 2)
        with self.assertRaises(ContractError):
            self.read(current=revoked)
        self.read(
            current=revoked,
            permission_id="permission_B",
            ref=self.b,
            source=self.source_b,
            revision=7,
        )

    def test_old_controls_or_permission_ids_cannot_revive_a_revoked_permission(self):
        self.current = self.revoke()
        for proposal in (self.proposal(epoch=0), self.proposal(epoch=2)):
            with self.subTest(proposal=proposal), self.assertRaises(ContractError):
                self.approve([proposal])
        with self.assertRaises(ContractError):
            self.revoke()
        with self.assertRaises(ContractError):
            self.read(permission_epoch=2)
        renewed = self.approve(
            [self.proposal("permission_A_new", revision=5)], states=[self.source(self.a, 5)]
        )
        self.assertEqual(len(renewed["permissions"]), 2)
        self.read(
            current=renewed,
            permission_id="permission_A_new",
            source=self.source(self.a, 5),
            revision=5,
        )
        with self.assertRaises(ContractError):
            self.read(current=renewed, source=self.source(self.a, 5), revision=5)
        with self.assertRaises(ContractError):
            self.read(current=renewed, permission_id="permission_A_new", revision=3)

    def test_active_ref_cannot_be_duplicated_or_rebound_to_old_history_or_another_incarnation(self):
        for item in (
            self.proposal("other_id"),
            self.proposal(epoch=1, revision=2),
            self.proposal(ref={**self.a, "incarnation": "new_incarnation"}, epoch=1),
        ):
            state = self.source(item["ref"], 3)
            with self.subTest(item=item), self.assertRaises(ContractError):
                self.approve([item], states=[state])

    def test_source_epoch_status_and_incarnation_are_rechecked_for_every_read(self):
        for state in (
            self.source(self.a, 4, epoch=2),
            self.source(self.a, 4, state="revoking"),
            self.source(self.a, 4, state="disconnected"),
            self.source(self.a, 4, state="deleted"),
            self.source(self.a, None, epoch=None, state="unavailable"),
            self.source({**self.a, "incarnation": "replaced"}, 4),
        ):
            with self.subTest(state=state), self.assertRaises(ContractError):
                self.read(source=state)
        with self.assertRaises(ContractError):
            self.read(source_epoch=2, source=self.source(self.a, 4, epoch=2))

    def test_unavailable_inactive_or_stale_sources_never_establish_a_new_permission(self):
        for state in (
            self.source(self.a, None, epoch=None, state="unavailable"),
            self.source(self.a, 3, state="deleted"),
            self.source(self.a, 4),
            self.source(self.a, 3, epoch=2),
            self.source(self.a, None),
        ):
            with self.subTest(state=state), self.assertRaises(ContractError):
                self.approve(current=None, states=[state])
        for field in ("ownerSubject", "vaultId"):
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.approve(current=None, states=[{**self.source_a, field: "other"}])

    def test_aggregate_cas_digest_and_monotonic_time_prevent_stale_or_tampered_updates(self):
        for changes in (
            {"expectedVersion": 0},
            {"expectedConsentDigest": None},
            {"expectedConsentDigest": "a" * 64},
            {"consentId": "other"},
            {"issuedAt": 999},
            {"issuedAt": 1001},
            {"issuedAt": 699},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.approve([self.proposal(epoch=1)], changes=changes)
        payload = self.control(
            "persistent_resource_approval",
            self.current,
            resources=[self.proposal("permission_B", self.b, 7)],
        )
        self.current = self.approve([self.proposal(epoch=1)])
        with self.assertRaises(ContractError):
            approve_resource_consent(
                self.f.sign(payload, "root"),
                root_jwk=self.f.root_public,
                current_consent=self.current,
                current_identity=self.identity,
                source_states=[self.source_b],
                consent_id="consent_A",
                now=1000,
                **self.context,
            )

    def test_current_parent_identity_and_keys_fence_all_resource_permissions(self):
        control = {
            **self.binding,
            "artifactType": "persistent_agent_revoke",
            "stableOperationId": "identity_revocation_0000001",
            "bindingFingerprint": self.identity["bindingFingerprint"],
            "issuedAt": 1000,
        }
        revoked = revoke_agent_identity(
            self.f.sign(control), current_identity=self.identity, now=1000, **self.context
        )
        with self.assertRaises(ContractError):
            self.read(identity=revoked)
        for name in ("A1_sig", "A1_enc"):
            reg = self.f.verify(self.f.make_bundle(revoked=(name,)))
            with self.subTest(name=name), self.assertRaises(ContractError):
                self.read(registry=reg)
        with self.assertRaises(ContractError):
            self.read(now=5000)
        for field, value in {
            "identityEpoch": 2,
            "bindingFingerprint": "a" * 64,
            "agentId": "A2",
            "clientId": "other",
        }.items():
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.read(identity={**self.identity, field: value})

    def test_consent_survives_original_owner_device_expiry_but_agent_expiry_blocks_use(self):
        self.f.certificates["device_sig"]["expiresAt"] = 1100
        reg = self.f.verify(self.f.make_bundle())
        self.read(registry=reg, now=2000)
        with self.assertRaises(ContractError):
            self.read(registry=reg, now=5000)

    def test_owner_can_revoke_when_agent_keys_are_expired_or_revoked_and_source_is_offline(self):
        for name in ("A1_sig", "A1_enc"):
            self.context["registry"] = self.f.verify(self.f.make_bundle(revoked=(name,)))
            self.assertEqual(self.revoke()["permissions"][0]["status"], "revoked")
        self.context["registry"] = self.f.registry
        self.f.certificates["A1_sig"]["expiresAt"] = 1100
        self.context["registry"] = self.f.verify(self.f.make_bundle())
        self.assertEqual(self.revoke(now=2000)["permissions"][0]["status"], "revoked")

    def test_root_approval_does_not_reinterpret_bounded_device_grant_authority(self):
        # Even a device with all legacy capabilities cannot issue this profile.
        payload = self.control(
            "persistent_resource_approval",
            self.current,
            authorKeyId=self.f.kid("device_sig"),
            resources=[self.proposal(epoch=1)],
        )
        with self.assertRaises(ContractError):
            approve_resource_consent(
                self.f.sign(payload),
                root_jwk=self.f.root_public,
                current_consent=self.current,
                current_identity=self.identity,
                source_states=[self.source_a],
                consent_id="consent_A",
                now=1000,
                **self.context,
            )
        self.f.certificates["device_sig"]["capabilities"] = ["control_write"]
        self.context["registry"] = self.f.verify(self.f.make_bundle())
        self.approve([self.proposal(epoch=1)])
        self.assertEqual(self.revoke()["permissions"][0]["status"], "revoked")

    def test_root_can_approve_and_revoke_after_owner_device_expiry(self):
        self.f.certificates["device_sig"]["expiresAt"] = 1100
        self.context["registry"] = self.f.verify(self.f.make_bundle())
        self.current = self.approve(
            [self.proposal("permission_B", self.b, 7)], states=[self.source_b], now=2000
        )
        payload = self.control(
            "persistent_resource_revocation",
            self.current,
            now=2000,
            authorKeyId=self.f.root_id,
            targets=[{"permissionId": "permission_A", "ref": self.a, "expectedPermissionEpoch": 1}],
        )
        result = revoke_resource_consent(
            self.f.sign(payload, "root"),
            root_jwk=self.f.root_public,
            current_consent=self.current,
            current_identity=self.identity,
            consent_id="consent_A",
            now=2000,
            **self.context,
        )
        self.read(
            current=result,
            permission_id="permission_B",
            ref=self.b,
            source=self.source_b,
            revision=7,
            now=2000,
        )
        with self.assertRaises(ContractError):
            self.revoke(now=2000)

    def test_public_root_and_author_selector_cannot_be_substituted(self):
        payload = self.control(
            "persistent_resource_approval", self.current, resources=[self.proposal(epoch=1)]
        )
        with self.assertRaises(ContractError):
            approve_resource_consent(
                self.f.sign(payload, "root"),
                root_jwk=AuthorityFixture().root_public,
                current_consent=self.current,
                current_identity=self.identity,
                source_states=[self.source_a],
                consent_id="consent_A",
                now=1000,
                **self.context,
            )
        with self.assertRaises(ContractError):
            self.approve(
                [self.proposal(epoch=1)], changes={"authorKeyId": self.f.kid("device_sig")}
            )
        with self.assertRaises(ContractError):
            revoke_resource_consent(
                self.f.sign(
                    self.control(
                        "persistent_resource_revocation",
                        self.current,
                        targets=[
                            {
                                "permissionId": "permission_A",
                                "ref": self.a,
                                "expectedPermissionEpoch": 1,
                            }
                        ],
                    )
                ),
                root_jwk=AuthorityFixture().root_public,
                current_consent=self.current,
                current_identity=self.identity,
                consent_id="consent_A",
                now=1000,
                **self.context,
            )

    def test_user_resource_kinds_use_the_same_committed_normal_version_policy(self):
        for kind in ("watchlist", "channel_follows"):
            ref = {
                "kind": kind,
                "sourceService": "user",
                "resourceId": "user_resource",
                "incarnation": "user_incarnation",
            }
            consent = self.approve(
                [self.proposal("permission_user", ref, 4)],
                current=None,
                states=[self.source(ref, 4)],
            )
            self.read(
                current=consent,
                permission_id="permission_user",
                ref=ref,
                source=self.source(ref, 5),
                revision=5,
            )
            with self.assertRaises(ContractError):
                self.read(
                    current=consent,
                    permission_id="permission_user",
                    ref=ref,
                    source=self.source(ref, 5),
                    revision=3,
                )

    def test_cross_owner_vault_connection_client_and_root_are_not_interchangeable(self):
        for context in (
            {"owner_subject": "other"},
            {"vault_id": "other"},
            {"connection_id": "other"},
            {"client_id": "other"},
            {"registry": AuthorityFixture().registry},
        ):
            with self.subTest(context=list(context)), self.assertRaises(ContractError):
                self.read(**context)
        for field in ("ownerSubject", "vaultId", "connectionId", "clientId", "rootKeyId"):
            value = "A" * 43 if field == "rootKeyId" else "other"
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.approve([self.proposal(epoch=1)], changes={field: value})

    def test_wrong_signers_bad_signatures_and_noncurrent_registry_controls_fail(self):
        payload = self.control(
            "persistent_resource_approval", self.current, resources=[self.proposal(epoch=1)]
        )
        for signer in ("A1_sig", "device_sig"):
            with self.subTest(signer=signer), self.assertRaises(ContractError):
                approve_resource_consent(
                    self.f.sign(payload, signer),
                    root_jwk=self.f.root_public,
                    current_consent=self.current,
                    current_identity=self.identity,
                    source_states=[self.source_a],
                    consent_id="consent_A",
                    now=1000,
                    **self.context,
                )
        for changes in ({"registrySequence": 2}, {"checkpointDigest": "a" * 64}, {"keyEpoch": 2}):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.approve([self.proposal(epoch=1)], changes=changes)
        signed = self.f.sign(payload, "root")
        signed["signature"] = "A" * 86
        with self.assertRaises(ContractError):
            approve_resource_consent(
                signed,
                root_jwk=self.f.root_public,
                current_consent=self.current,
                current_identity=self.identity,
                source_states=[self.source_a],
                consent_id="consent_A",
                now=1000,
                **self.context,
            )

    def test_lists_are_unique_canonical_bounded_and_fail_without_partial_mutation(self):
        before = copy.deepcopy(self.current)
        bad = self.proposal("permission_B", self.b, 7)
        for resources, sources in [
            ([self.proposal(epoch=1), self.proposal(epoch=1)], [self.source_a]),
            ([bad], [self.source_b, self.source_b]),
            ([bad, self.proposal("permission_bad", self.a, 2)], [self.source_a, self.source_b]),
            ([bad], [self.source_a]),
        ]:
            with self.subTest(resources=resources), self.assertRaises(ContractError):
                self.approve(resources, states=sources)
        self.assertEqual(self.current, before)
        for history in ([2, 1], [1, 1], [3], list(range(1, 52))):
            with self.subTest(history=history), self.assertRaises(ContractError):
                self.approve([self.proposal(history=history, epoch=1)])

    def test_revoke_matches_exact_target_and_epoch_without_affecting_other_records(self):
        for target in (
            {"permissionId": "unknown", "ref": self.a, "expectedPermissionEpoch": 1},
            {"permissionId": "permission_A", "ref": self.b, "expectedPermissionEpoch": 1},
            {"permissionId": "permission_A", "ref": self.a, "expectedPermissionEpoch": 2},
        ):
            with self.subTest(target=target), self.assertRaises(ContractError):
                self.revoke([target])
        target = {"permissionId": "permission_A", "ref": self.a, "expectedPermissionEpoch": 1}
        with self.assertRaises(ContractError):
            self.revoke([target, target])
        with self.assertRaises(ContractError):
            self.revoke(current=None)

    def test_integer_overflow_and_bool_arguments_do_not_create_new_generations(self):
        oversized = copy.deepcopy(self.current)
        oversized["version"] = MAX_SAFE_INTEGER
        with self.assertRaises(ContractError):
            self.approve([self.proposal(epoch=1)], current=oversized)
        oversized = copy.deepcopy(self.current)
        oversized["permissions"][0]["permissionEpoch"] = MAX_SAFE_INTEGER
        with self.assertRaises(ContractError):
            self.approve([self.proposal(history=[1], epoch=MAX_SAFE_INTEGER)], current=oversized)
        with self.assertRaises(ContractError):
            self.revoke(
                [
                    {
                        "permissionId": "permission_A",
                        "ref": self.a,
                        "expectedPermissionEpoch": MAX_SAFE_INTEGER,
                    }
                ],
                current=oversized,
            )
        for changes in (
            {"revision": True},
            {"permission_epoch": True},
            {"source_epoch": True},
            {"now": True},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.read(**changes)

    def test_capacity_limits_keep_revocation_tombstones_instead_of_evicting_them(self):
        current = copy.deepcopy(self.current)
        tombstone = copy.deepcopy(self.revoke()["permissions"][0])
        for index in range(31):
            current["permissions"].append({**tombstone, "permissionId": f"retired_{index:02d}"})
        current["permissions"].sort(key=lambda item: item["permissionId"])
        with self.assertRaises(ContractError):
            self.approve(
                [self.proposal("permission_B", self.b, 7)], current=current, states=[self.source_b]
            )
        current = copy.deepcopy(self.current)
        for index in range(9):
            current["permissions"].append(
                {
                    **copy.deepcopy(current["permissions"][0]),
                    "permissionId": f"active_{index}",
                    "ref": {**self.a, "resourceId": f"other_{index}"},
                }
            )
        current["permissions"].sort(key=lambda item: item["permissionId"])
        with self.assertRaises(ContractError):
            self.approve(
                [self.proposal("permission_B", self.b, 7)], current=current, states=[self.source_b]
            )

    def test_closed_opt_in_profile_cannot_be_a_legacy_grant_or_widen_purpose(self):
        for field in (
            "privateJwk",
            "prf",
            "refresh_token",
            "expiresAt",
            "oauthFamilyId",
            "taskVersions",
            "capabilities",
        ):
            with self.subTest(field=field), self.assertRaises(ContractError):
                validate_resource_consent_schema(
                    "PersistentResourceConsent", {**self.current, field: "UNEXPECTED"}
                )
        for purpose in ("trade", "export", "research", ""):
            with self.subTest(purpose=purpose), self.assertRaises(ContractError):
                self.approve([self.proposal(epoch=1)], changes={"purpose": purpose})
        with self.assertRaises(ContractError):
            self.read(purpose="export")
        with self.assertRaises(ContractError):
            validate_schema("AgentKeyGrantPayload", self.current)
        with self.assertRaises(ContractError):
            validate_resource_consent_schema("PersistentResourceConsent", self.f.grant())

    def test_detached_schema_state_and_decision_do_not_alias_caller_inputs_or_leak_errors(self):
        record = copy.deepcopy(self.current)
        decision = self.read(current=record)
        record["permissions"][0]["ref"]["resourceId"] = "changed"
        self.assertEqual(decision.resource_ref["resourceId"], self.a["resourceId"])
        with self.assertRaises(TypeError):
            decision.resource_ref["resourceId"] = "changed"
        schema = load_resource_consent_schema("PersistentResourceConsent")
        schema["$defs"]["PersistentResourceConsent"]["additionalProperties"] = True
        for name in ("Identifier", "../secret", [], None):
            with self.subTest(name=name), self.assertRaises(ContractError):
                load_resource_consent_schema(name)
        with self.assertRaises(ContractError) as caught:
            validate_resource_consent_schema(
                "PersistentResourceConsent", {"PRIVATE_SENTINEL": "do not echo"}
            )
        self.assertNotIn("PRIVATE_SENTINEL", str(caught.exception))
        with self.assertRaises(ContractError):
            validate_resource_consent_schema(
                "PersistentResourceConsent", {**self.current, "consentId": "x" * 70000}
            )


if __name__ == "__main__":
    unittest.main()
