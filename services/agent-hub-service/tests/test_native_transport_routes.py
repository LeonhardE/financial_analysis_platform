"""Separate issuer, closed forms and actual browser consent binding."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlencode

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.native_transport_routes import (
    COOKIE,
    COOKIE_PATH,
    get_native_transport,
    owner_router,
    router,
)
from folioview_shared.encrypted.constants import CONTRACT_VERSION

BROWSER = "b" * 43


class NativeTransportRoutes(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.include_router(owner_router)
        self.app.add_middleware(HubErrors)
        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(
            uid="synthetic_owner"
        )
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.calls = []
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Origin": "https://synthetic-hub.example",
            "Cookie": COOKIE + "=" + BROWSER,
        }
        self.path = COOKIE_PATH + "/synthetic_native_request"

    def install(self):
        service = SimpleNamespace(
            config=SimpleNamespace(
                consent_url="https://synthetic-hub.example/agent/v3/runtime/account-consent.html"
            ),
            pending=lambda *a: self.calls.append(a) or {"authority": "account_link_only"},
            approve=lambda *a: (
                self.calls.append(a)
                or "https://synthetic-muse.example/callback?code=synthetic&state=synthetic"
            ),
            authorize=lambda *a: self.calls.append(a) or "synthetic_native_request",
            metadata=lambda: {"scopes_supported": ["runtime:connect"]},
            protected_metadata=lambda: {"resource": "https://synthetic-hub.example/mcp/v3"},
            protocol=lambda *a: self.calls.append(a) or (200, {"revoked": True}, {}),
        )
        self.app.dependency_overrides[get_native_transport] = lambda: service

    def test_disabled_protocol_never_loads_storage_or_configuration(self):
        with (
            patch.dict(os.environ, {"HUB_PERSISTENT_TRANSPORT_ENABLED": "0"}),
            patch("app.native_transport_routes.get_store") as store,
        ):
            response = self.client.get("/.well-known/oauth-authorization-server/oauth/persistent")
        self.assertEqual(response.status_code, 503)
        store.assert_not_called()
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_authorize_sets_only_dedicated_secure_cookie_and_fixed_consent_target(self):
        self.install()
        response = self.client.get(
            "/oauth/persistent/authorize?" + urlencode({"client_id": "synthetic_client"}),
            follow_redirects=False,
        )
        self.assertEqual(response.status_code, 303)
        self.assertTrue(
            response.headers["location"].startswith(
                "https://synthetic-hub.example/agent/v3/runtime/account-consent.html?request="
            )
        )
        cookie = response.headers["set-cookie"]
        self.assertIn(COOKIE + "=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("Path=" + COOKIE_PATH, cookie)
        self.assertIn("SameSite=lax", cookie)

    def test_owner_pending_and_approval_bind_exact_origin_cookie_and_google_identity(self):
        self.install()
        self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 200)
        self.assertEqual(self.calls[-1], ("synthetic_owner", "synthetic_native_request", BROWSER))
        response = self.client.post(
            self.path + "/approvals",
            headers=self.headers,
            json={"contractVersion": CONTRACT_VERSION, "vaultId": "vault_A"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls[-1], ("synthetic_owner", "synthetic_native_request", BROWSER, "vault_A")
        )

    def test_missing_foreign_duplicate_cookies_or_origins_cannot_approve(self):
        self.install()
        variants = [
            {k: v for k, v in self.headers.items() if k != "Cookie"},
            {**self.headers, "Origin": "https://other.example"},
            {**self.headers, "Cookie": COOKIE + "=" + BROWSER + "; " + COOKIE + "=" + BROWSER},
            {**self.headers, "Cookie": COOKIE + "=short"},
        ]
        for headers in variants:
            self.assertEqual(
                self.client.post(
                    self.path + "/approvals",
                    headers=headers,
                    json={"contractVersion": CONTRACT_VERSION, "vaultId": "vault_A"},
                ).status_code,
                403,
            )
        self.assertEqual(self.calls, [])

    def test_scope_author_selector_query_and_plaintext_fields_rejected(self):
        self.install()
        body = {"contractVersion": CONTRACT_VERSION, "vaultId": "vault_A"}
        responses = [
            self.client.post(
                self.path + "/approvals",
                headers=self.headers,
                json={**body, "scopes": ["portfolio:read"]},
            ),
            self.client.post(self.path + "/approvals?owner=other", headers=self.headers, json=body),
            self.client.post(
                self.path + "/approvals",
                headers={**self.headers, "X-FolioView-Author-Key": "A" * 43},
                json=body,
            ),
        ]
        self.assertEqual([r.status_code for r in responses], [400, 400, 400])
        self.assertEqual(self.calls, [])

    def test_protocol_form_duplicates_and_unknown_fields_rejected_before_authlib(self):
        self.install()
        for raw in ("client_id=A&client_id=B", "plaintext=private_marker", "resource=%GG"):
            response = self.client.post(
                "/oauth/persistent/token",
                content=raw,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("private_marker", response.text)
        self.assertEqual(self.calls, [])

    def test_capabilities_do_not_claim_trusted_runtime_ready(self):
        with patch.dict(os.environ, {"HUB_PERSISTENT_TRANSPORT_ENABLED": "0"}):
            response = self.client.get(
                COOKIE_PATH + "/capabilities", headers={"X-FolioView-Contract": CONTRACT_VERSION}
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["accountLinkEnabled"])
        self.assertFalse(response.json()["runtimeReady"])
