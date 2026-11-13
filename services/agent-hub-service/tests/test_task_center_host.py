"""Actual private client bundle against synthetic Hub transactions; no cloud calls."""

import os
import shutil
import subprocess
import unittest
from pathlib import Path

import test_private_host_client as hosts
import test_task_center_store as centers
from test_oauth import TASK
from test_persistent_identity_store import CONNECTION

from app.provider_connections import slot_path
from app.task_center import TaskCenterAgentService
from app.task_center_results import TaskCenterResultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.provider_connections import (
    PROVIDER_CONNECTION_PROFILE,
    provider_slot_id,
    validate_provider_slot,
)


class TaskCenterHostTests(unittest.TestCase):
    setUp = hosts.PrivateHostClientTests.setUp
    configure_execution = hosts.PrivateHostClientTests.configure_execution
    execution = hosts.PrivateHostClientTests.execution
    response = hosts.PrivateHostClientTests.response
    control = centers.TaskCenterStoreTests.control

    def handle(self, value):
        route = value["path"].split("/task-center/", 1)
        if len(route) == 1:
            return hosts.PrivateHostClientTests.handle(self, value)
        try:
            body = value["body"]
            method = {"context": "context", "prepare": "prepare", "plans/report": "report_plan"}[
                route[1]
            ]
            result = getattr(self.center_agent, method)(
                self.f.owner,
                self.f.vault,
                CONNECTION,
                body["proof"],
                value["path"],
                body["request"],
            )
            if route[1] == "prepare" and getattr(self, "drop_prepare", False):
                self.drop_prepare = False
                return {"networkError": True}
            return {"value": result}
        except ContractError as error:
            return {"status": error.status, "value": {"detail": {"code": error.code}}}

    def enroll_center(self):
        case = self.execution()
        self.store = self.fx.store
        lease = self.activation["lease"]
        # Validated synthetic current-slot snapshot. The real cutover and setup
        # producers are independently exercised in test_task_center_store.
        ref = {
            "connectionId": CONNECTION,
            "clientId": lease["clientId"],
            "credentialGeneration": lease["generation"],
            "credentialFingerprint": lease["credentialFingerprint"],
        }
        self.slot = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROVIDER_CONNECTION_PROFILE,
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "provider": "muse",
            "slotId": provider_slot_id(self.f.owner, "muse"),
            "slotVersion": 1,
            "slotGeneration": 1,
            "currentCredential": ref,
            "lastCredential": ref,
        }
        validate_provider_slot(
            self.slot, owner_subject=self.f.owner, vault_id=self.f.vault, provider="muse"
        )
        self.store.transact(
            lambda u: u.put(
                slot_path(self.f.owner, "muse"),
                {
                    "slot": self.slot,
                    "retainedSelections": [],
                    "operationId": "synthetic_host_slot_operation_0001",
                },
            )
        )
        self.owner = TaskCenterResultService(self.store, clock=lambda: self.fx.now)
        self.serial = 0
        self.identity = self.fx.identity
        self.definition = self.control("set_rules")["definition"]
        from app.persistent_publications import stored_authority

        current = self.store.transact(
            lambda u: stored_authority(u, self.f.owner, self.f.vault, TASK, CONNECTION)
        )
        self.assignment = self.control("set_assignment", fingerprint=current["fingerprint"])[
            "assignment"
        ]
        self.center_agent = TaskCenterAgentService(
            self.store,
            self.fx.catalogue,
            audience=self.service.audience,
            client_ids=self.service.client_ids,
            clock=lambda: self.fx.now,
        )
        self.peer.call("activate", self.response())
        self.peer.call("initialize")
        return case

    def test_bundle_verifies_owner_rules_and_recovers_same_begin_after_process_restart(self):
        self.enroll_center()
        state = self.peer.call("taskCenterState", {"taskId": TASK})
        self.assertEqual(state["assignment"], self.assignment)
        self.assertEqual(self.peer.call("dueAssigned"), [])
        args = {"taskId": TASK, "baseTriggerId": "synthetic_center_host_run_0001"}
        self.drop_prepare = True
        self.assertEqual(
            self.peer.call("beginAssigned", args, ok=False)["error"], "runtime_network_unavailable"
        )
        self.peer.close()
        import private_client_fixture as sessions

        self.peer = sessions.RuntimePeer(self.handle, "private_host_peer.mjs")
        self.addCleanup(self.peer.close)
        self.peer.call(
            "load", {"directory": self.directory, "actor": self.actor, "provider": "muse"}
        )
        self.peer.call("initialize")
        run = self.peer.call("beginAssigned", args)
        self.assertEqual(self.peer.call("beginAssigned", args), run)
        self.control("remove_assignment", assignment=self.assignment)
        self.assertFalse(self.peer.call("taskCenterState", {"taskId": TASK}, ok=False)["ok"])

    def test_new_calendar_and_trigger_consumer_matches_frozen_foundation(self):
        root = Path(__file__).resolve().parents[1] / "agent-client"
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node)
        result = subprocess.run(
            [node, "--test", str(root / "tests/task-center.test.mjs")],
            capture_output=True,
            text=True,
            timeout=25,
        )
        self.assertEqual(result.returncode, 0, result.stdout[-2500:] + result.stderr[-1000:])

    def test_source_validator_runs_in_isolation_without_installed_node_modules(self):
        import tempfile

        root = Path(__file__).resolve().parents[1] / "agent-client"
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node)
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "validators.cjs"
            shutil.copyfile(root / "src/task-center-validators.cjs", copied)
            # Reproduce the clean CI/host dependency boundary rather than using
            # this workspace's development node_modules by accident.
            source = (
                "const v=require(process.argv[1]); if(!v.CenterSchedule({frequency:'daily',"
                "days:[],localTime:'13:47',timeZone:'America/Toronto',graceMinutes:5,"
                "effectiveFrom:0,dstGap:'skip',dstFold:'first'})) process.exit(1)"
            )
            result = subprocess.run(
                [node, "-e", source, str(copied)],
                cwd=directory,
                capture_output=True,
                text=True,
                timeout=25,
                env={**os.environ, "NODE_PATH": "", "NODE_OPTIONS": ""},
            )
            self.assertEqual(result.returncode, 0, result.stderr[-1000:])
