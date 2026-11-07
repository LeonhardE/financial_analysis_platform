"""Closed runtime uses real synthetic Hub transactions; no browser or real account."""

import json
import os
import selectors
import shutil
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_persistent_publications as publications
import test_runtime_setup as setups
from fixtures import UID
from jwcrypto import jwk
from test_oauth import CLIENT, TASK, OAuthFixture
from test_persistent_content import PersistentContentFixture
from test_persistent_identity_store import CONNECTION

from app.persistent_results import PersistentOwnerResultService, PersistentResultService
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_content import open_persistent_content

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
}


class RuntimePeer:
    def __init__(self, handle):
        self.handle = handle
        self.serial = 0
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        if node is None:
            raise AssertionError("Node required; this suite must not silently skip")
        self.process = subprocess.Popen(
            [node, str(ROOT / "runtime_session_peer.mjs")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "NODE_OPTIONS": ""},
        )

    def close(self):
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


class PersistentRuntimeSessionTests(unittest.TestCase):
    def setUp(self):
        self.peer = RuntimePeer(self.handle)
        self.addCleanup(self.peer.close)
        self.setup_case = None
        self.captured_offer = None
        self.drop_next_report = False
        self.ciphertexts = []
        self.connection = CONNECTION

    def handle(self, value):
        path, body = value["path"], value["body"]
        try:
            if path == "/agent/v3/runtime/config":
                result = {
                    "contractVersion": "folioview.agent-workspace.v2.0",
                    "runtimeVersion": "1.0.0",
                    "issuer": ORIGIN,
                    "serverNow": self.fx.now,
                }
            elif path.startswith("/agent/v3/runtime/setups/"):
                intent = path.split("/")[5]
                if path.endswith("/offers"):
                    self.captured_offer = body["proof"]
                    result = self.setup_case.service.offer(intent, body["proof"])
                else:
                    result = self.setup_case.service.public_state(intent)
            else:
                route = path.removeprefix(self.base + "/")
                result = getattr(self.service, METHODS[route])(
                    self.f.owner,
                    self.f.vault,
                    self.connection,
                    body["proof"],
                    path,
                    body["request"],
                )
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

    def test_registered_identity_restart_unknown_write_receipt_and_revocation(self):
        original = OAuthFixture()
        actor = {
            "issuer": ORIGIN,
            "ownerSubject": original.owner,
            "vaultId": original.vault,
            "connectionId": CONNECTION,
            "clientId": CLIENT,
        }
        public = self.peer.call("keys", actor)

        class BrowserKeysFixture(OAuthFixture):
            def pair(f, connection):
                for name, role, field in (
                    ("A1_sig", "agent_sig", "signingPublicJwk"),
                    ("A1_enc", "agent_enc", "encryptionPublicJwk"),
                ):
                    f.add_key(name, role, "synthetic_agent", connection)
                    f.keys[name] = jwk.JWK(**public[field])
                    f.certificates[name].update(
                        publicJwk=public[field], keyId=f.keys[name].thumbprint(), expiresAt=20000
                    )
                f.bundle = f.make_bundle(previous=f.registry, issued_at=1000)
                f.registry = f.verify(f.bundle, previous=f.registry)

        case = publications.PublicationTests()
        with patch("test_persistent_identity_store.OAuthFixture", BrowserKeysFixture):
            case.setUp()
        self.addCleanup(case.doCleanups)
        self.fx, self.f = case.fx, case.f
        f = self.f
        case.publish(case.context())
        case.create_task()
        case.publish(case.context("task"))
        self.configure_execution(self.fx.store, self.fx.catalogue)
        initialize = {
            "actor": {k: actor[k] for k in ("ownerSubject", "vaultId", "connectionId", "clientId")},
            "identity": self.fx.identity,
            "rootKeyId": f.root_id,
        }
        self.assertEqual(self.peer.call("initialize", initialize)["state"], "connected")
        self.assertEqual(len(self.peer.call("tasks")), 1)
        run = self.peer.call("begin", {"taskId": TASK, "triggerId": "synthetic_daily_slot_0001"})
        resource = self.peer.call(
            "input", {"runId": run["runId"], "publicationId": run["inputs"][0]["publicationId"]}
        )
        self.assertEqual(resource["resource"]["data"]["snapshotId"], f.resource["resourceId"])
        report = PersistentContentFixture.private_content(
            f, PersistentContentFixture.content_context(f, "result_revision")
        )["payload"]
        submit = {"runId": run["runId"], "report": report}
        self.drop_next_report = True
        self.assertEqual(
            self.peer.call("submit", submit, ok=False)["error"], "runtime_network_unavailable"
        )
        self.assertEqual(self.peer.call("initialize", initialize)["state"], "connected")
        self.assertEqual(self.peer.call("submit", submit)["state"], "saved")
        self.assertEqual(self.ciphertexts[0], self.ciphertexts[1])
        receipt = self.peer.call("receipt", {"runId": run["runId"]})
        saved = PersistentOwnerResultService(self.fx.store, clock=lambda: self.fx.now).owner_get(
            UID, f.vault, receipt["resultId"]
        )
        _, proof = _signed_parts(saved["envelope"]["proof"])
        opened = open_persistent_content(
            saved["envelope"]["jwe"], f.keys["recovery_enc"], context=proof["context"]
        )
        self.assertEqual(opened["payload"], report)
        # A current-and-future resource publication advances without another owner consent.
        self.fx.catalogue.revision = 4
        case.publish(case.context(revision=4, expectedRevision=3, sourceRevision=4))
        newer = self.peer.call("begin", {"taskId": TASK, "triggerId": "synthetic_daily_slot_0002"})
        current = self.peer.call(
            "input", {"runId": newer["runId"], "publicationId": newer["inputs"][0]["publicationId"]}
        )
        self.assertEqual(current["sourceRevision"], 4)
        self.assertEqual(self.fx.state()["consent"]["version"], 1)
        self.fx.apply(self.fx.command(targets=[self.fx.revoke_target()]), revoke=True)
        denied = self.peer.call(
            "begin", {"taskId": TASK, "triggerId": "synthetic_daily_slot_0003"}, ok=False
        )
        self.assertEqual(denied["error"], "insufficient_scope")
        self.assertEqual(self.peer.call("submit", submit)["state"], "saved")
        self.assertEqual(self.ciphertexts[0], self.ciphertexts[-1])

    def test_first_setup_has_no_authority_until_root_pairing_and_restart_restores_same_keys(self):
        case = setups.RuntimeSetupTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        self.setup_case, self.f = case, case.f
        self.connection = case.connection
        self.fx = SimpleNamespace(now=case.a.now)
        self.configure_execution(case.a.store, None)
        initialize = {"intentId": case.intent, "rootKeyId": self.f.root_id}
        first = self.peer.call("initialize", initialize)
        self.assertEqual(first["state"], "awaiting_owner_approval")
        self.assertEqual(self.peer.call("tasks", ok=False)["error"], "runtime_not_connected")
        _, payload = _signed_parts(self.captured_offer)
        case.proof, case.payload, case.agent = self.captured_offer, payload, payload["agentId"]
        for name, field in (
            ("runtime_sig", "signingPublicJwk"),
            ("runtime_enc", "encryptionPublicJwk"),
        ):
            key = jwk.JWK(**payload[field])
            self.f.keys[name] = key
            self.f.certificates[name].update(
                publicJwk=payload[field], keyId=key.thumbprint(), principalId=case.agent
            )
        identity = case.enroll()
        completed = case.service.complete(UID, case.intent)
        self.assertEqual(completed["paired"]["identity"], identity)
        self.assertEqual(self.peer.call("pairing")["state"], "connected")
        self.assertEqual(self.peer.call("initialize", initialize)["state"], "connected")
