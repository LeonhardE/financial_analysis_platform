"""Versioned browser handoff with actual JOSE, Worker time and authenticated HTTP."""

import os
import unittest
from unittest.mock import patch

import test_foreground_controller as foreground
import test_foreground_transport as legacy
import test_results
from jwcrypto import jwe
from test_oauth import TASK

from app.agent_tools import AgentTools
from app.foreground_transport import EXTENDED_PROFILE, PROFILE, ForegroundTransportService
from app.oauth import OAuthFailure, _put, _row
from app.oauth_config import digest
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads


class ExtendedTransportProducerTests(unittest.TestCase):
    def setUp(self):
        self.case = test_results.ResultTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.oauth, self.token = self.case.case.oauth, self.case.token

    def opened(self, packet):
        message = jwe.JWE(algs=["ECDH-ES+A256KW", "A256GCM"])
        message.deserialize(packet["credential"], key=self.case.case.fix.keys["A1_enc"])
        return strict_json_loads(message.payload)

    def test_new_tool_is_explicit_while_legacy_handoff_stays_sixty_seconds(self):
        tools = AgentTools(self.oauth)
        args = {"contractVersion": CONTRACT_VERSION, "taskId": TASK}
        old = tools.call(self.token, "get_foreground_transport_v2", args)
        new = tools.call(self.token, "get_foreground_transport_v3", args)
        self.assertEqual(old["profile"], PROFILE)
        self.assertEqual(new["profile"], EXTENDED_PROFILE)
        for packet, seconds in [(old, 60), (new, 300)]:
            value = self.opened(packet)
            self.assertEqual(value["expiresAt"] - value["issuedAt"], seconds)
            self.assertEqual(value["accessToken"], self.token)
            self.assertNotIn(self.token, canonical_json(packet).decode())

    def test_handoff_cannot_extend_the_original_access_token(self):
        def shorten(unit):
            row = _row(unit, "hub_oauth_access", digest(self.token))
            row["expiresAt"] = self.case.case.now + 90
            _put(unit, "hub_oauth_access", (digest(self.token),), row)

        self.oauth.store.transact(shorten)
        packet = ForegroundTransportService(self.oauth).seal(
            self.token, TASK, profile=EXTENDED_PROFILE
        )
        value = self.opened(packet)
        self.assertEqual(value["expiresAt"] - value["issuedAt"], 90)

    def test_new_tool_has_no_duration_recipient_token_or_url_overrides(self):
        tools = AgentTools(self.oauth)
        args = {"contractVersion": CONTRACT_VERSION, "taskId": TASK}
        for key, value in [
            ("handoffSeconds", 3600),
            ("profile", PROFILE),
            ("recipient", {}),
            ("token", self.token),
            ("url", "https://foreign.invalid"),
        ]:
            with self.subTest(key=key), self.assertRaises(ContractError):
                tools.call(self.token, "get_foreground_transport_v3", {**args, key: value})
        self.oauth.revoke_connection(self.case.case.fix.uid, self.case.case.connection)
        with self.assertRaises(OAuthFailure):
            tools.call(self.token, "get_foreground_transport_v3", args)


class ExtendedTransportControllerTests(unittest.TestCase):
    begin = foreground.ForegroundControllerTests.begin

    def setUp(self):
        env = patch.dict(
            os.environ,
            FOLIOVIEW_TEST_FOREGROUND_TRANSPORT="1",
            FOLIOVIEW_TEST_HELPER_RELEASE="1.4.0",
        )
        env.start()
        self.addCleanup(env.stop)
        with (
            patch.object(foreground, "ControllerPeer", legacy.CipherOnlyPeer),
            patch.object(foreground.run_helpers.RunHelperTests, "max_fetched_age_seconds", 600),
        ):
            foreground.ForegroundControllerTests.setUp(self)
        self.transport = ForegroundTransportService(self.case.oauth).seal(
            self.token, TASK, profile=EXTENDED_PROFILE
        )

    def advance(self, seconds):
        self.case.now += seconds
        self.peer.raw({"advanceTime": seconds * 1000})

    def test_delayed_real_worker_handoff_still_saves_an_owner_readable_report(self):
        self.advance(142)
        self.peer.api("connectTransport", self.transport)
        self.assertTrue(self.peer.api("status")["authenticatedTransport"])
        foreground.ForegroundControllerTests.test_real_http_three_resources_encrypt_initial_revision_and_owner_decrypt(
            self
        )

    def test_exact_expiry_refuses_old_packet_and_fresh_packet_reuses_same_keys(self):
        self.advance(300)
        self.assertEqual(
            self.peer.api("connectTransport", self.transport, ok=False)["error"],
            "transport_expired",
        )
        self.assertFalse(self.peer.api("status")["authenticatedTransport"])
        fresh = ForegroundTransportService(self.case.oauth).seal(
            self.token, TASK, profile=EXTENDED_PROFILE
        )
        self.peer.api("connectTransport", fresh)
        self.assertTrue(self.peer.api("status")["authenticatedTransport"])

    def test_profile_mismatch_oversized_window_and_model_token_access_fail_closed(self):
        old = ForegroundTransportService(self.case.oauth).seal(self.token, TASK)
        self.assertEqual(
            self.peer.api("connectTransport", old, ok=False)["error"],
            "transport_binding_mismatch",
        )

        def excessive(value):
            if isinstance(value, dict) and "accessToken" in value:
                value = {**value, "expiresAt": value["issuedAt"] + 301}
            return canonical_json(value)

        with patch("app.foreground_transport.canonical_json", side_effect=excessive):
            packet = ForegroundTransportService(self.case.oauth).seal(
                self.token, TASK, profile=EXTENDED_PROFILE
            )
        self.assertEqual(
            self.peer.api("connectTransport", packet, ok=False)["error"],
            "transport_expired",
        )
        self.assertEqual(
            self.peer.call(
                "openTransport",
                {"credential": self.transport["credential"], "issuer": "https://hub.example"},
                ok=False,
            )["error"],
            "unsupported_operation",
        )
