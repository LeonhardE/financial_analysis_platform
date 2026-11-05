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
from app.foreground_transport import PROFILE, ForegroundTransportService
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
