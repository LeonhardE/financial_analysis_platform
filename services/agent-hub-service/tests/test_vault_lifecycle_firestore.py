"""Real Firestore SDK lifecycle commits against bounded, synthetic conflict RPCs."""

import unittest

from fixtures import BOOT, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_task_firestore import WriteConflictRpc
from vault_lifecycle_fixtures import LifecycleFixture

from app.store import FirestoreHubStore
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError

REPLACE = "synthetic_sdk_archive_replace_0001"
AUTHORIZE = "synthetic_sdk_recovery_authorize_0001"
RECOVER = "synthetic_sdk_recovery_replace_0001"
AUTHORIZATION = "synthetic_sdk_recovery_authorization"


class FirestoreVaultLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = WriteConflictRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.now = 1000
        self.service = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.f = LifecycleFixture()
        self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.rpc.calls.clear()

    def state(self):
        return self.service.state(UID, self.f.vault)

    def replace(self, body=None, operation=REPLACE):
        return self.service.replace_archive(
            UID,
            self.f.vault,
            self.f.replace(self.state(), operation) if body is None else body,
            operation,
        )

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

    def test_archive_and_signed_history_are_one_sdk_atomic_commit(self):
        body = self.f.replace(self.state(), REPLACE)
        self.rpc.calls.clear()
        result = self.replace(body)
        batches = self.batches()
        self.assertEqual([len(batch) for batch in batches], [2])
        collections = {
            write.update.name.split("/documents/")[1].split("/")[0] for write in batches[0]
        }
        self.assertEqual(collections, {"hub_vaults", "hub_vault_lifecycle"})
        self.assertEqual(self.service.receipt(UID, self.f.vault, REPLACE), result)
        self.assertEqual(self.state()["archive"], body["archive"])

    def test_conflicting_archive_winner_rechecks_dual_cas_on_sdk_retry(self):
        state = self.state()
        winner_op = "synthetic_sdk_archive_winner_0001"
        loser_op = "synthetic_sdk_archive_loser_0001"
        winner = self.f.replace(state, winner_op, archive=self.f.archive(state, 1))
        loser = self.f.replace(state, loser_op, archive=self.f.archive(state, 2))
        accepted = []
        self.inject(lambda: accepted.append(self.replace(winner, winner_op)))
        with self.assertRaises(ContractError) as failed:
            self.replace(loser, loser_op)
        self.assertEqual(failed.exception.code, "version_conflict")
        self.assertEqual(self.state()["archive"], winner["archive"])
        self.assertEqual(self.state()["archiveRevision"], 1)
        self.assertEqual(self.service.receipt(UID, self.f.vault, winner_op), accepted[0])
        with self.assertRaises(ContractError) as missing:
            self.service.receipt(UID, self.f.vault, loser_op)
        self.assertEqual(missing.exception.code, "not_found")

    def test_same_operation_race_returns_original_receipt_without_second_revision(self):
        body = self.f.replace(self.state(), REPLACE)
        accepted = []
        self.inject(lambda: accepted.append(self.replace(body)))
        result = self.replace(body)
        self.assertEqual(result, accepted[0])
        self.assertEqual(self.state()["archiveRevision"], 1)
        self.assertEqual(self.state()["lifecycleVersion"], 1)
        self.assertEqual(self.service.receipt(UID, self.f.vault, REPLACE), result)
        self.assertEqual([len(batch) for batch in self.batches()], [2, 2])

    def test_registry_race_invalidates_signed_archive_command_before_retry_commit(self):
        body = self.f.replace(self.state(), REPLACE)
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
                "synthetic_sdk_lifecycle_registry_0001",
            )
        )
        with self.assertRaises(ContractError):
            self.replace(body)
        self.assertEqual(self.state()["archiveRevision"], 0)
        self.assertFalse(any("/hub_vault_lifecycle/" in key for key in self.rpc.documents))

    def test_recovery_consumption_and_receipt_commit_with_archive_and_survive_restart(self):
        initial = self.state()
        archive = self.f.archive(initial)
        auth_body = self.f.authorize(initial, archive, AUTHORIZE, authorization=AUTHORIZATION)
        self.service.authorize_recovery(UID, self.f.vault, auth_body, AUTHORIZE)
        state = self.state()
        body = self.f.replace(
            state, RECOVER, archive=archive, mode="recovery", authorization=AUTHORIZATION
        )
        self.rpc.calls.clear()
        result = self.replace(body, RECOVER)
        self.assertEqual([len(batch) for batch in self.batches()], [2])
        self.assertIsNone(self.state()["pendingAuthorization"])
        restarted = VaultLifecycleService(self.store, clock=lambda: 1500)
        self.assertEqual(restarted.receipt(UID, self.f.vault, RECOVER), result)
        self.assertEqual(restarted.replace_archive(UID, self.f.vault, body, RECOVER), result)
        self.assertEqual(restarted.state(UID, self.f.vault)["archiveRevision"], 1)
        self.assertIsNone(restarted.state(UID, self.f.vault)["pendingAuthorization"])
        self.assertEqual([len(batch) for batch in self.batches()], [2])

    def test_competing_recovery_consumer_cannot_both_spend_one_authorization(self):
        initial = self.state()
        archive = self.f.archive(initial)
        self.service.authorize_recovery(
            UID,
            self.f.vault,
            self.f.authorize(initial, archive, AUTHORIZE, authorization=AUTHORIZATION),
            AUTHORIZE,
        )
        state = self.state()
        winner_op = "synthetic_sdk_recover_winner_0001"
        loser_op = "synthetic_sdk_recover_loser_0001"
        winner = self.f.replace(
            state, winner_op, archive=archive, mode="recovery", authorization=AUTHORIZATION
        )
        loser = self.f.replace(
            state, loser_op, archive=archive, mode="recovery", authorization=AUTHORIZATION
        )
        accepted = []
        self.inject(lambda: accepted.append(self.replace(winner, winner_op)))
        with self.assertRaises(ContractError):
            self.replace(loser, loser_op)
        current = self.state()
        self.assertEqual(current["archiveRevision"], 1)
        self.assertEqual(current["lifecycleVersion"], 2)
        self.assertIsNone(current["pendingAuthorization"])
        self.assertEqual(self.service.receipt(UID, self.f.vault, winner_op), accepted[0])
        with self.assertRaises(ContractError):
            self.service.receipt(UID, self.f.vault, loser_op)
