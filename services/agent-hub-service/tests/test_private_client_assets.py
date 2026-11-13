"""Reviewed static distribution and required local host-storage checks."""

import hashlib
import json
import os
import shutil
import subprocess
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import agent_client_assets as assets


class PrivateClientAssetTests(unittest.TestCase):
    def test_fixed_default_off_assets_no_queries_arbitrary_modules_or_secret_paths(self):
        app = FastAPI()
        app.include_router(assets.router)
        with TestClient(app) as client:
            with patch.object(assets, "agent_owned_enabled", return_value=False):
                for version in ("1.0.0", "1.0.1", "1.1.0", "1.2.0"):
                    self.assertEqual(
                        client.get(f"/agent/v3/client/{version}/client.mjs").status_code, 503
                    )
            with patch.object(assets, "agent_owned_enabled", return_value=True):
                response = client.get("/agent/v3/client/1.2.0/client.mjs")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
                self.assertEqual(
                    assets.client_metadata()["sha256"], hashlib.sha256(response.content).hexdigest()
                )
                self.assertIn(assets.client_metadata()["sha256"], response.headers["ETag"])
                for version in ("1.0.0", "1.0.1", "1.1.0", "1.2.0"):
                    for path in ("src/files.mjs", "index.mjs", "credentials.sqlite", "../../.env"):
                        self.assertEqual(
                            client.get(f"/agent/v3/client/{version}/" + path).status_code, 404
                        )
                    self.assertEqual(
                        client.get(
                            f"/agent/v3/client/{version}/client.mjs?origin=other"
                        ).status_code,
                        400,
                    )
                self.assertEqual(client.get("/agent/v3/client/1.0.2/client.mjs").status_code, 404)

    def test_original_version_remains_byte_identical_at_its_original_pin(self):
        app = FastAPI()
        app.include_router(assets.router)
        with (
            patch.object(assets, "agent_owned_enabled", return_value=True),
            TestClient(app) as client,
        ):
            response = client.get("/agent/v3/client/1.0.0/client.mjs")
            self.assertEqual(response.status_code, 200)
            original = "5b99a8fe60e12f39d05adf945251526da2651a3651c01e11975913926aabe77e"
            self.assertEqual(hashlib.sha256(response.content).hexdigest(), original)
            self.assertEqual(assets.client_metadata("1.0.0")["sha256"], original)
            self.assertNotEqual(original, assets.client_metadata()["sha256"])
            manifest = client.get("/agent/v3/client/1.0.0/integrity.json").json()
            notices = client.get("/agent/v3/client/1.0.0/THIRD_PARTY_NOTICES.md")
            self.assertEqual(manifest["clientVersion"], "1.0.0")
            self.assertEqual(manifest["files"]["dist/cli.mjs"], original)
            self.assertEqual(
                hashlib.sha256(notices.content).hexdigest(),
                manifest["files"]["THIRD_PARTY_NOTICES.md"],
            )

    def test_distribution_hashes_and_frozen_shared_dependency_are_complete(self):
        manifest = json.loads((assets.ROOT / "integrity.json").read_text())
        for file, expected in manifest["files"].items():
            self.assertEqual(
                hashlib.sha256((assets.ROOT / file).read_bytes()).hexdigest(), expected, file
            )
        lock = (assets.ROOT / "shared-contract.integrity.json").read_bytes()
        pinned = json.loads(lock)
        self.assertEqual(
            manifest["sharedLibrary"]["integritySha256"], hashlib.sha256(lock).hexdigest()
        )
        self.assertEqual(
            manifest["sharedLibrary"]["bundleSha256"], pinned["files"]["dist/core.mjs"]
        )
        self.assertEqual(manifest["nodeMinimum"], "24.12.0")
        self.assertIn("src/leases.mjs", pinned["files"])

    def test_private_file_loss_corruption_permissions_and_explicit_reauthorization(self):
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node, "Node 24 is required; do not skip host credential validation")
        result = subprocess.run(
            [node, "--test", str(assets.ROOT / "tests/files.test.mjs")],
            capture_output=True,
            text=True,
            timeout=25,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stderr[:1500] + result.stdout[-1500:])
        self.assertIn("pass 4", result.stdout)

    def test_cli_distinguishes_policy_time_state_service_and_credential_failures(self):
        node = os.getenv("FOLIOVIEW_NODE_BIN") or shutil.which("node")
        self.assertIsNotNone(node, "Node 24 is required for CLI recovery validation")
        result = subprocess.run(
            [node, "--test", str(assets.ROOT / "tests/cli.test.mjs")],
            capture_output=True,
            text=True,
            timeout=25,
            env={**os.environ, "NODE_OPTIONS": ""},
        )
        self.assertEqual(result.returncode, 0, result.stderr[:1500] + result.stdout[-1500:])
        self.assertIn("pass 6", result.stdout)
