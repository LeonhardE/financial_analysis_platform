"""Public CSR possession and authenticated owner observation are distinct routes."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.runtime_setup_routes import get_runtime_setup, owner_router, public_router
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class RuntimeSetupRoutes(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(public_router)
        self.app.include_router(owner_router)
        self.app.add_middleware(HubErrors)
        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(
            uid="synthetic_owner"
        )
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.calls = []
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.public = "/agent/v3/runtime/setups/synthetic_runtime_setup_01"
        self.owner = "/api/v2/runtime-setups/synthetic_runtime_setup_01"

    def install(self):
        self.app.dependency_overrides[get_runtime_setup] = lambda: SimpleNamespace(
            public_state=lambda *a: self.calls.append(a) or {"paired": None},
            offer=lambda *a: self.calls.append(a) or {"offerFingerprint": "a" * 64},
            owner_state=lambda *a: (
                self.calls.append(a) or {"authority": "pairing_observation_only"}
            ),
            complete=lambda *a: self.calls.append(a) or {"paired": {}},
        )

    def test_disabled_factory_does_not_load_native_credentials_or_storage(self):
        with (
            patch.dict(os.environ, {"HUB_PERSISTENT_MCP_ENABLED": "0"}),
            patch("app.runtime_setup_routes.get_native_transport") as native,
        ):
            self.assertEqual(self.client.get(self.public, headers=self.headers).status_code, 503)
        native.assert_not_called()

    def test_public_offer_never_accepts_bearer_owner_selector_or_private_body_fields(self):
        self.install()
        body = {"contractVersion": CONTRACT_VERSION, "proof": {}}
        cases = [
            self.client.post(
                self.public + "/offers",
                headers={**self.headers, "Authorization": "Bearer private_marker"},
                json=body,
            ),
            self.client.post(self.public + "/offers?owner=other", headers=self.headers, json=body),
            self.client.post(
                self.public + "/offers",
                headers=self.headers,
                json={**body, "privateJwk": "private_marker"},
            ),
        ]
        self.assertEqual([r.status_code for r in cases], [400, 400, 400])
        self.assertEqual(self.calls, [])
        self.assertTrue(all("private_marker" not in r.text for r in cases))

    def test_owner_uses_authenticated_uid_and_completion_cannot_supply_identity_or_permission(self):
        self.install()
        self.assertEqual(self.client.get(self.owner, headers=self.headers).status_code, 200)
        self.assertEqual(self.calls[-1], ("synthetic_owner", "synthetic_runtime_setup_01"))
        self.assertEqual(
            self.client.post(
                self.owner + "/completion",
                headers=self.headers,
                json={"contractVersion": CONTRACT_VERSION},
            ).status_code,
            200,
        )
        self.calls.clear()
        self.assertEqual(
            self.client.post(
                self.owner + "/completion",
                headers=self.headers,
                json={"contractVersion": CONTRACT_VERSION, "resources": ["private_marker"]},
            ).status_code,
            400,
        )
        self.assertEqual(self.calls, [])
