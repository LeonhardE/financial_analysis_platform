"""Actual native OAuth association, encrypted handoff and atomic legacy migration."""

import copy
import os
import unittest
from unittest.mock import patch

import test_native_transport as accounts
import test_runtime_setup as legacy
from fixtures import UID
from test_oauth import CLIENT, configuration

from app.native_credentials import NativeCredentialService
from app.native_transport import NativeTransportService
from app.oauth import OAuthFailure, OAuthService
from app.oauth_config import Client, OAuthConfig
from app.store import document_path
from app.vaults import VaultService
from folioview_shared.encrypted.agent_credentials import AGENT_CREDENTIAL_PROFILE
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode

PACKET = {"version": 1, "iv": b64url_encode(b"i" * 12), "ciphertext": b64url_encode(b"c" * 32)}


class NativeCredentialTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, HUB_AGENT_OWNED_CREDENTIALS_ENABLED="1")
        env.start()
        self.addCleanup(env.stop)
        self.case = legacy.RuntimeSetupTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.case.enroll()
        self.a, self.f = self.case.a, self.case.f
        self.old = self.case.connection
        self.domain = NativeCredentialService(
            self.a.service, owner_url="https://owner.example/agents"
        )
        self.tokens = self.a.connect()
        self.token = self.tokens["access_token"]
        self.p = self.a.service.authenticate(self.token)
        self.new = self.p.connection_id
        self.setup = self.domain.prepare(self.token)["setup"]

    def parent(self, connection):
        return self.a.store.transact(
            lambda u: u.get(document_path("hub_oauth_connections", self.f.owner, connection))
        )

    def command(self):
        self.f.add_key("owned_sig", "agent_sig", "owned_agent", self.new)
        self.f.add_key("owned_enc", "agent_enc", "owned_agent", self.new)
        self.f.bundle = self.f.make_bundle(previous=self.f.registry, issued_at=1000)
        self.f.registry = self.f.verify(self.f.bundle, previous=self.f.registry)
        VaultService(self.a.store, clock=lambda: self.a.now).update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 2,
                "registryBundle": self.f.bundle,
            },
            "synthetic_owned_migration_registry_01",
        )
        operation = "synthetic_owned_migration_approve_01"
        binding = self.f.sign(
            {
                **self.case.binding,
                "connectionId": self.new,
                "agentId": "owned_agent",
                "agentSigningKeyId": self.f.kid("owned_sig"),
                "agentEncryptionKeyId": self.f.kid("owned_enc"),
                "registrySequence": self.f.registry.registry_sequence,
                "checkpointDigest": self.f.registry.checkpoint_digest,
                "stableOperationId": operation,
            }
        )
        from folioview_shared.encrypted.crypto import _signed_parts

        _, payload = _signed_parts(binding)
        approval = self.f.sign(
            {
                **payload,
                "profile": AGENT_CREDENTIAL_PROFILE,
                "artifactType": "agent_credential_approve",
                "bindingFingerprint": signing_input_fingerprint(binding),
                "generation": 1,
                "previousCredentialFingerprint": None,
                "setupIntentId": self.setup["setupIntentId"],
                "audience": configuration().issuer,
                "expiresAt": 4900,
            }
        )
        return {
            "binding": binding,
            "approval": approval,
            "activation": copy.deepcopy(PACKET),
        }, operation

    def test_new_slot_preserves_legacy_until_exact_owner_approval_and_reuses_pending(self):
        self.assertNotEqual(self.old, self.new)
        self.assertEqual(self.parent(self.old)["status"], "active")
        self.assertEqual(self.parent(self.new)["predecessorConnectionId"], self.old)
        again = self.a.connect()
        self.assertEqual(self.a.service.authenticate(again["access_token"]).connection_id, self.new)
        # The newer authorization invalidates the old bootstrap token without revoking legacy PoP.
        with self.assertRaises(OAuthFailure):
            self.domain.offer(self.token, self.setup["setupIntentId"], PACKET)
        self.assertEqual(self.parent(self.old)["status"], "active")

    def test_encrypted_activation_and_old_parent_revocation_are_atomic_and_retry_stable(self):
        self.domain.offer(self.token, self.setup["setupIntentId"], PACKET)
        self.assertIsNone(
            self.domain.activation(self.token, self.setup["setupIntentId"])["activation"]
        )
        command, operation = self.command()
        credentials = self.domain.credentials
        bad = {**command, "approval": self.f.sign({})}
        with self.assertRaises(ContractError):
            credentials.command(UID, self.f.vault, self.new, bad, operation)
        self.assertEqual(self.parent(self.old)["status"], "active")
        receipt = credentials.command(UID, self.f.vault, self.new, command, operation)
        self.assertEqual(self.parent(self.old)["status"], "revoked")
        self.assertNotIn("predecessorConnectionId", self.parent(self.new))
        self.assertEqual(
            credentials.command(UID, self.f.vault, self.new, command, operation), receipt
        )
        self.assertEqual(
            self.domain.activation(self.token, self.setup["setupIntentId"])["activation"], PACKET
        )
        with self.assertRaises(ContractError):
            credentials.command(
                UID,
                self.f.vault,
                self.new,
                {**command, "activation": {**PACKET, "ciphertext": b64url_encode(b"d" * 32)}},
                operation,
            )
        with self.assertRaises(OAuthFailure):
            self.case.a.service.authenticate(self.case.tokens["access_token"])
        self.assertEqual(self.domain.inspect(self.token)["credentialStatus"], "expiring")
        self.assertNotIn(self.token, str(receipt))
        renewed = self.a.connect()
        self.assertEqual(
            self.a.service.authenticate(renewed["access_token"]).connection_id, self.new
        )
        self.assertEqual(
            self.domain.inspect(renewed["access_token"])["credentialStatus"], "expiring"
        )

    def test_owner_url_and_activation_are_not_selected_by_caller_claims(self):
        for url in [
            "http://owner.example/agents",
            "https://owner.example/other",
            "https://owner.example/agents?x=1",
            "https://owner.example/agents#x",
        ]:
            with self.assertRaises(ContractError):
                NativeCredentialService(self.a.service, owner_url=url)
        with self.assertRaises(ContractError):
            self.domain.activation(self.token, "setup_unknown_intent_12345678")


class NativeProviderTests(unittest.TestCase):
    def test_real_chatgpt_oauth_uses_preregistered_provider_and_never_json_provider(self):
        case = accounts.NativeTransportTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        base = configuration()
        client = base.clients[0]
        config = OAuthConfig(
            base.issuer,
            base.consent_url,
            (Client(client.client_id, client.redirects, provider="chatgpt"),),
        )
        case.service = NativeTransportService(case.store, config, clock=lambda: case.now)
        with self.assertRaises(OAuthFailure):
            OAuthService(case.store, config, clock=lambda: case.now).authorize(
                accounts.authorization_params(), accounts.BROWSER
            )
        tokens = case.connect()
        domain = NativeCredentialService(case.service, owner_url="https://owner.example/agents")
        state = domain.inspect(tokens["access_token"])
        self.assertEqual(state["provider"], "chatgpt")
        self.assertEqual(state["actor"]["clientId"], CLIENT)
        setup = domain.prepare(tokens["access_token"])
        self.assertEqual(setup["provider"], "chatgpt")
        self.assertEqual(setup["setup"]["expectedGeneration"], 0)
        self.assertNotIn("private", str(setup["setup"]))
        for provider in ("other", "ChatGPT", None):
            with self.assertRaises(ValueError):
                Client(client.client_id, client.redirects, provider=provider)
