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
                    "/health",
                    "/api/v2/vaults/current",
                    "/api/v2/vaults",
                    "/api/v2/vaults/{vault_id}/registry",
                    "/api/v2/vaults/{vault_id}/archive",
                    "/api/v2/vaults/{vault_id}/archive-operations/{operation_id}",
                    "/api/v2/vaults/{vault_id}/recovery-authorizations",
                    "/api/v2/vaults/{vault_id}/recovery-authorizations/{authorization_id}/revoke",
                    "/api/v2/vaults/{vault_id}/holdings-sources/{source_id}",
                    "/api/v2/vaults/current/authority-token",
                    "/api/v2/resources/catalogue",
                    "/api/v2/tasks",
                    "/api/v2/tasks/{task_id}",
                    "/api/v2/tasks/{task_id}/versions/{version}",
                    "/api/v2/tasks/{task_id}/transitions",
                    "/internal/v2/portfolio-authorities/read",
                    "/internal/v2/source-fences",
                    "/.well-known/jwks.json",
                    "/.well-known/oauth-authorization-server",
                    "/.well-known/oauth-protected-resource/mcp/v2",
                    "/oauth/authorize",
                    "/oauth/token",
                    "/oauth/revoke",
                    "/api/v2/agent-authorizations/{request_id}",
                    "/api/v2/agent-authorizations/{request_id}/claim",
                    "/api/v2/agent-authorizations/{request_id}/prepare",
                    "/api/v2/agent-authorizations/{request_id}/prepare-encrypted",
                    "/api/v2/agent-authorizations/{request_id}/decision",
                    "/api/v2/agent-connections",
                    "/api/v2/agent-connections/{connection_id}/revoke",
                    "/api/v2/agent-connections/{connection_id}/grants/{grant_id}/revoke",
                    "/agent/v2/authorization",
                    "/api/v2/agent-connections/{connection_id}/tasks/{task_id}/preparation-intent",
                    "/api/v2/agent-connections/{connection_id}/tasks/{task_id}/preparation/objects/{object_id}",
                    "/api/v2/agent-connections/{connection_id}/tasks/{task_id}/preparation/commit",
                    "/agent/v2/tasks/{task_id}/preparation",
                    "/agent/v2/preparations/{preparation_id}/objects/{object_id}",
                    "/agent/v2/preparations/{preparation_id}/registries/{sequence}",
                    "/agent/v2/tasks/{task_id}/runs",
                    "/agent/v2/runs/{run_id}",
                    "/agent/v2/runs/{run_id}/inputs",
                    "/agent/v2/runs/{run_id}/registries/{sequence}",
                    "/agent/v2/runs/{run_id}/results",
                    "/agent/v2/results/{result_id}/revisions",
                    "/agent/v2/runs/{run_id}/receipts/{operation}",
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
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {"error": "authorization_unavailable"})
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
                self.assertEqual(response.status_code, 503, response.text)
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
