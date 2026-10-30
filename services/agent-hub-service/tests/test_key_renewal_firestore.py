"""Actual Firestore SDK renewal transactions using synthetic conflict RPCs only."""

import copy
import unittest
from unittest.mock import patch

from fixtures import BOOT, OTHER_UID, UID
from google.api_core.exceptions import ServiceUnavailable
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from key_renewal_fixtures import RENEW, KeyRenewalFixture
from test_task_firestore import WriteConflictRpc
from vault_lifecycle_fixtures import archive_digest

from app.key_renewals import VaultKeyRenewalService
from app.store import FirestoreHubStore, StoreUnavailable, document_path
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, strict_json_loads
from folioview_shared.identity import owner_key


class FirestoreKeyRenewalTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = WriteConflictRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.now = 1000
        self.service = VaultKeyRenewalService(self.store, clock=lambda: self.now)
        self.lifecycle = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.f = KeyRenewalFixture()
        self.original = self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.rpc.calls.clear()

    def state(self):
        return self.lifecycle.state(UID, self.f.vault)

    def renew(self, body=None, operation=RENEW):
        if body is None:
            body = self.f.renewal(self.state(), operation=operation, now=self.now)
        return self.service.renew(UID, self.f.vault, body, operation)

    def batches(self):
        return [
            kwargs["request"]["writes"]
            for kind, kwargs in self.rpc.calls
            if kind == "commit" and kwargs["request"]["writes"]
        ]

    def inject(self, action):
        def win():
            self.rpc.before_abort = None
            action()

        self.rpc.aborts, self.rpc.before_abort = 1, win

    def assert_missing_receipt(self, operation):
        with self.assertRaises(ContractError) as error:
            self.service.receipt(UID, self.f.vault, operation)
        self.assertEqual(error.exception.code, "not_found")

    def test_directory_archive_history_and_receipt_are_one_three_document_sdk_commit(self):
        before = self.state()
        body = self.f.renewal(before)
        self.rpc.calls.clear()
        result = self.renew(body)
        batches = self.batches()
        self.assertEqual([len(batch) for batch in batches], [3])
        self.assertEqual(
            {write.update.name.split("/documents/")[1].split("/")[0] for write in batches[0]},
            {"hub_vaults", "hub_vault_lifecycle", "hub_operations"},
        )
        self.assertTrue(
            all(
                write.update.name.startswith(
                    "projects/synthetic-hub/databases/agent-hub/documents/"
                )
                for write in batches[0]
            )
        )
        after = self.state()
        self.assertEqual(after["archive"], body["archive"])
        self.assertEqual(after["archiveRevision"], 1)
        self.assertEqual(after["lifecycleVersion"], 1)
        self.assertEqual(after["registrySequence"], 2)
        self.assertEqual(after["keyEpoch"], before["keyEpoch"])
        current = self.vaults.current(UID)
        self.assertEqual(current["vault"]["version"], 2)
        self.assertEqual(current["vault"]["rootJwk"], self.original["vault"]["rootJwk"])
        self.assertEqual(current["sources"], self.original["sources"])
        self.assertEqual(after["history"][0]["command"], body["archiveCommand"])
        self.assertEqual(self.service.receipt(UID, self.f.vault, RENEW), result)

    def test_same_operation_commit_collision_recovers_original_receipt_without_second_renewal(self):
        body = self.f.renewal(self.state())
        accepted = []
        self.inject(lambda: accepted.append(self.renew(body)))
        result = self.renew(body)
        self.assertEqual(result, accepted[0])
        self.assertEqual(self.state()["archiveRevision"], 1)
        self.assertEqual(self.state()["registrySequence"], 2)
        self.assertEqual(self.service.receipt(UID, self.f.vault, RENEW), result)
        self.assertEqual([len(batch) for batch in self.batches()], [3, 3])

    def test_root_can_renew_after_every_previous_owner_certificate_has_expired(self):
        self.now = 6000
        body = self.f.renewal(self.state(), now=self.now)
        result = self.renew(body)
        current = self.state()
        self.assertEqual(current["registrySequence"], 2)
        self.assertEqual(current["keyEpoch"], 1)
        self.assertEqual(current["archiveRevision"], 1)
        self.assertEqual(self.service.receipt(UID, self.f.vault, RENEW), result)
        self.assertEqual([len(batch) for batch in self.batches()], [3])

    def test_competing_renewal_rechecks_winner_and_never_overwrites_archive_or_directory(self):
        initial = self.state()
        winner_op = "synthetic_sdk_renewal_winner_0001"
        loser_op = "synthetic_sdk_renewal_loser_0001"
        winner = self.f.renewal(initial, operation=winner_op, index=1)
        loser = self.f.renewal(initial, operation=loser_op, index=2)
        accepted = []
        self.inject(lambda: accepted.append(self.renew(winner, winner_op)))
        with self.assertRaises(ContractError):
            self.renew(loser, loser_op)
        self.assertEqual(self.state()["archive"], winner["archive"])
        self.assertEqual(
            self.vaults.current(UID)["vault"]["registryHistory"][-1], winner["registryBundle"]
        )
        self.assertEqual(self.state()["archiveRevision"], 1)
        self.assertEqual(self.service.receipt(UID, self.f.vault, winner_op), accepted[0])
        self.assert_missing_receipt(loser_op)

    def test_passkey_archive_winner_invalidates_renewal_on_transaction_retry(self):
        initial = self.state()
        body = self.f.renewal(initial)
        winner_op = "synthetic_sdk_renewal_archive_winner"
        winner = self.f.replace(initial, winner_op, archive=self.f.archive(initial, index=7))
        accepted = []
        self.inject(
            lambda: accepted.append(
                self.lifecycle.replace_archive(UID, self.f.vault, winner, winner_op)
            )
        )
        with self.assertRaises(ContractError):
            self.renew(body)
        self.assertEqual(self.state()["archive"], winner["archive"])
        self.assertEqual(self.state()["registrySequence"], 1)
        self.assertEqual(self.state()["archiveRevision"], 1)
        self.assertEqual(self.lifecycle.receipt(UID, self.f.vault, winner_op), accepted[0])
        self.assert_missing_receipt(RENEW)

    def test_registry_winner_invalidates_renewal_before_retry_can_save_archive(self):
        body = self.f.renewal(self.state())
        bundle = self.f.make_bundle(previous=self.f.registry)
        self.inject(
            lambda: self.vaults.update_registry(
                UID,
                self.f.vault,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "expectedVersion": 1,
                    "registryBundle": bundle,
                },
                "synthetic_sdk_renewal_registry_winner",
            )
        )
        with self.assertRaises(ContractError):
            self.renew(body)
        self.assertEqual(self.state()["archive"], self.original["vault"]["archive"])
        self.assertEqual(self.state()["registrySequence"], 2)
        self.assertEqual(self.state()["archiveRevision"], 0)
        self.assertFalse(any("/hub_vault_lifecycle/" in key for key in self.rpc.documents))
        self.assert_missing_receipt(RENEW)

    def test_recovery_approval_winner_is_kept_and_renewal_is_not_partially_applied(self):
        state = self.state()
        body = self.f.renewal(state)
        operation = "synthetic_sdk_renewal_recovery_winner"
        authorization = "synthetic_sdk_pending_recovery"
        auth = self.f.authorize(
            state, self.f.archive(state, index=8), operation, authorization=authorization
        )
        self.inject(lambda: self.lifecycle.authorize_recovery(UID, self.f.vault, auth, operation))
        with self.assertRaises(ContractError):
            self.renew(body)
        current = self.state()
        self.assertEqual(current["pendingAuthorization"]["authorizationId"], authorization)
        self.assertEqual(current["archive"], self.original["vault"]["archive"])
        self.assertEqual(current["registrySequence"], 1)
        self.assertEqual(current["archiveRevision"], 0)
        self.assertEqual(current["lifecycleVersion"], 1)
        self.assert_missing_receipt(RENEW)
        # Even a freshly fenced command must not silently consume an expired approval.
        self.now = 1400
        fresh = self.f.renewal(self.state(), operation=RENEW, now=self.now, index=9)
        with self.assertRaises(ContractError):
            self.renew(fresh)
        self.assertEqual(self.state()["pendingAuthorization"]["authorizationId"], authorization)
        self.assert_missing_receipt(RENEW)

    def test_sdk_transport_commit_failure_leaves_all_three_documents_unchanged(self):
        body = self.f.renewal(self.state())
        before = copy.deepcopy(self.rpc.documents)
        original = self.rpc.commit

        def unavailable(**kwargs):
            if kwargs["request"]["writes"]:
                self.rpc.record("commit", kwargs)
                raise ServiceUnavailable("Synthetic renewal commit unavailable")
            return original(**kwargs)

        with patch.object(self.rpc, "commit", side_effect=unavailable):
            with self.assertRaises(ServiceUnavailable):
                self.renew(body)
        self.assertEqual(self.rpc.documents, before)
        self.assertEqual(self.state()["archiveRevision"], 0)
        self.assertEqual(self.state()["registrySequence"], 1)
        self.assert_missing_receipt(RENEW)

    def test_archive_approval_expiring_during_crypto_aborts_all_three_sdk_writes(self):
        body = self.f.renewal(self.state())
        archive_command = strict_json_loads(b64url_decode(body["archiveCommand"]["payload"]))
        archive_command["expiresAt"] = 1001
        body["archiveCommand"] = self.f.sign(archive_command, "root")
        command = strict_json_loads(b64url_decode(body["command"]["payload"]))
        command["archiveCommandFingerprint"] = signing_input_fingerprint(body["archiveCommand"])
        body["command"] = self.f.sign(command, "root")
        before = copy.deepcopy(self.rpc.documents)
        late = VaultKeyRenewalService(self.store, clock=iter([1000, 1001]).__next__)
        with self.assertRaises(ContractError) as error:
            late.renew(UID, self.f.vault, body, RENEW)
        self.assertEqual(error.exception.code, "key_authorization_required")
        self.assertEqual(self.rpc.documents, before)
        self.assertFalse(self.batches())
        self.assert_missing_receipt(RENEW)

    def test_existing_archive_operation_id_cannot_be_reused_to_corrupt_lifecycle_history(self):
        state = self.state()
        changed = self.f.replace(state, RENEW, archive=self.f.archive(state, index=4))
        original_receipt = self.lifecycle.replace_archive(UID, self.f.vault, changed, RENEW)
        body = self.f.renewal(self.state(), operation=RENEW)
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.calls.clear()
        with self.assertRaises(ContractError) as error:
            self.renew(body)
        self.assertEqual(error.exception.code, "idempotency_conflict")
        self.assertEqual(self.rpc.documents, before)
        self.assertFalse(self.batches())
        self.assertEqual(self.state()["lifecycleVersion"], 1)
        self.assertEqual(self.state()["archiveRevision"], 1)
        self.assertEqual(self.state()["registrySequence"], 1)
        self.assertEqual(self.lifecycle.receipt(UID, self.f.vault, RENEW), original_receipt)
        self.assert_missing_receipt(RENEW)

    def test_historical_key_reuse_is_refused_on_new_write_and_retained_proof_recovery(self):
        f = KeyRenewalFixture(OTHER_UID)
        past = f.add_key("omitted_recovery", "recovery_enc", "synthetic_retired_principal")
        f.bundle = f.make_bundle()
        f.registry = f.verify(f.bundle)
        self.vaults.bootstrap(OTHER_UID, f.bootstrap(), BOOT)
        del f.certificates["omitted_recovery"]
        omitted = f.make_bundle(previous=f.registry)
        self.vaults.update_registry(
            OTHER_UID,
            f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 1,
                "registryBundle": omitted,
            },
            "synthetic_sdk_omit_retired_key",
        )
        f.registry = f.verify(omitted, previous=f.registry)
        body = f.renewal(self.lifecycle.state(OTHER_UID, f.vault), roles=("recovery_enc",))
        command = strict_json_loads(b64url_decode(body["command"]["payload"]))
        target = command["renewals"][0]
        descriptions = []
        for entry in body["registryBundle"]["entries"]:
            cert = strict_json_loads(b64url_decode(entry["certificate"]["payload"]))
            if cert["keyId"] == target["newKeyId"]:
                cert.update(keyId=past["keyId"], publicJwk=past["publicJwk"])
                entry["certificate"] = f.sign(cert, "root")
            descriptions.append(
                {
                    "certificateId": cert["certificateId"],
                    "payloadDigest": archive_digest(cert),
                    "active": entry["active"],
                }
            )
        checkpoint = strict_json_loads(
            b64url_decode(body["registryBundle"]["checkpoint"]["payload"])
        )
        checkpoint["entriesDigest"] = archive_digest(
            sorted(descriptions, key=lambda item: item["certificateId"])
        )
        body["registryBundle"]["checkpoint"] = f.sign(checkpoint, "root")
        target["newKeyId"] = past["keyId"]
        command["newCheckpointDigest"] = archive_digest(checkpoint)
        body["command"] = f.sign(command, "root")
        # The generic shared verifier sees only the previous bundle and local
        # identity, so this root-signed candidate isolates the historical guard.
        self.assertIn(
            past["keyId"], f.verify(body["registryBundle"], previous=f.registry).certificates
        )
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.calls.clear()
        with self.assertRaises(ContractError) as error:
            self.service.renew(OTHER_UID, f.vault, body, RENEW)
        self.assertEqual(error.exception.code, "registry_conflict")
        self.assertEqual(self.rpc.documents, before)
        self.assertFalse(self.batches())
        # Simulate an older producer to verify that persisted proof recovery
        # independently rejects the same misuse rather than trusting its receipt.
        with patch("app.key_renewals._fresh_keys"):
            self.service.renew(OTHER_UID, f.vault, body, RENEW)
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.calls.clear()
        with self.assertRaises(StoreUnavailable):
            self.service.receipt(OTHER_UID, f.vault, RENEW)
        with self.assertRaises(StoreUnavailable):
            self.service.renew(OTHER_UID, f.vault, body, RENEW)
        self.assertEqual(self.rpc.documents, before)
        self.assertFalse(self.batches())

    def test_late_receipt_budget_failure_does_not_flush_earlier_pending_writes(self):
        body = self.f.renewal(self.state())
        before = copy.deepcopy(self.rpc.documents)
        from app import store

        original = store.stored_document

        def reject_receipt(value, *, path, project, database):
            if path.startswith("hub_operations/"):
                raise ContractError("payload_too_large")
            return original(value, path=path, project=project, database=database)

        self.rpc.calls.clear()
        with patch("app.store.stored_document", side_effect=reject_receipt):
            with self.assertRaises(ContractError) as error:
                self.renew(body)
        self.assertEqual(error.exception.code, "payload_too_large")
        self.assertEqual(self.rpc.documents, before)
        self.assertFalse(self.batches())
        self.assert_missing_receipt(RENEW)

    def test_old_renewal_replay_after_later_archive_change_only_returns_original_receipt(self):
        body = self.f.renewal(self.state())
        receipt = self.renew(body)
        state = self.state()
        next_op = "synthetic_sdk_after_renewal_passkey_change"
        change = self.f.replace(state, next_op, archive=self.f.archive(state, index=5))
        self.lifecycle.replace_archive(UID, self.f.vault, change, next_op)
        self.rpc.calls.clear()
        self.now = 1400
        restarted = VaultKeyRenewalService(self.store, clock=lambda: self.now)
        self.assertEqual(restarted.renew(UID, self.f.vault, body, RENEW), receipt)
        self.assertEqual(restarted.receipt(UID, self.f.vault, RENEW), receipt)
        self.assertEqual(self.state()["archive"], change["archive"])
        self.assertEqual(self.state()["archiveRevision"], 2)
        self.assertEqual(self.state()["registrySequence"], 2)
        self.assertFalse(self.batches())
        operation_path = document_path("hub_operations", owner_key(UID), "key-renewal", RENEW)
        self.assertTrue(any(key.endswith("/" + operation_path) for key in self.rpc.documents))

    def test_expired_renewal_replay_does_not_consume_or_reactivate_later_recovery_approval(self):
        body = self.f.renewal(self.state())
        receipt = self.renew(body)
        state = self.state()
        auth_op = "synthetic_sdk_post_renewal_approval"
        authorization = "synthetic_sdk_post_renewal_pending"
        auth = self.f.authorize(
            state, self.f.archive(state, index=6), auth_op, authorization=authorization
        )
        self.lifecycle.authorize_recovery(UID, self.f.vault, auth, auth_op)
        self.now = 1400
        pending = copy.deepcopy(self.state()["pendingAuthorization"])
        self.assertEqual(pending["status"], "expired")
        self.rpc.calls.clear()
        self.assertEqual(self.renew(body), receipt)
        self.assertEqual(self.service.receipt(UID, self.f.vault, RENEW), receipt)
        after = self.state()
        self.assertEqual(after["pendingAuthorization"], pending)
        self.assertEqual(after["lifecycleVersion"], 2)
        self.assertEqual(after["archiveRevision"], 1)
        self.assertFalse(self.batches())
