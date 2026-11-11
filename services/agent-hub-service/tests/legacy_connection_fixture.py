"""Historical v1 binding fixture; no retired browser setup producer is required."""

import unittest

import test_native_transport as accounts
from fixtures import UID
from test_oauth import CLIENT

from app.persistent_agents import PersistentAgentService
from app.store import document_path
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.persistent_agents import PERSISTENT_AGENT_PROFILE


class LegacyConnectionFixture(unittest.TestCase):
    register = True

    def setUp(self):
        self.a = accounts.NativeTransportTests()
        self.a.setUp()
        self.addCleanup(self.a.doCleanups)
        self.tokens = self.a.connect()
        self.f = self.a.f
        self.connection = self.a.service.authenticate(self.tokens["access_token"]).connection_id
        self.f.add_key("runtime_sig", "agent_sig", "pending", self.connection)
        self.f.add_key("runtime_enc", "agent_enc", "pending", self.connection)
        self.agent = "agent_" + self.f.kid("runtime_sig")
        for name in ("runtime_sig", "runtime_enc"):
            self.f.certificates[name]["principalId"] = self.agent
        intent = "setup_synthetic_legacy_pending_0001"
        row = {
            "intentId": intent,
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "connectionId": self.connection,
            "clientId": CLIENT,
            "authorizationId": self.a.service.authenticate(
                self.tokens["access_token"]
            ).authorization_id,
            "nonce": "n" * 43,
            "issuedAt": 1000,
            "expiresAt": 2800,
            "offer": None,
            "confirmed": False,
            "paired": None,
        }

        def seed(u):
            u.put(
                document_path(
                    "hub_runtime_setup_heads", self.f.owner, self.f.vault, self.connection
                ),
                {"intentId": intent},
            )
            u.put(document_path("hub_runtime_setup_intents", intent), row)

        self.a.store.transact(seed)

    def enroll(self):
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
            "synthetic_legacy_registry_0001",
        )
        operation = "synthetic_legacy_identity_0001"
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
        if self.register:
            return PersistentAgentService(
                self.a.store, client_ids=[CLIENT], clock=lambda: self.a.now
            ).command(UID, self.f.vault, self.connection, self.f.sign(self.binding), operation)[
                "identity"
            ]
