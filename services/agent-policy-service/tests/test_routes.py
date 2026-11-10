"""Closed HTTP body/header budgets, Owner separation and same-browser consent."""

import os
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient
from fixtures import CONNECTION, UID, PolicyFixture, public

from app.contracts import digest
from app.main import app, get_active_policy, get_policy
from folioview_shared.auth import require_google_user
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class RouteTests(PolicyFixture):
    def setUp(self):
        super().setUp()
        app.dependency_overrides[get_active_policy] = lambda: self.policy
        app.dependency_overrides[get_policy] = lambda: self.policy
        app.dependency_overrides[require_google_user] = lambda: SimpleNamespace(uid=UID)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app, base_url=self.config.issuer)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.tokens = self.authorize()
        self.agent = f"/v1/connections/{CONNECTION}"

    def test_default_gate_fails_before_loading_store_or_signing_keys(self):
        app.dependency_overrides.pop(get_active_policy)
        with (
            patch.dict(os.environ, {"POLICY_ENABLED": "0"}, clear=True),
            patch("app.main.configured_store") as store,
        ):
            r = self.client.post(self.agent + "/challenges", json={})
            self.assertEqual(r.status_code, 503, r.text)
            self.assertEqual(r.headers["cache-control"], "no-store")
            store.assert_not_called()

    def test_current_owner_state_requires_no_agent_token_and_cannot_switch_owner(self):
        r = self.client.get(f"/api/v1/connections/{CONNECTION}", headers=self.headers)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("wrappedStateKey", r.text)
        app.dependency_overrides[require_google_user] = lambda: SimpleNamespace(uid="other_owner")
        self.assertEqual(
            self.client.get(f"/api/v1/connections/{CONNECTION}", headers=self.headers).status_code,
            403,
        )

    def test_authorize_cookie_and_owner_root_approval_form_one_browser_bound_flow(self):
        data = self.authorization_data()
        r = self.client.get("/oauth/authorize", params=data, follow_redirects=False)
        self.assertEqual(r.status_code, 303, r.text)
        self.assertIn("Secure", r.headers["set-cookie"])
        self.assertIn("HttpOnly", r.headers["set-cookie"])
        pending = parse_qs(urlsplit(r.headers["location"]).query)["request"][0]
        state = self.owner_state()
        command = self.control(
            "oauth_approve",
            version=state["stateVersion"],
            head=state["stateHead"],
            parameters={"pendingId": pending, "requestDigest": digest(data)},
        )
        info = self.client.get("/api/v1/authorizations/" + pending, headers=self.headers)
        self.assertEqual(info.status_code, 200, info.text)
        approved = self.client.post(
            "/api/v1/authorizations/" + pending + "/approvals",
            headers=self.headers,
            json={
                "contractVersion": CONTRACT_VERSION,
                "connectionId": CONNECTION,
                "command": command,
            },
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertTrue(
            approved.json()["redirectUri"].startswith("https://native.example/callback?")
        )

    def test_other_browser_or_callback_cannot_claim_pending_approval(self):
        pending, cookie = (
            __import__("app.oauth", fromlist=["OAuth"])
            .OAuth(self.policy)
            .begin(self.authorization_data())
        )
        r = self.client.get("/api/v1/authorizations/" + pending["pendingId"], headers=self.headers)
        self.assertEqual(r.status_code, 403)
        r = self.client.get(
            "/oauth/authorize",
            params=self.authorization_data(redirect_uri="https://attacker.example/callback"),
            follow_redirects=False,
        )
        self.assertEqual(r.status_code, 400)
        self.assertNotIn("location", r.headers)

    def test_exact_agent_request_needs_current_oauth_and_exact_signed_path_body(self):
        request = {}
        _, access, proof, path, _ = self.args("checkpoint", request)
        r = self.client.post(
            path,
            headers=self.headers | {"Authorization": "Bearer " + access},
            json={"contractVersion": CONTRACT_VERSION, "proof": proof, "request": request},
        )
        self.assertEqual(r.status_code, 200, r.text)
        no = self.client.post(
            path,
            headers=self.headers,
            json={"contractVersion": CONTRACT_VERSION, "proof": proof, "request": request},
        )
        self.assertEqual(no.status_code, 403)
        changed = self.client.post(
            path,
            headers=self.headers | {"Authorization": "Bearer " + access},
            json={
                "contractVersion": CONTRACT_VERSION,
                "proof": proof,
                "request": {"owner": "other"},
            },
        )
        self.assertEqual(changed.status_code, 400)

    def test_closed_queries_headers_json_and_streamed_byte_budget(self):
        request = {}
        _, access, proof, path, _ = self.args("checkpoint", request)
        value = {"contractVersion": CONTRACT_VERSION, "proof": proof, "request": request}
        auth = self.headers | {"Authorization": "Bearer " + access}
        for response in (
            self.client.post(path + "?owner=other", headers=auth, json=value),
            self.client.post(
                path, headers=auth | {"X-FolioView-Delegation": "synthetic"}, json=value
            ),
            self.client.post(path, headers=auth, json=value | {"private_marker": "x"}),
            self.client.post(
                path,
                headers=auth | {"Content-Type": "application/json"},
                content='{"contractVersion":"'
                + CONTRACT_VERSION
                + '","proof":{},"request":{},"request":{}}',
            ),
        ):
            self.assertEqual(response.status_code, 400, response.text)
            self.assertNotIn("private_marker", response.text)
        r = self.client.post(
            path,
            headers=auth | {"Content-Type": "application/json"},
            content=iter([b'{"private_marker":"', b"x" * 65536, b'"}']),
        )
        self.assertEqual(r.status_code, 413)
        self.assertNotIn("private_marker", r.text)

    def test_duplicate_oauth_parameters_and_unregistered_plaintext_routes_are_closed(self):
        r = self.client.post(
            "/oauth/token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            content="grant_type=refresh_token&grant_type=authorization_code",
        )
        self.assertEqual(r.status_code, 400)
        for path in ("/decrypt", "/sign", "/bootstrap", "/v1/private-key", "/proxy"):
            r = self.client.post(path, json={"private_marker": "x"})
            self.assertEqual(r.status_code, 404)
            self.assertEqual(r.headers["cache-control"], "no-store")
            self.assertNotIn("private_marker", r.text)

    def test_measured_workload_startup_has_no_financial_route_or_bearer_fallback(self):
        path = f"/workload/v1/connections/{CONNECTION}/challenges"
        request = {
            "purpose": "recover",
            "operation": self.operation(),
            "resourceBindings": [],
            "bootId": "synthetic_boot_01",
            "releaseRecipientJwk": public(self.keys["ephemeral"]),
        }
        value = {
            "contractVersion": CONTRACT_VERSION,
            "proof": self.proof(path, request, key="ephemeral"),
            "request": request,
        }
        response = self.client.post(path, headers=self.headers, json=value)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["statement"]["authorizationMode"], "workload_recovery")
        response = self.client.post(
            path,
            headers=self.headers | {"Authorization": "Bearer " + self.tokens["access_token"]},
            json=value,
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            f"/workload/v1/connections/{CONNECTION}/leases", headers=self.headers, json=value
        )
        self.assertEqual(response.status_code, 404)
