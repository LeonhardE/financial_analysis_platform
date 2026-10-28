"""The build-only skeleton starts without credentials or another service."""

import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

SERVICE_ROOT = Path(__file__).resolve().parents[1]
COMMON_ROOT = SERVICE_ROOT.parent / "common"


class PortfolioBoundaryTests(unittest.TestCase):
    def test_health_and_encrypted_owner_routes_are_the_only_implemented_routes(self):
        with TestClient(app) as client:
            response = client.get("/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"status": "ok", "service": "portfolio"})
            self.assertEqual(
                set(client.get("/openapi.json").json()["paths"]),
                {
                    "/health",
                    "/api/v2/holdings/sources/{source_id}",
                    "/api/v2/holdings/sources/{source_id}/latest",
                    "/api/v2/holdings/sources/{source_id}/snapshots/{snapshot_id}",
                    "/api/v2/holdings/sources/{source_id}/operations/{operation_id}",
                },
            )

    def test_unimplemented_private_and_brokerage_paths_refuse_requests(self):
        with TestClient(app) as client:
            for method, path in (
                ("GET", "/api/v2/holdings"),
                ("POST", "/api/v2/holdings"),
                ("POST", "/api/v2/holdings/import"),
                ("POST", "/api/v2/wealthsimple/connect"),
                ("DELETE", "/api/v2/connections/synthetic"),
            ):
                with self.subTest(method=method, path=path):
                    response = client.request(method, path)
                    self.assertEqual(response.status_code, 404)
                    self.assertEqual(response.headers["cache-control"], "no-store")

    def test_cold_start_needs_no_credentials_network_or_other_service(self):
        script = textwrap.dedent(
            """
            import os
            import sys
            from unittest.mock import patch

            from fastapi.testclient import TestClient

            original_getenv = os.getenv
            credential_names = {
                "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_PROJECT_ID",
                "FIRESTORE_DATABASE", "WEALTHSIMPLE_USERNAME",
                "WEALTHSIMPLE_PASSWORD", "WEALTHSIMPLE_ACCESS_TOKEN",
            }

            def checked_getenv(key, default=None):
                if key in credential_names:
                    raise AssertionError("Skeleton tried to read credentials/storage configuration")
                return original_getenv(key, default)

            with (
                patch("socket.socket.connect", side_effect=AssertionError("Outbound socket")),
                patch("socket.create_connection", side_effect=AssertionError("Outbound socket")),
                patch("os.getenv", side_effect=checked_getenv),
            ):
                from app.main import app
                with TestClient(app) as client:
                    response = client.get("/health")
                    assert response.status_code == 200
                    assert response.json() == {"status": "ok", "service": "portfolio"}

            for module in (
                "yfinance",
                "app.watchlist", "app.preferences", "app.market_data",
                "app.market_client", "app.brokerage",
            ):
                assert module not in sys.modules, module
            """
        )
        environment = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join((str(COMMON_ROOT), str(SERVICE_ROOT))),
            "GOOGLE_APPLICATION_CREDENTIALS": "/nonexistent/portfolio-skeleton-credentials.json",
            "WEALTHSIMPLE_USERNAME": "synthetic-unused",
            "WEALTHSIMPLE_PASSWORD": "synthetic-unused",
        }
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=SERVICE_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
