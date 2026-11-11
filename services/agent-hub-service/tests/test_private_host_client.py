"""Generated host keys, Python Owner handoff and real encrypted Hub transactions."""

import json
import secrets
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import private_client_fixture as sessions
import test_encrypted_schema as payloads
import test_persistent_identity_store as identities
import test_persistent_publications as publications
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fixtures import UID
from jwcrypto import jwk
from test_oauth import CLIENT, TASK, OAuthFixture
from test_persistent_content import PersistentContentFixture
from test_persistent_identity_store import CONNECTION

from app.native_transport import SCOPE
from app.persistent_agents import identity_path
from app.persistent_results import PersistentOwnerResultService
from app.resource_consents import current_consent_path, stored_consent
from app.store import document_path
from folioview_shared.encrypted.agent_credentials import (
    AGENT_CREDENTIAL_PROFILE,
    approve_credential,
)
from folioview_shared.encrypted.crypto import _signed_parts, verify_jws
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json
from folioview_shared.encrypted.persistent_content import open_persistent_content

ORIGIN = sessions.ORIGIN


class PrivateHostClientTests(unittest.TestCase):
    configure_execution = sessions.PrivateClientServiceFixture.configure_execution
    handle = sessions.PrivateClientServiceFixture.handle

    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.directory = scratch.name + "/private"
        self.peer = sessions.RuntimePeer(self.handle, "private_host_peer.mjs")
        self.addCleanup(self.peer.close)
        self.connection = CONNECTION
        self.drop_next_plan = self.drop_next_report = False
        self.plan_requests, self.ciphertexts = [], []

    def execution(self, provider="muse"):
        original = OAuthFixture()
        self.actor = {
            "ownerSubject": original.owner,
            "vaultId": original.vault,
            "connectionId": CONNECTION,
            "clientId": CLIENT,
        }
        setup = {
            **self.actor,
            "setupIntentId": "setup_synthetic_private_host_0001",
            "authorizationId": "synthetic_host_authorization",
            "issuedAt": 1000,
            "expiresAt": 1600,
            "expectedGeneration": 0,
            "expectedCredentialFingerprint": None,
            "offer": None,
            "consumedBy": None,
        }
        bootstrap = {
            "issuer": ORIGIN,
            "provider": provider,
            "actor": self.actor,
            "setup": setup,
            "ownerUrl": "https://owner.example/agents",
        }
        prepared = self.peer.call("prepare", {"directory": self.directory, "bootstrap": bootstrap})
        repeated = self.peer.call("prepare", {"directory": self.directory, "bootstrap": bootstrap})
        self.assertEqual(prepared, repeated)
        fragment = parse_qs(urlsplit(prepared["authorizationUrl"]).fragment)
        handoff = json.loads(b64url_decode(fragment["agent_authorization"][0]))
        self.secret = b64url_decode(handoff["secret"], exact_bytes=32)
        self.context = {
            "profile": "folioview.agent-pairing.v1",
            "issuer": ORIGIN,
            "provider": provider,
            **{k: v for k, v in setup.items() if k not in {"offer", "consumedBy"}},
        }
        packet = prepared["offer"]
        signed = json.loads(
            AESGCM(self.secret).decrypt(
                b64url_decode(packet["iv"]),
                b64url_decode(packet["ciphertext"]),
                canonical_json({**self.context, "phase": "offer"}),
            )
        )
        _, offer = _signed_parts(signed)
        self.assertEqual(verify_jws(signed, offer["signingPublicJwk"], typ="fv-control+jws"), offer)
        self.assertEqual(offer["setupIntentId"], setup["setupIntentId"])
        self.assertEqual(offer["provider"], provider)
        self.assertNotIn('"d":', json.dumps(offer))
        agent = offer["agentId"]

        class HostKeysFixture(OAuthFixture):
            def pair(f, connection):
                for name, role, field in (
                    ("A1_sig", "agent_sig", "signingPublicJwk"),
                    ("A1_enc", "agent_enc", "encryptionPublicJwk"),
                ):
                    f.add_key(name, role, agent, connection)
                    f.keys[name] = jwk.JWK(**offer[field])
                    f.certificates[name].update(
                        publicJwk=offer[field], keyId=f.keys[name].thumbprint(), expiresAt=20000
                    )
                f.bundle = f.make_bundle(previous=f.registry, issued_at=1000)
                f.registry = f.verify(f.bundle, previous=f.registry)

        enroll = identities.PersistentAgentTests.enroll

        def host_enroll(case, *args, **kwargs):
            case.payload["agentId"] = agent
            case.signed = case.f.sign(case.payload)
            return enroll(case, *args, **kwargs)

        task_content, resource_content = payloads.task_content, payloads.resource_content

        def task():
            value = task_content()
            value["inputPolicy"]["allowUnknownAsOf"] = True
            return value

        def resource(*args, **kwargs):
            return {**resource_content(*args, **kwargs), "fetchedAt": "1970-01-01T00:16:40Z"}

        for name, factory in (("task_content", task), ("resource_content", resource)):
            patcher = patch.object(payloads, name, factory)
            patcher.start()
            self.addCleanup(patcher.stop)
        case = publications.PublicationTests()
        with (
            patch("test_persistent_identity_store.OAuthFixture", HostKeysFixture),
            patch.object(identities.PersistentAgentTests, "enroll", host_enroll),
        ):
            case.setUp()
        self.addCleanup(case.doCleanups)
        self.fx, self.f = case.fx, case.f
        self.configure_execution(self.fx.store, self.fx.catalogue)
        row = self.fx.store.transact(
            lambda u: u.get(identity_path(self.f.owner, self.f.vault, CONNECTION))
        )
        _, binding = _signed_parts(row["binding"])
        approval = self.f.sign(
            {
                **binding,
                "profile": AGENT_CREDENTIAL_PROFILE,
                "artifactType": "agent_credential_approve",
                "bindingFingerprint": self.fx.identity["bindingFingerprint"],
                "generation": 1,
                "previousCredentialFingerprint": None,
                "setupIntentId": setup["setupIntentId"],
                "audience": ORIGIN,
                "issuedAt": 1000,
                "expiresAt": 4000,
            }
        )
        lease = approve_credential(
            approval,
            registry=self.f.registry,
            identity=self.fx.identity,
            current_lease=None,
            setup_intent_id=setup["setupIntentId"],
            audience=ORIGIN,
            now=1000,
        )

        def seed(unit):
            consent = stored_consent(unit, self.f.owner, self.f.vault, CONNECTION)
            unit.put(
                identity_path(self.f.owner, self.f.vault, CONNECTION),
                {**row, "credentialLease": lease, "credentialApproval": approval},
            )
            unit.put(current_consent_path(unit, self.f.owner, self.f.vault, CONNECTION), consent)
            parent = unit.get(document_path("hub_oauth_connections", self.f.owner, CONNECTION))
            unit.put(
                document_path("hub_oauth_connections", self.f.owner, CONNECTION),
                {
                    **parent,
                    "credentialMode": "agent_owned",
                    "transportKind": "persistent_runtime",
                    "approvedScopes": [SCOPE],
                    "grants": {},
                    "provider": provider,
                },
            )

        self.fx.store.transact(seed)
        case.publish(case.context())
        case.create_task()
        case.publish(case.context("task"))
        self.activation = {
            "contractVersion": "folioview.agent-workspace.v2.0",
            "profile": "folioview.agent-activation.v1",
            "setupIntentId": setup["setupIntentId"],
            "issuer": ORIGIN,
            "provider": provider,
            "actor": self.actor,
            "rootJwk": self.f.root_public,
            "rootKeyId": self.f.root_id,
            "anchor": {
                "rootKeyId": self.f.root_id,
                "registrySequence": self.f.registry.registry_sequence,
                "checkpointDigest": self.f.registry.checkpoint_digest,
            },
            "identity": self.fx.identity,
            "binding": row["binding"],
            "lease": lease,
            "approval": approval,
            "previousLease": None,
        }
        return case

    def response(self, activation=None, *, phase="activation"):
        value = self.activation if activation is None else activation
        iv = secrets.token_bytes(12)
        return {
            "setupIntentId": self.context["setupIntentId"],
            "state": "approved",
            "activation": {
                "version": 1,
                "iv": b64url_encode(iv),
                "ciphertext": b64url_encode(
                    AESGCM(self.secret).encrypt(
                        iv, canonical_json(value), canonical_json({**self.context, "phase": phase})
                    )
                ),
            },
        }

    def test_local_keys_real_python_authority_input_and_unknown_result_retry(self):
        self.execution()
        self.assertEqual(self.peer.call("activate", self.response())["state"], "connected")
        self.assertEqual(self.peer.call("initialize")["state"], "connected")
        self.assertEqual(len(self.peer.call("tasks")), 1)
        run = self.peer.call("begin", {"taskId": TASK, "triggerId": "synthetic_host_run_0001"})
        item = self.peer.call(
            "input", {"runId": run["runId"], "publicationId": run["inputs"][0]["publicationId"]}
        )
        self.assertEqual(item["resource"]["data"]["snapshotId"], self.f.resource["resourceId"])
        report = PersistentContentFixture.private_content(
            self.f, PersistentContentFixture.content_context(self.f, "result_revision")
        )["payload"]
        args = {"runId": run["runId"], "report": report}
        self.drop_next_report = True
        self.assertEqual(
            self.peer.call("submit", args, ok=False)["error"], "runtime_network_unavailable"
        )
        self.peer.close()
        self.peer = sessions.RuntimePeer(self.handle, "private_host_peer.mjs")
        self.addCleanup(self.peer.close)
        self.peer.call(
            "load", {"directory": self.directory, "actor": self.actor, "provider": "muse"}
        )
        self.assertEqual(self.peer.call("initialize")["state"], "connected")
        result = self.peer.call("submit", args)
        self.assertEqual(result["state"], "saved")
        self.assertEqual(self.ciphertexts[0], self.ciphertexts[1])
        saved = PersistentOwnerResultService(self.fx.store, clock=lambda: self.fx.now).owner_get(
            UID, self.f.vault, result["resultId"]
        )
        _, signed = _signed_parts(saved["envelope"]["proof"])
        opened = open_persistent_content(
            saved["envelope"]["jwe"], self.f.keys["recovery_enc"], context=signed["context"]
        )
        self.assertEqual(opened["payload"], report)
        self.assertNotIn(report["title"], self.ciphertexts[0])
        self.fx.now = 4000
        self.peer.call("clock", {"now": 4000})
        self.assertEqual(
            self.peer.call("initialize", ok=False)["error"], "key_authorization_required"
        )

    def test_chatgpt_uses_same_crypto_with_independent_provider_and_native_statement(self):
        self.execution("chatgpt")
        self.assertEqual(self.peer.call("activate", self.response())["provider"], "chatgpt")
        self.peer.call("initialize")
        receipt = self.peer.call(
            "reportPlan",
            {
                "taskId": TASK,
                "status": "enabled",
                "planReference": "synthetic_actual_provider_task",
            },
        )
        self.assertEqual(receipt["receipt"]["provider"], "chatgpt")
        self.assertFalse(receipt["receipt"]["nativeScheduleAttested"])

    def test_wrong_activation_origin_root_keys_or_aead_phase_never_activate_pending(self):
        self.execution()
        for value in (
            {**self.activation, "issuer": "https://wrong.example"},
            {**self.activation, "provider": "chatgpt"},
            {**self.activation, "rootKeyId": b64url_encode(b"x" * 32)},
            {**self.activation, "lease": {**self.activation["lease"], "generation": 2}},
        ):
            self.assertFalse(self.peer.call("activate", self.response(value), ok=False)["ok"])
        self.assertFalse(self.peer.call("activate", self.response(phase="offer"), ok=False)["ok"])
        self.assertEqual(self.peer.call("activate", self.response())["state"], "connected")
