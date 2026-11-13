"""Closed Owner transport, gate rollback and no automatic widening or native dispatch."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwcrypto import jwk

from app.api import require_owner
from app.errors import HubErrors
from app.task_center_routes import agent_router, get_agent_center, get_owner_center, owner_router
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import sign_jws


class TaskCenterRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(owner_router)
        self.app.include_router(agent_router)
        self.app.add_middleware(HubErrors)
        self.calls = []
        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(
            uid="synthetic_owner"
        )

        def call(kind, *args, **kwargs):
            self.calls.append((kind, args))
            return {"kind": kind}

        self.app.dependency_overrides[get_owner_center] = lambda: SimpleNamespace(
            **{
                name: lambda *args, name=name, **kwargs: call(name, *args, **kwargs)
                for name in [
                    "command",
                    "state",
                    "receipt",
                    "results",
                    "progress",
                    "trash",
                    "maintenance",
                ]
            }
        )
        self.app.dependency_overrides[get_agent_center] = lambda: SimpleNamespace(
            context=lambda *a: call("agent", *a)
        )
        self.client = TestClient(self.app)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.op = "synthetic_task_center_operation_0001"
        self.write = {**self.headers, "Idempotency-Key": self.op}
        self.path = "/api/v3/task-center/vault_A/tasks/task_A"
        self.key = jwk.JWK.generate(kty="EC", crv="P-256")

    def packet(self, action):
        return {
            "contractVersion": CONTRACT_VERSION,
            "command": sign_jws({"action": action}, self.key, typ="fv-control+jws"),
        }

    def test_default_off_keeps_owner_history_and_narrowing_without_enabling_agent_calls(self):
        with patch.dict(os.environ, {"HUB_TASK_CENTER_ENABLED": "0"}):
            self.assertFalse(
                self.client.get("/api/v3/task-center/capabilities", headers=self.headers).json()[
                    "enabled"
                ]
            )
            self.assertEqual(
                self.client.post(
                    self.path + "/commands", headers=self.write, json=self.packet("set_rules")
                ).status_code,
                503,
            )
            self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 200)
            self.assertEqual(
                self.client.post(
                    self.path + "/commands",
                    headers=self.write,
                    json=self.packet("remove_assignment"),
                ).status_code,
                201,
            )
            self.assertEqual(
                self.client.post(
                    self.path + "/results/query",
                    headers=self.headers,
                    json={
                        "contractVersion": CONTRACT_VERSION,
                        "request": {"limit": 20, "cursor": None},
                    },
                ).status_code,
                200,
            )
            path = (
                "/agent/v3/persistent/owners/owner_A/vaults/vault_A"
                "/connections/connection_A/task-center/context"
            )
            self.assertEqual(self.client.post(path, headers=self.headers, json={}).status_code, 503)
        self.assertFalse(any(kind == "agent" for kind, _ in self.calls))

    def test_transport_rejects_unknown_fields_queries_missing_owner_and_operation(self):
        self.assertEqual(
            self.client.get(self.path + "?unexpected=1", headers=self.headers).status_code, 400
        )
        with patch("app.task_center_routes.task_center_enabled", return_value=True):
            self.assertEqual(
                self.client.post(
                    self.path + "/commands", headers=self.headers, json=self.packet("set_rules")
                ).status_code,
                400,
            )
            self.assertEqual(
                self.client.post(
                    self.path + "/commands",
                    headers=self.write,
                    json={**self.packet("set_rules"), "verified": True},
                ).status_code,
                400,
            )
        self.assertEqual(self.calls, [])
        self.app.dependency_overrides.pop(require_owner)
        self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 401)

    def test_trash_pagination_uses_closed_post_body_not_url_queries(self):
        response = self.client.post(
            "/api/v3/task-center/vault_A/trash/query",
            headers=self.headers,
            json={"contractVersion": CONTRACT_VERSION, "cursor": "task_A"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls[-1][0], "trash")
        self.assertEqual(
            self.client.get(
                "/api/v3/task-center/vault_A/trash?cursor=task_A", headers=self.headers
            ).status_code,
            400,
        )
