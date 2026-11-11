"""Admission narrowing fences real issuance/execution without erasing Owner history."""

import json
import os
import unittest
from unittest.mock import patch

import test_agent_credential_fences as fences
import test_agent_credential_routes as routes
import test_native_transport as native
import test_owned_credentials as credentials
from fixtures import OTHER_UID, UID

from app.agent_rollout import ENVIRONMENT, owner_allowed
from app.oauth import OAuthFailure
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key


class AgentRolloutTests(unittest.TestCase):
    def fixture(self, cls):
        helper = cls()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        return helper

    def restricted(self, owners):
        return patch.dict(os.environ, {ENVIRONMENT: json.dumps(owners)})

    def test_empty_invalid_duplicate_and_oversized_configuration_fail_closed(self):
        owner = owner_key(UID)
        for raw in [
            "[]",
            "null",
            "{}",
            "not-json",
            '["invalid"]',
            json.dumps([owner, owner]),
            json.dumps([owner] * 33),
            " " * 4097,
            '{"a":1,"a":2}',
        ]:
            with self.subTest(raw=raw[:80]), patch.dict(os.environ, {ENVIRONMENT: raw}):
                self.assertFalse(owner_allowed(owner))
        with self.restricted([owner]):
            self.assertTrue(owner_allowed(owner))
            self.assertFalse(owner_allowed(owner_key(OTHER_UID)))

    def test_native_pending_approval_tokens_and_refresh_respect_current_scope(self):
        h = self.fixture(native.NativeTransportTests)
        with self.restricted([h.f.owner]):
            tokens = h.connect()
            self.assertEqual(h.service.authenticate(tokens["access_token"]).owner_uid, UID)
        with self.restricted([]):
            with self.assertRaises(OAuthFailure):
                h.service.authenticate(tokens["access_token"])
            self.assertNotEqual(h.refresh(tokens["refresh_token"])[0], 200)
            request = h.service.authorize(h.authorize_params, native.BROWSER)
            with self.assertRaises(ContractError):
                h.service.pending(UID, request, native.BROWSER)
            with self.assertRaises(ContractError):
                h.service.approve(UID, request, native.BROWSER, h.f.vault)

    def test_credential_replacement_is_denied_but_original_owner_history_survives(self):
        h = self.fixture(credentials.AgentCredentialTests)
        with self.restricted([h.f.owner]):
            original = h.approve()
            before = h.row()
            command, operation = h.command()
        with self.restricted([]):
            with self.assertRaises(ContractError):
                h.service.begin_setup(h.principal())
            with self.assertRaises(ContractError):
                h.approve(command, operation)
            self.assertEqual(h.row(), before)
            self.assertEqual(
                h.service.state(UID, h.f.vault, h.fx.conn["connectionId"])["lease"],
                original["lease"],
            )

    def test_real_pop_session_and_final_report_write_are_fenced(self):
        h = self.fixture(fences.CredentialExecutionFenceTests)
        r = h.result
        with self.restricted([h.helper.f.owner]):
            self.assertIn("credentialLease", r.x.service.session(*r.x.args("session", {})))
        with self.restricted([]):
            with self.assertRaises(ContractError):
                r.x.service.session(*r.x.args("session", {}))
            with self.assertRaises(ContractError):
                r.submit()
            self.assertEqual(r.history.owner_list(UID, h.helper.f.vault)["items"], [])

    def test_owner_route_denies_before_service_dispatch_and_retains_reads(self):
        h = self.fixture(routes.AgentCredentialRouteTests)
        with (
            self.restricted([]),
            patch("app.agent_credential_routes.agent_owned_enabled", return_value=True),
        ):
            caps = h.client.get("/api/v3/agent-credentials/capabilities", headers=h.headers)
            self.assertFalse(caps.json()["enabled"])
            self.assertEqual(
                h.client.post(
                    h.path + "/approvals", headers=h.write_headers, json=h.body
                ).status_code,
                503,
            )
            self.assertEqual(h.calls, [])
            self.assertEqual(h.client.get(h.path, headers=h.headers).status_code, 200)

    def test_scope_removed_during_source_read_blocks_the_final_write(self):
        h = self.fixture(fences.CredentialExecutionFenceTests)
        r = h.result
        with self.restricted([h.helper.f.owner]):
            h.helper.fx.catalogue.callback = lambda: os.environ.__setitem__(ENVIRONMENT, "[]")
            with self.assertRaises(ContractError):
                r.submit()
            self.assertEqual(r.history.owner_list(UID, h.helper.f.vault)["items"], [])
