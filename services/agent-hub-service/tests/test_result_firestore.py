"""Actual Firestore SDK result transactions and races over bounded synthetic RPCs."""

import unittest

import test_preparation_firestore as fixtures
import test_results as result_fixtures
import test_runs as run_fixtures
from fixtures import UID
from test_oauth import TASK

from app.fences import FenceService
from app.oauth import OAuthFailure
from app.results import ResultService, result_path
from app.runs import RunService
from app.store import document_path
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_STORED_DOCUMENT_BYTES
from folioview_shared.encrypted.errors import ContractError


class ResultFirestoreTests(unittest.TestCase):
    make_intent = run_fixtures.RunTests.make_intent
    make_carrier = result_fixtures.ResultTests.make_carrier
    submit = result_fixtures.ResultTests.submit

    def setUp(self):
        self.case = fixtures.PreparationFirestoreTests()
        with result_fixtures.result_consent():
            self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.case.publish()
        self.metadata = self.case.service.metadata(self.case.tokens["access_token"], TASK)
        self.runs = RunService(self.case.oauth)
        self.runResponse, _ = self.runs.begin(
            self.case.tokens["access_token"], TASK, self.make_intent(), run_fixtures.OP
        )
        self.results = ResultService(self.case.oauth)
        self.run_id = self.runResponse["run"]["runId"]
        self.result_id = self.runResponse["run"]["initialResultId"]
        self.token = self.case.tokens["access_token"]
        self.case.rpc.calls.clear()

    def test_initial_commit_is_atomic_bounded_and_restart_recovers_original_receipt(self):
        receipt, status = self.submit()
        self.assertEqual(status, 201)
        batches = self.case.batches()
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(batches[0]), 8)
        self.assertEqual(
            {w.update.name.split("/documents/")[1].split("/")[0] for w in batches[0]},
            {
                "hub_results",
                "hub_result_revisions",
                "hub_result_operations",
                "hub_result_indexes",
                "hub_runs",
                "hub_oauth_connections",
            },
        )
        self.assertTrue(
            all(
                len(w.update._pb.SerializeToString()) <= MAX_STORED_DOCUMENT_BYTES
                for w in batches[0]
            )
        )
        self.assertLess(sum(len(w._pb.SerializeToString()) for w in batches[0]), 10 * 1024 * 1024)
        restarted = ResultService(self.case.oauth)
        self.assertEqual(restarted.receipt(self.token, self.run_id, result_fixtures.OP), receipt)
        self.assertEqual(
            restarted.submit(
                self.token,
                self.run_id,
                result_fixtures.json_carrier(
                    self.case.store.transact(
                        lambda u: u.get(
                            document_path(
                                "hub_result_revisions", self.case.fix.owner, self.result_id, "1"
                            )
                        )
                    )
                ),
                result_fixtures.OP,
            ),
            (receipt, 200),
        )

    def test_same_operation_collision_retries_return_one_winner_and_do_not_duplicate_result(self):
        carrier = self.make_carrier()
        winner = []
        self.case.inject(lambda: winner.append(self.submit(carrier)))
        result, status = self.submit(carrier)
        self.assertEqual(winner[0][1], 201)
        self.assertEqual((result, status), (winner[0][0], 200))
        head = self.case.store.transact(
            lambda u: u.get(result_path(self.case.fix.owner, self.result_id))
        )
        self.assertEqual(head["metadata"]["revision"], 1)
        self.assertEqual(
            self.case.store.transact(
                lambda u: u.get(document_path("hub_result_indexes", self.case.fix.owner))
            )["resultIds"],
            [self.result_id],
        )

    def test_competing_initial_operations_cannot_publish_second_result(self):
        other = "synthetic_result_sdk_other_first"
        carrier = self.make_carrier(other)
        winner = []
        self.case.inject(lambda: winner.append(self.submit()))
        with self.assertRaises(ContractError) as caught:
            self.submit(carrier, other)
        self.assertEqual(caught.exception.code, "initial_result_exists")
        self.assertEqual(
            self.results.receipt(self.token, self.run_id, result_fixtures.OP), winner[0][0]
        )
        self.assertIsNone(self.results.receipt(self.token, self.run_id, other))

    def test_competing_revisions_retry_cas_and_preserve_winner_and_original_receipt(self):
        first, _ = self.submit()
        winner_op, loser_op = (
            "synthetic_result_sdk_revision_winner",
            "synthetic_result_sdk_revision_loser",
        )
        winner, loser = (
            self.make_carrier(winner_op, revision=2),
            self.make_carrier(loser_op, revision=2),
        )
        accepted = []
        self.case.inject(
            lambda: accepted.append(
                self.results.revise(self.token, self.result_id, 1, winner, winner_op)
            )
        )
        with self.assertRaises(ContractError) as caught:
            self.results.revise(self.token, self.result_id, 1, loser, loser_op)
        self.assertEqual(caught.exception.code, "version_conflict")
        self.assertEqual(self.results.receipt(self.token, self.run_id, winner_op), accepted[0][0])
        self.assertEqual(self.results.receipt(self.token, self.run_id, result_fixtures.OP), first)
        self.assertIsNone(self.results.receipt(self.token, self.run_id, loser_op))

    def test_racing_source_invalidation_is_read_dependency_and_prevents_result_commit(self):
        mutation = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": self.case.fix.owner,
            "mutationId": "synthetic_result_sdk_source_fence",
            "ref": self.case.sources.ref,
            "expectedSourceEpoch": 1,
            "newSourceEpoch": 2,
            "reason": "disconnected",
        }
        self.case.inject(
            lambda: FenceService(self.case.store).invalidate(mutation, source_service="portfolio")
        )
        with self.assertRaises(ContractError) as caught:
            self.submit()
        self.assertEqual(caught.exception.code, "version_conflict")
        self.assertIsNone(self.results.receipt(self.token, self.run_id, result_fixtures.OP))
        self.assertFalse(any("/hub_result" in path for path in self.case.rpc.documents))

    def test_connection_revocation_during_save_retries_and_refuses_stale_authority(self):
        self.case.inject(lambda: self.case.oauth.revoke_connection(UID, self.case.connection))
        with self.assertRaises(OAuthFailure):
            self.submit()
        self.assertFalse(any("/hub_result" in path for path in self.case.rpc.documents))
        connection = self.case.store.transact(
            lambda u: u.get(
                document_path("hub_oauth_connections", self.case.fix.owner, self.case.connection)
            )
        )
        self.assertFalse(connection["grants"][TASK]["resultSaved"])
