"""Fixed native window distribution without a browser Agent key/runtime fallback."""

import hashlib
import json
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

from app import account_assets


class AccountAssetsTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(account_assets.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_default_off_does_not_load_native_transport(self):
        with (
            patch.dict(os.environ, HUB_AGENT_OWNED_CREDENTIALS_ENABLED="0"),
            patch.object(
                account_assets, "get_native_transport", side_effect=AssertionError("must not load")
            ),
        ):
            self.assertEqual(self.client.get("/agent/v3/account/consent.html").status_code, 503)

    def test_only_account_assets_and_bounded_config_are_served(self):
        native = SimpleNamespace(config=SimpleNamespace(base=configuration()))
        with (
            patch.dict(
                os.environ,
                HUB_AGENT_OWNED_CREDENTIALS_ENABLED="1",
                HUB_PERSISTENT_TRANSPORT_ENABLED="1",
                HUB_PERSISTENT_MCP_ENABLED="1",
                CORS_ORIGINS="https://owner.example",
            ),
            patch.object(account_assets, "get_native_transport", return_value=native),
        ):
            for path in [
                "/agent/v3/account/consent.html",
                "/agent/v3/runtime/account-consent.html",
                "/agent/v3/account/1.0.0/account-consent-page.mjs",
                "/agent/v3/account/1.0.0/account-bridge.mjs",
            ]:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
            config = self.client.get("/agent/v3/account/config").json()
            self.assertEqual(
                set(config),
                {"contractVersion", "accountLinkVersion", "issuer", "ownerOrigins", "clients"},
            )
            self.assertNotIn("workerPath", config)
            for path in [
                "/agent/v3/runtime/config",
                "/agent/v3/runtime/controller.html",
                "/agent/v3/runtime/1.0.0/worker.mjs",
                "/agent/v3/account/1.0.0/session.mjs",
            ]:
                self.assertEqual(self.client.get(path).status_code, 404)
            self.assertEqual(
                self.client.get("/agent/v3/account/config?origin=evil").status_code, 503
            )
            with patch.dict(os.environ, CORS_ORIGINS="*"):
                self.assertEqual(self.client.get("/agent/v3/account/config").status_code, 503)

    def test_reviewed_plain_modules_match_the_manifest_and_keep_bridge_and_schedule_guards(self):
        root = account_assets.ROOT
        manifest = json.loads((root / "integrity.json").read_text())
        for name, digest in manifest["files"].items():
            self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), digest)
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node)
        for name in ["account_link_boundaries.mjs", "private_client_policy_boundaries.mjs"]:
            result = subprocess.run(
                [node, str(Path(__file__).with_name(name))],
                capture_output=True,
                text=True,
                timeout=12,
            )
            self.assertEqual(result.returncode, 0, result.stderr[:1500])
