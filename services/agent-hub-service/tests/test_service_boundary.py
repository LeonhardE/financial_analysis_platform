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
    def test_health_and_openapi_expose_bounded_vault_authority_only(self):
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
                    "/api/v2/vaults/{vault_id}/holdings-sources/{source_id}",
                    "/api/v2/vaults/current/authority-token",
                    "/internal/v2/portfolio-authorities/read",
                    "/.well-known/jwks.json",
                },
            )

    def test_private_and_protocol_paths_are_not_implemented_or_cached(self):
        with TestClient(app) as client:
            for method, path in (
                ("GET", "/api"),
                ("GET", "/api/v2/resources"),
                ("GET", "/api/v2/tasks"),
                ("POST", "/api/v2/results"),
                ("GET", "/api/v2/inbox"),
                ("GET", "/mcp"),
                ("POST", "/mcp/v2"),
                ("GET", "/oauth"),
                ("GET", "/oauth/authorize"),
                ("POST", "/oauth/token"),
                ("GET", "/.well-known"),
                ("GET", "/.well-known/oauth-authorization-server"),
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
