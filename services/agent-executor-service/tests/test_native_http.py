"""Actual MCP HTTP surface, explicit OAuth challenges and unforgeable ingress provenance."""

from unittest.mock import patch

from fastapi.testclient import TestClient
from fixtures import ACCESS
from native_fixtures import NativeFixture

from app.contracts import AccessDenied, ScopeDenied, Stopped
from app.main import app
from app.provider_tls import PEER_SCOPE, PROVIDER, ProviderPeer


class Ingress:
    def __init__(self, app, peer):
        self.app, self.peer = app, peer

    async def __call__(self, scope, receive, send):
        await self.app({**scope, PEER_SCOPE: self.peer}, receive, send)


class NativeHttpTests(NativeFixture):
    def setUp(self):
        super().setUp()
        for name, value in [("native_engine", self.engine), ("executor", self.runtime)]:
            p = patch("app.main." + name, value)
            p.start()
            self.addCleanup(p.stop)
        peer = ProviderPeer(PROVIDER, "a" * 64, self.now - 1, self.now + 3600)
        self.client = TestClient(Ingress(app, peer))
        self.addCleanup(self.client.close)

    def rpc(self, method, params=None, **changes):
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": {} if params is None else params,
            **changes,
        }
        return self.client.post("/mcp", json=body)

    def test_initialize_tools_and_resource_metadata_match_exact_independent_policy(self):
        response = self.rpc(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {
                    "name": "synthetic_native_client",
                    "version": "1.0",
                    "title": "Synthetic",
                },
                "_meta": {"locale": "zh"},
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["result"]["protocolVersion"], "2025-06-18")
        tools = self.rpc("tools/list").json()["result"]["tools"]
        self.assertEqual(
            [t["name"] for t in tools],
            ["executor_profile", "executor_tasks", "executor_input", "executor_report"],
        )
        self.assertTrue(all(t["inputSchema"]["additionalProperties"] is False for t in tools))
        self.assertTrue(all(t["securitySchemes"][0]["type"] == "oauth2" for t in tools))
        meta = self.client.get("/.well-known/oauth-protected-resource")
        self.assertEqual(meta.json()["resource"], self.config.binding["audience"])
        self.assertEqual(meta.json()["authorization_servers"], [self.config.issuer])
        self.assertEqual(meta.headers["cache-control"], "no-store")

    def test_missing_token_returns_discovery_challenge_without_touching_business_engine(self):
        with patch.object(self.engine, "execute") as execute:
            r = self.rpc("tools/call", {"name": "executor_profile", "arguments": {}})
            self.assertEqual(r.status_code, 401)
            self.assertIn(
                'resource_metadata="https://executor.example/.well-known/oauth-protected-resource"',
                r.headers["www-authenticate"],
            )
            execute.assert_not_called()

    def test_expired_account_scope_denial_and_outage_have_distinct_non_expanding_outcomes(self):
        for error, status in [(AccessDenied(), 401), (ScopeDenied(), 403), (Stopped(), 200)]:
            with patch.object(self.engine, "execute", side_effect=error):
                r = self.client.post(
                    "/mcp",
                    headers={"Authorization": "Bearer " + ACCESS},
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {"name": "executor_profile", "arguments": {}},
                    },
                )
                self.assertEqual(r.status_code, status, r.text)
                if status == 200:
                    self.assertTrue(r.json()["result"]["isError"])
        self.assertEqual(self.wire.calls, [])

    def test_forwarded_provider_and_account_headers_cannot_replace_actual_peer(self):
        with TestClient(app) as client:
            r = client.post(
                "/mcp",
                headers={
                    "X-Forwarded-Client-Cert": "mtls.prod.connectors.openai.com",
                    "X-Provider-Identity": "OpenAI",
                    "Authorization": "Bearer " + ACCESS,
                },
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/list",
                    "params": {"_meta": {"provider": "openai_chatgpt"}},
                },
            )
            self.assertEqual(r.status_code, 403)
            self.assertEqual(client.get("/.well-known/oauth-protected-resource").status_code, 403)

    def test_real_authorized_profile_uses_current_account_and_never_claims_schedule_installation(
        self,
    ):
        r = self.client.post(
            "/mcp",
            headers={"Authorization": "Bearer " + ACCESS},
            json={
                "jsonrpc": "2.0",
                "id": "profile",
                "method": "tools/call",
                "params": {"name": "executor_profile", "arguments": {}},
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()["result"]["structuredContent"]
        self.assertEqual(data["nativeScheduleStatus"], "not_observed")
        self.assertEqual(data["reportDestination"], "owner_inbox")
        self.assertNotIn('"d":', r.text)
        self.assertNotIn(ACCESS, r.text)

    def test_oversized_malformed_batched_unknown_and_caller_selected_destinations_fail_closed(self):
        cases = [b"x" * 98305, b'{"jsonrpc":"2.0","jsonrpc":"2.0"}', b"[]"]
        for raw in cases:
            r = self.client.post("/mcp", content=raw, headers={"Content-Type": "application/json"})
            self.assertEqual(r.status_code, 400)
        self.assertEqual(self.rpc("tools/list", {}, id=True).status_code, 400)
        r = self.client.post(
            "/mcp",
            headers={"Authorization": "Bearer " + ACCESS},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "executor_profile",
                    "arguments": {"issuer": "https://attacker.example"},
                },
            },
        )
        self.assertTrue(r.json()["result"]["isError"])
        self.assertEqual(self.wire.submissions, [])
        self.assertEqual(self.client.get("/mcp").status_code, 405)
        self.assertEqual(self.client.post("/mcp?owner=other").status_code, 400)

    def test_session_headers_and_extra_rpc_parameters_cannot_select_another_connection(self):
        r = self.client.post(
            "/mcp",
            headers={"Mcp-Session-Id": "other_connection"},
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(
            self.rpc("tools/list", {"issuer": "https://attacker.example"}).status_code, 400
        )

    def test_feature_disabled_cannot_be_enabled_by_request_headers(self):
        with patch("app.main.native_engine", None):
            r = self.client.post("/mcp", headers={"X-Executor-Native-Enabled": "1"})
            self.assertEqual(r.status_code, 503)
            self.assertEqual(
                self.client.get("/.well-known/oauth-protected-resource").status_code, 503
            )
