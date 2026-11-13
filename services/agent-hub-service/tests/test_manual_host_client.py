"""Distributed client pickup against local synthetic Hub; never a native job."""

import unittest

import private_client_fixture as sessions
import test_task_center_host as hosts
from fixtures import UID
from test_oauth import TASK
from test_persistent_identity_store import CONNECTION

from app.manual_intents import ManualAgentService, ManualOwnerService
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError


class ManualHostTests(unittest.TestCase):
    setUp = hosts.TaskCenterHostTests.setUp
    configure_execution = hosts.TaskCenterHostTests.configure_execution
    execution = hosts.TaskCenterHostTests.execution
    response = hosts.TaskCenterHostTests.response
    control = hosts.TaskCenterHostTests.control
    enroll_center = hosts.TaskCenterHostTests.enroll_center

    def handle(self, value):
        if value["path"].endswith("/task-center/manual/query"):
            body = value["body"]
            try:
                result = self.center_agent.pending_manual(
                    self.f.owner,
                    self.f.vault,
                    CONNECTION,
                    body["proof"],
                    value["path"],
                    body["request"],
                )
                return {"value": result}
            except ContractError as error:
                return {"status": error.status, "value": {"detail": {"code": error.code}}}
        result = hosts.TaskCenterHostTests.handle(self, value)
        if (
            getattr(self, "drop_begin", False)
            and value["path"].endswith("/runs/begin")
            and "value" in result
        ):
            self.drop_begin = False
            return {"networkError": True}
        if (
            getattr(self, "tamper", False)
            and value["path"].endswith("/task-center/prepare")
            and "value" in result
        ):
            result["value"]["manualControl"] = self.f.sign({"action": "manual_intent"})
        return result

    def prepare_manual(self):
        self.enroll_center()
        self.owner = ManualOwnerService(self.store, clock=lambda: self.fx.now)
        self.center_agent = ManualAgentService(
            self.store,
            self.fx.catalogue,
            audience=self.service.audience,
            client_ids=self.service.client_ids,
            clock=lambda: self.fx.now,
        )
        _, p = _signed_parts(self.last_signed)
        p.update(
            action="manual_intent",
            expectedAssignmentVersion=None,
            assignmentId=None,
            assignment=None,
            stableOperationId="synthetic_manual_host_intent_0001",
            intent={
                "expiresAt": self.fx.now + 600,
                "assignments": [
                    {
                        "assignmentId": self.assignment["assignmentId"],
                        "assignmentVersion": self.assignment["assignmentVersion"],
                    }
                ],
            },
        )
        self.owner.manual(UID, self.f.vault, TASK, self.f.sign(p), p["stableOperationId"])
        return {"taskId": TASK, "requestId": p["stableOperationId"]}

    def test_private_bundle_recovers_same_manual_pickup_after_network_loss_and_restart(self):
        args = self.prepare_manual()
        self.assertEqual(
            self.peer.call("pendingManual", {"taskId": TASK})["items"][0]["requestId"],
            args["requestId"],
        )
        self.drop_prepare = True
        self.assertEqual(
            self.peer.call("beginManual", args, ok=False)["error"], "runtime_network_unavailable"
        )
        self.peer.close()
        self.peer = sessions.RuntimePeer(self.handle, "private_host_peer.mjs")
        self.addCleanup(self.peer.close)
        self.peer.call(
            "load", {"directory": self.directory, "actor": self.actor, "provider": "muse"}
        )
        self.peer.call("initialize")
        run = self.peer.call("beginManual", args)
        self.assertEqual(run, self.peer.call("beginManual", args))
        state = self.owner.manual_state(UID, self.f.vault, TASK, args["requestId"])
        self.assertEqual(state["snapshot"]["executors"][0]["runId"], run["runId"])

    def test_forged_owner_intent_never_reaches_begin(self):
        args = self.prepare_manual()
        self.tamper = True
        self.assertFalse(self.peer.call("beginManual", args, ok=False)["ok"])
        state = self.owner.manual_state(UID, self.f.vault, TASK, args["requestId"])
        self.assertIsNone(state["snapshot"]["executors"][0]["runId"])

    def test_restored_history_requires_fresh_assignment_and_verifies_lifecycle_controls(self):
        self.prepare_manual()
        self.definition = self.control("trash")["definition"]
        self.definition = self.control("restore")["definition"]
        self.assertFalse(self.peer.call("taskCenterState", {"taskId": TASK}, ok=False)["ok"])
        self.assignment = self.control(
            "set_assignment",
            assignment=self.assignment,
            fingerprint=self.assignment["authorityFingerprint"],
        )["assignment"]
        state = self.peer.call("taskCenterState", {"taskId": TASK})
        self.assertEqual(state["definition"]["lifecycleEpoch"], 3)

    def test_lost_begin_response_recovers_original_run_after_pickup_deadline(self):
        args = self.prepare_manual()
        self.drop_begin = True
        self.assertFalse(self.peer.call("beginManual", args, ok=False)["ok"])
        before = self.owner.manual_state(UID, self.f.vault, TASK, args["requestId"])
        original = before["snapshot"]["executors"][0]["runId"]
        self.assertIsNotNone(original)
        self.fx.now += 601
        self.peer.call("clock", {"now": self.fx.now})
        recovered = self.peer.call("beginManual", args)
        self.assertEqual(recovered["runId"], original)
