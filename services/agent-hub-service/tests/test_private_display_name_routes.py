"""Real Owner authentication and closed requests; synthetic service, no network."""

import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.private_display_name_routes import get_display_names, router
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class DisplayNameRoutesTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.add_middleware(HubErrors)
        self.calls = []

        def call(kind, *args):
            self.calls.append((kind, args))
            return {"kind": kind}

        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(
            uid="synthetic_owner"
        )
        self.app.dependency_overrides[get_display_names] = lambda: SimpleNamespace(
            listing=lambda *a: call("listing", *a),
            read=lambda *a: call("read", *a),
            write=lambda *a: call("write", *a),
        )
        self.client = TestClient(self.app)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.operation = "synthetic_display_name_0001"
        self.write_headers = {**self.headers, "Idempotency-Key": self.operation}
        self.path = "/api/v3/private-display-names/vault_A/holdings/source_A"
        self.body = {
            "contractVersion": CONTRACT_VERSION,
            "command": {"protected": "YQ", "payload": "Yg", "signature": "Yw"},
        }

    def test_named_owner_routes_preserve_original_packet_and_use_no_new_rollout_flag(self):
        cap = self.client.get("/api/v3/private-display-names/capabilities", headers=self.headers)
        self.assertEqual(cap.status_code, 200)
        self.assertEqual(cap.json()["maxNameLength"], 80)
        self.assertTrue(cap.json()["enabled"])
        self.assertEqual(
            self.client.get(self.path.rsplit("/", 1)[0], headers=self.headers).status_code, 200
        )
        self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 200)
        self.assertEqual(
            self.client.get(
                self.path + "/operations/" + self.operation, headers=self.headers
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                self.path + "/commands", json=self.body, headers=self.write_headers
            ).status_code,
            201,
        )
        self.assertEqual(
            self.calls[-1],
            (
                "write",
                ("synthetic_owner", "vault_A", "source_A", self.body["command"], self.operation),
            ),
        )

    def test_header_query_body_and_method_aliases_fail_before_service_access(self):
        for path, headers, body in [
            (self.path + "/commands?owner=other", self.write_headers, self.body),
            (self.path + "/commands", self.headers, self.body),
            (
                self.path + "/commands",
                {**self.write_headers, "X-FolioView-Delegation": "foreign"},
                self.body,
            ),
            (
                self.path + "/commands",
                {**self.write_headers, "X-FolioView-Author-Key": "A" * 43},
                self.body,
            ),
            (
                self.path + "/commands",
                self.write_headers,
                {**self.body, "displayName": "Plaintext"},
            ),
            (self.path + "/commands", self.write_headers, {**self.body, "command": "x" * 17000}),
        ]:
            self.assertGreaterEqual(
                self.client.post(path, json=body, headers=headers).status_code, 400
            )
        for kwargs in [
            dict(url=self.path + "?cursor=other", headers=self.headers),
            dict(url=self.path, headers={**self.headers, "Idempotency-Key": self.operation}),
            dict(url=self.path, headers=self.headers, content=b"{}"),
        ]:
            self.assertEqual(self.client.request("GET", **kwargs).status_code, 400)
        self.assertEqual(self.client.delete(self.path, headers=self.headers).status_code, 405)
        self.assertEqual(self.calls, [])

    def test_unverified_identity_never_reaches_alias_service(self):
        self.app.dependency_overrides.pop(require_owner)
        # No token or configuration can act as a Google Owner identity.
        self.assertIn(self.client.get(self.path, headers=self.headers).status_code, [401, 503])
        self.assertEqual(self.calls, [])
