"""Fixed Agent proof transport with activation and no credential fallback."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import HubErrors
from app.identity_recovery_routes import get_identity_recovery_service, router
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class IdentityRecoveryRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.add_middleware(HubErrors)
        self.calls = []
        self.service = SimpleNamespace(
            challenge=lambda *a: self.calls.append(a) or {"synthetic": "challenge"},
            recover=lambda *a: self.calls.append(a) or {"authority": "identity_only"},
        )
        self.app.dependency_overrides[get_identity_recovery_service] = lambda: self.service
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.path = "/agent/v2/persistent/identity-recovery"
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.body = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": "a" * 64,
            "vaultId": "vault_A",
            "connectionId": "connection_A",
            "clientId": "synthetic_muse",
        }

    def test_challenge_and_proof_use_only_closed_fields_not_caller_tokens(self):
        response = self.client.post(self.path + "/challenges", headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls[-1], ("a" * 64, "vault_A", "connection_A", "synthetic_muse"))
        response = self.client.post(
            self.path + "/proofs",
            headers=self.headers,
            json={**self.body, "proof": {"synthetic": True}},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["authority"], "identity_only")

    def test_token_authority_and_idempotency_headers_cannot_substitute_for_proof(self):
        for header in (
            "Authorization",
            "X-FolioView-Author-Key",
            "Idempotency-Key",
            "X-FolioView-Delegation",
            "X-FolioView-Authority-Delegation",
        ):
            response = self.client.post(
                self.path + "/challenges",
                headers={**self.headers, header: "synthetic"},
                json=self.body,
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.calls, [])

    def test_unknown_body_scope_or_query_contract_and_body_budget_fail_before_storage(self):
        responses = [
            self.client.post(
                self.path + "/challenges?scope=all", headers=self.headers, json=self.body
            ),
            self.client.post(
                self.path + "/challenges",
                headers=self.headers,
                json={**self.body, "scopes": ["all"]},
            ),
            self.client.post(self.path + "/challenges", json=self.body),
            self.client.post(
                self.path + "/proofs",
                headers=self.headers,
                json={**self.body, "proof": {"synthetic_marker": "X" * 40000}},
            ),
        ]
        self.assertEqual([r.status_code for r in responses], [400, 400, 400, 413])
        self.assertEqual(self.calls, [])
        self.assertNotIn("synthetic_marker", responses[-1].text)

    def test_disabled_configuration_uses_no_store_or_oauth_credentials(self):
        self.app.dependency_overrides.clear()
        with (
            patch.dict(os.environ, {"HUB_PERSISTENT_IDENTITY_RECOVERY_ENABLED": "0"}),
            patch("app.identity_recovery_routes.get_store") as store,
            patch("app.identity_recovery_routes.OAuthConfig.environment") as config,
        ):
            response = self.client.post(
                self.path + "/challenges", headers=self.headers, json=self.body
            )
        self.assertEqual(response.status_code, 503)
        store.assert_not_called()
        config.assert_not_called()
        self.assertEqual(response.json()["error"]["code"], "authorization_unavailable")

    def test_missing_proof_is_not_an_identity_only_recovery(self):
        response = self.client.post(self.path + "/proofs", headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.calls, [])
