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
from folioview_shared.encrypted.errors import ContractError


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
        for path in (
            self.path,
            self.path + "/restoration",
            self.path + "/restoration/source_A/" + "a" * 64,
        ):
            response = self.client.get(path, headers=self.headers)
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

    def test_restoration_reads_are_owner_only_closed_and_available_with_new_issuance_off(self):
        def read(*args):
            self.calls.append(args[1:])
            return {"publicHistory": True}

        with (
            patch("app.credential_restoration.head", side_effect=read),
            patch("app.credential_restoration.source", side_effect=read),
            patch.dict(os.environ, HUB_AGENT_OWNED_CREDENTIALS_ENABLED="0"),
        ):
            for tail in ("/restoration", "/restoration/source_A/" + "a" * 64):
                response = self.client.get(self.path + tail, headers=self.headers)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["publicHistory"])
            self.assertEqual(self.calls[0], ("synthetic_owner", "vault_A", "connection_A"))
            self.assertEqual(
                self.calls[1], ("synthetic_owner", "vault_A", "connection_A", "source_A", "a" * 64)
            )
            self.calls.clear()
            for headers, path in [
                (self.headers, self.path + "/restoration?owner=other"),
                ({**self.headers, "Idempotency-Key": self.operation}, self.path + "/restoration"),
                (
                    {**self.headers, "X-FolioView-Delegation": "private_marker"},
                    self.path + "/restoration",
                ),
            ]:
                response = self.client.get(path, headers=headers)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("private_marker", response.text)
            self.assertEqual(self.calls, [])

    def assert_formal_error(self, response, status, code):
        self.assertEqual(response.status_code, status)
        value = response.json()
        self.assertEqual(set(value), {"contractVersion", "error"})
        self.assertEqual(value["contractVersion"], CONTRACT_VERSION)
        self.assertEqual(set(value["error"]), {"code", "retryable", "requestId"})
        self.assertEqual(value["error"]["code"], code)
        self.assertEqual(value["error"]["retryable"], status == 503)
        self.assertRegex(value["error"]["requestId"], r"^[a-f0-9]{32}$")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("private_marker", response.text)

    def test_uncommitted_receipt_is_a_formal_not_found_for_owner_retry_orchestration(self):
        def missing(*args):
            self.calls.append(args)
            raise ContractError("not_found")

        self.app.dependency_overrides[get_credential_service] = lambda: SimpleNamespace(
            receipt=missing
        )
        response = self.client.get(
            self.path + "/operations/" + self.operation, headers=self.headers
        )
        self.assert_formal_error(response, 404, "not_found")
        self.assertEqual(
            self.calls,
            [("synthetic_owner", "vault_A", "connection_A", self.operation)],
        )

    def test_authentication_and_closed_transport_failures_keep_the_v3_error_contract(self):
        response = self.client.get(self.path + "?owner=private_marker", headers=self.headers)
        self.assert_formal_error(response, 400, "unsupported_query")
        self.assertEqual(self.calls, [])
        self.app.dependency_overrides.pop(require_owner)
        response = self.client.get(self.path, headers=self.headers)
        self.assert_formal_error(response, 401, "invalid_token")
        self.assertEqual(self.calls, [])

    def test_unexpected_v3_failure_is_sanitized_and_unknown_receipt_route_stays_formal(self):
        def broken(*args):
            raise RuntimeError("private_marker: credential storage diagnostic")

        self.app.dependency_overrides[get_credential_service] = lambda: SimpleNamespace(
            receipt=broken
        )
        response = self.client.get(
            self.path + "/operations/" + self.operation, headers=self.headers
        )
        self.assert_formal_error(response, 503, "authorization_unavailable")
        self.assert_formal_error(
            self.client.get(self.path + "/private_marker", headers=self.headers),
            404,
            "not_found",
        )
