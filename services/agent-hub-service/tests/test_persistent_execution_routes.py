"""Fixed proof routes reject ambient credentials and caller scope selectors."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import HubErrors
from app.persistent_execution_routes import get_execution, router
from app.persistent_plan_routes import agent_router as plans_router
from folioview_shared.encrypted.constants import CONTRACT_VERSION

SYNTHETIC_OPERATION = "synthetic_operation_0001"


class ExecutionRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.include_router(plans_router)
        self.app.add_middleware(HubErrors)
        self.calls = []
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.base = "/agent/v3/persistent/owners/owner_A/vaults/vault_A/connections/connection_A"
        self.path = self.base + "/tasks"
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.body = {
            "contractVersion": CONTRACT_VERSION,
            "proof": {"synthetic": True},
            "request": {},
        }

    def install(self):
        self.app.dependency_overrides[get_execution] = lambda: SimpleNamespace(
            tasks=lambda *a: self.calls.append(a) or {"tasks": []}
        )

    def test_default_gate_is_closed_before_loading_cloud_or_storage(self):
        with (
            patch.dict(os.environ, {"HUB_PERSISTENT_EXECUTION_ENABLED": "0"}),
            patch("app.persistent_execution_routes.get_store") as store,
        ):
            response = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 503)
        store.assert_not_called()
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_fixed_path_method_and_exact_business_body_reach_service(self):
        self.install()
        response = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls, [("owner_A", "vault_A", "connection_A", {"synthetic": True}, self.path, {})]
        )

    def test_bearer_google_author_and_operation_headers_cannot_replace_proof(self):
        self.install()
        for key, value in (
            ("Authorization", "Bearer synthetic"),
            ("Idempotency-Key", SYNTHETIC_OPERATION),
            ("X-FolioView-Author-Key", "A" * 43),
            ("X-FolioView-Delegation", "synthetic"),
        ):
            response = self.client.post(
                self.path, headers={**self.headers, key: value}, json=self.body
            )
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.calls, [])

    def test_contract_query_unknown_fields_and_budget_rejected_without_echo(self):
        self.install()
        cases = [
            self.client.post(self.path, json=self.body),
            self.client.post(self.path + "?owner=other", headers=self.headers, json=self.body),
            self.client.post(
                self.path, headers=self.headers, json={**self.body, "ownerUid": "private_marker"}
            ),
            self.client.post(
                self.path,
                headers=self.headers,
                json={**self.body, "request": {"x": "private_marker" * 9000}},
            ),
        ]
        self.assertEqual([r.status_code for r in cases], [400, 400, 400, 413])
        self.assertTrue(all("private_marker" not in r.text for r in cases))
        self.assertEqual(self.calls, [])

    def test_unknown_routes_and_wrong_methods_use_closed_errors(self):
        self.install()
        for response in (
            self.client.get(self.path, headers=self.headers),
            self.client.post(self.base + "/sign", headers=self.headers, json=self.body),
        ):
            self.assertIn(response.status_code, (400, 404, 405))
            self.assertEqual(response.json()["contractVersion"], CONTRACT_VERSION)
            self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.calls, [])

    def test_disabled_factory_cannot_be_bypassed_by_execution_flag_alone(self):
        with patch.dict(
            os.environ,
            {"HUB_PERSISTENT_EXECUTION_ENABLED": "1", "HUB_PERSISTENT_PUBLICATIONS_ENABLED": "0"},
        ):
            self.assertEqual(
                self.client.post(self.path, headers=self.headers, json=self.body).status_code, 503
            )

    def test_plan_reports_share_closed_execution_gate_before_loading_cloud(self):
        with (
            patch.dict(os.environ, {"HUB_PERSISTENT_EXECUTION_ENABLED": "0"}),
            patch("app.persistent_plan_routes.get_store") as store,
        ):
            for operation in ("state", "report"):
                response = self.client.post(
                    self.base + "/plans/" + operation, headers=self.headers, json=self.body
                )
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.headers["cache-control"], "no-store")
            store.assert_not_called()
