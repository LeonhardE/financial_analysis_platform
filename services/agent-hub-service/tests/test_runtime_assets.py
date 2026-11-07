"""Default-off distribution, exact public configuration and browser trust boundaries."""

import os
import shutil
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_oauth import configuration

from app import runtime_assets


class PersistentRuntimeAssetsTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(runtime_assets.router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_default_off_never_loads_transport_or_serves_assets(self):
        with (
            patch.dict(os.environ, HUB_PERSISTENT_RUNTIME_ENABLED=""),
            patch.object(
                runtime_assets, "get_native_transport", side_effect=AssertionError("must not load")
            ),
        ):
            for path in ("controller.html", "account-consent.html", "config", "1.0.0/worker.mjs"):
                self.assertEqual(self.client.get("/agent/v3/runtime/" + path).status_code, 503)

    def test_fixed_distribution_and_config_reject_arbitrary_files_queries_or_owner_origins(self):
        native = SimpleNamespace(config=SimpleNamespace(base=configuration()))
        with (
            patch.dict(
                os.environ,
                HUB_PERSISTENT_RUNTIME_ENABLED="1",
                HUB_PERSISTENT_MCP_ENABLED="1",
                CORS_ORIGINS="https://synthetic-owner.example",
            ),
            patch.object(runtime_assets, "get_native_transport", return_value=native),
        ):
            for path in ("controller.html", "account-consent.html", "1.0.0/worker.mjs"):
                response = self.client.get("/agent/v3/runtime/" + path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
                self.assertEqual(response.headers["Cross-Origin-Resource-Policy"], "same-origin")
            config = self.client.get("/agent/v3/runtime/config").json()
            self.assertEqual(config["issuer"], native.config.base.issuer)
            self.assertEqual(config["workerPath"], "/agent/v3/runtime/1.0.0/worker.mjs")
            self.assertEqual(config["ownerOrigins"], ["https://synthetic-owner.example"])
            self.assertEqual(
                self.client.get("/agent/v3/runtime/1.0.0/session.mjs").status_code, 404
            )
            self.assertEqual(
                self.client.get("/agent/v3/runtime/config?origin=evil").status_code, 503
            )
            with patch.dict(os.environ, CORS_ORIGINS="*"):
                self.assertEqual(self.client.get("/agent/v3/runtime/config").status_code, 503)

    def test_native_account_bridge_and_timezone_trigger_boundaries(self):
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node, "Node is required; this suite cannot silently skip")
        result = subprocess.run(
            [node, str(Path(__file__).with_name("runtime_boundaries.mjs"))],
            capture_output=True,
            text=True,
            timeout=12,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stderr[:1500])
        self.assertEqual(
            __import__("json").loads(result.stdout),
            {"schedule": True, "bridge": True, "worker": True},
        )
