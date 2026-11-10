"""Native frozen-input and exact encrypted-report workflow with real JOSE."""

from fixtures import ACCESS
from native_fixtures import RPUB, NativeFixture

from app.contracts import Stopped
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_content import (
    inspect_persistent_carrier,
    open_persistent_content,
)


class NativeFlowTests(NativeFixture):
    def test_reads_frozen_task_and_one_approved_resource(self):
        task = self.read()
        self.assertEqual(task["data"]["name"], "Synthetic daily brief")
        resource = self.read(RPUB)
        self.assertEqual(resource["sourceVersion"], 1)
        self.assertEqual(resource["data"]["data"]["kind"], "holdings")
        self.assertEqual(len(self.wire.runs), 1)
        self.assertIn("hubPins", self.runtime.snapshot_state(ACCESS))

    def test_report_is_encrypted_only_to_owner_and_original_retry_returns_same_receipt(self):
        run = self.read()["runId"]
        result = self.engine.execute(
            "executor_report", {"runId": run, "report": self.report}, ACCESS
        )
        carrier = self.wire.submissions[0]["envelope"]
        _, context = inspect_persistent_carrier(carrier)
        for key in ["device", "recovery"]:
            opened = open_persistent_content(carrier["jwe"], self.keys[key], context=context)
            self.assertEqual(opened["payload"], self.report)
        with self.assertRaises(ContractError):
            open_persistent_content(carrier["jwe"], self.keys["encryption"], context=context)
        again = self.engine.execute(
            "executor_report", {"runId": run, "report": self.report}, ACCESS
        )
        self.assertEqual(result["receipt"], again["receipt"])
        self.assertEqual(len(self.wire.submissions), 1)

    def test_unknown_report_response_keeps_original_ciphertext_across_restart(self):
        run = self.read()["runId"]
        self.wire.drop_submit = True
        with self.assertRaises(Stopped):
            self.engine.execute("executor_report", {"runId": run, "report": self.report}, ACCESS)
        first = self.wire.submissions[0]
        self.wire.drop_submit = False
        runtime = self.new_runtime()
        runtime.restore()
        engine = self.new_engine(runtime)
        result = engine.execute("executor_report", {"runId": run, "report": self.report}, ACCESS)
        self.assertEqual(self.wire.submissions[1], first)
        self.assertEqual(len(self.wire.results), 1)
        self.assertEqual(result["status"], "saved")

    def test_changed_report_same_run_conflicts(self):
        run = self.read()["runId"]
        self.wire.drop_submit = True
        with self.assertRaises(Stopped):
            self.engine.execute("executor_report", {"runId": run, "report": self.report}, ACCESS)
        self.wire.drop_submit = False
        with self.assertRaises(Stopped):
            self.engine.execute(
                "executor_report",
                {"runId": run, "report": {**self.report, "summary": "changed"}},
                ACCESS,
            )
        self.assertEqual(len(self.wire.submissions), 1)

    def test_unknown_policy_ack_restores_same_keys_and_original_hub_receipt(self):
        run = self.read()["runId"]
        original = self.runtime.identity()
        respond = self.wire.respond

        def lose_ack(request):
            response = respond(request)
            if request.url.path.endswith("/runs/submit"):
                self.authority.drop_commit_response = True
            return response

        self.wire.respond = lose_ack
        engine = self.new_engine(self.runtime)
        args = {"runId": run, "report": self.report}
        with self.assertRaises(Stopped):
            engine.execute("executor_report", args, ACCESS)
        self.assertIsNone(self.runtime.head)
        self.authority.drop_commit_response = False
        self.wire.respond = respond
        result = engine.execute("executor_report", args, ACCESS)
        self.assertEqual(result["status"], "saved")
        self.assertEqual(len(self.wire.submissions), 1)
        self.assertEqual(self.runtime.identity()["tlsJwk"], original["tlsJwk"])
