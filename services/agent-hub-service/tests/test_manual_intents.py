"""Signed manual intents and real local pickup/Begin/result transactions."""

import unittest
from concurrent.futures import ThreadPoolExecutor

import test_task_center_store as centers
from fixtures import OTHER_UID, UID
from test_oauth import TASK

from app.manual_intents import ManualAgentService, ManualOwnerService
from app.task_center import center_reference
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_content import digest
from folioview_shared.encrypted.task_center import assignment_trigger_id


class ManualIntentTests(unittest.TestCase):
    def setUp(self):
        self.fx = centers.TaskCenterStoreTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.f = self.fx.f
        self.owner = ManualOwnerService(self.fx.store, clock=lambda: self.fx.fx.now)
        self.fx.owner = self.owner
        old = self.fx.agent
        self.agent = ManualAgentService(
            old.store,
            old.catalogue,
            audience=old.audience,
            client_ids=old.client_ids,
            managed_only=True,
            clock=old.clock,
        )
        self.fx.agent = self.agent

    def create(self):
        _, payload = _signed_parts(self.fx.last_signed)
        self.fx.serial += 1
        payload.update(
            action="manual_intent",
            schedule=None,
            assignment=None,
            assignmentId=None,
            expectedAssignmentVersion=None,
            issuedAt=self.fx.fx.now,
            expectedDefinitionVersion=self.fx.definition["definitionVersion"],
            stableOperationId="manual_" + digest([self.fx.serial, self.fx.fx.now]),
            intent={
                "expiresAt": self.fx.fx.now + 600,
                "assignments": sorted(
                    [
                        {
                            "assignmentId": a["assignmentId"],
                            "assignmentVersion": a["assignmentVersion"],
                        }
                        for a in self.fx.assignments.values()
                    ],
                    key=lambda a: a["assignmentId"],
                ),
            },
        )
        self.signed = self.f.sign(payload)
        self.operation = payload["stableOperationId"]
        return self.owner.manual(UID, self.f.vault, TASK, self.signed, self.operation)

    def claim(self, request):
        a = self.fx.assignments[self.fx.connection]
        trigger = assignment_trigger_id(a, request, kind="manual")
        body = {
            "taskId": TASK,
            "baseTriggerId": request,
            "manualIntentId": request,
            "operationId": "begin_" + digest([self.f.owner, self.f.vault, TASK, trigger]),
            "binding": center_reference(self.fx.definition, a),
            "taskPublicationFingerprint": a["authorityFingerprint"],
        }
        return self.agent.prepare(*self.fx.args("task-center/prepare", body))

    def begin(self, request):
        prepared = self.claim(request)
        body = {
            "taskId": TASK,
            "triggerId": prepared["triggerId"],
            "operationId": prepared["request"]["operationId"],
            "taskPublicationFingerprint": prepared["request"]["taskPublicationFingerprint"],
        }
        return self.fx.execution.begin(*self.fx.args("runs/begin", body))

    def test_manual_retry_pickup_restart_and_result_have_owner_provenance(self):
        receipt = self.create()
        self.assertFalse(receipt["dispatchSupported"])
        self.assertEqual(
            self.owner.manual(UID, self.f.vault, TASK, self.signed, self.operation), receipt
        )
        first = self.begin(self.operation)
        self.assertEqual(first, self.begin(self.operation))
        self.assertEqual(
            self.owner.manual_state(UID, self.f.vault, TASK, self.operation)["aggregate"]["state"],
            "running",
        )
        submitted = self.fx.submit(first)
        state = self.owner.manual_state(UID, self.f.vault, TASK, self.operation)
        self.assertEqual(state["aggregate"]["state"], "waiting")
        self.assertEqual(state["aggregate"]["counts"]["result_received"], 1)
        self.fx.use(next(c for c in self.fx.assignments if c != self.fx.connection))
        self.fx.submit(self.begin(self.operation))
        self.assertEqual(
            self.owner.manual_state(UID, self.f.vault, TASK, self.operation)["aggregate"]["state"],
            "result_received",
        )
        feed = self.owner.results(UID, self.f.vault, TASK, {"limit": 20, "cursor": None})
        self.assertEqual({i["attribution"]["trigger"]["kind"] for i in feed["items"]}, {"manual"})
        self.assertEqual(
            state["snapshot"]["executors"][
                next(
                    i
                    for i, e in enumerate(state["snapshot"]["executors"])
                    if e["resultId"] == submitted["resultId"]
                )
            ]["stage"],
            "result_received",
        )

    def test_cancel_before_claim_is_idempotent_and_fences_late_pickup(self):
        self.create()
        self.assertEqual(
            self.owner.cancel_manual(UID, self.f.vault, TASK, self.operation),
            self.owner.cancel_manual(UID, self.f.vault, TASK, self.operation),
        )
        with self.assertRaises(ContractError):
            self.claim(self.operation)
        with self.assertRaises(ContractError):
            self.owner.manual_state(OTHER_UID, self.f.vault, TASK, self.operation)

    def test_claim_and_cancel_race_never_starts_a_cancelled_intent(self):
        self.create()

        def cancel():
            try:
                return self.owner.cancel_manual(UID, self.f.vault, TASK, self.operation)
            except ContractError:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            pending = pool.submit(cancel)
            try:
                self.claim(self.operation)
                claimed = True
            except ContractError:
                claimed = False
            result = pending.result()
        self.assertNotEqual(claimed, result is not None)
        if result:
            with self.assertRaises(ContractError):
                self.begin(self.operation)

    def test_expiry_and_trash_restore_do_not_replay_unclaimed_requests(self):
        self.create()
        self.fx.fx.now += 600
        state = self.owner.manual_state(UID, self.f.vault, TASK, self.operation)
        self.assertTrue(all(v == "timed_out" for v in state["reasons"].values()))
        with self.assertRaises(ContractError):
            self.claim(self.operation)
        self.fx.definition = self.fx.control("trash")["definition"]
        with self.assertRaises(ContractError):
            self.owner.manual_list(UID, self.f.vault, TASK)
        self.fx.definition = self.fx.control("restore")["definition"]
        with self.assertRaises(ContractError):
            self.claim(self.operation)

    def test_fifo_is_per_actor_and_manual_namespace_is_separate(self):
        first = self.create()["requestId"]
        second = self.create()["requestId"]
        with self.assertRaises(ContractError):
            self.claim(second)
        run = self.begin(first)
        # An unverified scheduled/legacy request with the same public base has
        # its own namespace; manual pickup does not consume or relabel it.
        legacy = self.fx.begin(first)
        self.assertNotEqual(run["manifest"]["runId"], legacy["manifest"]["runId"])
        self.fx.submit(run)
        self.assertIsNotNone(self.begin(second)["manifest"])

    def test_deleted_pending_and_inflight_intents_are_not_reactivated_by_restore(self):
        request = self.create()["requestId"]
        run = self.begin(request)
        self.fx.definition = self.fx.control("trash")["definition"]
        with self.assertRaises(ContractError):
            self.fx.submit(run)
        self.fx.definition = self.fx.control("restore")["definition"]
        with self.assertRaises(ContractError):
            self.claim(request)

    def test_owner_queue_is_bounded_and_cancelled_slot_can_be_reused(self):
        receipts = [self.create() for _ in range(16)]
        with self.assertRaises(ContractError):
            self.create()
        self.owner.cancel_manual(UID, self.f.vault, TASK, receipts[0]["requestId"])
        self.create()
        self.assertEqual(len(self.owner.manual_list(UID, self.f.vault, TASK)["items"]), 16)

    def test_durable_pickup_remains_valid_after_control_admission_freshness_window(self):
        request = self.create()["requestId"]
        self.fx.fx.now += 599
        self.assertIsNotNone(self.begin(request)["manifest"])
