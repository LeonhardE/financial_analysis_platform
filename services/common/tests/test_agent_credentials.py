"""Real signatures and cross-language vectors; no live account or key material."""

import copy
import json
import unittest
from pathlib import Path

from folioview_shared.encrypted.agent_credentials import (
    AGENT_CREDENTIAL_PROFILE,
    CREDENTIAL_NOTICE_SECONDS,
    DEFAULT_CREDENTIAL_SECONDS,
    approve_credential,
    credential_status,
    require_current_credential,
)
from folioview_shared.encrypted.errors import ContractError


class CredentialFixture:
    def __init__(self):
        from test_persistent_agents import PersistentAgentTests

        legacy = PersistentAgentTests()
        legacy.setUp()
        self.legacy = legacy
        self.identity = legacy.identity
        self.f = legacy.f
        self.payload = {
            **legacy.binding_payload,
            "artifactType": "agent_credential_approve",
            "profile": AGENT_CREDENTIAL_PROFILE,
            "bindingFingerprint": self.identity["bindingFingerprint"],
            "generation": 1,
            "previousCredentialFingerprint": None,
            "setupIntentId": "setup_intent_operation_000001",
            "audience": "https://hub.example.test",
            "expiresAt": 4900,
            "issuedAt": 1000,
        }

    def approve(self, payload=None, **changes):
        return approve_credential(
            self.f.sign(self.payload if payload is None else payload),
            **{
                "registry": self.f.registry,
                "identity": self.identity,
                "current_lease": None,
                "setup_intent_id": self.payload["setupIntentId"],
                "audience": self.payload["audience"],
                "now": 1000,
                **changes,
            },
        )


class AgentCredentialTests(unittest.TestCase):
    def setUp(self):
        self.f = CredentialFixture()

    def test_expiry_boundary_notice_and_public_only_record(self):
        lease = self.f.approve()
        self.assertEqual(DEFAULT_CREDENTIAL_SECONDS, 7_776_000)
        self.assertEqual(CREDENTIAL_NOTICE_SECONDS, 604_800)
        self.assertEqual(credential_status(lease, now=4899), "expiring")
        self.assertEqual(credential_status(lease, now=4900), "expired")
        for now in (4900, 4901):
            with self.assertRaises(ContractError):
                require_current_credential(
                    lease, identity=self.f.identity, audience=self.f.payload["audience"], now=now
                )
        self.assertNotIn("private", json.dumps(lease))
        self.assertEqual(credential_status({**lease, "status": "revoked"}, now=1000), "revoked")
        long_lease = {**lease, "expiresAt": 1000 + DEFAULT_CREDENTIAL_SECONDS}
        self.assertEqual(
            credential_status(
                long_lease, now=long_lease["expiresAt"] - CREDENTIAL_NOTICE_SECONDS - 1
            ),
            "active",
        )
        self.assertEqual(
            credential_status(long_lease, now=long_lease["expiresAt"] - CREDENTIAL_NOTICE_SECONDS),
            "expiring",
        )

    def test_owner_signature_and_trusted_context_not_self_claimed_identity(self):
        for signer in ("A1_sig", "root"):
            with self.subTest(signer=signer), self.assertRaises(ContractError):
                approve_credential(
                    self.f.f.sign(self.f.payload, signer),
                    registry=self.f.f.registry,
                    identity=self.f.identity,
                    current_lease=None,
                    setup_intent_id=self.f.payload["setupIntentId"],
                    audience=self.f.payload["audience"],
                    now=1000,
                )
        for field, value in {
            "ownerSubject": "someone_else",
            "clientId": "other_client",
            "connectionId": "other_connection",
            "audience": "https://evil.example.test",
            "setupIntentId": "setup_other_operation_00001",
            "bindingFingerprint": "0" * 64,
            "generation": 2,
            "previousCredentialFingerprint": "0" * 64,
            "expiresAt": 1000,
            "issuedAt": 699,
            "verified": True,
        }.items():
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.f.approve({**self.f.payload, field: value})

    def test_reauthorization_requires_fresh_keys_and_compare_and_swap(self):
        lease = self.f.approve()
        with self.assertRaises(ContractError):
            self.f.approve(
                {
                    **self.f.payload,
                    "generation": 2,
                    "previousCredentialFingerprint": lease["credentialFingerprint"],
                },
                current_lease=lease,
            )
        f = self.f.f
        old = copy.deepcopy(self.f.identity)
        f.add_key("new_sig", "agent_sig", "new_agent", old["connectionId"], epoch=2)
        f.add_key("new_enc", "agent_enc", "new_agent", old["connectionId"], epoch=2)
        registry = f.verify(f.make_bundle())
        new = {
            **old,
            "agentId": "new_agent",
            "agentSigningKeyId": f.kid("new_sig"),
            "agentEncryptionKeyId": f.kid("new_enc"),
            "bindingFingerprint": "1" * 64,
        }
        payload = {
            **self.f.payload,
            **{
                k: new[k]
                for k in (
                    "agentId",
                    "agentSigningKeyId",
                    "agentEncryptionKeyId",
                    "bindingFingerprint",
                )
            },
            "generation": 2,
            "previousCredentialFingerprint": lease["credentialFingerprint"],
            "checkpointDigest": registry.checkpoint_digest,
        }
        replacement = self.f.approve(payload, identity=new, current_lease=lease, registry=registry)
        self.assertEqual(replacement["generation"], 2)
        self.assertEqual(lease["generation"], 1)
        with self.assertRaises(ContractError):
            require_current_credential(
                replacement, identity=old, audience=payload["audience"], now=1000
            )
        with self.assertRaises(ContractError):
            self.f.approve(payload, identity=new, current_lease=replacement, registry=registry)

    def test_maximum_lifetime_and_key_certificate_deadline_are_independent_fences(self):
        f = self.f.f
        for cert in f.certificates.values():
            cert["expiresAt"] = 1000 + DEFAULT_CREDENTIAL_SECONDS + 100
        registry = f.verify(f.make_bundle())
        payload = {
            **self.f.payload,
            "checkpointDigest": registry.checkpoint_digest,
            "expiresAt": 1000 + DEFAULT_CREDENTIAL_SECONDS,
        }
        lease = self.f.approve(payload, registry=registry)
        self.assertEqual(lease["expiresAt"] - lease["issuedAt"], DEFAULT_CREDENTIAL_SECONDS)
        with self.assertRaises(ContractError):
            self.f.approve({**payload, "expiresAt": payload["expiresAt"] + 1}, registry=registry)
        f.certificates["A1_enc"]["expiresAt"] = 4900
        registry = f.verify(f.make_bundle())
        with self.assertRaises(ContractError):
            self.f.approve(
                {**payload, "checkpointDigest": registry.checkpoint_digest}, registry=registry
            )
        f.certificates["A1_enc"]["expiresAt"] = payload["expiresAt"]
        f.certificates["A1_enc"]["keyEpoch"] = 2
        registry = f.verify(f.make_bundle())
        with self.assertRaises(ContractError):
            self.f.approve(
                {**payload, "checkpointDigest": registry.checkpoint_digest}, registry=registry
            )

    def test_independent_browser_signed_vector(self):
        from folioview_shared.encrypted.authority import verify_registry

        vector = json.loads((Path(__file__).parent / "fixtures/agent_credentials.json").read_text())
        args = vector["anchor"]
        registry = verify_registry(vector["registryBundle"], **args, now=1000)
        for signed in (vector["pythonApproval"], vector["nodeApproval"]):
            lease = approve_credential(
                signed,
                registry=registry,
                identity=vector["identity"],
                current_lease=None,
                setup_intent_id=vector["setupIntentId"],
                audience=vector["audience"],
                now=1000,
            )
            self.assertEqual(lease["generation"], 1)
