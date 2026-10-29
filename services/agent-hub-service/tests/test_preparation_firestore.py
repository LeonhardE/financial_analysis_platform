"""Actual Firestore SDK preparation publication and retry guards over synthetic RPCs."""

import unittest

import test_preparations as fixtures
from fixtures import BOOT, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_oauth import TASK, configuration
from test_task_firestore import WriteConflictRpc

from app.oauth import OAuthService
from app.preparations import PreparationService
from app.store import FirestoreHubStore, document_path
from app.tasks import TaskService
from app.vaults import VaultService


class PreparationFirestoreTests(unittest.TestCase):
    consent = fixtures.PreparationTests.consent
    stage_all = fixtures.PreparationTests.stage_all
    publish = fixtures.PreparationTests.publish
    assert_code = fixtures.PreparationTests.assert_code

    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = WriteConflictRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.now = 1000
        self.fix = fixtures.PreparationFixture()
        self.sources = fixtures.Sources()
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.vaults.bootstrap(UID, self.fix.bootstrap(), BOOT)
        self.tasks = TaskService(self.store, self.sources, clock=lambda: self.now)
        self.resources = [{"ref": self.sources.ref, "sourceEpoch": 1}]
        self.original = self.tasks.create(
            UID,
            self.fix.task_body(resources=self.resources),
            "synthetic_oauth_task_create_1",
            self.fix.kid("device_sig"),
        )[0]
        self.oauth = OAuthService(self.store, configuration(), self.sources, clock=lambda: self.now)
        self.service = PreparationService(self.oauth)
        self.tokens, self.approved = self.consent()
        self.connection = self.approved["connectionId"]

    def batches(self):
        return [
            kw["request"]["writes"]
            for method, kw in self.rpc.calls
            if method == "commit" and kw["request"]["writes"]
        ]

    def inject(self, action):
        def win():
            self.rpc.before_abort = None
            action()

        self.rpc.aborts, self.rpc.before_abort = 1, win

    def test_publish_commits_ready_descriptor_and_delivery_tail_in_one_batch(self):
        intent, envelopes, selected = self.stage_all()
        self.rpc.calls.clear()
        receipt = self.service.commit(
            UID, self.connection, TASK, selected, "synthetic_preparation_sdk_commit"
        )
        self.assertEqual(len(self.batches()), 1)
        self.assertEqual(
            {w.update.name.split("/documents/")[1].split("/")[0] for w in self.batches()[0]},
            {"hub_preparations", "hub_task_deliveries"},
        )
        restarted = PreparationService(
            OAuthService(self.store, configuration(), self.sources, clock=lambda: self.now)
        )
        self.assertEqual(
            restarted.metadata(self.tokens["access_token"], TASK)["preparationId"],
            receipt["preparationId"],
        )
        self.assertEqual(
            receipt,
            restarted.commit(
                UID, self.connection, TASK, selected, "synthetic_preparation_sdk_commit"
            ),
        )

    def test_concurrent_task_delivery_change_retries_and_refuses_stale_publish(self):
        intent, envelopes, selected = self.stage_all()

        def compete():
            self.store.transact(
                lambda unit: unit.put(
                    document_path("hub_task_deliveries", self.fix.owner, self.fix.vault, TASK, "1"),
                    {"deliveryRevision": 2, "envelopeFingerprint": "a" * 64},
                )
            )

        # Inject conflict only in the publish callback, after its readonly preflight.
        original = self.store.transact
        reads = 0

        def transact(callback):
            nonlocal reads
            reads += 1
            if reads == 3:
                self.inject(compete)
            return original(callback)

        self.store.transact = transact
        self.assert_code(
            "version_conflict",
            lambda: self.service.commit(
                UID, self.connection, TASK, selected, "synthetic_preparation_sdk_conflict"
            ),
        )
        self.assertIsNone(
            original(
                lambda unit: unit.get(
                    document_path("hub_preparations", self.fix.owner, intent["preparationId"])
                )
            )
        )

    def test_read_observation_is_recorded_only_in_final_current_authority_transaction(self):
        intent, envelopes, selected, receipt = self.publish()
        self.rpc.calls.clear()
        obj = receipt["objects"][0]["objectId"]
        self.service.object(self.tokens["access_token"], receipt["preparationId"], obj)
        self.assertEqual(len(self.batches()), 1)
        self.assertEqual(
            {w.update.name.split("/documents/")[1].split("/")[0] for w in self.batches()[0]},
            {"hub_oauth_connections"},
        )
        observed = self.oauth.connections(UID)["items"][0]["grants"][0]
        self.assertTrue(observed["readObserved"])
        self.assertFalse(observed["resultSaved"])
