"""Agent writes and owner history keep distinct authentication and activation gates."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.persistent_result_routes import (
    agent_router,
    get_result_history,
    get_result_writer,
    owner_router,
)
from folioview_shared.encrypted.constants import CONTRACT_VERSION

OPERATION = "synthetic_persistent_http_result_01"


class PersistentResultRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(agent_router)
        self.app.include_router(owner_router)
        self.app.add_middleware(HubErrors)
        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(
            uid="synthetic_owner"
        )
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.calls = []
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.agent = (
            "/agent/v3/persistent/owners/owner_A/vaults/vault_A"
            "/connections/connection_A/runs/submit"
        )
        self.owner = "/api/v2/persistent-results/vault_A"
        self.body = {"contractVersion": CONTRACT_VERSION, "proof": {}, "request": {}}

    def install_writer(self):
        self.app.dependency_overrides[get_result_writer] = lambda: SimpleNamespace(
            submit=lambda *a: self.calls.append(a) or {"saved": True}
        )

    def install_history(self):
        self.app.dependency_overrides[get_result_history] = lambda: SimpleNamespace(
            owner_list=lambda *a, **k: self.calls.append((a, k)) or {"items": []},
            owner_get=lambda *a: self.calls.append(a) or {"metadata": {}},
            owner_state=lambda *a: self.calls.append(a) or {"read": True},
        )

    def test_writer_default_closed_before_storage_or_execution_config(self):
        with (
            patch.dict(os.environ, {"HUB_PERSISTENT_RESULTS_ENABLED": "0"}),
            patch("app.persistent_result_routes.get_execution") as execution,
        ):
            response = self.client.post(self.agent, headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 503)
        execution.assert_not_called()

    def test_fixed_agent_scope_and_business_body_pass_unchanged(self):
        self.install_writer()
        response = self.client.post(self.agent, headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.calls, [("owner_A", "vault_A", "connection_A", {}, self.agent, {})])

    def test_bearer_and_unknown_owner_selectors_rejected_before_writer(self):
        self.install_writer()
        for url, headers, body in (
            (self.agent, {**self.headers, "Authorization": "Bearer synthetic"}, self.body),
            (self.agent + "?uid=other", self.headers, self.body),
            (self.agent, self.headers, {**self.body, "plaintext": "private_marker"}),
        ):
            response = self.client.post(url, headers=headers, json=body)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("private_marker", response.text)
        self.assertEqual(self.calls, [])

    def test_owner_history_is_available_with_all_issuance_disabled(self):
        self.install_history()
        with patch.dict(
            os.environ,
            {"HUB_PERSISTENT_RESULTS_ENABLED": "0", "HUB_PERSISTENT_EXECUTION_ENABLED": "0"},
        ):
            response = self.client.get(self.owner + "?limit=5", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls, [(("synthetic_owner", "vault_A"), {"limit": 5, "cursor": None})]
        )

    def test_owner_history_rejects_foreign_scope_query_duplicate_limits_and_raw_bodies(self):
        self.install_history()
        for query in ("owner=other", "limit=5&limit=6", "limit=99"):
            self.assertEqual(
                self.client.get(self.owner + "?" + query, headers=self.headers).status_code, 400
            )
        self.assertEqual(self.calls, [])

    def test_owner_state_requires_exact_operation_author_contract_and_body(self):
        self.install_history()
        headers = {**self.headers, "Idempotency-Key": OPERATION, "X-FolioView-Author-Key": "A" * 43}
        body = {"contractVersion": CONTRACT_VERSION, "command": {}}
        response = self.client.patch(self.owner + "/result_A/state", headers=headers, json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls, [("synthetic_owner", "vault_A", "result_A", {}, OPERATION, "A" * 43)]
        )
        self.calls.clear()
        self.assertEqual(
            self.client.patch(
                self.owner + "/result_A/state", headers=headers, json={**body, "read": True}
            ).status_code,
            400,
        )
        self.assertEqual(self.calls, [])
