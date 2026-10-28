"""HTTP boundaries, without credentials, financial plaintext or cloud calls."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from fixtures import OPERATION, OTHER_UID, SOURCE, UID, HoldingsFixture

from app.api import get_service
from app.holdings import PortfolioService
from app.main import app
from app.store import SQLitePortfolioStore
from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_HTTP_WRITE_BYTES
from folioview_shared.encrypted.schema import validate_schema


class HoldingsRouteTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.service = PortfolioService(
            SQLitePortfolioStore(Path(self.directory.name) / "portfolio.sqlite3"),
            clock=lambda: 1000,
        )
        self.fixture = HoldingsFixture()
        self.fixture.install(self.service)

        def user(request: Request):
            token = request.headers.get("authorization")
            uid = {"Bearer synthetic-A": UID, "Bearer synthetic-B": OTHER_UID}.get(token)
            if not uid:
                raise HTTPException(401, "Sign-in required")
            return CurrentUser(uid=uid, email=None, displayName=None, photoURL=None)

        app.dependency_overrides[require_google_user] = user
        app.dependency_overrides[get_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.base = f"/api/v2/holdings/sources/{SOURCE}"
        self.url = self.base + "/snapshots/snapshot_1"
        self.headers = {
            "Authorization": "Bearer synthetic-A",
            "X-FolioView-Contract": CONTRACT_VERSION,
            "X-FolioView-Author-Key": self.fixture.kid("device_sig"),
            "Idempotency-Key": OPERATION,
        }
        self.carrier, _ = self.fixture.message()
        self.body = {
            "contractVersion": CONTRACT_VERSION,
            "expectedRevision": 0,
            "carrier": self.carrier,
        }

    def assert_private(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:300])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("synthetic-A", response.text)
        if status >= 400:
            validate_schema("Error", response.json())

    def test_owner_put_get_original_retry_and_receipt_recovery(self):
        saved = self.client.put(self.url, headers=self.headers, json=self.body)
        self.assert_private(saved, 200)
        self.assert_private(self.client.put(self.url, headers=self.headers, json=self.body), 200)
        for path in (self.url, self.base + "/latest"):
            response = self.client.get(path, headers=self.headers)
            self.assert_private(response, 200)
            self.assertEqual(response.json()["carrier"], self.carrier)
            self.assertEqual(response.json()["receipt"], saved.json())
        recovered = self.client.get(self.base + "/operations/" + OPERATION, headers=self.headers)
        self.assert_private(recovered, 200)
        self.assertEqual(recovered.json(), saved.json())

    def test_anonymous_requests_fail_before_private_storage_or_parser(self):
        app.dependency_overrides.pop(require_google_user)
        response = self.client.get(self.url)
        self.assert_private(response, 401)
        self.assertEqual(response.headers["www-authenticate"], "Bearer")
        self.assert_private(self.client.put(self.url, content=b"not-json"), 401)

    def test_other_owner_cannot_read_or_overwrite_even_with_same_source_ids(self):
        self.client.put(self.url, headers=self.headers, json=self.body)
        other = HoldingsFixture(OTHER_UID)
        other.install(self.service)
        headers = {**self.headers, "Authorization": "Bearer synthetic-B"}
        self.assert_private(self.client.get(self.url, headers=headers), 404)
        self.assert_private(self.client.put(self.url, headers=headers, json=self.body), 403)
        self.assertEqual(self.service.metadata(OTHER_UID, SOURCE)["revision"], 0)

    def test_locked_source_blocks_existing_operation_replay(self):
        self.client.put(self.url, headers=self.headers, json=self.body)
        self.fixture.install(self.service, version=1, active=False)
        self.assert_private(self.client.put(self.url, headers=self.headers, json=self.body), 403)
        self.assert_private(self.client.get(self.url, headers=self.headers), 403)

    def test_missing_authority_is_a_closed_gate_and_never_enrolls_from_request(self):
        store = SQLitePortfolioStore(Path(self.directory.name) / "empty.sqlite3")
        app.dependency_overrides[get_service] = lambda: PortfolioService(store, clock=lambda: 1000)
        self.assert_private(self.client.get(self.base, headers=self.headers), 503)
        self.assert_private(self.client.put(self.url, headers=self.headers, json=self.body), 503)
        for path in ("/api/v2/authority", "/api/v2/vaults", "/api/v2/keys", "/decrypt"):
            response = self.client.post(path, json={"rootJwk": self.fixture.root_public})
            self.assertEqual(response.status_code, 404)

    def test_exact_version_headers_metadata_queries_and_body_shape(self):
        bad = {**self.headers, "X-FolioView-Contract": "v1"}
        self.assert_private(self.client.put(self.url, headers=bad, json=self.body), 400)
        self.assert_private(
            self.client.get(self.base + "?symbol=PRIVATE", headers=self.headers), 400
        )
        self.assert_private(
            self.client.put(self.url, headers=self.headers, json={**self.body, "positions": []}),
            400,
        )
        headers = {key: value for key, value in self.headers.items() if key != "Idempotency-Key"}
        self.assert_private(self.client.put(self.url, headers=headers, json=self.body), 400)
        duplicate = list(self.headers.items()) + [("Idempotency-Key", "second")]
        self.assert_private(self.client.put(self.url, headers=duplicate, json=self.body), 400)

    def test_streaming_byte_limit_duplicate_json_and_plaintext_media_rejected(self):
        headers = {**self.headers, "Content-Type": "application/json"}
        self.assert_private(
            self.client.put(self.url, headers=headers, content=b" " * (MAX_HTTP_WRITE_BYTES + 1)),
            413,
        )
        self.assert_private(
            self.client.put(
                self.url, headers=headers, content=b'{"contractVersion":1,"contractVersion":2}'
            ),
            400,
        )
        self.assert_private(
            self.client.put(self.url, headers=self.headers, content=b"symbol,quantity\nSYN,1"), 415
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["revision"], 0)

    def test_stale_write_signature_failure_and_errors_do_not_echo_inputs(self):
        bad = json.loads(json.dumps(self.body))
        bad["carrier"]["signedObject"]["signature"] = "A" * 86
        response = self.client.put(self.url, headers=self.headers, json=bad)
        self.assert_private(response, 422)
        self.assertNotIn(self.carrier["signedObject"]["payload"], response.text)
        self.client.put(self.url, headers=self.headers, json=self.body)
        carrier, _ = self.fixture.message(
            snapshot="snapshot_other", operation="synthetic_operation_other"
        )
        response = self.client.put(
            self.base + "/snapshots/snapshot_other",
            headers={**self.headers, "Idempotency-Key": "synthetic_operation_other"},
            json={**self.body, "carrier": carrier},
        )
        self.assert_private(response, 409)

    def test_slow_body_deadline_returns_fixed_private_timeout_without_writing(self):
        async def run():
            async def body():
                yield b"{"
                await asyncio.sleep(1)
                yield b"}"

            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as client:
                return await client.put(
                    self.url,
                    headers={**self.headers, "Content-Type": "application/json"},
                    content=body(),
                )

        with patch("app.api.WRITE_BODY_TIMEOUT_SECONDS", 0.01):
            response = asyncio.run(run())
        self.assert_private(response, 400)
        self.assertEqual(response.json()["error"]["code"], "malformed_request")
        self.assertEqual(self.service.metadata(UID, SOURCE)["revision"], 0)

    def test_storage_and_dependency_failures_have_fixed_private_diagnostics(self):
        with patch.object(self.service.store, "transact", side_effect=RuntimeError("PRIVATE_SDK")):
            response = self.client.get(self.base, headers=self.headers)
        self.assert_private(response, 503)
        self.assertNotIn("PRIVATE_SDK", response.text)

        def unavailable():
            raise RuntimeError("PRIVATE_CREDENTIAL_CONFIGURATION")

        app.dependency_overrides[get_service] = unavailable
        response = self.client.get(self.base, headers=self.headers)
        self.assert_private(response, 503)
        self.assertNotIn("PRIVATE_CREDENTIAL_CONFIGURATION", response.text)

    def test_cors_missing_routes_and_wrong_methods_share_closed_error_schema(self):
        response = self.client.options(
            self.url,
            headers={
                "Origin": "https://untrusted.example",
                "Access-Control-Request-Method": "PUT",
            },
        )
        self.assert_private(response, 400)
        self.assertEqual(response.json()["error"]["code"], "malformed_request")
        self.assert_private(self.client.get("/api/v2/absent"), 404)
        self.assert_private(self.client.post(self.url, json=self.body), 400)
