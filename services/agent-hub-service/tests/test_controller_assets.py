"""Fixed static Hub surfaces are lazy, gated, bounded and independent of cloud clients."""

import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class ControllerAssetsTests(unittest.TestCase):
    def test_extended_release_is_pinned_gated_and_does_not_replace_legacy_assets(self):
        import hashlib

        old = self.client.get("/agent/v2/controller/config/1.3.0").json()
        new = self.client.get("/agent/v2/controller/config/1.4.0").json()
        self.assertEqual(new["helperVersion"], "1.4.0")
        self.assertEqual(new["workerPath"], "/agent/v2/helper/1.4.0/worker.mjs")
        self.assertNotEqual(new["workerSha256"], old["workerSha256"])
        manifest = self.client.get("/agent/v2/helper/1.4.0/integrity.json").json()
        for name in [
            "controller.html",
            "controller.css",
            "controller.mjs",
            "worker.mjs",
            "owner-helper.mjs",
            "controller-page.mjs",
            "protocol.json",
        ]:
            response = self.client.get("/agent/v2/helper/1.4.0/" + name)
            self.assertEqual(response.status_code, 200)
            prefix = (
                "static/"
                if name.endswith((".html", ".css"))
                else "dist/"
                if name.endswith(".mjs")
                else ""
            )
            self.assertEqual(
                hashlib.sha256(response.content).hexdigest(), manifest["files"][prefix + name]
            )
        self.assertEqual(self.client.get("/agent/v2/helper/1.4.0/idb-runtime.mjs").status_code, 404)
        with patch.dict(os.environ, {"HUB_OAUTH_ENABLED": "0"}):
            self.assertEqual(self.client.get("/agent/v2/controller/config/1.4.0").status_code, 503)
            self.assertEqual(
                self.client.get("/agent/v2/helper/1.4.0/controller.html").status_code, 503
            )

    def setUp(self):
        self.environment = {
            "HUB_ENCRYPTED_ADAPTER_ENABLED": "1",
            "HUB_OAUTH_ENABLED": "1",
            "HUB_OAUTH_ISSUER": "https://hub.example",
            "HUB_OAUTH_CONSENT_URL": "https://hub.example/agent/v2/helper/consent.html",
            "HUB_OAUTH_CLIENTS_JSON": json.dumps(
                [
                    {
                        "provider": "muse",
                        "clientId": "synthetic_muse",
                        "redirectUris": ["https://agent.meta.ai/api/hatch/oauth/callback"],
                        "tokenEndpointAuthMethod": "none",
                        "secretSha256": None,
                    }
                ]
            ),
            "CORS_ORIGINS": "https://web.example,http://127.0.0.1:3000",
        }
        settings = patch.dict(os.environ, self.environment)
        settings.start()
        self.addCleanup(settings.stop)
        self.client = TestClient(app, base_url="https://hub.example")
        self.addCleanup(self.client.close)

    def test_explicit_owner_origins_callback_metadata_and_fixed_paths(self):
        response = self.client.get("/agent/v2/controller/config")
        self.assertEqual(response.status_code, 200, response.text)
        value = response.json()
        self.assertEqual(value["ownerOrigins"], ["https://web.example", "http://127.0.0.1:3000"])
        self.assertEqual(
            value["clients"][0]["redirectUris"], ["https://agent.meta.ai/api/hatch/oauth/callback"]
        )
        self.assertEqual(value["profile"], "folioview.owner-consent-bridge.v1")
        self.assertEqual(len(value["workerSha256"]), 64)
        for name in [
            "consent.html",
            "controller.html",
            "controller.css",
            "controller.mjs",
            "controller-page.mjs",
            "owner-helper.mjs",
            "consent.mjs",
        ]:
            item = self.client.get("/agent/v2/helper/" + name)
            self.assertEqual(item.status_code, 200, name)
            self.assertEqual(item.headers["cache-control"], "no-store")
            self.assertEqual(item.headers["x-content-type-options"], "nosniff")
            if name.endswith(".html"):
                self.assertIn("frame-ancestors 'none'", item.headers["content-security-policy"])
                self.assertNotIn("unsafe-inline", item.headers["content-security-policy"])
                self.assertNotIn("unsafe-eval", item.headers["content-security-policy"])
        self.assertEqual(self.client.get("/agent/v2/helper/idb-runtime.mjs").status_code, 404)
        docker = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
        self.assertNotIn("COPY services/agent-hub-service/tests", docker)

    def test_unset_wildcard_ambiguous_or_noncanonical_owner_origins_fail_closed(self):
        for value in [
            "",
            "*",
            "https://web.example/",
            "https://WEB.example",
            "https://web.example:443",
            "http://untrusted.example",
            "https://web.example,https://web.example",
            "https://web.example?next=evil",
        ]:
            with self.subTest(value=value), patch.dict(os.environ, {"CORS_ORIGINS": value}):
                response = self.client.get("/agent/v2/controller/config")
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("https://web.example", response.text)

    def test_new_transport_release_is_explicit_and_keeps_legacy_distribution(self):
        old = self.client.get("/agent/v2/controller/config").json()
        new = self.client.get("/agent/v2/controller/config/1.3.0").json()
        self.assertEqual(old["helperVersion"], "1.2.0")
        self.assertEqual(new["helperVersion"], "1.3.0")
        self.assertNotEqual(old["workerSha256"], new["workerSha256"])
        self.assertEqual(new["workerPath"], "/agent/v2/helper/1.3.0/worker.mjs")
        for name in [
            "controller.html",
            "controller.css",
            "controller.mjs",
            "worker.mjs",
            "owner-helper.mjs",
            "controller-page.mjs",
            "integrity.json",
            "protocol.json",
        ]:
            response = self.client.get("/agent/v2/helper/1.3.0/" + name)
            self.assertEqual(response.status_code, 200, name)
            self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.client.get("/agent/v2/helper/1.3.0/idb-runtime.mjs").status_code, 404)
        self.assertEqual(self.client.get("/agent/v2/helper/9.9.9/worker.mjs").status_code, 404)
        self.assertEqual(
            self.client.get("/agent/v2/controller/config/1.3.0?issuer=evil").status_code, 503
        )
        with patch.dict(os.environ, {"HUB_OAUTH_ENABLED": "0"}):
            self.assertEqual(self.client.get("/agent/v2/controller/config/1.3.0").status_code, 503)
            self.assertEqual(
                self.client.get("/agent/v2/helper/1.3.0/controller.html").status_code, 503
            )

    def test_adapter_and_oauth_remain_disabled_by_default_without_credential_fallback(self):
        with patch.dict(os.environ, {"HUB_ENCRYPTED_ADAPTER_ENABLED": "0"}):
            self.assertEqual(self.client.get("/agent/v2/helper/controller.html").status_code, 503)
            self.assertEqual(self.client.get("/agent/v2/controller/config").status_code, 503)
        with patch.dict(os.environ, {"HUB_OAUTH_ENABLED": "0"}):
            self.assertEqual(self.client.get("/agent/v2/controller/config").status_code, 503)
        self.assertEqual(
            self.client.get("/agent/v2/controller/config?owner=https://evil.example").status_code,
            503,
        )
