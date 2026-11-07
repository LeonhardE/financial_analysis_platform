"""Current-key proof recovery is atomic and never revives resource authority."""

import copy
import unittest
from unittest.mock import patch

import test_persistent_identity_store as identities
from fixtures import OTHER_UID, UID
from test_oauth import CLIENT, configuration

from app.identity_recovery import IdentityRecoveryService, recovery_path
from app.oauth import OAuthFailure, OAuthService, OwnerConnectionService
from app.store import StoreUnavailable
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key

AUDIENCE = "https://synthetic-hub.example/agent/v2/persistent/identity-recovery"


class IdentityRecoveryTests(unittest.TestCase):
    make_store = identities.PersistentAgentTests.make_store
    rejects = identities.PersistentAgentTests.rejects

    def setUp(self):
        original = identities.OAuthFixture

        def short_owner():
            fixture = original()
            fixture.certificates["device_sig"]["expiresAt"] = 1100
            fixture.bundle = fixture.make_bundle()
            fixture.registry = fixture.verify(fixture.bundle)
            return fixture

        with patch.object(identities, "OAuthFixture", side_effect=short_owner):
            identities.PersistentAgentTests.setUp(self)
        self.identity = identities.PersistentAgentTests.enroll(self)["identity"]
        self.identities = self.service
        self.service = IdentityRecoveryService(
            self.store, client_ids=[CLIENT], audience=AUDIENCE, clock=lambda: self.now
        )

    def challenge(self, **changes):
        args = {
            "owner": self.f.owner,
            "vault": self.f.vault,
            "connection": identities.CONNECTION,
            "client": CLIENT,
        }
        return self.service.challenge(**(args | changes))

    def proof(self, challenge=None, signer="A1_sig", **changes):
        challenge = challenge or self.challenge()
        return self.f.sign(
            {**challenge, "artifactType": "persistent_agent_session_proof", **changes}, signer
        )

    def recover(self, signed=None):
        return self.service.recover(
            self.f.owner, self.f.vault, identities.CONNECTION, CLIENT, signed or self.proof()
        )

    def bucket(self):
        return self.store.transact(
            lambda unit: unit.get(recovery_path(self.f.owner, self.f.vault, identities.CONNECTION))
        )

    def test_same_identity_recovers_after_oauth_and_original_owner_device_expire(self):
        self.now = 2000
        result = self.recover()
        self.assertEqual(
            result["identity"]["bindingFingerprint"], self.identity["bindingFingerprint"]
        )
        self.assertEqual(result["authority"], "identity_only")
        self.assertEqual(result["expiresAt"], 2300)
        self.assertNotIn("access_token", result)
        self.assertNotIn("grant", result)
        self.assertEqual(
            self.identities.state(UID, self.f.vault, identities.CONNECTION)["identity"],
            self.identity,
        )

    def test_unconsumed_challenge_is_reused_and_nonce_is_generated_by_service(self):
        first = self.challenge()
        for _ in range(12):
            self.assertEqual(self.challenge(), first)
        self.assertEqual(len(self.bucket()["entries"]), 1)
        self.assertEqual(len(first["nonce"]), 43)
        self.assertEqual(first["expiresAt"] - first["issuedAt"], 120)

    def test_expired_unused_challenge_cannot_be_consumed_or_replace_identity(self):
        first = self.challenge()
        signed = self.proof(first)
        self.now = first["expiresAt"]
        self.rejects("key_authorization_required", lambda: self.recover(signed))
        self.assertIsNone(self.bucket()["entries"][first["challengeId"]]["receipt"])
        self.assertNotEqual(self.challenge()["challengeId"], first["challengeId"])
        self.assertEqual(
            self.identities.state(UID, self.f.vault, identities.CONNECTION)["identity"],
            self.identity,
        )

    def test_invalid_signatures_and_substituted_nonce_never_consume_the_challenge(self):
        first = self.challenge()
        for signer in ("device_sig", "root", "recovery_enc"):
            with self.assertRaises(ContractError):
                self.recover(self.proof(first, signer))
        with self.assertRaises(ContractError):
            self.recover(self.proof(first, nonce="A" * 43))
        self.assertIsNone(self.bucket()["entries"][first["challengeId"]]["proof"])
        self.assertEqual(self.recover(self.proof(first))["challengeId"], first["challengeId"])

    def test_wrong_route_owner_vault_client_and_signed_audience_are_denied(self):
        self.rejects("not_found", lambda: self.challenge(owner=owner_key(OTHER_UID)))
        self.rejects("not_found", lambda: self.challenge(vault="other_vault"))
        self.rejects("key_authorization_required", lambda: self.challenge(client="other_client"))
        with self.assertRaises(ContractError):
            self.recover(self.proof(audience="https://other.example/recovery"))
        first = self.challenge()
        self.assertIsNone(self.bucket()["entries"][first["challengeId"]]["receipt"])

    def test_original_recovery_receipt_is_not_renewed_by_replay_after_its_deadline(self):
        signed = self.proof()
        original = self.recover(signed)
        self.now = original["expiresAt"] + 1
        self.assertEqual(self.recover(signed), original)
        self.assertLess(original["expiresAt"], self.now)
        fresh = self.challenge()
        self.assertNotEqual(fresh["challengeId"], original["challengeId"])
        self.assertEqual(self.recover(signed), original)

    def test_parent_disconnect_and_identity_revocation_block_old_proofs(self):
        signed = self.proof()
        self.recover(signed)
        OwnerConnectionService(self.store).revoke_connection(UID, identities.CONNECTION)
        self.rejects("key_authorization_required", lambda: self.recover(signed))
        self.rejects("key_authorization_required", self.challenge)

    def test_recovery_receipt_cannot_be_used_as_a_legacy_oauth_bearer(self):
        receipt = self.recover()
        oauth = OAuthService(self.store, configuration(), clock=lambda: self.now)
        with self.assertRaises(OAuthFailure) as caught:
            oauth.authenticate(receipt["challengeId"])
        self.assertEqual(caught.exception.code, "invalid_token")

    def test_bounded_receipts_prune_after_expiry_without_changing_stable_identity(self):
        for _ in range(8):
            self.recover()
            self.now += 1
        self.assertEqual(len(self.bucket()["entries"]), 8)
        self.rejects("authorization_unavailable", self.challenge)
        self.now += 500
        self.challenge()
        self.assertEqual(len(self.bucket()["entries"]), 1)
        self.assertEqual(
            self.identities.state(UID, self.f.vault, identities.CONNECTION)["identity"],
            self.identity,
        )

    def test_corrupt_recovery_bucket_fails_closed_instead_of_resetting(self):
        self.recover()
        row = copy.deepcopy(self.bucket())
        row["ownerSubject"] = owner_key(OTHER_UID)
        self.store.transact(
            lambda unit: unit.put(
                recovery_path(self.f.owner, self.f.vault, identities.CONNECTION), row
            )
        )
        with self.assertRaises(StoreUnavailable):
            self.challenge()

    def test_configured_audience_cannot_be_a_url_with_credentials_or_query(self):
        for audience in (
            "https://example.test/path?key=synthetic",
            "https://user:synthetic@example.test/path",
            "http://example.test/path",
        ):
            self.rejects(
                "authorization_unavailable",
                lambda audience=audience: IdentityRecoveryService(self.store, audience=audience),
            )


class FirestoreIdentityRecoveryTests(IdentityRecoveryTests):
    make_store = identities.FirestorePersistentAgentTests.make_store

    def test_concurrent_proofs_commit_only_one_original_recovery_receipt(self):
        signed = self.proof()
        winner = []

        def race():
            self.rpc.before_abort = None
            self.now += 1
            winner.append(self.recover(signed))

        self.rpc.aborts, self.rpc.before_abort = 1, race
        result = self.recover(signed)
        self.assertEqual(result, winner[0])
        self.assertEqual(len(self.bucket()["entries"]), 1)
        self.assertEqual(result["acceptedAt"], 1001)

    def test_identity_revocation_wins_against_a_proof_commit(self):
        signed = self.proof()

        def race():
            self.rpc.before_abort = None
            payload = {
                **self.payload,
                "artifactType": "persistent_agent_revoke",
                "stableOperationId": identities.REVOKE,
                "bindingFingerprint": self.identity["bindingFingerprint"],
            }
            self.identities.command(
                UID,
                self.f.vault,
                identities.CONNECTION,
                self.f.sign(payload),
                identities.REVOKE,
                revoke=True,
            )

        self.rpc.aborts, self.rpc.before_abort = 1, race
        self.rejects("key_authorization_required", lambda: self.recover(signed))
        self.assertIsNone(next(iter(self.bucket()["entries"].values()))["receipt"])

    def test_disconnect_wins_against_a_proof_commit(self):
        signed = self.proof()

        def race():
            self.rpc.before_abort = None
            OwnerConnectionService(self.store).revoke_connection(UID, identities.CONNECTION)

        self.rpc.aborts, self.rpc.before_abort = 1, race
        self.rejects("key_authorization_required", lambda: self.recover(signed))
        self.assertIsNone(next(iter(self.bucket()["entries"].values()))["receipt"])
