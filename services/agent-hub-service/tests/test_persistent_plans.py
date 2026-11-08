"""Native plan declarations cannot impersonate platform attestation or content authority."""

import unittest
from concurrent.futures import ThreadPoolExecutor

import test_persistent_execution as executions
import test_persistent_results as results
from fixtures import OTHER_UID, UID
from test_oauth import TASK
from test_persistent_identity_store import CONNECTION

from app.persistent_plans import (
    MAX_REPORTS_PER_DAY,
    PersistentOwnerPlanService,
    PersistentPlanService,
    plan_path,
)
from app.store import StoreUnavailable, document_path


class PersistentPlanTests(unittest.TestCase):
    def setUp(self):
        self.x = executions.PersistentExecutionTests()
        self.x.setUp()
        self.addCleanup(self.x.doCleanups)
        self.f, self.fx = self.x.f, self.x.fx
        self.service = PersistentPlanService(
            self.fx.store,
            self.fx.catalogue,
            audience=executions.ISSUER,
            client_ids=self.x.service.client_ids,
            clock=lambda: self.fx.now,
        )
        self.history = PersistentOwnerPlanService(self.fx.store, clock=lambda: self.fx.now)

    def request(self, **changes):
        return {
            "taskId": TASK,
            "taskPublicationFingerprint": self.x.task["fingerprint"],
            "operationId": "synthetic_native_plan_report_0001",
            "expectedVersion": 0,
            "provider": "muse",
            "planReferenceHash": "a" * 64,
            "reportedStatus": "enabled",
            "reportedAt": self.fx.now,
            **changes,
        }

    def report(self, request=None):
        return self.service.report_plan(*self.x.args("plans/report", request or self.request()))

    def state(self):
        return self.history.state(UID, self.f.vault, CONNECTION, TASK)

    def test_statement_preserves_signed_evidence_but_never_claims_native_attestation(self):
        self.assertIsNone(self.state()["reported"])
        self.assertIsNone(self.state()["observed"])
        saved = self.report()
        state = self.state()
        self.assertEqual(state["reported"], saved)
        self.assertEqual(state["version"], 1)
        self.assertEqual(state["desired"]["taskPublicationFingerprint"], self.x.task["fingerprint"])
        self.assertEqual(saved["authority"], "agent_statement")
        self.assertFalse(saved["nativeScheduleAttested"])
        self.assertFalse(state["nativeScheduleAttested"])
        self.assertEqual(state["reportedEvidence"]["request"], self.request())
        self.assertNotIn("planReference", state["reportedEvidence"]["request"])
        self.assertEqual(
            self.service.plan_state(*self.x.args("plans/state", {"taskId": TASK})),
            {k: v for k, v in state.items() if k != "parentRevoked"},
        )
        self.assertEqual(self.fx.state()["consent"]["version"], 1)

    def test_lost_response_and_restart_return_original_receipt_without_consuming_quota(self):
        request = self.request()
        first = self.report(request)
        self.fx.now += 1000
        restored = PersistentPlanService(
            self.fx.store,
            self.fx.catalogue,
            audience=executions.ISSUER,
            client_ids=self.x.service.client_ids,
            clock=lambda: self.fx.now,
        )
        self.assertEqual(restored.report_plan(*self.x.args("plans/report", request)), first)
        self.x.rejects(
            "idempotency_conflict", lambda: self.report({**request, "reportedStatus": "paused"})
        )
        self.assertEqual(self.state()["version"], 1)

    def test_malformed_secret_fields_stale_task_wrong_path_key_and_future_observation_fail(self):
        for changed in (
            {"token": "never_accepted"},
            {"schedule": {"cadence": "daily"}},
            {"reportedStatus": []},
            {"expectedVersion": True},
            {"planReferenceHash": "https://provider.example/plan"},
            {"reportedStatus": "enabled", "planReferenceHash": None},
            {"reportedAt": self.fx.now + 3},
        ):
            self.x.rejects(
                "malformed_request", lambda changed=changed: self.report(self.request(**changed))
            )
        self.x.rejects(
            "version_conflict",
            lambda: self.report(self.request(taskPublicationFingerprint="0" * 64)),
        )
        self.x.rejects(
            "key_authorization_required",
            lambda: self.service.report_plan(*self.x.args("plans/state", self.request())),
        )
        self.x.rejects(
            "invalid_signature",
            lambda: self.service.report_plan(
                *self.x.args("plans/report", self.request(), key="device_sig")
            ),
        )
        self.assertIsNone(self.state()["reported"])

    def test_simultaneous_different_statements_have_one_cas_winner_and_no_lost_execution(self):
        packets = [
            self.x.args("plans/report", self.request(operationId=f"synthetic_plan_report_{n:04d}"))
            for n in range(2)
        ]

        def send(args):
            try:
                return self.service.report_plan(*args)["version"]
            except Exception as error:
                return getattr(error, "code", "unexpected")

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(send, packets))
        self.assertCountEqual(outcomes, [1, "version_conflict"])
        self.x.begin()
        self.assertEqual(self.state()["version"], 1)
        self.assertEqual(self.state()["observed"]["source"], "hub_run_receipt")
        self.assertFalse(self.state()["observed"]["nativeScheduleAttested"])
        self.report(
            self.request(
                operationId="synthetic_plan_report_next_0001",
                expectedVersion=1,
                reportedStatus="paused",
            )
        )
        self.assertIsNotNone(self.state()["observed"])

    def test_owner_partition_revoked_parent_and_corrupt_head_never_fake_an_enabled_plan(self):
        self.report()
        self.x.rejects(
            "not_found", lambda: self.history.state(OTHER_UID, self.f.vault, CONNECTION, TASK)
        )
        self.fx.store.transact(
            lambda u: u.put(
                document_path("hub_oauth_connections", self.f.owner, CONNECTION),
                {**self.fx.conn, "status": "revoked"},
            )
        )
        self.assertTrue(self.state()["parentRevoked"])
        self.x.rejects(
            "key_authorization_required",
            lambda: self.report(
                self.request(expectedVersion=1, operationId="synthetic_plan_after_revoke_0001")
            ),
        )
        row = self.fx.store.transact(
            lambda u: u.get(plan_path(self.f.owner, self.f.vault, CONNECTION, TASK))
        )
        row["reported"]["nativeScheduleAttested"] = True
        self.fx.store.transact(
            lambda u: u.put(plan_path(self.f.owner, self.f.vault, CONNECTION, TASK), row)
        )
        with self.assertRaises(StoreUnavailable):
            self.state()

    def test_separate_quota_does_not_consume_run_budget_and_exact_retry_remains_readable(self):
        request = self.request()
        saved = self.report(request)
        quota = document_path(
            "hub_persistent_plan_quotas", self.f.owner, CONNECTION, str(self.fx.now // 86400)
        )
        self.fx.store.transact(lambda u: u.put(quota, {"count": MAX_REPORTS_PER_DAY}))
        self.assertEqual(self.report(request), saved)
        self.x.rejects(
            "version_conflict",
            lambda: self.report(
                self.request(expectedVersion=1, operationId="synthetic_plan_after_quota_0001")
            ),
        )
        self.assertEqual(self.x.begin()["state"], "ready")


class ObservedResultTests(unittest.TestCase):
    def test_actual_result_receipt_is_distinct_from_native_plan_installation(self):
        case = results.PersistentResultTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        history = PersistentOwnerPlanService(case.fx.store, clock=lambda: case.fx.now)
        before = history.state(UID, case.f.vault, CONNECTION, TASK)
        self.assertIsNone(before["reported"])
        receipt = case.submit()
        after = history.state(UID, case.f.vault, CONNECTION, TASK)
        self.assertEqual(after["observed"]["source"], "hub_result_receipt")
        self.assertEqual(after["observed"]["resultId"], receipt["resultId"])
        self.assertFalse(after["nativeScheduleAttested"])
        self.assertIsNone(after["reported"])
        self.assertEqual(case.submit(), receipt)
        self.assertEqual(history.state(UID, case.f.vault, CONNECTION, TASK), after)

    def test_delayed_result_does_not_replace_another_run_created_in_same_second(self):
        case = results.PersistentResultTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        history = PersistentOwnerPlanService(case.fx.store, clock=lambda: case.fx.now)
        second = case.x.begin(
            operationId="synthetic_second_run_operation_0001",
            triggerId="synthetic_second_run_trigger_0001",
        )
        self.assertNotEqual(second["manifest"]["runId"], case.manifest["runId"])
        case.submit()
        observed = history.state(UID, case.f.vault, CONNECTION, TASK)["observed"]
        self.assertEqual(observed["runId"], second["manifest"]["runId"])
        self.assertIsNone(observed["resultId"])
