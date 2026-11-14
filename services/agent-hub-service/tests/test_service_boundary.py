"""Health stays independent; only the bounded vault authority APIs are implemented."""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from folioview_shared.encrypted.schema import validate_schema

SERVICE = Path(__file__).resolve().parents[1]
ROOT = SERVICE.parents[1]


class AgentHubBoundaryTests(unittest.TestCase):
    def test_health_and_openapi_expose_bounded_vault_and_oauth_authority(self):
        with TestClient(app) as client:
            response = client.get("/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"status": "ok", "service": "agent-hub"})
            self.assertEqual(
                set(client.get("/openapi.json").json()["paths"]),
                {
                    "/api/v3/private-display-names/capabilities",
                    "/api/v3/private-display-names/{vault}/holdings",
                    "/api/v3/private-display-names/{vault}/holdings/{source}",
                    "/api/v3/private-display-names/{vault}/holdings/{source}/commands",
                    "/api/v3/private-display-names/{vault}/holdings/{source}/operations/{operation}",
                    "/api/v3/task-center/capabilities",
                    "/api/v3/task-center/{vault}/tasks/{task}/manual",
                    "/api/v3/task-center/{vault}/tasks/{task}/manual/{intent}",
                    "/api/v3/task-center/{vault}/tasks/{task}/manual/{intent}/cancel",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/task-center/manual/query",
                    "/api/v3/task-center/{vault}/trash",
                    "/api/v3/task-center/{vault}/trash/query",
                    "/api/v3/task-center/{vault}/tasks/{task}/maintenance",
                    "/api/v3/task-center/{vault}/tasks/{task}",
                    "/api/v3/task-center/{vault}/tasks/{task}/operations/{operation}",
                    "/api/v3/task-center/{vault}/tasks/{task}/operations/{operation}/cancel",
                    "/api/v3/task-center/{vault}/tasks/{task}/commands",
                    "/api/v3/task-center/{vault}/tasks/{task}/results/query",
                    "/api/v3/task-center/{vault}/tasks/{task}/progress/query",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/task-center/context",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/task-center/prepare",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/task-center/plans/report",
                    "/api/v3/provider-connections/capabilities",
                    "/api/v3/provider-connections/{vault}/{provider}",
                    "/api/v3/provider-connections/{vault}/summary",
                    "/api/v3/provider-connections/{vault}/{provider}/operations/{operation}",
                    "/api/v3/provider-connections/{vault}/{provider}/commands",
                    "/api/v2/persistent-connections",
                    "/api/v2/tasks/packets/query",
                    "/api/v2/persistent-connections/{connection_id}/revocations",
                    "/.well-known/oauth-authorization-server/oauth/persistent",
                    "/.well-known/oauth-protected-resource/mcp/v3",
                    "/oauth/persistent/authorize",
                    "/oauth/persistent/token",
                    "/oauth/persistent/revoke",
                    "/api/v2/persistent-account-authorizations/capabilities",
                    "/api/v2/persistent-account-authorizations/{request_id}",
                    "/api/v2/persistent-account-authorizations/{request_id}/approvals",
                    "/api/v2/persistent-account-authorizations/{request_id}/pending",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/runs/submit",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/runs/result-receipt",
                    "/api/v2/persistent-results/{vault_id}",
                    "/api/v2/persistent-plans/{vault_id}/{connection_id}/{task_id}",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/plans/state",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/plans/report",
                    "/api/v2/persistent-results/{vault_id}/{result_id}",
                    "/api/v2/persistent-results/{vault_id}/{result_id}/state",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/session",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/consent-receipts",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/tasks",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/task-input",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/runs/begin",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/runs/receipt",
                    "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/runs/input",
                    "/api/v2/persistent-content/{vault_id}/connections/{connection_id}/publications",
                    "/api/v2/persistent-content/{vault_id}/tasks/{task_id}/authority",
                    "/api/v2/persistent-content/{vault_id}/connections/{connection_id}/operations/{operation_id}",
                    "/api/v3/agent-credentials/{vault}/{connection}/restoration",
                    "/api/v3/agent-credentials/{vault}/{connection}/restoration/{source_connection}/{fingerprint}",
                    "/api/v3/agent-credentials/capabilities",
                    "/api/v3/agent-credentials/{vault}/{connection}",
                    "/api/v3/agent-credentials/{vault}/{connection}/setups/{intent}",
                    "/api/v3/agent-credentials/{vault}/{connection}/operations/{operation}",
                    "/api/v3/agent-credentials/{vault}/{connection}/approvals",
                    "/health",
                    "/api/v2/vaults/current",
                    "/api/v2/vaults",
                    "/api/v2/vaults/{vault_id}/registry",
                    "/api/v2/vaults/{vault_id}/archive",
                    "/api/v2/vaults/{vault_id}/archive-deletions",
                    "/api/v2/vaults/{vault_id}/archive-deletion-withdrawals",
                    "/api/v2/vaults/{vault_id}/archive-deletion-checks",
                    "/api/v2/vaults/{vault_id}/archive-operations/{operation_id}",
                    "/api/v2/vaults/{vault_id}/recovery-authorizations",
                    "/api/v2/vaults/{vault_id}/recovery-authorizations/{authorization_id}/revoke",
                    "/api/v2/vaults/{vault_id}/key-renewal-state",
                    "/api/v2/vaults/{vault_id}/key-renewals",
                    "/api/v2/vaults/{vault_id}/key-renewal-operations/{operation_id}",
                    "/api/v2/vaults/{vault_id}/holdings-sources/{source_id}",
                    "/api/v2/vaults/current/authority-token",
                    "/api/v2/resources/catalogue",
                    "/api/v2/tasks",
                    "/api/v2/tasks/{task_id}",
                    "/api/v2/tasks/{task_id}/versions/{version}",
                    "/api/v2/tasks/{task_id}/operations/{operation_id}",
                    "/api/v2/tasks/{task_id}/operation-cancellations",
                    "/api/v2/tasks/{task_id}/operation-cancellations/{cancellation_id}",
                    "/api/v2/tasks/{task_id}/transitions",
                    "/internal/v2/portfolio-authorities/read",
                    "/internal/v2/source-fences",
                    "/.well-known/jwks.json",
                    "/api/v2/agent-capabilities",
                    "/api/v2/persistent-agents/capabilities",
                    "/api/v2/persistent-agents/{vault_id}/{connection_id}",
                    "/api/v2/persistent-agents/{vault_id}/{connection_id}/operations/{operation_id}",
                    "/api/v2/persistent-agents/{vault_id}/{connection_id}/revocations",
                    "/api/v2/persistent-agents/{vault_id}/{connection_id}/resource-consent",
                    "/api/v2/persistent-agents/{vault_id}/{connection_id}/resource-operations/{operation_id}",
                    "/api/v2/persistent-agents/{vault_id}/{connection_id}/resource-approvals",
                    "/api/v2/persistent-agents/{vault_id}/{connection_id}/resource-revocations",
                    "/api/v2/agent-connections",
                    "/api/v2/agent-connections/{connection_id}/revoke",
                    "/api/v2/agent-connections/{connection_id}/grants/{grant_id}/revoke",
                    "/api/v2/results",
                    "/api/v2/results/counts",
                    "/api/v2/results/{result_id}",
                    "/api/v2/results/{result_id}/revisions",
                    "/api/v2/results/{result_id}/state",
                    "/api/v2/results/{result_id}/revisions/{revision}/evidence",
                    "/api/v2/results/{result_id}/revisions/{revision}/registries/{sequence}",
                },
            )

    def test_private_and_protocol_paths_are_not_implemented_or_cached(self):
        with TestClient(app) as client:
            for method, path in (
                ("GET", "/api"),
                ("GET", "/api/v2/resources"),
                ("POST", "/api/v2/inbox"),
                ("GET", "/api/v2/inbox"),
                ("GET", "/mcp"),
                ("GET", "/oauth"),
                ("GET", "/.well-known"),
                ("GET", "/.well-known/oauth-protected-resource"),
                ("GET", "/connectors"),
                ("POST", "/connectors/muse"),
            ):
                with self.subTest(method=method, path=path):
                    response = client.request(
                        method,
                        path,
                        headers={"Authorization": "Bearer synthetic-untrusted-token"},
                        json={"report": "synthetic-private-marker"},
                    )
                    self.assertEqual(response.status_code, 404)
                    if path.startswith(("/api/v2/", "/.well-known/")):
                        validate_schema("Error", response.json())
                    else:
                        self.assertEqual(response.json(), {"detail": "Not Found"})
                    self.assertEqual(response.headers["cache-control"], "no-store")
                    self.assertNotIn("synthetic-private-marker", response.text)
                    self.assertNotIn("synthetic-untrusted-token", response.text)

    def test_mcp_disabled_without_configuration_and_needs_no_cloud(self):
        from unittest.mock import patch

        with (
            patch.dict(os.environ, HUB_OAUTH_ENABLED="0", HUB_ENCRYPTED_ADAPTER_ENABLED="0"),
            patch("app.mcp_transport.get_oauth_service", side_effect=AssertionError("cloud")),
            TestClient(app) as client,
        ):
            response = client.post("/mcp/v2", json={"private": "synthetic-private-marker"})
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json(), {"detail": "Not Found"})
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(client.get("/health").status_code, 200)

    def test_oauth_is_disabled_without_configuration_and_needs_no_cloud(self):
        from unittest.mock import patch

        with (
            patch.dict(os.environ, {"HUB_OAUTH_ENABLED": "0"}),
            patch(
                "app.oauth.get_store",
                side_effect=AssertionError("Disabled OAuth must not open storage"),
            ),
            TestClient(app) as client,
        ):
            for method, path in (
                ("GET", "/oauth/authorize"),
                ("POST", "/oauth/token"),
                ("POST", "/oauth/revoke"),
                ("GET", "/.well-known/oauth-authorization-server"),
                ("GET", "/.well-known/oauth-protected-resource/mcp/v2"),
                ("GET", "/agent/v2/authorization"),
            ):
                response = client.request(method, path)
                self.assertEqual(response.status_code, 404, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn("credentials", response.text.lower())

    def test_fresh_start_and_health_need_no_credentials_or_network(self):
        # A fresh interpreter cannot accidentally reuse another service's app or
        # an already-created cloud client. ASGI health runs without a real socket.
        script = """
import json
import sys
from unittest.mock import patch

with patch('socket.create_connection', side_effect=AssertionError('network forbidden')), \\
     patch('socket.socket.connect', side_effect=AssertionError('network forbidden')):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        response = client.get('/health')
        assert response.status_code == 200
        assert response.json() == {'status': 'ok', 'service': 'agent-hub'}
    for name in ('firebase_admin', 'google.auth', 'google.cloud.firestore',
                 'app.watchlist', 'app.preferences', 'app.portfolio', 'yfinance'):
        assert name not in sys.modules, name
print(json.dumps(response.json()))
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=SERVICE,
            env={
                "PATH": os.environ.get("PATH", ""),
                "PYTHONPATH": os.pathsep.join((str(ROOT / "services/common"), str(SERVICE))),
                "CORS_ORIGINS": "",
            },
            text=True,
            capture_output=True,
            timeout=30,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout), {"status": "ok", "service": "agent-hub"})

    def test_unconfigured_browser_origin_does_not_gain_private_access(self):
        with TestClient(app) as client:
            response = client.get(
                "/api/v2/inbox", headers={"Origin": "https://synthetic-untrusted.example"}
            )
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("access-control-allow-origin", response.headers)


class RetiredSurfaceTests(unittest.TestCase):
    def test_old_flags_cannot_reactivate_browser_executor_or_financial_transports(self):
        from unittest.mock import patch

        from app import native_transport_routes

        with (
            patch.dict(
                os.environ,
                {
                    "HUB_OAUTH_ENABLED": "1",
                    "HUB_ENCRYPTED_ADAPTER_ENABLED": "1",
                    "HUB_PERSISTENT_RUNTIME_ENABLED": "1",
                    "HUB_EXECUTOR_CIPHERTEXT_ENABLED": "1",
                    "HUB_PERSISTENT_TRANSPORT_ENABLED": "1",
                    "HUB_PERSISTENT_MCP_ENABLED": "1",
                    "HUB_AGENT_OWNED_CREDENTIALS_ENABLED": "0",
                },
            ),
            patch.object(
                native_transport_routes,
                "get_store",
                side_effect=AssertionError("retired requests cannot load storage"),
            ),
            TestClient(app) as client,
        ):
            for method, path in [
                ("GET", "/agent/v3/runtime/controller.html"),
                ("GET", "/agent/v3/runtime/config"),
                ("POST", "/agent/v3/runtime/setups/old_setup/offers"),
                ("POST", "/api/v2/runtime-setups/old_setup/completion"),
                ("POST", "/api/v2/executor-connections/vault_A/connection_A/bindings"),
                ("POST", "/agent/v2/persistent/identity-recovery/challenges"),
                ("POST", "/mcp/v2"),
                ("GET", "/oauth/authorize"),
                ("POST", "/oauth/token"),
                ("GET", "/agent/v2/authorization"),
                ("POST", "/agent/v2/tasks/task_A/runs"),
            ]:
                response = client.request(method, path)
                self.assertEqual(response.status_code, 404, path)
            self.assertEqual(client.post("/mcp/v3", json={}).status_code, 503)
            self.assertEqual(client.get("/health").status_code, 200)
