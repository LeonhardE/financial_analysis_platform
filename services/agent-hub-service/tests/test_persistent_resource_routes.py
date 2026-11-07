"""Explicit opt-in approval while policy history and revocation stay available."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.persistent_routes import get_resource_consent_service, router
from folioview_shared.encrypted.constants import CONTRACT_VERSION

SYNTHETIC_OPERATION = "synthetic_resource_operation_01"


class ResourceConsentRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        app.add_middleware(HubErrors)
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid="synthetic")
        self.calls = []
        service = SimpleNamespace(
            state=lambda *a: self.calls.append(a) or {"consent": None},
            receipt=lambda *a: self.calls.append(a) or {"receipt": "synthetic"},
            command=lambda *a, **k: self.calls.append((a, k)) or {"committed": True},
        )
        app.dependency_overrides[get_resource_consent_service] = lambda: service
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.write_headers = {**self.headers, "Idempotency-Key": SYNTHETIC_OPERATION}
        self.body = {"contractVersion": CONTRACT_VERSION, "command": {"synthetic": True}}
        self.path = "/api/v2/persistent-agents/vault_A/connection_A"

    def test_approvals_default_closed_but_read_and_revoke_do_not_require_activation(self):
        with patch.dict(os.environ, {"HUB_PERSISTENT_RESOURCE_CONSENTS_ENABLED": "0"}):
            response = self.client.post(
                self.path + "/resource-approvals", headers=self.write_headers, json=self.body
            )
            self.assertEqual(response.status_code, 503)
            self.assertEqual(self.calls, [])
            self.assertEqual(
                self.client.get(self.path + "/resource-consent", headers=self.headers).status_code,
                200,
            )
            response = self.client.post(
                self.path + "/resource-revocations", headers=self.write_headers, json=self.body
            )
            self.assertEqual(response.status_code, 201)
            self.assertTrue(self.calls[-1][1]["revoke"])

    def test_capabilities_keep_execution_false_when_resource_control_is_activated(self):
        with (
            patch.dict(os.environ, {"HUB_PERSISTENT_RESOURCE_CONSENTS_ENABLED": "1"}),
            patch("app.persistent_routes.enrollment_clients", return_value=("synthetic_muse",)),
        ):
            response = self.client.get(
                "/api/v2/persistent-agents/capabilities", headers=self.headers
            )
            self.assertTrue(response.json()["resourceConsentEnabled"])
            self.assertFalse(response.json()["executionEnabled"])
            response = self.client.post(
                self.path + "/resource-approvals", headers=self.write_headers, json=self.body
            )
            self.assertEqual(response.status_code, 201)
            self.assertEqual(self.calls[-1][0][0], "synthetic")

    def test_resource_flag_cannot_bypass_missing_identity_enrollment_configuration(self):
        with patch.dict(
            os.environ,
            {"HUB_PERSISTENT_RESOURCE_CONSENTS_ENABLED": "1", "HUB_PERSISTENT_AGENTS_ENABLED": "0"},
        ):
            response = self.client.post(
                self.path + "/resource-approvals", headers=self.write_headers, json=self.body
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.calls, [])

    def test_receipt_uses_fixed_path_not_body_owner_selectors(self):
        response = self.client.get(
            self.path + "/resource-operations/" + SYNTHETIC_OPERATION, headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls, [("synthetic", "vault_A", "connection_A", SYNTHETIC_OPERATION)]
        )

    def test_unknown_fields_selectors_contract_and_content_type_rejected(self):
        with patch("app.persistent_routes.require_resource_approval"):
            cases = [
                self.client.post(
                    self.path + "/resource-approvals?owner=other",
                    headers=self.write_headers,
                    json=self.body,
                ),
                self.client.post(
                    self.path + "/resource-approvals",
                    headers={**self.write_headers, "X-FolioView-Author-Key": "A" * 43},
                    json=self.body,
                ),
                self.client.post(
                    self.path + "/resource-approvals",
                    headers=self.write_headers,
                    json={**self.body, "ownerSubject": "other"},
                ),
                self.client.post(
                    self.path + "/resource-approvals",
                    headers=self.write_headers,
                    content="synthetic",
                ),
            ]
        self.assertEqual([r.status_code for r in cases], [400, 400, 400, 415])
        self.assertEqual(self.calls, [])

    def test_body_budget_is_enforced_without_echo_or_storage(self):
        with patch("app.persistent_routes.require_resource_approval"):
            response = self.client.post(
                self.path + "/resource-approvals",
                headers=self.write_headers,
                json={
                    "contractVersion": CONTRACT_VERSION,
                    "command": {"synthetic_marker": "X" * 100000},
                },
            )
        self.assertEqual(response.status_code, 413)
        self.assertNotIn("synthetic_marker", response.text)
        self.assertEqual(self.calls, [])
