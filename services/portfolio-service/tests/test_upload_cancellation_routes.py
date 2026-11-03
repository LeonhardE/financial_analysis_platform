"""Owner-only bounded cancellation HTTP, with no real credentials or cloud calls."""

import tempfile
import unittest
from pathlib import Path

from cancellation_fixtures import CANCEL, CancellationFixture
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from fixtures import OTHER_UID, SOURCE, UID

from app.api import get_service
from app.holdings import PortfolioService
from app.main import app
from app.store import SQLitePortfolioStore
from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.schema import validate_schema


class UploadCancellationRouteTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.clock = 1000
        self.service = PortfolioService(
            SQLitePortfolioStore(Path(directory.name) / "portfolio.sqlite3"),
            clock=lambda: self.clock,
        )
        self.f = CancellationFixture()
        self.f.install(self.service)
        self.clock = 6000
        self.body, _ = self.f.cancellation()

        def user(request: Request):
            uid = {"Bearer synthetic-A": UID, "Bearer synthetic-B": OTHER_UID}.get(
                request.headers.get("authorization")
            )
            if not uid:
                raise HTTPException(401, "Sign-in required")
            return CurrentUser(uid=uid, email=None, displayName=None, photoURL=None)

        app.dependency_overrides[require_google_user] = user
        app.dependency_overrides[get_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.url = f"/api/v2/holdings/sources/{SOURCE}/operation-cancellations"
        self.headers = {
            "Authorization": "Bearer synthetic-A",
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Idempotency-Key": CANCEL,
        }
        self.read_headers = {
            name: value for name, value in self.headers.items() if name != "Idempotency-Key"
        }

    def response(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")
        if status >= 400:
            validate_schema("Error", response.json())
        self.assertNotIn("ciphertext", response.text)

    def test_post_get_idempotency_and_required_cloud_run_identity_remains_accepted(self):
        headers = {**self.headers, "X-Serverless-Authorization": "Bearer synthetic-service-only"}
        saved = self.client.post(self.url, headers=headers, json=self.body)
        self.response(saved, 200)
        self.assertEqual(saved.json()["receipt"]["outcome"], "cancelled")
        read = self.client.get(
            self.url + "/" + CANCEL,
            headers={
                **self.read_headers,
                "X-Serverless-Authorization": "Bearer synthetic-service-only",
            },
        )
        self.response(read, 200)
        self.assertEqual(read.json(), saved.json())
        retry = self.client.post(self.url, headers=headers, json=self.body)
        self.response(retry, 200)
        self.assertEqual(retry.json(), saved.json())

    def test_no_anonymous_owner_or_service_only_header_can_access_storage(self):
        self.response(self.client.post(self.url, json=self.body), 401)
        self.response(
            self.client.get(
                self.url + "/" + CANCEL,
                headers={"X-Serverless-Authorization": "Bearer synthetic-service-only"},
            ),
            401,
        )
        app.dependency_overrides.pop(require_google_user)
        self.response(
            self.client.post(
                self.url, headers={"X-FolioView-Contract": CONTRACT_VERSION}, json=self.body
            ),
            401,
        )

    def test_closed_body_contract_and_8192_byte_ceiling(self):
        for body in [
            None,
            {},
            {**self.body, "rootJwk": self.f.root_public},
            {**self.body, "ownerSubject": self.f.owner},
        ]:
            self.response(
                self.client.post(
                    self.url,
                    headers={**self.headers, "Content-Type": "application/json"},
                    json=body,
                ),
                400,
            )
        self.response(
            self.client.post(
                self.url,
                headers={**self.headers, "Content-Type": "application/json"},
                content=b" " * 8193,
            ),
            413,
        )
        self.response(
            self.client.post(
                self.url, headers={**self.headers, "Content-Type": "text/plain"}, content=b"{}"
            ),
            415,
        )
        self.response(
            self.client.post(
                self.url, headers={**self.headers, "X-FolioView-Contract": "other"}, json=self.body
            ),
            400,
        )

    def test_write_selectors_delegation_caller_queries_and_duplicate_headers_are_refused(self):
        for name in [
            "X-FolioView-Author-Key",
            "X-FolioView-Delegation",
            "X-FolioView-Authority-Delegation",
            "X-FolioView-Caller",
            "X-FolioView-Owner",
        ]:
            self.response(
                self.client.post(
                    self.url, headers={**self.headers, name: "synthetic"}, json=self.body
                ),
                400,
            )
        for query in ["?owner=other", "?sourceEpoch=1", "?x=1&x=1"]:
            self.response(
                self.client.post(self.url + query, headers=self.headers, json=self.body), 400
            )
        for name in ["X-FolioView-Contract", "Idempotency-Key", "X-Serverless-Authorization"]:
            headers = [
                (key, value) for key, value in self.headers.items() if key.lower() != name.lower()
            ]
            value = {
                "X-FolioView-Contract": CONTRACT_VERSION,
                "Idempotency-Key": CANCEL,
                "X-Serverless-Authorization": "Bearer synthetic-service-only",
            }[name]
            headers += [(name, value), (name, value)]
            self.response(self.client.post(self.url, headers=headers, json=self.body), 400)

    def test_read_rejects_body_query_write_headers_and_keeps_missing_404(self):
        self.response(self.client.get(self.url + "/" + CANCEL, headers=self.read_headers), 404)
        self.response(self.client.post(self.url, headers=self.headers, json=self.body), 200)
        for suffix, headers, content in [
            ("?owner=other", self.read_headers, None),
            ("", self.headers, None),
            ("", {**self.read_headers, "X-FolioView-Author-Key": self.f.kid("device_sig")}, None),
            ("", self.read_headers, b"{}"),
        ]:
            self.response(
                self.client.request(
                    "GET", self.url + "/" + CANCEL + suffix, headers=headers, content=content
                ),
                400,
            )

    def test_other_registered_owner_and_wrong_source_cannot_read_or_replace_receipt(self):
        other = CancellationFixture(OTHER_UID)
        self.clock = 1000
        other.install(self.service)
        self.clock = 6000
        self.response(self.client.post(self.url, headers=self.headers, json=self.body), 200)
        self.response(
            self.client.get(
                self.url + "/" + CANCEL,
                headers={**self.read_headers, "Authorization": "Bearer synthetic-B"},
            ),
            404,
        )
        self.response(
            self.client.post(
                self.url,
                headers={**self.headers, "Authorization": "Bearer synthetic-B"},
                json=self.body,
            ),
            422,
        )
        self.response(
            self.client.get(
                self.url + "/synthetic_other_cancellation_0001", headers=self.read_headers
            ),
            404,
        )
