"""Real Owner signatures, durable replacement, and immutable historical identities."""

import json
import unittest
from concurrent.futures import ThreadPoolExecutor

import test_persistent_identity_store as identities
from fixtures import OTHER_UID, UID

from app.agent_credentials import AgentCredentialService
from app.native_transport import SCOPE, NativePrincipal
from app.persistent_agents import (
    identity_history_path,
    identity_path,
    require_managed_credential,
    stored_identity,
)
from app.store import StoreUnavailable, document_path
from app.vaults import _current
from folioview_shared.encrypted.agent_credentials import AGENT_CREDENTIAL_PROFILE
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode

AUDIENCE = "https://synthetic-hub.example"


class AgentCredentialTests(unittest.TestCase):
    make_store = identities.PersistentAgentTests.make_store

    def setUp(self):
        self.fx = identities.PersistentAgentTests()
        self.fx.make_store = self.make_store
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.f, self.store = self.fx.f, self.fx.store
        self.conn = {
            **self.fx.conn,
            "transportKind": "persistent_runtime",
            "approvedScopes": [SCOPE],
        }
        self.store.transact(
            lambda u: u.put(
                document_path("hub_oauth_connections", self.f.owner, identities.CONNECTION),
                self.conn,
            )
        )
        self.service = AgentCredentialService(
            self.store,
            audience=AUDIENCE,
            client_ids=[self.conn["clientId"]],
            clock=lambda: self.fx.now,
        )
        self.agent, self.signing, self.encryption = "synthetic_agent", "A1_sig", "A1_enc"
        self.serial = 0

    def principal(self, **changes):
        return NativePrincipal(
            **{
                "owner_uid": UID,
                "owner_subject": self.f.owner,
                "vault_id": self.f.vault,
                "connection_id": identities.CONNECTION,
                "authorization_id": self.conn["authorizationId"],
                "client_id": self.conn["clientId"],
                "expires_at": 10000,
                **changes,
            }
        )

    def setup(self):
        principal = self.principal()
        setup = self.service.begin_setup(principal)
        return self.service.put_offer(
            principal,
            setup["setupIntentId"],
            {
                "version": 1,
                "iv": b64url_encode(b"x" * 12),
                "ciphertext": b64url_encode(b"x" * 32),
            },
        )

    def command(self, *, setup=None, expires=4900, **changes):
        setup = setup or self.setup()
        self.serial += 1
        operation = f"synthetic_credential_operation_{self.serial:04d}"
        payload = {
            **self.fx.payload,
            "agentId": self.agent,
            "agentSigningKeyId": self.f.kid(self.signing),
            "agentEncryptionKeyId": self.f.kid(self.encryption),
            "stableOperationId": operation,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "issuedAt": self.fx.now,
        }
        binding = self.f.sign(payload)
        approval = {
            **payload,
            "artifactType": "agent_credential_approve",
            "profile": AGENT_CREDENTIAL_PROFILE,
            "bindingFingerprint": signing_input_fingerprint(binding),
            "generation": setup["expectedGeneration"] + 1,
            "previousCredentialFingerprint": setup["expectedCredentialFingerprint"],
            "setupIntentId": setup["setupIntentId"],
            "audience": AUDIENCE,
            "expiresAt": expires,
            **changes,
        }
        return {"binding": binding, "approval": self.f.sign(approval)}, operation

    def approve(self, command=None, operation=None):
        if command is None:
            command, operation = self.command()
        return self.service.command(UID, self.f.vault, identities.CONNECTION, command, operation)

    def row(self):
        return self.store.transact(
            lambda u: stored_identity(u, self.f.owner, self.f.vault, identities.CONNECTION)
        )

    def fresh_keys(self, label="second"):
        self.fx.now += 1
        self.agent, self.signing, self.encryption = f"{label}_agent", f"{label}_sig", f"{label}_enc"
        self.f.add_key(self.signing, "agent_sig", self.agent, identities.CONNECTION)
        self.f.add_key(self.encryption, "agent_enc", self.agent, identities.CONNECTION)
        bundle = self.f.make_bundle(previous=self.f.registry, issued_at=self.fx.now)
        registry = self.f.verify(bundle, previous=self.f.registry, now=self.fx.now)
        version = self.store.transact(
            lambda u: _current(u, self.f.owner, self.fx.now, self.f.vault)[0]["version"]
        )
        self.fx.vaults.update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": version,
                "registryBundle": bundle,
            },
            "synthetic_credential_registry_0001"
            if label == "second"
            else f"synthetic_credential_registry_{label}_0001",
        )
        self.f.bundle, self.f.registry = bundle, registry

    def test_initial_owner_approval_stores_public_only_and_sets_current_mode(self):
        result = self.approve()
        row = self.row()
        self.assertEqual(row["credentialLease"], result["lease"])
        self.assertEqual(result["lease"]["generation"], 1)
        require_managed_credential(row, now=1000, audience=AUDIENCE)
        self.assertNotIn('"d":', json.dumps(row))
        self.assertNotIn("private", json.dumps(row).lower())
        conn = self.store.transact(
            lambda u: u.get(
                document_path("hub_oauth_connections", self.f.owner, identities.CONNECTION)
            )
        )
        self.assertEqual(conn["credentialMode"], "agent_owned")

    def test_expiry_boundary_and_revocation_are_always_enforced(self):
        self.approve()
        row = self.row()
        require_managed_credential(row, now=4899, audience=AUDIENCE)
        for now in (4900, 4901):
            with self.assertRaises(ContractError):
                require_managed_credential(row, now=now, audience=AUDIENCE)
        self.assertEqual(self.row(), row)
        self.fx.revoke()
        self.assertEqual(self.row()["credentialLease"]["status"], "revoked")
        with self.assertRaises(ContractError):
            require_managed_credential(self.row(), now=1000, audience=AUDIENCE)

    def test_replacement_archives_old_binding_and_original_retry_cannot_restore_it(self):
        command, operation = self.command(expires=2000)
        first = self.approve(command, operation)
        old = self.row()
        self.fresh_keys()
        replacement = self.approve()
        self.assertEqual(replacement["lease"]["generation"], 2)
        self.assertEqual(
            replacement["lease"]["previousCredentialFingerprint"], first["fingerprint"]
        )
        prior = self.store.transact(
            lambda u: stored_identity(
                u,
                self.f.owner,
                self.f.vault,
                identities.CONNECTION,
                binding_fingerprint=old["identity"]["bindingFingerprint"],
            )
        )
        self.assertEqual(prior, old)
        self.fx.now = 4901
        self.assertEqual(self.approve(command, operation), first)
        self.assertEqual(
            self.service.receipt(UID, self.f.vault, identities.CONNECTION, operation), first
        )
        self.assertEqual(self.row()["credentialLease"]["generation"], 2)
        self.assertEqual(self.row()["identity"], replacement["identity"])

    def test_bad_owner_intent_audience_or_generation_does_not_change_current(self):
        self.approve()
        self.fresh_keys()
        before = self.row()
        pending = self.setup()
        for changes in [
            {"audience": "https://other.example.test"},
            {"generation": 3},
            {"previousCredentialFingerprint": "0" * 64},
            {"setupIntentId": "nonexistent_setup_operation_0001"},
        ]:
            command, operation = self.command(setup=pending, **changes)
            with self.assertRaises(ContractError):
                self.approve(command, operation)
            self.assertEqual(self.row(), before)
        command, operation = self.command()
        with self.assertRaises(ContractError):
            self.service.command(OTHER_UID, self.f.vault, identities.CONNECTION, command, operation)
        self.assertEqual(self.row(), before)

    def test_used_expired_unconfirmed_or_changed_native_setup_is_denied(self):
        setup = self.service.begin_setup(self.principal())
        command, operation = self.command(setup=setup)
        with self.assertRaises(ContractError):
            self.approve(command, operation)
        self.assertIsNone(self.row())
        setup = self.setup()
        command, operation = self.command(setup=setup)
        self.fx.now = setup["expiresAt"]
        with self.assertRaises(ContractError):
            self.approve(command, operation)
        self.assertIsNone(self.row())
        with self.assertRaises(ContractError):
            self.service.begin_setup(self.principal(client_id="wrong_client"))

    def test_legacy_used_or_revoked_v1_slot_cannot_be_reenrolled_as_generation_one(self):
        self.fx.enroll()
        before = self.row()
        with self.assertRaises(ContractError):
            self.service.begin_setup(self.principal())
        self.assertEqual(self.row(), before)
        self.fx.revoke()
        with self.assertRaises(ContractError):
            self.service.begin_setup(self.principal())
        self.assertEqual(self.row()["identity"]["identityEpoch"], 2)

    def test_reauthorization_after_expiry_or_explicit_revocation_needs_fresh_keys(self):
        self.approve()
        self.fx.revoke()
        old_revocation = self.row()["revocation"]
        self.fresh_keys()
        result = self.approve()
        self.assertEqual(result["lease"]["generation"], 2)
        self.assertEqual(result["lease"]["status"], "active")
        self.assertEqual(self.row()["identity"]["status"], "active")
        self.fx.service.command(
            UID,
            self.f.vault,
            identities.CONNECTION,
            old_revocation,
            identities.REVOKE,
            revoke=True,
        )  # Exact old revoke receipt must not revoke generation two.
        self.assertEqual(self.row()["identity"]["status"], "active")

    def test_concurrent_distinct_replacements_have_exactly_one_winner(self):
        self.approve()
        self.fresh_keys()
        candidates = [self.command(), self.command()]

        def commit(candidate):
            try:
                return self.approve(*candidate)
            except ContractError:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(commit, candidates))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(self.row()["credentialLease"]["generation"], 2)

    def test_corrupt_lease_or_missing_history_never_falls_back_to_another_binding(self):
        self.approve()
        before = self.row()
        path = identity_path(self.f.owner, self.f.vault, identities.CONNECTION)
        self.store.transact(
            lambda u: u.put(
                path,
                {**before, "credentialLease": {**before["credentialLease"], "expiresAt": 4999}},
            )
        )
        with self.assertRaises(StoreUnavailable):
            self.row()
        self.store.transact(lambda u: u.put(path, before))
        self.assertIsNone(
            self.store.transact(
                lambda u: stored_identity(
                    u,
                    self.f.owner,
                    self.f.vault,
                    identities.CONNECTION,
                    binding_fingerprint="0" * 64,
                )
            )
        )
        self.assertIsNone(
            self.store.transact(
                lambda u: u.get(
                    identity_history_path(
                        self.f.owner, self.f.vault, identities.CONNECTION, "0" * 64
                    )
                )
            )
        )

    def test_setup_offer_is_immutable_bounded_and_never_a_user_private_key(self):
        setup = self.setup()
        original = self.service.owner_setup(
            UID, self.f.vault, identities.CONNECTION, setup["setupIntentId"]
        )
        different = {
            "version": 1,
            "iv": b64url_encode(b"y" * 12),
            "ciphertext": b64url_encode(b"y" * 32),
        }
        with self.assertRaises(ContractError):
            self.service.put_offer(self.principal(), setup["setupIntentId"], different)
        with self.assertRaises(ContractError):
            self.service.put_offer(
                self.principal(),
                setup["setupIntentId"],
                {**different, "privateKey": "not_accepted"},
            )
        self.assertEqual(
            self.service.owner_setup(
                UID, self.f.vault, identities.CONNECTION, setup["setupIntentId"]
            ),
            original,
        )

    def test_missing_managed_record_cannot_reset_generation_or_use_legacy_enrollment(self):
        path = document_path("hub_oauth_connections", self.f.owner, identities.CONNECTION)
        self.store.transact(lambda u: u.put(path, {**u.get(path), "credentialMode": "agent_owned"}))
        with self.assertRaises(StoreUnavailable):
            self.service.begin_setup(self.principal())
        with self.assertRaises(ContractError):
            self.fx.enroll()
        self.assertIsNone(self.row())

    def test_missing_connection_marker_fails_closed_without_replacing_current(self):
        self.approve()
        before = self.row()
        path = document_path("hub_oauth_connections", self.f.owner, identities.CONNECTION)

        def corrupt(unit):
            conn = unit.get(path)
            conn.pop("credentialMode")
            unit.put(path, conn)

        self.store.transact(corrupt)
        with self.assertRaises(StoreUnavailable):
            self.service.begin_setup(self.principal())
        self.assertEqual(self.row(), before)


class FirestoreAgentCredentialTests(AgentCredentialTests):
    make_store = identities.FirestorePersistentAgentTests.make_store

    def test_concurrent_distinct_replacements_have_exactly_one_winner(self):
        # This fake RPC has no MVCC; inject the real SDK Aborted/retry path.
        self.approve()
        self.fresh_keys()
        winner = self.command()
        loser = self.command()

        def commit_winner():
            self.rpc.before_abort = None
            self.approve(*winner)

        self.rpc.aborts, self.rpc.before_abort = 1, commit_winner
        with self.assertRaises(ContractError):
            self.approve(*loser)
        self.assertEqual(self.row()["credentialLease"]["generation"], 2)
