"""Closed runtime uses real synthetic Hub transactions; no browser or real account."""

import json
import os
import selectors
import shutil
import subprocess
from pathlib import Path

from test_oauth import CLIENT

from app.persistent_plans import PersistentPlanService
from app.persistent_results import PersistentResultService
from folioview_shared.encrypted.errors import ContractError

ORIGIN = "https://synthetic-hub.example"
ROOT = Path(__file__).resolve().parent
METHODS = {
    "session": "session",
    "consent-receipts": "consent_receipt",
    "tasks": "tasks",
    "task-input": "task_input",
    "runs/begin": "begin",
    "runs/receipt": "run_receipt",
    "runs/input": "input",
    "runs/submit": "submit",
    "runs/result-receipt": "result_receipt",
    "plans/state": "plan_state",
    "plans/report": "report_plan",
}


class RuntimePeer:
    def __init__(self, handle, peer_file="private_host_peer.mjs"):
        self.handle = handle
        self.serial = 0
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        if node is None:
            raise AssertionError("Node required; this suite must not silently skip")
        self.process = subprocess.Popen(
            [node, str(ROOT / peer_file)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "NODE_OPTIONS": ""},
        )

    def close(self):
        if self.process.poll() is not None:
            return
        self.process.stdin.close()
        self.process.terminate()
        self.process.wait(timeout=5)
        self.process.stdout.close()
        self.process.stderr.close()

    def send(self, value):
        self.process.stdin.write(json.dumps(value) + "\n")
        self.process.stdin.flush()

    def call(self, method, args=None, *, ok=True):
        self.serial += 1
        self.send({"id": self.serial, "method": method, "args": args or {}, "origin": ORIGIN})
        while True:
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdout, selectors.EVENT_READ)
                if not selector.select(timeout=12):
                    raise AssertionError("Runtime failed a bounded request")
                line = self.process.stdout.readline()
            if not line:
                raise AssertionError("Synthetic runtime exited unexpectedly")
            value = json.loads(line)
            if "fetch" in value:
                self.send({"response": value["fetch"], **self.handle(value)})
            elif value.get("id") == self.serial:
                if ok and not value["ok"]:
                    raise AssertionError("Runtime denied synthetic operation: " + value["error"])
                return value.get("value") if ok else value
            else:
                raise AssertionError("Unexpected runtime reply")


class PrivateClientServiceFixture:
    def handle(self, value):
        path, body = value["path"], value["body"]
        try:
            route = path.removeprefix(self.base + "/")
            target = self.plans if route.startswith("plans/") else self.service
            result = getattr(target, METHODS[route])(
                self.f.owner,
                self.f.vault,
                self.connection,
                body["proof"],
                path,
                body["request"],
            )
            if route == "plans/report":
                self.plan_requests.append(json.dumps(body["request"], sort_keys=True))
                if self.drop_next_plan:
                    self.drop_next_plan = False
                    return {"networkError": True}
            if route == "runs/submit":
                self.ciphertexts.append(json.dumps(body["request"]["envelope"], sort_keys=True))
                if self.drop_next_report:
                    self.drop_next_report = False
                    return {"networkError": True}
            return {"value": result}
        except ContractError as error:
            status = (
                404
                if error.code == "not_found"
                else 403
                if error.code in {"key_authorization_required", "insufficient_scope"}
                else 409
            )
            return {"status": status, "value": {"error": error.code}}

    def configure_execution(self, store, catalogue):
        self.base = (
            f"/agent/v3/persistent/owners/{self.f.owner}/vaults/{self.f.vault}"
            f"/connections/{self.connection}"
        )
        self.service = PersistentResultService(
            store, catalogue, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: self.fx.now
        )

        self.plans = PersistentPlanService(
            store, catalogue, audience=ORIGIN, client_ids=[CLIENT], clock=lambda: self.fx.now
        )
