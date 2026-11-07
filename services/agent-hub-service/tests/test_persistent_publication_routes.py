"""Publication routes cannot turn an incoming Agent selector into owner identity."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.persistent_publication_routes import get_publications, router
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class PublicationRoutes(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        app.add_middleware(HubErrors)
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid="synthetic_owner")
        self.calls = []
        service = SimpleNamespace(
            publish=lambda *a: self.calls.append(a) or {"accepted": True},
            receipt=lambda *a: self.calls.append(a) or {"receipt": True},
            task_state=lambda *a: self.calls.append(a) or {"authority": None},
        )
        app.dependency_overrides[get_publications] = lambda: service
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.path = "/api/v2/persistent-content/vault_A/connections/connection_A/publications"
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Idempotency-Key": "synthetic_publication_http_01",
        }
        self.body = {"contractVersion": CONTRACT_VERSION, "envelope": {"synthetic": True}}

    def test_publication_disabled_by_default_without_storage_mutation(self):
        response = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.calls, [])

    def test_enabled_publication_forwards_only_fixed_authenticated_owner(self):
        with patch("app.persistent_publication_routes.require_publication"):
            response = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            self.calls[0],
            (
                "synthetic_owner",
                "vault_A",
                "connection_A",
                {"synthetic": True},
                "synthetic_publication_http_01",
            ),
        )

    def test_history_and_authority_read_do_not_require_mutation_activation(self):
        h = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.assertEqual(
            self.client.get(
                self.path.rsplit("/", 1)[0] + "/operations/synthetic_publication_http_01", headers=h
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                "/api/v2/persistent-content/vault_A/tasks/task_A/authority", headers=h
            ).status_code,
            200,
        )

    def test_unknown_fields_query_author_selectors_and_oversize_rejected(self):
        with patch("app.persistent_publication_routes.require_publication"):
            cases = [
                self.client.post(self.path + "?owner=other", headers=self.headers, json=self.body),
                self.client.post(
                    self.path,
                    headers={**self.headers, "X-FolioView-Author-Key": "A" * 43},
                    json=self.body,
                ),
                self.client.post(
                    self.path,
                    headers=self.headers,
                    json={**self.body, "plaintext": "private_marker"},
                ),
                self.client.post(
                    self.path,
                    headers=self.headers,
                    json={**self.body, "envelope": {"x": "private_marker" * 60000}},
                ),
            ]
        self.assertEqual([r.status_code for r in cases], [400, 400, 400, 413])
        self.assertTrue(all("private_marker" not in r.text for r in cases))
        self.assertEqual(self.calls, [])
