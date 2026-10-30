"""Actual pinned Worker + controller + offline IDB model at production Hub HTTP APIs."""

import copy
import json
import os
import selectors
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_helper as helpers
import test_helper_runs as run_helpers
import test_preparations as preparations
from fastapi.testclient import TestClient
from test_encrypted_schema import report_content

from app.main import app
from app.oauth import OAuthFailure, get_oauth_service
from app.preparations import get_preparation_service
from app.results import ResultService, get_result_service
from app.runs import get_run_service
from folioview_shared.encrypted.crypto import decrypt_jwe, verify_jws

ROOT = Path(__file__).resolve().parents[1]


class ControllerPeer(helpers.Peer):
    def __init__(self):
        node = shutil.which("node")
        if not node:
            raise AssertionError("Controller checks require Node; no skipped coverage.")
        self.process = subprocess.Popen(
            [node, str(ROOT / "tests" / "controller_peer.mjs")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.counter, self.generation = 0, 1
        self.client, self.lose_next_post, self.denied = None, False, None
        self.traffic = []

    def raw(self, value):
        self.process.stdin.write(json.dumps(value) + "\n")
        self.process.stdin.flush()
        selector = selectors.DefaultSelector()
        try:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            while True:
                if not selector.select(timeout=12):
                    raise AssertionError("Controller did not finish a bounded request.")
                line = self.process.stdout.readline()
                if not line:
                    raise AssertionError("Controller process exited before a response.")
                result = json.loads(line)
                if result.get("type") != "http":
                    return result
                self.traffic.append(result)
                self.assert_request(result)
                if self.denied:
                    reply = {"status": self.denied, "body": {"debug": "DO_NOT_EXPOSE"}}
                else:
                    response = self.client.request(
                        result["method"],
                        result["path"],
                        headers=result["headers"],
                        content=result["body"],
                    )
                    reply = {"status": response.status_code, "body": response.json()}
                    if self.lose_next_post and result["method"] == "POST":
                        self.lose_next_post = False
                        reply["failure"] = True
                self.process.stdin.write(
                    json.dumps({"type": "httpResult", "id": result["id"], **reply}) + "\n"
                )
                self.process.stdin.flush()
        finally:
            selector.close()

    @staticmethod
    def assert_request(value):
        if not value["path"].startswith("/agent/v2/"):
            raise AssertionError("Controller attempted an arbitrary endpoint.")
        if value["headers"].get("X-FolioView-Contract") != helpers.CONTRACT_VERSION:
            raise AssertionError("Missing exact v2 contract.")

    def api(self, method, *args, ok=True):
        result = self.raw({"api": {"method": method, "args": list(args)}})
        if ok and not result["ok"]:
            raise AssertionError("Controller rejected synthetic operation: " + result["error"])
        return result["value"] if ok else result


class ForegroundControllerTests(unittest.TestCase):
    def setUp(self):
        enabled = patch.dict(os.environ, {"HUB_ENCRYPTED_ADAPTER_ENABLED": "1"})
        enabled.start()
        self.addCleanup(enabled.stop)
        original = preparations.authorization_params

        def requested(**kwargs):
            kwargs["scope"] += " results:revise"
            return original(**kwargs)

        self.harness = run_helpers.RunHelperTests(
            "test_actual_run_manifest_and_three_frozen_components_decrypt"
        )
        self.addCleanup(self.harness.doCleanups)
        with (
            patch.object(helpers, "Peer", ControllerPeer),
            patch.object(preparations, "authorization_params", requested),
        ):
            self.harness.setUp()
        self.peer, self.case = self.harness.peer, self.harness.case
        self.results = ResultService(self.case.oauth)
        app.dependency_overrides[get_oauth_service] = lambda: self.case.oauth
        app.dependency_overrides[get_preparation_service] = lambda: self.case.service
        app.dependency_overrides[get_run_service] = lambda: self.harness.service
        app.dependency_overrides[get_result_service] = lambda: self.results
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app, base_url="https://hub.example")
        self.addCleanup(self.client.close)
        self.peer.client = self.client
        self.token = self.case.tokens["access_token"]
        self.peer.api("authenticate", self.token)
        self.content = report_content()

    def begin(self, operation="synthetic_controller_run_01"):
        preparation = self.peer.api("loadPreparation")
        for descriptor in preparation["objects"]:
            self.peer.api("readPreparedObject", descriptor["objectId"])
        response = self.peer.api("beginRun", operation)
        cursor = None
        while True:
            page = self.peer.api("readRunPage", response["run"]["runId"], cursor)
            cursor = page["nextCursor"]
            if cursor is None:
                break
        return response

    def test_real_http_three_resources_encrypt_initial_revision_and_owner_decrypt(self):
        run = self.begin()
        saved = self.peer.api(
            "submitResult", run["run"]["runId"], "synthetic_controller_report_01", self.content
        )
        self.assertTrue(saved["liveRevisionSession"])
        self.assertEqual(saved["receipt"]["revision"], 1)
        revised = self.peer.api(
            "submitResult",
            run["run"]["runId"],
            "synthetic_controller_revision_01",
            {**self.content, "summary": "Synthetic revised controller report."},
            1,
        )
        self.assertEqual(revised["receipt"]["revision"], 2)
        outbox = self.peer.raw({"inspect": True})["value"]
        self.assertEqual(len(outbox["rows"]), 2)
        for row in outbox["rows"]:
            packet = row["value"]["packet"]
            public = self.case.fix.certificates["A1_sig"]["publicJwk"]
            message = verify_jws(packet["envelope"]["signedObject"], public, typ="fv-object+jws")
            for role in ("device_enc", "recovery_enc"):
                private = decrypt_jwe(
                    message["jwe"], self.case.fix.keys[role], context=message["context"]
                )
                self.assertEqual(private["payload"]["title"], self.content["title"])
            text = json.dumps(row)
            self.assertNotIn(self.content["title"], text)
            self.assertNotIn(self.token, text)
            self.assertNotIn('"d":', text)
        self.assertTrue(all("DO_NOT_EXPOSE" not in json.dumps(row) for row in outbox["rows"]))

    def test_lost_http_response_keeps_exact_ciphertext_and_receipt_recovers(self):
        run = self.begin()
        self.peer.lose_next_post = True
        result = self.peer.api(
            "submitResult",
            run["run"]["runId"],
            "synthetic_lost_controller_report",
            self.content,
            ok=False,
        )
        self.assertEqual(result["error"], "request_failed")
        before = copy.deepcopy(self.peer.traffic[-1])
        pending = self.peer.api("listOutbox")
        self.assertFalse(pending[0]["receiptSaved"])
        recovered = self.peer.api("recoverReceipt", "synthetic_lost_controller_report")
        self.assertTrue(recovered["liveRevisionSession"])
        replayed = self.peer.api("replay", "synthetic_lost_controller_report")
        self.assertEqual(replayed["receipt"], recovered["receipt"])
        self.assertEqual(self.peer.traffic[-1]["body"], before["body"])
        self.assertEqual(self.peer.traffic[-1]["headers"], before["headers"])

    def test_lock_restart_recovers_ciphertext_receipt_without_restoring_private_key_or_revision(
        self,
    ):
        run = self.begin()
        self.peer.api(
            "submitResult", run["run"]["runId"], "synthetic_restart_controller_report", self.content
        )
        record = self.peer.raw({"inspect": True})["value"]["rows"][0]["value"]
        self.peer.raw({"restart": True})
        offer = self.peer.call(
            "initialize",
            {"anchor": self.case.fix.initial_anchor, "now": 1000, "ttlSeconds": 600},
            trusted=True,
        )
        self.assertNotEqual(
            offer["agentSigningKeyId"], self.case.fix.worker_keys["agentSigningKeyId"]
        )
        self.peer.api("authenticate", self.token)
        recovered = self.peer.api("recoverReceipt", "synthetic_restart_controller_report")
        self.assertTrue(recovered["recoveredWithoutPrivateKeys"])
        replayed = self.peer.api("replay", "synthetic_restart_controller_report")
        self.assertEqual(replayed["receipt"], record["receipt"])
        self.assertFalse(replayed["liveRevisionSession"])
        self.assertEqual(
            self.peer.api(
                "submitResult",
                run["run"]["runId"],
                "synthetic_restart_revision",
                self.content,
                1,
                ok=False,
            )["error"],
            "run_pin_required",
        )

    def test_agent_port_cannot_initialize_confirm_or_accept_receipt(self):
        for op, args in [
            ("initialize", {}),
            ("confirmDelivery", {"pin": self.harness.fixture.pin}),
            (
                "acceptReceipt",
                {"runId": "run_A", "stableOperationId": "operation_A", "receipt": {}},
            ),
            ("authenticate", {"accessToken": self.token}),
        ]:
            self.assertEqual(self.peer.call(op, args, ok=False)["error"], "unsupported_operation")

    def test_current_http_denial_locks_and_retains_ciphertext_outbox(self):
        run = self.begin()
        self.peer.denied = 403
        reply = self.peer.api(
            "submitResult",
            run["run"]["runId"],
            "synthetic_revoked_controller_report",
            self.content,
            ok=False,
        )
        self.assertEqual(reply["error"], "authorization_denied")
        self.assertEqual(self.peer.api("status")["state"], "LOCKED")
        self.assertNotIn("DO_NOT_EXPOSE", json.dumps(reply))
        rows = self.peer.raw({"inspect": True})["value"]["rows"]
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["value"]["receipt"])

    def test_trusted_host_refresh_preserves_identity_keys_and_worker_ttl_after_old_access_expires(
        self,
    ):
        run = self.begin()
        self.peer.api(
            "submitResult", run["run"]["runId"], "synthetic_refresh_controller_report", self.content
        )
        offer, before = self.peer.api("publicOffer"), self.peer.api("status")
        self.case.now = 1601
        with self.assertRaises(OAuthFailure):
            self.case.oauth.authenticate(self.token)
        status, tokens, _ = self.case.oauth.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": self.case.oauth.config.clients[0].client_id,
                "refresh_token": self.case.tokens["refresh_token"],
                "resource": self.case.oauth.config.resource,
            },
            {},
            "token",
        )
        self.assertEqual(status, 200)
        self.peer.api("authenticate", tokens["access_token"])
        self.assertEqual(self.peer.api("publicOffer"), offer)
        self.assertEqual(self.peer.api("status")["expiresAt"], before["expiresAt"])
        recovered = self.peer.api("recoverReceipt", "synthetic_refresh_controller_report")
        self.assertTrue(recovered["liveRevisionSession"])
        self.assertEqual(
            self.peer.traffic[-1]["headers"]["Authorization"], "Bearer " + tokens["access_token"]
        )

    def test_transport_refresh_is_idle_serialized_and_scope_changes_require_new_owner_session(self):
        first = self.peer.raw({"authRace": {"mode": "whileRequest", "token": self.token}})
        self.assertTrue(first["ok"])
        self.assertEqual(first["value"]["refreshed"], "transport_busy")
        second = self.peer.raw({"authRace": {"mode": "whileRefresh", "token": self.token}})
        self.assertEqual(second["value"]["privateRead"], "transport_refreshing")
        _, tokens, _ = self.case.oauth.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": self.case.oauth.config.clients[0].client_id,
                "refresh_token": self.case.tokens["refresh_token"],
                "resource": self.case.oauth.config.resource,
                "scope": "tasks:read",
            },
            {},
            "token",
        )
        changed = self.peer.api("authenticate", tokens["access_token"], ok=False)
        self.assertEqual(changed["error"], "authorization_changed")
        self.assertEqual(self.peer.api("status")["state"], "LOCKED")

    def test_another_agent_token_cannot_replace_or_revoke_this_controller_connection(self):
        original_params = preparations.authorization_params

        def second_agent_params(**kwargs):
            kwargs["scope"] += " watchlist:read channel_follows:read"
            return original_params(**kwargs)

        with patch.object(preparations, "authorization_params", second_agent_params):
            tokens, prepared = self.case.consent(name="A2")
        self.assertNotEqual(prepared["connectionId"], self.case.connection)
        rejected = self.peer.api("authenticate", tokens["access_token"], ok=False)
        self.assertEqual(rejected["error"], "authorization_denied")
        self.assertEqual(self.peer.api("status")["state"], "LOCKED")
        still_active = self.case.oauth.authenticate(self.token)
        self.assertEqual(still_active["connectionId"], self.case.connection)
        self.assertFalse(any(row["method"] == "POST" for row in self.peer.traffic))

    def test_hidden_page_refuses_private_work_without_requiring_owner_window_foreground(self):
        self.peer.api("setVisible", False)
        self.assertEqual(self.peer.api("loadPreparation", ok=False)["error"], "foreground_required")
        self.assertEqual(self.peer.api("status")["state"], "READY")
        self.peer.api("setVisible", True)
        self.assertTrue(self.peer.api("loadPreparation")["objects"])


class ForegroundStorageTests(unittest.TestCase):
    setUp = ForegroundControllerTests.setUp
    begin = ForegroundControllerTests.begin

    def test_offline_idb_model_uses_production_store_for_cas_scope_capacity_and_receipts(self):
        run = self.begin()
        self.peer.api(
            "submitResult", run["run"]["runId"], "synthetic_controller_store_fixture", self.content
        )
        record = self.peer.raw({"inspect": True})["value"]["rows"][0]["value"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ciphertext-record.json"
            path.write_text(json.dumps(record))
            result = subprocess.run(
                [
                    shutil.which("node"),
                    "--test",
                    str(ROOT / "tests" / "controller_storage.test.mjs"),
                ],
                capture_output=True,
                text=True,
                timeout=20,
                env={**os.environ, "NODE_OPTIONS": "", "FV_CONTROLLER_CIPHER_RECORD": str(path)},
            )
        self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-2000:])
