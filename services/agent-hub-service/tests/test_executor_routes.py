"""Closed HTTP transports, bounded messages and independent opt-in configuration."""

import json
import os
from types import SimpleNamespace
from unittest.mock import patch

import test_executor_ciphertext as fixtures
import test_persistent_execution as executions
import test_persistent_identity_store as identities
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fixtures import UID

from app.api import require_owner
from app.errors import HubErrors
from app.executor_routes import (
    agent_router,
    get_execution,
    get_identities,
    get_registration,
    owner_router,
)
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class ExecutorRouteTests(fixtures.ExecutorFixture):
    def setUp(self):
        super().setUp()
        self.app = FastAPI()
        self.app.include_router(owner_router)
        self.app.include_router(agent_router)
        self.app.add_middleware(HubErrors)
        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=UID)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.owner_path = f"/api/v2/executor-connections/{self.f.vault}/{identities.CONNECTION}"
        self.agent_path = (
            f"/agent/v3/persistent/executor/owners/{self.f.owner}/vaults/{self.f.vault}"
            f"/connections/{identities.CONNECTION}"
        )
        self.env = {
            "HUB_EXECUTOR_CIPHERTEXT_ENABLED": "1",
            "HUB_EXECUTOR_CIPHERTEXT_CONFIG": json.dumps(self.configuration),
        }
        self.body = {"contractVersion": CONTRACT_VERSION, "proof": {}, "request": {}}

    def request_registration(self):
        return self.client.post(
            self.owner_path + "/bindings",
            headers={
                **self.headers,
                "Idempotency-Key": identities.ENROLL,
            },
            json={
                "contractVersion": CONTRACT_VERSION,
                "command": self.signed,
                "approval": self.approval,
                "scope": self.scope,
            },
        )

    def test_registration_and_agent_session_need_no_muse_flags_or_oauth_configuration(self):
        def registration():
            service = get_registration()
            service.clock = lambda: self.now
            return service

        def execution():
            service = get_execution()
            service.clock = lambda: self.now
            return service

        self.app.dependency_overrides[get_registration] = registration
        self.app.dependency_overrides[get_execution] = execution
        with (
            patch.dict(os.environ, self.env, clear=True),
            patch("app.executor_routes.get_store", return_value=self.store),
            patch("app.executor_routes.get_sources", return_value=None),
            patch("app.executor_routes.CatalogueService", return_value=None),
            patch(
                "app.oauth_config.OAuthConfig.environment", side_effect=AssertionError("OAuth used")
            ),
        ):
            response = self.request_registration()
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json(), self.enroll())
            builder = executions.PersistentExecutionTests()
            builder.fx = SimpleNamespace(now=self.now, identity=response.json()["identity"])
            builder.f, builder.serial, builder.base = self.f, 0, self.agent_path
            _, _, _, proof, _, request = builder.args("session", {})
            session = self.client.post(
                self.agent_path + "/session",
                headers=self.headers,
                json={"contractVersion": CONTRACT_VERSION, "proof": proof, "request": request},
            )
            self.assertEqual(session.status_code, 200, session.text)
            self.assertEqual(session.json()["identity"], response.json()["identity"])

    def test_default_off_and_invalid_configuration_fail_before_store_or_sources(self):
        for env in (
            {"HUB_EXECUTOR_CIPHERTEXT_ENABLED": "0"},
            {"HUB_EXECUTOR_CIPHERTEXT_ENABLED": "1", "HUB_EXECUTOR_CIPHERTEXT_CONFIG": "{}"},
            {
                "HUB_EXECUTOR_CIPHERTEXT_ENABLED": "1",
                "HUB_EXECUTOR_CIPHERTEXT_CONFIG": json.dumps(
                    self.configuration | {"privateJwk": {"d": "synthetic"}}
                ),
            },
            {
                "HUB_EXECUTOR_CIPHERTEXT_ENABLED": "1",
                "HUB_EXECUTOR_CIPHERTEXT_CONFIG": json.dumps(
                    self.configuration | {"audience": "https://" + "a" * 2041}
                ),
            },
        ):
            with (
                patch.dict(os.environ, env, clear=True),
                patch("app.executor_routes.get_store") as store,
                patch("app.executor_routes.get_sources") as sources,
            ):
                for response in [
                    self.request_registration(),
                    self.client.post(
                        self.agent_path + "/session", headers=self.headers, json=self.body
                    ),
                ]:
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                store.assert_not_called()
                sources.assert_not_called()

    def test_owner_state_and_revocation_remain_available_when_disabled(self):
        self.enroll()
        payload = {
            **self.payload,
            "artifactType": "persistent_agent_revoke",
            "bindingFingerprint": self.binding["bindingFingerprint"],
            "stableOperationId": identities.REVOKE,
        }
        with (
            patch.dict(os.environ, {"HUB_EXECUTOR_CIPHERTEXT_ENABLED": "0"}, clear=True),
            patch("app.executor_routes.get_store", return_value=self.store),
        ):
            # Historical public owner reads are allowed, independent of approval expiry.
            response = self.client.get(self.owner_path, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.app.dependency_overrides[get_identities] = lambda: (
                fixtures.ExecutorIdentityService(self.store, clock=lambda: self.now)
            )
            revoked = self.client.post(
                self.owner_path + "/revocations",
                headers={**self.headers, "Idempotency-Key": identities.REVOKE},
                json={"contractVersion": CONTRACT_VERSION, "command": self.f.sign(payload)},
            )
            self.assertEqual(revoked.status_code, 201, revoked.text)
            self.assertEqual(revoked.json()["identity"]["status"], "revoked")

    def install_agent_stub(self, result=None):
        self.calls = []
        stub = SimpleNamespace(
            **{
                name: lambda *a: self.calls.append(a) or (result or {"ok": True})
                for name in ("session", "begin", "input", "submit", "result_receipt", "tasks")
            }
        )
        self.app.dependency_overrides[get_execution] = lambda: stub

    def test_fixed_route_method_and_business_body_are_passed_without_scope_aliases(self):
        self.install_agent_stub()
        response = self.client.post(
            self.agent_path + "/session", headers=self.headers, json=self.body
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.calls,
            [
                (
                    self.f.owner,
                    self.f.vault,
                    identities.CONNECTION,
                    {},
                    self.agent_path + "/session",
                    {},
                )
            ],
        )

    def test_ambient_bearer_author_operation_queries_and_unknown_fields_are_rejected(self):
        self.install_agent_stub()
        for key, value in (
            ("Authorization", "Bearer synthetic"),
            ("Idempotency-Key", identities.ENROLL),
            ("X-FolioView-Author-Key", "A" * 43),
            ("X-FolioView-Delegation", "synthetic"),
        ):
            response = self.client.post(
                self.agent_path + "/session", headers=self.headers | {key: value}, json=self.body
            )
            self.assertEqual(response.status_code, 400)
        for response in (
            self.client.post(self.agent_path + "/session", json=self.body),
            self.client.post(
                self.agent_path + "/session?owner=other", headers=self.headers, json=self.body
            ),
            self.client.post(
                self.agent_path + "/session",
                headers=self.headers,
                json=self.body | {"ownerUid": "private_marker"},
            ),
        ):
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("private_marker", response.text)
        self.assertEqual(self.calls, [])

    def test_streamed_budget_and_duplicate_json_fields_fail_without_service_call(self):
        self.install_agent_stub()
        for route, maximum in (("session", 65536), ("runs/submit", 557056)):
            chunks = iter(
                [
                    b'{"contractVersion":"'
                    + CONTRACT_VERSION.encode()
                    + b'","proof":{},"request":{"private_marker":"',
                    b"x" * maximum,
                    b'"}}',
                ]
            )
            response = self.client.post(
                self.agent_path + "/" + route,
                headers=self.headers | {"Content-Type": "application/json"},
                content=chunks,
            )
            self.assertEqual(response.status_code, 413)
            self.assertNotIn("private_marker", response.text)
        response = self.client.post(
            self.agent_path + "/session",
            headers=self.headers | {"Content-Type": "application/json"},
            content='{"contractVersion":"'
            + CONTRACT_VERSION
            + '","proof":{},"request":{},"request":{}}',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.calls, [])

    def test_output_budget_and_undeclared_plaintext_key_or_proxy_routes_are_closed(self):
        self.install_agent_stub({"private_marker": "x" * 1100000})
        response = self.client.post(
            self.agent_path + "/session", headers=self.headers, json=self.body
        )
        self.assertEqual(response.status_code, 413)
        self.assertNotIn("private_marker", response.text)
        for suffix in ("decrypt", "sign", "private-key", "proxy", "task-input"):
            response = self.client.post(
                self.agent_path + "/" + suffix, headers=self.headers, json=self.body
            )
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.headers["cache-control"], "no-store")
