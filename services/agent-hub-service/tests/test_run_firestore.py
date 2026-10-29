"""Actual Firestore SDK Run publication, collision and authority retries."""

import unittest

import test_preparation_firestore as preparation_fixtures
import test_runs as run_fixtures
from test_oauth import TASK

from app.oauth import OAuthFailure
from app.runs import RunService
from app.store import document_path


class RunFirestoreTests(unittest.TestCase):
    make_intent = run_fixtures.RunTests.make_intent

    def setUp(self):
        self.case = preparation_fixtures.PreparationFirestoreTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.case.publish()
        self.metadata = self.case.service.metadata(self.case.tokens["access_token"], TASK)
        self.runs = RunService(self.case.oauth)
        self.case.rpc.calls.clear()

    def test_publication_has_one_atomic_batch_and_frozen_pages_survive_restart(self):
        signed = self.make_intent()
        response, status = self.runs.begin(
            self.case.tokens["access_token"], TASK, signed, run_fixtures.OP
        )
        self.assertEqual(status, 201)
        batches = self.case.batches()
        self.assertEqual(len(batches), 1)
        self.assertEqual(
            {w.update.name.split("/documents/")[1].split("/")[0] for w in batches[0]},
            {
                "hub_runs",
                "hub_run_components",
                "hub_run_proofs",
                "hub_run_indexes",
                "hub_run_operations",
                "hub_run_quotas",
            },
        )
        self.assertEqual(len(batches[0]), 9)
        restarted = RunService(self.case.oauth)
        self.assertEqual(
            restarted.get(self.case.tokens["access_token"], response["run"]["runId"]), response
        )
        self.assertEqual(
            restarted.begin(self.case.tokens["access_token"], TASK, signed, run_fixtures.OP),
            (response, 200),
        )
        for proof in response["registryProofs"]:
            self.assertEqual(
                restarted.registry(
                    self.case.tokens["access_token"],
                    response["run"]["runId"],
                    proof["registrySequence"],
                )["registrySequence"],
                proof["registrySequence"],
            )

    def test_same_operation_racing_commit_retries_return_winner_without_duplicate_quota(self):
        token, signed = self.case.tokens["access_token"], self.make_intent()
        winner = []
        self.case.inject(
            lambda: winner.append(self.runs.begin(token, TASK, signed, run_fixtures.OP))
        )
        result, status = self.runs.begin(token, TASK, signed, run_fixtures.OP)
        self.assertEqual(winner[0][1], 201)
        self.assertEqual(status, 200)
        self.assertEqual(result, winner[0][0])
        quota = self.case.store.transact(
            lambda u: u.get(document_path("hub_run_quotas", self.case.fix.owner, "owner"))
        )
        self.assertEqual(quota["count"], 1)

    def test_revocation_during_publish_aborts_all_frozen_documents(self):
        token, signed = self.case.tokens["access_token"], self.make_intent()
        self.case.inject(
            lambda: self.case.oauth.revoke_connection(
                preparation_fixtures.UID, self.case.connection
            )
        )
        with self.assertRaises(OAuthFailure):
            self.runs.begin(token, TASK, signed, run_fixtures.OP)
        self.assertFalse(any("/hub_runs/" in path for path in self.case.rpc.documents))

    def test_daily_quota_collision_rechecks_winner_before_committing(self):
        token, signed = self.case.tokens["access_token"], self.make_intent()

        def exhaust():
            self.case.store.transact(
                lambda u: u.put(
                    document_path("hub_run_quotas", self.case.fix.owner, "owner"),
                    {"window": 0, "count": 200},
                )
            )

        self.case.inject(exhaust)
        with self.assertRaisesRegex(ValueError, "version_conflict"):
            self.runs.begin(token, TASK, signed, run_fixtures.OP)
        self.assertFalse(any("/hub_runs/" in path for path in self.case.rpc.documents))
