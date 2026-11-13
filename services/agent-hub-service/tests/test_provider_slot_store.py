"""Transactional slot cutover with real signatures, native setup and SQLite races."""

import copy
import unittest
from concurrent.futures import ThreadPoolExecutor

import test_owned_credentials as owned
from fixtures import OTHER_UID, UID
from test_persistent_identity_store import CONNECTION

from app.agent_credentials import setup_path
from app.native_transport import NativePrincipal
from app.persistent_agents import stored_identity
from app.provider_connections import ProviderConnectionService, require_provider_current
from app.store import document_path
from app.vaults import _current
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode
from folioview_shared.encrypted.provider_connections import (
    PROVIDER_CONNECTION_PROFILE,
    provider_review_digest,
    provider_slot_id,
)


class ProviderConnectionTests(unittest.TestCase):
    def setUp(self):
        self.fx = owned.AgentCredentialTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.f, self.store = self.fx.f, self.fx.store
        self.service = ProviderConnectionService(
            self.store,
            audience=owned.AUDIENCE,
            client_ids=[self.fx.conn["clientId"]],
            clock=lambda: self.fx.fx.now,
        )

    def state(self):
        return self.service.state(UID, self.f.vault, "muse")

    def packet(self, credential=None, operation=None, *, state=None, tasks=None, **changes):
        if credential is None:
            credential, operation = self.fx.command()
        state = self.state() if state is None else state
        slot = state["slot"]
        _, lease = _signed_parts(credential["approval"])
        review = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROVIDER_CONNECTION_PROFILE,
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "provider": "muse",
            "slotId": provider_slot_id(self.f.owner, "muse"),
            "retiredCredentials": state["retirementCandidates"],
            "tasks": tasks or [],
        }
        payload = {
            **{
                k: review[k]
                for k in (
                    "contractVersion",
                    "profile",
                    "ownerSubject",
                    "vaultId",
                    "provider",
                    "slotId",
                )
            },
            "artifactType": "provider_connection_update",
            "action": "activate",
            "rootKeyId": self.f.root_id,
            "expectedSlotVersion": slot["slotVersion"] if slot else 0,
            "expectedSlotGeneration": slot["slotGeneration"] if slot else 0,
            "previousCredentialFingerprint": slot["lastCredential"]["credentialFingerprint"]
            if slot
            else None,
            "candidateCredentialFingerprint": signing_input_fingerprint(credential["approval"]),
            "reviewDigest": provider_review_digest(review),
            "setupIntentId": lease["setupIntentId"],
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "stableOperationId": operation,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": self.f.registry.key_epoch,
            "issuedAt": self.fx.fx.now,
            **changes,
        }
        return {
            "approval": self.f.sign(payload),
            "review": review,
            "credential": credential,
        }, operation

    def apply(self, packet, operation):
        return self.service.command(UID, self.f.vault, "muse", packet, operation)

    def gate(self, connection=CONNECTION):
        def read(unit):
            conn = unit.get(document_path("hub_oauth_connections", self.f.owner, connection))
            row = stored_identity(unit, self.f.owner, self.f.vault, connection)
            require_provider_current(
                unit, self.f.owner, self.f.vault, connection, conn, row, self.fx.fx.now
            )

        return self.store.transact(read)

    def pending_second_connection(self):
        connection = "synthetic_second_provider_connection"
        self.fx.fx.now += 1
        self.f.add_key("second_provider_sig", "agent_sig", "second_provider_agent", connection)
        self.f.add_key("second_provider_enc", "agent_enc", "second_provider_agent", connection)
        bundle = self.f.make_bundle(previous=self.f.registry, issued_at=self.fx.fx.now)
        registry = self.f.verify(bundle, previous=self.f.registry, now=self.fx.fx.now)
        version = self.store.transact(
            lambda u: _current(u, self.f.owner, self.fx.fx.now, self.f.vault)[0]["version"]
        )
        self.fx.fx.vaults.update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": version,
                "registryBundle": bundle,
            },
            "provider_new_registry_operation_001",
        )
        self.f.bundle, self.f.registry = bundle, registry
        conn = {
            **self.fx.conn,
            "connectionId": connection,
            "authorizationId": "second_authorization",
        }

        def write(unit):
            path = document_path("hub_oauth_owners", self.f.owner)
            old = unit.get(path)
            unit.put(path, {**old, "connectionIds": [*old["connectionIds"], connection]})
            unit.put(document_path("hub_oauth_connections", self.f.owner, connection), conn)

        self.store.transact(write)
        principal = NativePrincipal(
            owner_uid=UID,
            owner_subject=self.f.owner,
            vault_id=self.f.vault,
            connection_id=connection,
            authorization_id=conn["authorizationId"],
            client_id=conn["clientId"],
            expires_at=10000,
        )
        setup = self.fx.service.begin_setup(principal)
        setup = self.fx.service.put_offer(
            principal,
            setup["setupIntentId"],
            {"version": 1, "iv": b64url_encode(b"x" * 12), "ciphertext": b64url_encode(b"x" * 32)},
        )
        operation = "second_provider_credential_operation_001"
        p = {
            **self.fx.fx.payload,
            "connectionId": connection,
            "agentId": "second_provider_agent",
            "agentSigningKeyId": self.f.kid("second_provider_sig"),
            "agentEncryptionKeyId": self.f.kid("second_provider_enc"),
            "stableOperationId": operation,
            "registrySequence": registry.registry_sequence,
            "checkpointDigest": registry.checkpoint_digest,
            "issuedAt": self.fx.fx.now,
        }
        binding = self.f.sign(p)
        from folioview_shared.encrypted.agent_credentials import AGENT_CREDENTIAL_PROFILE

        approval = {
            **p,
            "artifactType": "agent_credential_approve",
            "profile": AGENT_CREDENTIAL_PROFILE,
            "bindingFingerprint": signing_input_fingerprint(binding),
            "generation": 1,
            "previousCredentialFingerprint": None,
            "setupIntentId": setup["setupIntentId"],
            "audience": owned.AUDIENCE,
            "expiresAt": 4900,
        }
        return {"binding": binding, "approval": self.f.sign(approval)}, operation, connection

    def test_initial_cutover_is_atomic_public_only_and_installs_permanent_marker(self):
        packet, operation = self.packet()
        result = self.apply(packet, operation)
        self.assertEqual(result["slot"]["slotVersion"], 1)
        self.assertEqual(result["slot"]["currentCredential"]["connectionId"], CONNECTION)
        self.assertEqual(result["retainedSelections"], [])
        self.assertTrue(result["requiresFreshGrants"])
        self.assertEqual(self.service.receipt(UID, self.f.vault, "muse", operation), result)
        self.gate()

    def test_cutover_also_works_with_production_style_buffered_writes(self):
        original_store = self.store

        class BufferedUnit:
            def __init__(self, unit):
                self.unit, self.pending = unit, []

            def get(self, path):
                return self.unit.get(path)

            def get_many(self, paths, **options):
                return self.unit.get_many(paths, **options)

            def put(self, path, value):
                self.pending.append((path, copy.deepcopy(value)))

        class BufferedStore:
            def transact(self, callback):
                def run(unit):
                    buffered = BufferedUnit(unit)
                    result = callback(buffered)
                    for path, value in buffered.pending:
                        unit.put(path, value)
                    return result

                return original_store.transact(run)

        self.service.store = BufferedStore()
        packet, operation = self.packet()
        result = self.apply(packet, operation)
        self.assertEqual(self.state()["slot"], result["slot"])
        self.assertEqual(self.apply(packet, operation), result)

    def test_invalid_review_rolls_back_candidate_intent_identity_slot_and_receipt(self):
        packet, operation = self.packet(reviewDigest="0" * 64)
        _, payload = _signed_parts(packet["credential"]["approval"])
        with self.assertRaises(ContractError):
            self.apply(packet, operation)
        self.assertIsNone(self.fx.row())
        self.assertIsNone(self.state()["slot"])
        setup = self.store.transact(lambda u: u.get(setup_path(payload["setupIntentId"])))
        self.assertIsNone(setup["consumedBy"])

    def test_signature_only_variants_return_original_receipt_without_reinstalling(self):
        packet, operation = self.packet()
        result = self.apply(packet, operation)
        variant = copy.deepcopy(packet)
        for container, field in (
            (variant, "approval"),
            (variant["credential"], "approval"),
            (variant["credential"], "binding"),
        ):
            _, payload = _signed_parts(container[field])
            container[field] = self.f.sign(payload)
        self.assertEqual(self.apply(variant, operation), result)
        self.assertEqual(self.state()["slot"], result["slot"])

    def test_two_pending_native_connections_cannot_install_two_current_identities(self):
        second, op2, conn2 = self.pending_second_connection()
        first, op1 = self.packet()
        second, op2 = self.packet(second, op2)

        def attempt(args):
            try:
                return self.apply(*args)
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(attempt, [(first, op1), (second, op2)]))
        self.assertEqual(sum(isinstance(r, dict) for r in outcomes), 1)
        self.assertIn("version_conflict", outcomes)
        rows = self.store.transact(
            lambda u: [
                stored_identity(u, self.f.owner, self.f.vault, c) for c in (CONNECTION, conn2)
            ]
        )
        self.assertEqual(sum(r is not None for r in rows), 1)

    def test_reviewed_legacy_replacement_retains_actor_history_and_original_retry(self):
        legacy = self.fx.approve()
        old = copy.deepcopy(self.fx.row())
        self.fx.fresh_keys()
        packet, operation = self.packet()
        result = self.apply(packet, operation)
        self.assertEqual(result["credentialReceipt"]["lease"]["generation"], 2)
        self.assertEqual(
            legacy["identity"]["connectionId"],
            result["credentialReceipt"]["identity"]["connectionId"],
        )
        self.assertNotEqual(old["identity"], self.fx.row()["identity"])
        self.assertEqual(self.apply(packet, operation), result)
        fresh, next_op = self.fx.command()
        with self.assertRaises(ContractError):
            self.fx.approve(fresh, next_op)  # Old approval route cannot bypass the slot.

    def test_replacement_of_another_connection_revokes_only_reviewed_old_actor(self):
        second, op2, conn2 = self.pending_second_connection()
        first, op1 = self.packet()
        original = self.apply(first, op1)
        packet, operation = self.packet(second, op2)
        result = self.apply(packet, operation)
        self.assertEqual(result["slot"]["slotVersion"], 2)
        self.assertEqual(result["slot"]["currentCredential"]["connectionId"], conn2)
        with self.assertRaises(ContractError):
            self.gate()
        self.gate(conn2)
        self.assertEqual(self.apply(first, op1), original)
        self.assertEqual(self.state()["slot"], result["slot"])
        conn = self.store.transact(
            lambda u: u.get(document_path("hub_oauth_connections", self.f.owner, CONNECTION))
        )
        self.assertEqual(conn["status"], "revoked")

    def test_explicit_disconnect_keeps_high_water_and_cannot_be_undone_by_old_retry(self):
        packet, operation = self.packet()
        original = self.apply(packet, operation)
        _, payload = _signed_parts(packet["approval"])
        payload.update(
            action="disconnect",
            expectedSlotVersion=1,
            expectedSlotGeneration=1,
            previousCredentialFingerprint=original["slot"]["lastCredential"][
                "credentialFingerprint"
            ],
            candidateCredentialFingerprint=None,
            reviewDigest=None,
            setupIntentId=None,
            stableOperationId="provider_disconnect_operation_001",
        )
        gone = self.apply({"approval": self.f.sign(payload)}, payload["stableOperationId"])
        self.assertIsNone(gone["slot"]["currentCredential"])
        self.assertEqual(gone["slot"]["slotVersion"], 2)
        self.assertEqual(self.apply(packet, operation), original)
        self.assertEqual(self.state()["slot"], gone["slot"])
        with self.assertRaises(ContractError):
            self.gate()

    def test_cross_account_provider_and_changed_command_are_rejected_without_mutation(self):
        packet, operation = self.packet()
        with self.assertRaises(ContractError):
            self.service.command(OTHER_UID, self.f.vault, "muse", packet, operation)
        with self.assertRaises(ContractError):
            self.service.command(UID, self.f.vault, "chatgpt", packet, operation)
        original = self.apply(packet, operation)
        changed = copy.deepcopy(packet)
        changed["review"]["tasks"] = [
            {
                "taskId": "not_reviewed",
                "taskVersion": 1,
                "executionEpoch": 1,
                "grantFingerprint": "a" * 64,
                "resourceIds": [],
            }
        ]
        with self.assertRaises(ContractError):
            self.apply(changed, operation)
        self.assertEqual(self.state()["slot"], original["slot"])

    def test_unsupported_legacy_identity_is_reported_not_silently_skipped(self):
        # A genuine old create-only identity is not a synthetic 90-day lease.
        self.fx.fx.enroll()
        state = self.state()
        self.assertEqual(state["legacyBlockers"], [CONNECTION])
        self.assertEqual(state["retirementCandidates"], [])
