"""Owner authentication, activation and closed transport precede credential controls."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agent_credential_routes import get_credential_service, router
from app.api import require_owner
from app.errors import HubErrors
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class AgentCredentialRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.add_middleware(HubErrors)
        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(
            uid="synthetic_owner"
        )
        self.calls = []
        service = SimpleNamespace(
            state=lambda *a: self.calls.append(a) or {"status": "active"},
            owner_setup=lambda *a: self.calls.append(a) or {"offer": None},
            receipt=lambda *a: self.calls.append(a) or {"original": True},
            command=lambda *a: self.calls.append(a) or {"committed": True},
        )
        self.app.dependency_overrides[get_credential_service] = lambda: service
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.operation = "synthetic_credential_operation_0001"
        self.write_headers = {**self.headers, "Idempotency-Key": self.operation}
        self.path = "/api/v3/agent-credentials/vault_A/connection_A"
        self.body = {
            "contractVersion": CONTRACT_VERSION,
            "command": {"binding": {}, "approval": {}},
        }

    def test_default_closed_write_does_not_disable_owner_state_or_original_receipt(self):
        with patch.dict(os.environ, {"HUB_AGENT_OWNED_CREDENTIALS_ENABLED": "0"}):
            self.assertEqual(
                self.client.post(
                    self.path + "/approvals", headers=self.write_headers, json=self.body
                ).status_code,
                503,
            )
            self.assertEqual(self.calls, [])
            caps = self.client.get("/api/v3/agent-credentials/capabilities", headers=self.headers)
            self.assertFalse(caps.json()["enabled"])
            self.assertEqual(caps.json()["defaultValiditySeconds"], 7776000)
            self.assertEqual(caps.json()["noticeSeconds"], 604800)
            self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 200)
            self.assertEqual(
                self.client.get(
                    self.path + "/operations/" + self.operation, headers=self.headers
                ).status_code,
                200,
            )

    def test_owner_and_operation_come_from_authenticated_context_and_header(self):
        with patch("app.agent_credential_routes.agent_owned_enabled", return_value=True):
            response = self.client.post(
                self.path + "/approvals", headers=self.write_headers, json=self.body
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            self.calls,
            [("synthetic_owner", "vault_A", "connection_A", self.body["command"], self.operation)],
        )

    def test_queries_extra_owner_fields_and_delegation_headers_are_rejected(self):
        with patch("app.agent_credential_routes.agent_owned_enabled", return_value=True):
            for headers, body, path in [
                (
                    {**self.write_headers, "X-FolioView-Author-Key": "untrusted"},
                    self.body,
                    self.path,
                ),
                (
                    {**self.write_headers, "X-FolioView-Delegation": "untrusted"},
                    self.body,
                    self.path,
                ),
                (self.write_headers, {**self.body, "ownerSubject": "someone_else"}, self.path),
                (self.write_headers, self.body, self.path + "?ownerSubject=someone_else"),
            ]:
                route = path.replace("?", "/approvals?", 1) if "?" in path else path + "/approvals"
                response = self.client.post(route, headers=headers, json=body)
                self.assertEqual(response.status_code, 400)
            self.assertEqual(self.calls, [])

    def test_oversized_write_and_duplicate_operation_header_never_reach_service(self):
        with patch("app.agent_credential_routes.agent_owned_enabled", return_value=True):
            response = self.client.post(
                self.path + "/approvals",
                headers=self.write_headers,
                json={"contractVersion": CONTRACT_VERSION, "command": "x" * 33001},
            )
            self.assertEqual(response.status_code, 413)
            response = self.client.post(
                self.path + "/approvals",
                headers=[
                    *self.headers.items(),
                    ("Idempotency-Key", self.operation),
                    ("Idempotency-Key", self.operation),
                ],
                json=self.body,
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(self.calls, [])

    def test_missing_owner_authentication_fails_before_storage_factory(self):
        self.app.dependency_overrides.pop(require_owner)
        self.app.dependency_overrides[get_credential_service] = lambda: self.calls.append("factory")
        response = self.client.get(self.path, headers=self.headers)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])

    def test_setup_locator_cannot_choose_a_different_owner(self):
        response = self.client.get(
            self.path + "/setups/synthetic_setup_operation_0001", headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls,
            [("synthetic_owner", "vault_A", "connection_A", "synthetic_setup_operation_0001")],
        )
