"""HTTP boundaries for owner-only gated persistent enrollment."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.persistent_routes import get_persistent_service, router
from folioview_shared.encrypted.constants import CONTRACT_VERSION

SYNTHETIC_OPERATION = "synthetic_operation_0001"


class PersistentRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        app.add_middleware(HubErrors)
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid="synthetic")
        self.calls = []
        service = SimpleNamespace(
            state=lambda *a: self.calls.append(a) or {"identity": None},
            receipt=lambda *a: self.calls.append(a) or {"operation": "synthetic"},
            command=lambda *a, **k: self.calls.append((a, k)) or {"revoked": True},
        )
        app.dependency_overrides[get_persistent_service] = lambda: service
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.path = "/api/v2/persistent-agents/vault_A/connection_A"

    def test_capabilities_do_not_claim_execution_or_consent_ready(self):
        with patch.dict(os.environ, {"HUB_PERSISTENT_AGENTS_ENABLED": "0"}):
            response = self.client.get(
                "/api/v2/persistent-agents/capabilities", headers=self.headers
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["enrollmentEnabled"])
        self.assertFalse(response.json()["executionEnabled"])
        self.assertFalse(response.json()["resourceConsentEnabled"])

    def test_disabled_enrollment_cannot_mutate_storage(self):
        with patch.dict(os.environ, {"HUB_PERSISTENT_AGENTS_ENABLED": "0"}):
            response = self.client.post(
                self.path + "/bindings",
                headers={**self.headers, "Idempotency-Key": SYNTHETIC_OPERATION},
                json={"contractVersion": CONTRACT_VERSION, "command": {}},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.calls, [])
        self.assertNotIn("command", response.text)

    def test_owner_history_available_while_enrollment_disabled(self):
        response = self.client.get(self.path, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls, [("synthetic", "vault_A", "connection_A")])

    def test_unknown_query_and_author_selectors_rejected(self):
        cases = [
            (self.path + "?owner=other", self.headers),
            (self.path, {**self.headers, "X-FolioView-Author-Key": "A" * 43}),
            (self.path, {**self.headers, "Idempotency-Key": SYNTHETIC_OPERATION}),
        ]
        for path, headers in cases:
            self.assertEqual(self.client.get(path, headers=headers).status_code, 400)
        self.assertEqual(self.calls, [])

    def test_revocation_does_not_require_enrollment_enabled(self):
        with patch.dict(os.environ, {"HUB_PERSISTENT_AGENTS_ENABLED": "0"}):
            response = self.client.post(
                self.path + "/revocations",
                headers={**self.headers, "Idempotency-Key": SYNTHETIC_OPERATION},
                json={"contractVersion": CONTRACT_VERSION, "command": {"synthetic": True}},
            )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(self.calls[0][1]["revoke"])

    def test_contract_and_operation_required(self):
        self.assertEqual(self.client.get(self.path).status_code, 400)
        self.assertEqual(
            self.client.post(self.path + "/revocations", headers=self.headers, json={}).status_code,
            400,
        )
        self.assertEqual(self.calls, [])
