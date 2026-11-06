"""Real OAuth/registry recipient encryption and actual Worker/controller consumption."""

import copy
import json
import os
import unittest
from unittest.mock import patch

import test_foreground_controller as foreground
import test_results
from jwcrypto import jwe
from test_oauth import TASK

from app.agent_tools import AgentTools
from app.foreground_transport import EXTENDED_PROFILE, PROFILE, ForegroundTransportService
from app.oauth import OAuthFailure
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads


class ForegroundTransportTests(unittest.TestCase):
    def setUp(self):
        self.case = test_results.ResultTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.oauth = self.case.case.oauth
        self.token = self.case.token
        self.service = ForegroundTransportService(self.oauth)

    def test_existing_bearer_is_encrypted_only_to_the_approved_agent_key(self):
        packet = self.service.seal(self.token, TASK)
        self.assertEqual(packet["profile"], PROFILE)
        self.assertNotIn(self.token, json.dumps(packet))
        message = jwe.JWE(algs=["ECDH-ES+A256KW", "A256GCM"])
        message.deserialize(packet["credential"], key=self.case.case.fix.keys["A1_enc"])
        value = strict_json_loads(message.payload)
        self.assertEqual(value["accessToken"], self.token)
        self.assertEqual(value["taskId"], TASK)
        self.assertEqual(value["expiresAt"], value["issuedAt"] + 60)
        self.assertEqual(value["preparationId"], packet["preparationId"])
        for key in ["device_enc", "recovery_enc"]:
            with self.assertRaises(jwe.InvalidJWEData):
                jwe.JWE().deserialize(packet["credential"], key=self.case.case.fix.keys[key])

    def test_closed_mcp_tool_has_no_token_recipient_or_url_arguments(self):
        tools = AgentTools(self.oauth)
        args = {"contractVersion": CONTRACT_VERSION, "taskId": TASK}
        packet = tools.call(self.token, "get_foreground_transport_v2", args)
        self.assertNotIn(self.token, json.dumps(packet))
        for field, value in [
            ("token", self.token),
            ("recipient", {}),
            ("url", "https://evil.invalid"),
        ]:
            with self.assertRaises(ContractError):
                tools.call(self.token, "get_foreground_transport_v2", {**args, field: value})
        with self.assertRaises(OAuthFailure):
            self.service.seal("x" * 43, TASK)
        with self.assertRaises(OAuthFailure):
            self.service.seal(self.token, "foreign_task")

    def test_revoked_grant_cannot_receive_a_transport(self):
        self.oauth.revoke_connection(self.case.case.fix.uid, self.case.case.connection)
        with self.assertRaises(OAuthFailure):
            self.service.seal(self.token, TASK)

    def test_snapshot_change_is_rechecked_before_sealing(self):
        original = self.service.preparations.metadata

        def changed(*args):
            value = original(*args)
            value["keyEpoch"] += 1
            return value

        with patch.object(self.service.preparations, "metadata", changed):
            with self.assertRaises(ContractError):
                self.service.seal(self.token, TASK)


class CipherOnlyPeer(foreground.ControllerPeer):
    def api(self, method, *args, ok=True):
        # The inherited fixture initializes real keys/grants, but this class
        # explicitly withholds its usual direct trusted-host authentication.
        if method == "authenticate" and not getattr(self, "initial_auth_withheld", False):
            self.initial_auth_withheld = True
            return None
        return super().api(method, *args, ok=ok)


class ForegroundTransportControllerTests(unittest.TestCase):
    begin = foreground.ForegroundControllerTests.begin

    def setUp(self):
        settings = patch.dict(os.environ, FOLIOVIEW_TEST_FOREGROUND_TRANSPORT="1")
        settings.start()
        self.addCleanup(settings.stop)
        with patch.object(foreground, "ControllerPeer", CipherOnlyPeer):
            foreground.ForegroundControllerTests.setUp(self)
        self.assertFalse(self.peer.api("status")["authenticatedTransport"])
        self.transport = ForegroundTransportService(self.case.oauth).seal(self.token, TASK)

    def test_real_worker_opens_ciphertext_then_authenticated_http_saves_owner_readable_report(self):
        self.peer.api("connectTransport", self.transport)
        self.assertTrue(self.peer.api("status")["authenticatedTransport"])
        foreground.ForegroundControllerTests.test_real_http_three_resources_encrypt_initial_revision_and_owner_decrypt(
            self
        )
        inspected = self.peer.raw({"inspect": True})["value"]
        self.assertNotIn(self.token, json.dumps(inspected))

    def test_model_port_cannot_open_or_obtain_transport_plaintext(self):
        result = self.peer.call(
            "openTransport",
            {"credential": self.transport["credential"], "issuer": "https://hub.example"},
            ok=False,
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "unsupported_operation")
        self.assertFalse(self.peer.api("status")["authenticatedTransport"])

    def test_extended_profile_cannot_silently_upgrade_the_original_worker(self):
        packet = ForegroundTransportService(self.case.oauth).seal(
            self.token, TASK, profile=EXTENDED_PROFILE
        )
        self.assertEqual(
            self.peer.api("connectTransport", packet, ok=False)["error"],
            "transport_binding_mismatch",
        )
        self.assertFalse(self.peer.api("status")["authenticatedTransport"])

    def test_wrong_scope_corrupt_ciphertext_and_expiry_never_authenticate(self):
        for field in ["taskId", "connectionId", "preparationId"]:
            packet = copy.deepcopy(self.transport)
            packet[field] = "foreign"
            self.assertEqual(
                self.peer.api("connectTransport", packet, ok=False)["error"],
                "transport_binding_mismatch",
            )
        packet = copy.deepcopy(self.transport)
        parts = packet["credential"].split(".")
        parts[3] = ("A" if parts[3][0] != "A" else "B") + parts[3][1:]
        packet["credential"] = ".".join(parts)
        self.assertEqual(
            self.peer.api("connectTransport", packet, ok=False)["error"],
            "transport_crypto_rejected",
        )

        def expired(value):
            if isinstance(value, dict) and "accessToken" in value:
                value = {**value, "issuedAt": 900, "expiresAt": 960}
            return canonical_json(value)

        with patch("app.foreground_transport.canonical_json", side_effect=expired):
            packet = ForegroundTransportService(self.case.oauth).seal(self.token, TASK)
        self.assertEqual(
            self.peer.api("connectTransport", packet, ok=False)["error"], "transport_expired"
        )
        self.assertFalse(self.peer.api("status")["authenticatedTransport"])

    def test_lock_destroys_the_only_helper_key_that_can_open_the_handoff(self):
        self.peer.api("lock")
        self.assertFalse(self.peer.api("connectTransport", self.transport, ok=False)["ok"])

    def prepared_controller(self):
        self.peer.api("connectTransport", self.transport)
        prepared = self.peer.api("loadPreparation")
        for descriptor in prepared["objects"]:
            self.peer.api("readPreparedObject", descriptor["objectId"])

    def run_posts(self):
        return [
            request
            for request in self.peer.traffic
            if request["method"] == "POST" and request["path"] == f"/agent/v2/tasks/{TASK}/runs"
        ]

    def test_created_run_refusal_rechecks_original_response_then_saves_same_run(self):
        self.prepared_controller()
        self.peer.raw({"refuseRunInstalls": 1})
        operation = "synthetic_original_run_acceptance"
        self.assertEqual(
            self.peer.api("beginRun", operation, ok=False)["error"],
            "run_expired_or_untrusted",
        )
        self.assertEqual(len(self.run_posts()), 1)
        self.assertEqual(
            self.peer.api("beginRun", "synthetic_different_run", ok=False)["error"],
            "original_run_pending",
        )
        response = self.peer.api("beginRun", operation)
        self.assertEqual(len(self.run_posts()), 1)
        cursor = None
        while True:
            page = self.peer.api("readRunPage", response["run"]["runId"], cursor)
            cursor = page["nextCursor"]
            if cursor is None:
                break
        saved = self.peer.api(
            "submitResult",
            response["run"]["runId"],
            "synthetic_original_run_report",
            self.content,
        )
        self.assertEqual(saved["receipt"]["resultId"], response["run"]["initialResultId"])
        self.assertEqual(saved["receipt"]["revision"], 1)
        self.assertTrue(saved["liveRevisionSession"])

    def test_unknown_begin_outcome_replays_original_signed_bytes_and_blocks_new_run(self):
        self.prepared_controller()
        self.peer.lose_next_post = True
        operation = "synthetic_unknown_begin_outcome"
        self.assertEqual(self.peer.api("beginRun", operation, ok=False)["error"], "request_failed")
        self.assertEqual(len(self.run_posts()), 1)
        self.assertEqual(
            self.peer.api("beginRun", "synthetic_different_run", ok=False)["error"],
            "original_run_pending",
        )
        recovered = self.peer.api("beginRun", operation)
        posts = self.run_posts()
        self.assertEqual(len(posts), 2)
        self.assertEqual(posts[0]["body"], posts[1]["body"])
        self.assertEqual(recovered["run"]["state"], "ready")

    def test_continuation_never_accepts_an_out_of_bounds_run_lifetime(self):
        self.prepared_controller()
        original = self.harness.service._response

        def invalid_lifetime(*args):
            response = original(*args)
            response["run"]["expiresAt"] = "2099-01-01T00:00:00Z"
            response["manifest"]["expiresAt"] = "2099-01-01T00:00:00Z"
            return response

        operation = "synthetic_untrusted_run_lifetime"
        with patch.object(self.harness.service, "_response", side_effect=invalid_lifetime):
            self.assertEqual(
                self.peer.api("beginRun", operation, ok=False)["error"],
                "run_expired_or_untrusted",
            )
        self.assertEqual(
            self.peer.api("beginRun", operation, ok=False)["error"],
            "run_expired_or_untrusted",
        )
        self.assertEqual(len(self.run_posts()), 1)


class ForegroundAccessExpiryTests(unittest.TestCase):
    begin = foreground.ForegroundControllerTests.begin

    def setUp(self):
        # Mirror production: the helper/grant outlive the 600-second access token.
        fixture = foreground.preparations.PreparationFixture
        original_grant = fixture.grant
        original_call = foreground.helpers.Peer.call

        def grant(instance, *args, **kwargs):
            return original_grant(instance, *args, **{**kwargs, "expiresAt": 2000})

        def call(peer, op, args=None, **kwargs):
            if op == "initialize" and kwargs.get("trusted"):
                args = {**args, "ttlSeconds": 3600}
            return original_call(peer, op, args, **kwargs)

        with (
            patch.object(fixture, "grant", grant),
            patch.object(foreground.helpers.Peer, "call", call),
        ):
            ForegroundTransportControllerTests.setUp(self)

    def refresh_access(self):
        self.case.now = 1601
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

    def test_expiry_between_registry_pages_stops_before_http_and_same_grant_resumes(self):
        self.peer.api("connectTransport", self.transport)
        offer, before = self.peer.api("publicOffer"), self.peer.api("status")
        preparation_id = self.transport["preparationId"]
        first = f"/agent/v2/preparations/{preparation_id}/registries/1"
        self.peer.raw({"clockAfterResponse": {"path": first, "now": 1580000}})
        start = len(self.peer.traffic)
        refused = self.peer.api("loadPreparation", ok=False)
        self.assertEqual(refused["error"], "access_token_refresh_required")
        traffic = self.peer.traffic[start:]
        self.assertEqual(traffic[-1]["path"], first)
        self.assertFalse(any(row["path"].endswith("/registries/2") for row in traffic))
        current = self.peer.api("status")
        self.assertEqual(current["state"], "READY")
        self.assertFalse(current["authenticatedTransport"])
        self.assertTrue(current["independentDeliveryConfirmed"])
        self.assertEqual(current["expiresAt"], before["expiresAt"])
        self.assertEqual(self.peer.api("publicOffer"), offer)
        start = len(self.peer.traffic)
        self.assertEqual(
            self.peer.api("loadPreparation", ok=False)["error"], "access_token_refresh_required"
        )
        self.assertEqual(len(self.peer.traffic), start)
        self.refresh_access()
        self.assertEqual(self.peer.api("loadPreparation")["preparationId"], preparation_id)
        self.assertEqual(self.peer.api("publicOffer"), offer)
        self.assertEqual(self.peer.api("status")["expiresAt"], before["expiresAt"])

    def test_expired_access_preserves_original_run_and_ciphertext_receipt_recovery(self):
        self.peer.api("connectTransport", self.transport)
        run = self.begin()
        operation = "synthetic_expired_access_report"
        self.peer.lose_next_post = True
        self.assertEqual(
            self.peer.api("submitResult", run["run"]["runId"], operation, self.content, ok=False)[
                "error"
            ],
            "request_failed",
        )
        offer, before = self.peer.api("publicOffer"), self.peer.api("status")
        rows = self.peer.raw({"inspect": True})["value"]["rows"]
        self.peer.raw({"now": 1600000})
        start = len(self.peer.traffic)
        self.assertEqual(
            self.peer.api("recoverReceipt", operation, ok=False)["error"],
            "access_token_refresh_required",
        )
        self.assertEqual(len(self.peer.traffic), start)
        self.assertEqual(self.peer.raw({"inspect": True})["value"]["rows"], rows)
        self.assertEqual(self.peer.api("publicOffer"), offer)
        self.refresh_access()
        receipt = self.peer.api("recoverReceipt", operation)
        self.assertTrue(receipt["liveRevisionSession"])
        self.assertEqual(receipt["receipt"]["runId"], run["run"]["runId"])
        self.assertEqual(receipt["receipt"]["revision"], 1)
        self.assertEqual(self.peer.api("status")["expiresAt"], before["expiresAt"])
        self.assertEqual(self.peer.api("publicOffer"), offer)
        self.assertEqual(sum(row["path"].endswith("/runs") for row in self.peer.traffic), 1)

    def test_unexpired_access_denied_by_server_still_ends_the_session(self):
        self.peer.api("connectTransport", self.transport)
        self.peer.denied = 401
        refused = self.peer.api("loadPreparation", ok=False)
        self.assertEqual(refused["error"], "authorization_denied")
        self.assertEqual(self.peer.api("status")["state"], "LOCKED")

    def test_server_denial_still_preserves_only_the_encrypted_outbox(self):
        self.peer.api("connectTransport", self.transport)
        foreground.ForegroundControllerTests.test_current_http_denial_locks_and_retains_ciphertext_outbox(
            self
        )
