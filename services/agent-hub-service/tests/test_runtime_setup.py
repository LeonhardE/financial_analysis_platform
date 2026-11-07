"""Real synthetic CSR key possession is not resource permission or host attestation."""

import copy
import unittest
from urllib.parse import parse_qs, urlsplit

import test_native_transport as accounts
from fixtures import OTHER_UID, UID
from test_oauth import CLIENT

from app.persistent_agents import PersistentAgentService
from app.runtime_setup import PROFILE, RuntimeSetupService
from app.store import document_path
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import sign_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_agents import PERSISTENT_AGENT_PROFILE


class RuntimeSetupTests(unittest.TestCase):
    def setUp(self):
        self.a = accounts.NativeTransportTests()
        self.a.setUp()
        self.addCleanup(self.a.doCleanups)
        self.tokens = self.a.connect()
        self.f = self.a.f
        self.service = RuntimeSetupService(self.a.service)
        self.bootstrap = self.service.bootstrap(self.tokens["access_token"])
        self.intent = self.bootstrap["setup"]["intentId"]
        self.connection = self.bootstrap["actor"]["connectionId"]
        self.f.add_key("runtime_sig", "agent_sig", "pending", self.connection)
        self.f.add_key("runtime_enc", "agent_enc", "pending", self.connection)
        self.agent = "agent_" + self.f.kid("runtime_sig")
        for name in ("runtime_sig", "runtime_enc"):
            self.f.certificates[name]["principalId"] = self.agent
        self.payload = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "artifactType": "runtime_key_offer",
            **{
                k: self.bootstrap["setup"][k]
                for k in (
                    "intentId",
                    "ownerSubject",
                    "vaultId",
                    "connectionId",
                    "clientId",
                    "authorizationId",
                    "nonce",
                )
            },
            "issuedAt": self.a.now,
            "expiresAt": self.a.now + 300,
            "agentId": self.agent,
            "signingPublicJwk": self.f.certificates["runtime_sig"]["publicJwk"],
            "encryptionPublicJwk": self.f.certificates["runtime_enc"]["publicJwk"],
        }
        self.proof = self.sign(self.payload)

    def sign(self, payload):
        return sign_jws(payload, self.f.keys["runtime_sig"], typ="fv-control+jws")

    def offer(self):
        return self.service.offer(self.intent, self.proof)

    def rejects(self, code, action):
        with self.assertRaises(ContractError) as caught:
            action()
        self.assertEqual(caught.exception.code, code)

    def confirm(self):
        result = self.offer()
        return self.service.confirm(
            self.tokens["access_token"], self.intent, result["offerFingerprint"]
        )

    def enroll(self):
        self.confirm()
        self.f.bundle = self.f.make_bundle(previous=self.f.registry, issued_at=1000)
        self.f.registry = self.f.verify(self.f.bundle, previous=self.f.registry)
        VaultService(self.a.store, clock=lambda: self.a.now).update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 1,
                "registryBundle": self.f.bundle,
            },
            "synthetic_runtime_registry_01",
        )
        self.agents = PersistentAgentService(
            self.a.store, client_ids=[CLIENT], clock=lambda: self.a.now
        )
        operation = "synthetic_runtime_identity_01"
        self.binding = {
            **self.f.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": self.f.root_id,
            "connectionId": self.connection,
            "agentId": self.agent,
            "clientId": CLIENT,
            "identityEpoch": 1,
            "agentSigningKeyId": self.f.kid("runtime_sig"),
            "agentEncryptionKeyId": self.f.kid("runtime_enc"),
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "stableOperationId": operation,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": self.a.now,
        }
        return self.agents.command(
            UID, self.f.vault, self.connection, self.f.sign(self.binding), operation
        )["identity"]

    def test_bootstrap_reuses_pending_intent_without_creating_any_authority(self):
        self.assertEqual(self.service.bootstrap(self.tokens["access_token"]), self.bootstrap)
        self.assertEqual(self.bootstrap["mode"], "setup")
        self.assertNotIn("ownerUid", str(self.bootstrap))
        self.assertIsNone(
            self.a.store.transact(
                lambda u: u.get(
                    document_path(
                        "hub_agent_identities", self.f.owner, self.f.vault, self.connection
                    )
                )
            )
        )

    def test_exact_offer_retry_returns_original_fingerprint_and_cannot_replace_keys(self):
        first = self.offer()
        self.assertEqual(self.offer(), first)
        changed = copy.deepcopy(self.payload)
        changed["expiresAt"] -= 1
        self.rejects(
            "idempotency_conflict", lambda: self.service.offer(self.intent, self.sign(changed))
        )
        self.assertFalse(self.service.public_state(self.intent)["setup"]["confirmed"])

    def test_native_confirmation_is_association_not_host_attestation_or_data_permission(self):
        confirmed = self.confirm()
        self.assertTrue(confirmed["clientAssociated"])
        self.assertFalse(confirmed["protectedHostAttested"])
        state = self.service.owner_state(UID, self.intent)
        self.assertEqual(state["authority"], "pairing_observation_only")
        self.assertIsNone(
            self.a.store.transact(
                lambda u: u.get(
                    document_path(
                        "hub_resource_consents", self.f.owner, self.f.vault, self.connection
                    )
                )
            )
        )

    def test_unsigned_scope_extra_private_jwk_and_wrong_tenant_are_rejected(self):
        for change in (
            {"nonce": "x" * 43},
            {"clientId": "other"},
            {"ownerSubject": "f" * 64},
            {"vaultId": "other_vault"},
        ):
            self.rejects(
                "recipient_binding_mismatch",
                lambda change=change: self.service.offer(
                    self.intent, self.sign(self.payload | change)
                ),
            )
        for change in (
            {"scope": "portfolio:read"},
            {"signingPublicJwk": self.f.keys["runtime_sig"].export(private_key=True, as_dict=True)},
        ):
            with self.assertRaises(ContractError):
                self.service.offer(self.intent, self.sign(self.payload | change))

    def test_google_owner_and_native_confirmation_cannot_be_substituted(self):
        self.offer()
        self.rejects("not_found", lambda: self.service.owner_state(OTHER_UID, self.intent))
        self.rejects(
            "recipient_binding_mismatch",
            lambda: self.service.confirm(self.tokens["access_token"], self.intent, "f" * 64),
        )
        self.rejects("key_authorization_required", lambda: self.service.complete(UID, self.intent))

    def test_completion_requires_actual_root_certified_matching_identity(self):
        self.confirm()
        self.rejects("key_authorization_required", lambda: self.service.complete(UID, self.intent))
        identity = self.enroll()
        result = self.service.complete(UID, self.intent)
        self.assertEqual(result["paired"]["identity"], identity)
        self.assertEqual(result["paired"]["authority"], "pairing_observation_only")
        self.assertEqual(self.service.complete(UID, self.intent), result)
        resumed = self.service.bootstrap(self.tokens["access_token"])
        self.assertEqual(resumed["mode"], "resume")
        self.assertIsNone(resumed["setup"])
        self.assertIn("ownerSubject=", resumed["runtimeUrl"])
        fragment = parse_qs(urlsplit(resumed["runtimeUrl"]).fragment)
        self.assertEqual(fragment["rootKeyId"], [self.f.root_id])
        from folioview_shared.encrypted.jsonutil import b64url_decode, strict_json_loads

        self.assertEqual(strict_json_loads(b64url_decode(fragment["descriptor"][0])), identity)

    def test_account_repair_invalidates_old_setup_but_keeps_same_connection(self):
        self.offer()
        new = self.a.connect()
        bootstrap = self.service.bootstrap(new["access_token"])
        self.assertEqual(bootstrap["actor"]["connectionId"], self.connection)
        self.assertNotEqual(bootstrap["setup"]["intentId"], self.intent)
        self.rejects("key_authorization_required", lambda: self.service.public_state(self.intent))

    def test_expired_intent_and_wrong_current_nonce_cannot_be_reopened(self):
        self.a.now += 1801
        self.rejects("key_authorization_required", lambda: self.service.public_state(self.intent))
