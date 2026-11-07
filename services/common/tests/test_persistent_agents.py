"""Persistent identity separation and recovery use only in-memory synthetic keys."""

import copy
import unittest

from test_encrypted_authority import AuthorityFixture

from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_SAFE_INTEGER
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_agents import (
    PERSISTENT_AGENT_PROFILE,
    initial_agent_identity,
    load_persistent_schema,
    revoke_agent_identity,
    validate_persistent_schema,
    verify_agent_identity_binding,
    verify_agent_session_proof,
)
from folioview_shared.encrypted.schema import validate_schema


class PersistentAgentTests(unittest.TestCase):
    def setUp(self):
        self.f = AuthorityFixture()
        self.expected = {
            "registry": self.f.registry,
            "owner_subject": self.f.owner,
            "vault_id": self.f.vault,
            "connection_id": "connection_A1",
            "client_id": "muse_synthetic",
            "now": 1000,
        }
        self.binding_payload = {
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
            "keyEpoch": self.f.registry.key_epoch,
            "issuedAt": 950,
        }
        self.binding = self.verify_binding()
        self.identity = initial_agent_identity(self.binding)
        self.challenge = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PERSISTENT_AGENT_PROFILE,
            "purpose": "resume_session",
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
            "challengeId": "challenge_operation_0000001",
            "audience": "https://hub.example.test/api/v2",
            "nonce": "A" * 43,
            "issuedAt": 1000,
            "expiresAt": 1120,
        }

    def verify_binding(self, payload=None, **changes):
        return verify_agent_identity_binding(
            self.f.sign(payload or self.binding_payload),
            **{**self.expected, "agent_id": "A1", **changes},
        )

    def proof(self, payload=None, challenge=None, **changes):
        challenge = challenge or self.challenge
        payload = payload or {**challenge, "artifactType": "persistent_agent_session_proof"}
        signed = self.f.sign(payload, "A1_sig")
        return verify_agent_session_proof(
            signed,
            current_identity=self.identity,
            challenge=challenge,
            challenge_used=False,
            audience=self.challenge["audience"],
            **{**self.expected, **changes},
        )

    def revocation(self):
        return {
            **self.binding_payload,
            "artifactType": "persistent_agent_revoke",
            "stableOperationId": "revocation_operation_000001",
            "bindingFingerprint": self.identity["bindingFingerprint"],
            "issuedAt": 1000,
        }

    def test_enrollment_and_resume_retain_identity_without_oauth_or_content_authority(self):
        result = self.proof()
        self.assertEqual(result["connectionId"], self.identity["connectionId"])
        self.assertEqual(result["bindingFingerprint"], self.binding.fingerprint)
        self.assertEqual(
            self.binding.fingerprint, signing_input_fingerprint(self.f.sign(self.binding_payload))
        )
        for field in (
            "expiresAt",
            "familyId",
            "refreshToken",
            "scopes",
            "resourceBindings",
            "taskId",
        ):
            self.assertNotIn(field, self.identity)
        before = copy.deepcopy(self.identity)
        later = {
            **self.challenge,
            "challengeId": "challenge_operation_0000002",
            "issuedAt": 2000,
            "expiresAt": 2120,
        }
        self.proof(challenge=later, now=2000)
        self.assertEqual(self.identity, before)

    def test_resume_does_not_require_the_original_owner_device_to_stay_unexpired(self):
        self.f.certificates["device_sig"]["expiresAt"] = 1100
        reg = self.f.verify(self.f.make_bundle())
        later = {**self.challenge, "issuedAt": 2000, "expiresAt": 2120}
        self.proof(challenge=later, registry=reg, now=2000)

    def test_current_registry_and_approved_agent_pair_are_required_at_enrollment(self):
        for key, value in {
            "ownerSubject": "other_owner",
            "vaultId": "other_vault",
            "rootKeyId": "A" * 43,
            "connectionId": "connection_A2",
            "agentId": "A2",
            "clientId": "other_client",
            "identityEpoch": 2,
            "agentSigningKeyId": self.f.kid("A2_sig"),
            "agentEncryptionKeyId": self.f.kid("A2_enc"),
            "registrySequence": 2,
            "checkpointDigest": "a" * 64,
            "keyEpoch": 2,
            "deviceSigningKeyId": self.f.kid("A1_sig"),
        }.items():
            with self.subTest(key=key), self.assertRaises(ContractError):
                self.verify_binding({**self.binding_payload, key: value})

    def test_stale_future_or_backdated_owner_controls_are_rejected(self):
        for issued in (0, 699, 1001):
            with self.subTest(issued=issued), self.assertRaises(ContractError):
                self.verify_binding({**self.binding_payload, "issuedAt": issued})

    def test_owner_enrollment_is_not_an_agent_signature_or_unsigned_dto(self):
        for signer in ("A1_sig", "root"):
            with self.subTest(signer=signer), self.assertRaises(ContractError):
                verify_agent_identity_binding(
                    self.f.sign(self.binding_payload, signer), agent_id="A1", **self.expected
                )
        with self.assertRaises(ContractError):
            initial_agent_identity(self.binding_payload)
        with self.assertRaises(TypeError):
            self.binding.payload["clientId"] = "mutated"

    def test_every_challenge_binding_is_compared_to_the_authoritative_current_record(self):
        for key, value in {
            "ownerSubject": "other_owner",
            "vaultId": "other_vault",
            "rootKeyId": "A" * 43,
            "connectionId": "other_connection",
            "agentId": "A2",
            "clientId": "other_client",
            "identityEpoch": 2,
            "agentSigningKeyId": self.f.kid("A2_sig"),
            "agentEncryptionKeyId": self.f.kid("A2_enc"),
            "bindingFingerprint": "a" * 64,
            "audience": "https://other.example.test/api/v2",
        }.items():
            with self.subTest(key=key), self.assertRaises(ContractError):
                self.proof(challenge={**self.challenge, key: value})

    def test_signed_proof_cannot_substitute_nonce_audience_challenge_or_deadline(self):
        payload = {**self.challenge, "artifactType": "persistent_agent_session_proof"}
        for key, value in {
            "nonce": "B" * 43,
            "challengeId": "challenge_operation_0000002",
            "expiresAt": 1119,
            "issuedAt": 999,
            "audience": "https://other.example.test/api/v2",
            "purpose": "run_request",
        }.items():
            with self.subTest(key=key), self.assertRaises(ContractError):
                self.proof(payload={**payload, key: value})

    def test_used_challenges_wrong_signers_and_changed_signatures_never_authenticate(self):
        payload = {**self.challenge, "artifactType": "persistent_agent_session_proof"}
        for signer in ("A2_sig", "device_sig", "root"):
            with self.subTest(signer=signer), self.assertRaises(ContractError):
                verify_agent_session_proof(
                    self.f.sign(payload, signer),
                    current_identity=self.identity,
                    challenge=self.challenge,
                    challenge_used=False,
                    audience=self.challenge["audience"],
                    **self.expected,
                )
        for used in (True, 1, "false", None):
            with self.subTest(used=used), self.assertRaises(ContractError):
                verify_agent_session_proof(
                    self.f.sign(payload, "A1_sig"),
                    current_identity=self.identity,
                    challenge=self.challenge,
                    challenge_used=used,
                    audience=self.challenge["audience"],
                    **self.expected,
                )
        signed = self.f.sign(payload, "A1_sig")
        signed["signature"] = "A" * 86
        with self.assertRaises(ContractError):
            verify_agent_session_proof(
                signed,
                current_identity=self.identity,
                challenge=self.challenge,
                challenge_used=False,
                audience=self.challenge["audience"],
                **self.expected,
            )

    def test_challenge_deadlines_canonical_nonce_and_safe_audience_are_required(self):
        for changes, now in [
            ({"issuedAt": 1001}, 1000),
            ({"expiresAt": 1000}, 1000),
            ({"expiresAt": 1121}, 1000),
            ({}, 1120),
            ({"issuedAt": 900}, 1000),
            ({"nonce": "B" * 43}, 1000),
        ]:
            with self.subTest(changes=changes, now=now), self.assertRaises(ContractError):
                self.proof(challenge={**self.challenge, **changes}, now=now)
        for audience in (
            "http://hub.example.test",
            "https://u:p@hub.example.test",
            "https://hub.example.test/?token=x",
            "https://hub.example.test/#x",
        ):
            with self.subTest(audience=audience), self.assertRaises(ContractError):
                challenge = {**self.challenge, "audience": audience}
                verify_agent_session_proof(
                    self.f.sign(
                        {**challenge, "artifactType": "persistent_agent_session_proof"}, "A1_sig"
                    ),
                    current_identity=self.identity,
                    challenge=challenge,
                    challenge_used=False,
                    audience=audience,
                    **self.expected,
                )

    def test_current_agent_certificate_expiry_revocation_and_wrong_registry_fail_closed(self):
        for revoked in ("A1_sig", "A1_enc"):
            reg = self.f.verify(self.f.make_bundle(revoked=(revoked,)))
            with self.subTest(revoked=revoked), self.assertRaises(ContractError):
                self.proof(registry=reg)
        expired = {**self.challenge, "issuedAt": 5000, "expiresAt": 5120}
        with self.assertRaises(ContractError):
            self.proof(challenge=expired, now=5000)
        with self.assertRaises(ContractError):
            self.proof(registry=AuthorityFixture(owner="other_owner").registry)
        with self.assertRaises(ContractError):
            self.proof(now=True)

    def test_owner_revoke_advances_epoch_and_old_proof_cannot_resume_or_reenroll(self):
        before = copy.deepcopy(self.identity)
        tombstone = revoke_agent_identity(
            self.f.sign(self.revocation()), current_identity=self.identity, **self.expected
        )
        self.assertEqual(tombstone["identityEpoch"], 2)
        self.assertEqual(tombstone["status"], "revoked")
        self.assertEqual(self.identity, before)
        for occupied in (self.identity, tombstone):
            with self.subTest(status=occupied["status"]), self.assertRaises(ContractError):
                initial_agent_identity(self.binding, current_identity=occupied)
        self.identity = tombstone
        with self.assertRaises(ContractError):
            self.proof()
        with self.assertRaises(ContractError):
            revoke_agent_identity(
                self.f.sign(self.revocation()), current_identity=tombstone, **self.expected
            )

    def test_revocation_is_exact_owner_control_and_overflow_does_not_wrap(self):
        for key, value in {
            "connectionId": "other_connection",
            "identityEpoch": 2,
            "bindingFingerprint": "a" * 64,
        }.items():
            with self.subTest(key=key), self.assertRaises(ContractError):
                revoke_agent_identity(
                    self.f.sign({**self.revocation(), key: value}),
                    current_identity=self.identity,
                    **self.expected,
                )
        with self.assertRaises(ContractError):
            revoke_agent_identity(
                self.f.sign(self.revocation(), "A1_sig"),
                current_identity=self.identity,
                **self.expected,
            )
        self.identity["identityEpoch"] = MAX_SAFE_INTEGER
        with self.assertRaises(ContractError):
            revoke_agent_identity(
                self.f.sign(self.revocation()), current_identity=self.identity, **self.expected
            )

    def test_closed_profiles_reject_secrets_permissions_legacy_and_unbounded_values(self):
        for field in (
            "privateJwk",
            "prf",
            "refresh_token",
            "oauthFamilyId",
            "expiresAt",
            "resourceBindings",
            "capabilities",
        ):
            with self.subTest(field=field), self.assertRaises(ContractError):
                validate_persistent_schema(
                    "PersistentAgentIdentity", {**self.identity, field: "UNEXPECTED"}
                )
        for profile in ("P1", "folioview.persistent-agent-identity.v0", ""):
            with self.subTest(profile=profile), self.assertRaises(ContractError):
                self.verify_binding({**self.binding_payload, "profile": profile})
        with self.assertRaises(ContractError):
            validate_schema("AgentKeyGrantPayload", self.binding_payload)
        with self.assertRaises(ContractError):
            validate_persistent_schema("PersistentAgentBindingPayload", self.f.grant())
        with self.assertRaises(ContractError):
            validate_persistent_schema(
                "PersistentAgentIdentity", {**self.identity, "agentId": "x" * 20000}
            )

    def test_schema_loading_is_detached_and_unknown_names_are_sanitized(self):
        schema = load_persistent_schema("PersistentAgentIdentity")
        schema["$defs"]["PersistentAgentIdentity"]["properties"]["status"] = {}
        with self.assertRaises(ContractError):
            validate_persistent_schema(
                "PersistentAgentIdentity", {**self.identity, "status": "restored"}
            )
        for name in ("Identifier", "../secret", [], None):
            with self.subTest(name=name), self.assertRaises(ContractError):
                load_persistent_schema(name)
        with self.assertRaises(ContractError) as caught:
            validate_persistent_schema(
                "PersistentAgentIdentity", {"PRIVATE_SENTINEL": "not leaked"}
            )
        self.assertNotIn("PRIVATE_SENTINEL", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
