"""Durable identity CAS, original receipts and revocation under real signatures."""

import copy
import tempfile
import unittest
from pathlib import Path

from fixtures import BOOT, OTHER_UID, UID
from test_oauth import CLIENT, OAuthFixture

from app.oauth import OwnerConnectionService
from app.persistent_agents import PersistentAgentService, identity_path, operation_path
from app.store import SQLiteHubStore, StoreUnavailable, document_path
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_agents import PERSISTENT_AGENT_PROFILE

CONNECTION = "synthetic_persistent_connection"
ENROLL = "synthetic_identity_enroll_0001"
REVOKE = "synthetic_identity_revoke_0001"


class PersistentAgentTests(unittest.TestCase):
    def make_store(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return SQLiteHubStore(Path(directory.name) / "hub.sqlite3")

    def setUp(self):
        self.store = self.make_store()
        self.now = 1000
        self.f = OAuthFixture()
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.f.pair(CONNECTION)
        self.vaults.update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 1,
                "registryBundle": self.f.bundle,
            },
            "synthetic_registry_pair_0001",
        )
        # Public, authenticated OAuth parent fixture. The identity API cannot
        # create it or choose a different owner/client by incoming claims.
        self.conn = {
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "provider": "muse",
            "clientId": CLIENT,
            "connectionId": CONNECTION,
            "authorizationId": "synthetic_authorization",
            "authorizationCount": 1,
            "approvedScopes": ["tasks:read"],
            "status": "active",
            "authorizedAt": 1000,
            "expiresAt": 1001,
            "grants": {},
        }
        self.owner = {
            "ownerSubject": self.f.owner,
            "ownerUid": UID,
            "connectionIds": [CONNECTION],
            "attempts": {},
        }
        self.store.transact(
            lambda u: (
                u.put(document_path("hub_oauth_connections", self.f.owner, CONNECTION), self.conn),
                u.put(document_path("hub_oauth_owners", self.f.owner), self.owner),
            )
        )
        self.service = PersistentAgentService(
            self.store, client_ids=[CLIENT], clock=lambda: self.now
        )
        self.payload = {
            **self.f.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": self.f.root_id,
            "connectionId": CONNECTION,
            "agentId": "synthetic_agent",
            "clientId": CLIENT,
            "identityEpoch": 1,
            "agentSigningKeyId": self.f.kid("A1_sig"),
            "agentEncryptionKeyId": self.f.kid("A1_enc"),
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "stableOperationId": ENROLL,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": 1000,
        }
        self.signed = self.f.sign(self.payload)

    def enroll(self, signed=None, operation=ENROLL):
        return self.service.command(UID, self.f.vault, CONNECTION, signed or self.signed, operation)

    def revoke(self):
        identity = self.state()["identity"]
        payload = {
            **self.payload,
            "artifactType": "persistent_agent_revoke",
            "stableOperationId": REVOKE,
            "bindingFingerprint": identity["bindingFingerprint"],
            "issuedAt": self.now,
        }
        return self.service.command(
            UID, self.f.vault, CONNECTION, self.f.sign(payload), REVOKE, revoke=True
        )

    def state(self):
        return self.service.state(UID, self.f.vault, CONNECTION)

    def rejects(self, code, call):
        with self.assertRaises(ContractError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)

    def test_original_receipt_and_identity_survive_transport_expiry_and_process_restart(self):
        first = self.enroll()
        self.now = 1400  # Original control and transport expired.
        service = PersistentAgentService(self.store, clock=lambda: self.now)
        self.assertEqual(service.receipt(UID, self.f.vault, CONNECTION, ENROLL), first)
        self.assertEqual(service.command(UID, self.f.vault, CONNECTION, self.signed, ENROLL), first)
        self.assertEqual(
            service.state(UID, self.f.vault, CONNECTION)["identity"], first["identity"]
        )
        self.assertNotIn("expiresAt", first["identity"])
        self.assertNotIn("token", first)

    def test_exact_retry_does_not_revive_a_revoked_identity(self):
        first = self.enroll()
        self.now = 1100
        revoked = self.revoke()
        self.assertEqual(revoked["identity"]["identityEpoch"], 2)
        self.assertEqual(self.enroll(), first)
        self.assertEqual(self.state()["identity"], revoked["identity"])
        second = {
            **self.payload,
            "stableOperationId": "synthetic_identity_enroll_0002",
            "issuedAt": 1100,
        }
        self.rejects(
            "version_conflict",
            lambda: self.enroll(self.f.sign(second), second["stableOperationId"]),
        )

    def test_occupied_active_slot_requires_original_receipt(self):
        self.enroll()
        second = {**self.payload, "stableOperationId": "synthetic_identity_enroll_0002"}
        self.rejects(
            "version_conflict",
            lambda: self.enroll(self.f.sign(second), second["stableOperationId"]),
        )

    def test_operation_collision_rejects_changed_payload(self):
        self.enroll()
        self.rejects(
            "idempotency_conflict",
            lambda: self.enroll(self.f.sign({**self.payload, "issuedAt": 999})),
        )

    def test_header_operation_and_route_owner_vault_must_match(self):
        self.rejects(
            "recipient_binding_mismatch",
            lambda: self.enroll(operation="synthetic_wrong_operation_001"),
        )
        self.rejects(
            "not_found",
            lambda: self.service.command(OTHER_UID, self.f.vault, CONNECTION, self.signed, ENROLL),
        )
        self.rejects(
            "not_found",
            lambda: self.service.command(UID, "other_vault", CONNECTION, self.signed, ENROLL),
        )
        for field, value in {
            "clientId": "other_client",
            "agentId": "other_agent",
            "connectionId": "other_connection",
        }.items():
            self.rejects(
                "recipient_binding_mismatch",
                lambda field=field, value=value: self.enroll(
                    self.f.sign({**self.payload, field: value})
                ),
            )
        self.assertIsNone(self.state()["identity"])

    def test_agent_cannot_enroll_or_revoke_itself(self):
        self.rejects(
            "key_authorization_required", lambda: self.enroll(self.f.sign(self.payload, "A1_sig"))
        )
        self.assertIsNone(self.state()["identity"])
        self.enroll()
        revoked = {
            **self.payload,
            "artifactType": "persistent_agent_revoke",
            "stableOperationId": REVOKE,
            "bindingFingerprint": self.state()["identity"]["bindingFingerprint"],
        }
        self.rejects(
            "key_authorization_required",
            lambda: self.service.command(
                UID,
                self.f.vault,
                CONNECTION,
                self.f.sign(revoked, "A1_sig"),
                REVOKE,
                revoke=True,
            ),
        )
        self.assertEqual(self.state()["identity"]["status"], "active")

    def test_receipts_remain_historical_after_parent_disconnect(self):
        first = self.enroll()
        OwnerConnectionService(self.store).revoke_connection(UID, CONNECTION)
        self.assertEqual(self.enroll(), first)
        self.assertTrue(self.state()["connectionRevoked"])
        self.assertEqual(self.revoke()["identity"]["status"], "revoked")

    def test_revoked_oauth_parent_cannot_be_upgraded(self):
        OwnerConnectionService(self.store, clock=lambda: self.now).revoke_connection(
            UID, CONNECTION
        )
        self.rejects("key_authorization_required", self.enroll)
        self.assertTrue(self.state()["connectionRevoked"])
        self.assertIsNone(self.state()["identity"])

    def test_disabling_enrollment_does_not_disable_history_or_revocation(self):
        self.enroll()
        self.service = PersistentAgentService(self.store, clock=lambda: self.now)
        self.assertEqual(self.state()["identity"]["status"], "active")
        self.assertEqual(self.revoke()["identity"]["status"], "revoked")

    def test_unregistered_client_and_unindexed_parent_cannot_enroll(self):
        self.service = PersistentAgentService(self.store, clock=lambda: self.now)
        self.rejects("key_authorization_required", self.enroll)
        self.owner["connectionIds"] = []
        self.store.transact(
            lambda u: u.put(document_path("hub_oauth_owners", self.f.owner), self.owner)
        )
        with self.assertRaises(StoreUnavailable):
            self.enroll()

    def test_receipt_ownership_and_absence(self):
        self.enroll()
        self.rejects(
            "not_found", lambda: self.service.receipt(OTHER_UID, self.f.vault, CONNECTION, ENROLL)
        )
        self.rejects(
            "not_found",
            lambda: self.service.receipt(
                UID, self.f.vault, CONNECTION, "synthetic_missing_operation_01"
            ),
        )

    def test_invalid_signature_cannot_leave_identity_or_receipt(self):
        damaged = copy.deepcopy(self.signed)
        damaged["signature"] = "A" * 86
        self.rejects("invalid_signature", lambda: self.enroll(damaged))
        self.assertIsNone(self.state()["identity"])
        self.assertIsNone(
            self.store.transact(lambda u: u.get(operation_path(self.f.owner, self.f.vault, ENROLL)))
        )

    def test_corrupt_stored_binding_fails_unavailable(self):
        self.enroll()
        path = identity_path(self.f.owner, self.f.vault, CONNECTION)
        row = self.store.transact(lambda u: u.get(path))
        row["identity"]["bindingFingerprint"] = "A" * 43
        self.store.transact(lambda u: u.put(path, row))
        with self.assertRaises(StoreUnavailable):
            self.state()


class FirestorePersistentAgentTests(PersistentAgentTests):
    def make_store(self):
        from google.auth.credentials import AnonymousCredentials
        from google.cloud import firestore
        from test_firestore_store import MemoryRpc

        from app.store import FirestoreHubStore

        client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(client.close)
        self.rpc = MemoryRpc(client)
        client._firestore_api_internal = self.rpc
        return FirestoreHubStore("synthetic-hub", "agent-hub", client=client)

    def test_competing_enrollment_retries_without_overwriting_the_winner(self):
        first = []

        def winner():
            self.rpc.before_abort = None
            first.append(self.enroll())

        self.rpc.aborts, self.rpc.before_abort = 1, winner
        self.assertEqual(self.enroll(), first[0])
        self.assertEqual(self.state()["identity"], first[0]["identity"])

    def test_revocation_wins_against_delayed_enrollment_retry(self):
        first = self.enroll()

        def winner():
            self.rpc.before_abort = None
            self.revoke()

        self.rpc.aborts, self.rpc.before_abort = 1, winner
        self.assertEqual(self.enroll(), first)
        self.assertEqual(self.state()["identity"]["status"], "revoked")

    def test_different_competing_enrollment_cannot_overwrite_winner(self):
        def winner():
            self.rpc.before_abort = None
            self.enroll()

        self.rpc.aborts, self.rpc.before_abort = 1, winner
        second = {**self.payload, "stableOperationId": "synthetic_identity_enroll_0002"}
        self.rejects(
            "version_conflict",
            lambda: self.enroll(self.f.sign(second), second["stableOperationId"]),
        )
        self.assertIsNone(
            self.store.transact(
                lambda u: u.get(
                    operation_path(self.f.owner, self.f.vault, second["stableOperationId"])
                )
            )
        )
