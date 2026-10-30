"""Synthetic owner HTTP lifecycle: fixed roots, closed transport and opaque receipts."""

import copy
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from fixtures import BOOT, OTHER_UID, UID
from vault_lifecycle_fixtures import LifecycleFixture

from app.api import get_lifecycle_service, require_owner
from app.main import app
from app.store import SQLiteHubStore
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.schema import validate_schema


class VaultLifecycleRoutesTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLiteHubStore(Path(directory.name) / "hub.sqlite3")
        self.now = 1000
        self.service = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.f = LifecycleFixture()
        self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.uid = UID
        app.dependency_overrides[get_lifecycle_service] = lambda: self.service
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=self.uid)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.base = f"/api/v2/vaults/{self.f.vault}"
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}

    def state(self):
        response = self.client.get(self.base + "/archive", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        return response.json()

    def write(self, method, path, body, operation):
        return self.client.request(
            method,
            self.base + path,
            headers={**self.headers, "Idempotency-Key": operation},
            json=body,
        )

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())

    def test_passkey_change_and_original_receipt_recovery_do_not_change_legacy_shape(self):
        before = self.vaults.current(UID)
        state = self.state()
        operation = "synthetic_http_archive_change_0001"
        body = self.f.replace(state, operation=operation)
        saved = self.write("PUT", "/archive", body, operation)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.headers["cache-control"], "no-store")
        receipt = self.client.get(
            self.base + "/archive-operations/" + operation, headers=self.headers
        )
        self.assertEqual(receipt.status_code, 200, receipt.text)
        self.assertEqual(receipt.json(), saved.json())
        self.assertEqual(self.write("PUT", "/archive", body, operation).json(), saved.json())
        after = self.vaults.current(UID)
        self.assertEqual(set(after), set(before))
        self.assertEqual(set(after["vault"]), set(before["vault"]))
        for field in ("rootJwk", "rootKeyId", "version", "registryHistory"):
            self.assertEqual(after["vault"][field], before["vault"][field])
        self.assertEqual(after["vault"]["archive"], body["archive"])
        self.assertEqual(self.state()["archiveRevision"], 1)

    def test_recovery_authorization_revoke_and_new_authorization_then_consume(self):
        state = self.state()
        archive = self.f.archive(state)
        authorization = "synthetic_http_recovery_A"
        op = "synthetic_http_recovery_authorize_0001"
        body = self.f.authorize(state, archive, operation=op, authorization=authorization)
        response = self.write("POST", "/recovery-authorizations", body, op)
        self.assertEqual(response.status_code, 201, response.text)
        state = self.state()
        revoke = "synthetic_http_recovery_revoke_0001"
        response = self.write(
            "POST",
            f"/recovery-authorizations/{authorization}/revoke",
            self.f.revoke(state, authorization, operation=revoke),
            revoke,
        )
        self.assertEqual(response.status_code, 200, response.text)
        state = self.state()
        authorization = "synthetic_http_recovery_B"
        op = "synthetic_http_recovery_authorize_0002"
        response = self.write(
            "POST",
            "/recovery-authorizations",
            self.f.authorize(state, archive, operation=op, authorization=authorization),
            op,
        )
        self.assertEqual(response.status_code, 201, response.text)
        state = self.state()
        op = "synthetic_http_recovery_apply_0001"
        response = self.write(
            "PUT",
            "/archive",
            self.f.replace(
                state, operation=op, archive=archive, mode="recovery", authorization=authorization
            ),
            op,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.state()["archive"], archive)
        self.assertIsNone(self.state()["pendingAuthorization"])

    def test_query_bodies_duplicate_headers_and_selected_author_are_refused(self):
        state = self.state()
        op = "synthetic_http_closed_transport_0001"
        body = self.f.replace(state, operation=op)
        self.failure(self.client.get(self.base + "/archive?uid=other", headers=self.headers), 400)
        self.failure(
            self.client.request("GET", self.base + "/archive", headers=self.headers, content="x"),
            400,
        )
        for headers in (
            [("X-FolioView-Contract", CONTRACT_VERSION)] * 2 + [("Idempotency-Key", op)],
            [("X-FolioView-Contract", CONTRACT_VERSION)] + [("Idempotency-Key", op)] * 2,
            {**self.headers, "Idempotency-Key": op, "X-FolioView-Author-Key": self.f.root_id},
        ):
            self.failure(self.client.put(self.base + "/archive", headers=headers, json=body), 400)
        for extra in ({"uid": OTHER_UID}, {"privateKey": "never-accepted"}):
            self.failure(self.write("PUT", "/archive", {**body, **extra}, op), 400)
        self.assertEqual(self.state(), state)

    def test_size_media_signature_errors_are_fixed_and_never_echo_request(self):
        headers = {**self.headers, "Idempotency-Key": "synthetic_http_bad_envelope_0001"}
        self.failure(
            self.client.put(
                self.base + "/archive",
                headers={**headers, "Content-Type": "text/plain"},
                content="{}",
            ),
            415,
        )
        self.failure(
            self.client.put(
                self.base + "/archive",
                headers={**headers, "Content-Type": "application/json"},
                content=b"x" * 65537,
            ),
            413,
        )
        state = self.state()
        op = "synthetic_http_bad_signature_0001"
        body = self.f.replace(state, operation=op)
        body = copy.deepcopy(body)
        body["command"]["signature"] = "A" * 86
        response = self.write("PUT", "/archive", body, op)
        self.failure(response, 422)
        self.assertNotIn("A" * 86, response.text)
        self.assertEqual(self.state(), state)

    def test_cross_owner_state_receipts_and_writes_are_not_found(self):
        state = self.state()
        op = "synthetic_http_owner_isolation_0001"
        body = self.f.replace(state, operation=op)
        self.uid = OTHER_UID
        self.failure(self.client.get(self.base + "/archive", headers=self.headers), 404)
        self.failure(self.write("PUT", "/archive", body, op), 404)
        self.failure(
            self.client.get(self.base + "/archive-operations/" + op, headers=self.headers), 404
        )
        self.uid = UID
        self.assertEqual(self.state(), state)

    def test_missing_owner_credentials_fail_before_cloud_or_crypto_dependencies(self):
        app.dependency_overrides.pop(require_owner)
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            self.failure(self.client.get(self.base + "/archive", headers=self.headers), 401)


if __name__ == "__main__":
    unittest.main()
