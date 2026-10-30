"""Root-approved renewal over the real owner HTTP boundary and synthetic SQLite."""

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from firebase_admin import auth
from fixtures import BOOT, OTHER_UID, UID
from key_renewal_fixtures import RENEW, KeyRenewalFixture

from app.api import get_key_renewal_service, get_lifecycle_service, get_service
from app.key_renewals import VaultKeyRenewalService
from app.main import app
from app.store import SQLiteHubStore
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_HTTP_WRITE_BYTES
from folioview_shared.encrypted.jsonutil import b64url_decode, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

OWNER_A = "synthetic_renewal_google_owner_A"
OWNER_B = "synthetic_renewal_google_owner_B"
MARKER = "synthetic-private-marker"


class KeyRenewalRoutesTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="folioview-renewal-http-")
        self.addCleanup(directory.cleanup)
        self.store = SQLiteHubStore(Path(directory.name) / "hub.sqlite3")
        self.now = 1000
        self.service = VaultKeyRenewalService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.lifecycle = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.f = KeyRenewalFixture()
        self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        app.dependency_overrides[get_key_renewal_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)

        def verify(token, **kwargs):
            self.assertTrue(kwargs["check_revoked"])
            if token == "synthetic_non_google_provider":
                return {"uid": UID, "firebase": {"sign_in_provider": "password"}}
            if token not in (OWNER_A, OWNER_B):
                raise auth.InvalidIdTokenError("Synthetic rejected identity")
            return {
                "uid": UID if token == OWNER_A else OTHER_UID,
                "firebase": {"sign_in_provider": "google.com"},
            }

        identity = patch("folioview_shared.auth.auth.verify_id_token", side_effect=verify)
        identity.start()
        self.addCleanup(identity.stop)
        configuration = patch("folioview_shared.auth._get_firebase_app", return_value=object())
        configuration.start()
        self.addCleanup(configuration.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.base = f"/api/v2/vaults/{self.f.vault}"
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Authorization": "Bearer " + OWNER_A,
        }

    def packet(self, operation=RENEW):
        state = self.lifecycle.state(UID, self.f.vault)
        return self.f.renewal(state, operation=operation, now=self.now)

    def renew(self, value=None, operation=RENEW, headers=None):
        return self.client.post(
            self.base + "/key-renewals",
            headers={
                **(self.headers if headers is None else headers),
                "Idempotency-Key": operation,
            },
            json=self.packet(operation) if value is None else value,
        )

    def state(self):
        response = self.client.get(self.base + "/key-renewal-state", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        return response.json()

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:300])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())
        self.assertNotIn(MARKER, response.text)
        self.assertNotIn(OWNER_A, response.text)
        return response.json()["error"]["code"]

    def test_actual_http_renewal_and_original_receipt_survive_expiry_without_reapplying(self):
        original = self.vaults.current(UID)
        before = self.state()
        packet = self.packet()
        saved = self.renew(packet)
        self.assertEqual(saved.status_code, 201, saved.text)
        self.assertEqual(saved.headers["cache-control"], "no-store")
        after = self.vaults.current(UID)
        self.assertEqual(after["vault"]["rootJwk"], original["vault"]["rootJwk"])
        self.assertEqual(after["vault"]["rootKeyId"], original["vault"]["rootKeyId"])
        self.assertEqual(after["vault"]["archive"], packet["archive"])
        self.assertEqual(len(after["vault"]["registryHistory"]), 2)
        self.assertEqual(after["sources"], original["sources"])
        self.assertEqual(set(after["vault"]), set(original["vault"]))
        self.assertNotEqual(self.state(), before)
        self.now = 20000
        receipt = self.client.get(
            self.base + "/key-renewal-operations/" + RENEW, headers=self.headers
        )
        self.assertEqual(receipt.status_code, 200, receipt.text)
        self.assertEqual(receipt.headers["cache-control"], "no-store")
        self.assertEqual(receipt.json(), saved.json())
        replay = self.renew(packet)
        self.assertEqual(replay.status_code, 201, replay.text)
        self.assertEqual(replay.json(), saved.json())
        self.assertEqual(self.vaults.current(UID), after)

    def test_owner_dependency_rejects_agent_workload_and_non_google_identity(self):
        packet = self.packet()
        paths = [
            ("GET", "/key-renewal-state"),
            ("GET", "/key-renewal-operations/" + RENEW),
            ("POST", "/key-renewals"),
        ]
        for token in (
            None,
            "synthetic_agent_access_token",
            "synthetic_workload_identity",
            "synthetic_non_google_provider",
        ):
            for method, path in paths:
                with self.subTest(token=token, method=method):
                    headers = {"X-FolioView-Contract": CONTRACT_VERSION}
                    if token is not None:
                        headers["Authorization"] = "Bearer " + token
                    if method == "POST":
                        headers["Idempotency-Key"] = RENEW
                    self.failure(
                        self.client.request(
                            method,
                            self.base + path,
                            headers=headers,
                            **({"json": packet} if method == "POST" else {}),
                        ),
                        401,
                    )
        self.assertEqual(len(self.vaults.current(UID)["vault"]["registryHistory"]), 1)

    def test_anonymous_request_stops_before_store_and_cloud_configuration(self):
        def unavailable():
            raise AssertionError("Anonymous requests must not construct a store")

        app.dependency_overrides[get_key_renewal_service] = unavailable
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            self.failure(
                self.client.get(
                    self.base + "/key-renewal-state",
                    headers={"X-FolioView-Contract": CONTRACT_VERSION},
                ),
                401,
            )

    def test_other_google_owner_cannot_read_apply_or_recover_this_vault_operation(self):
        packet = self.packet()
        self.assertEqual(self.renew(packet).status_code, 201)
        headers = {**self.headers, "Authorization": "Bearer " + OWNER_B}
        self.failure(self.client.get(self.base + "/key-renewal-state", headers=headers), 404)
        self.failure(
            self.client.get(self.base + "/key-renewal-operations/" + RENEW, headers=headers), 404
        )
        self.failure(self.renew(packet, headers=headers), 404)
        self.assertIsNone(self.vaults.current(OTHER_UID)["vault"])

    def test_closed_get_transport_rejects_queries_body_and_control_headers(self):
        for path in ("/key-renewal-state", "/key-renewal-operations/" + RENEW):
            url = self.base + path
            self.failure(self.client.get(url + "?uid=other", headers=self.headers), 400)
            self.failure(self.client.request("GET", url, headers=self.headers, content="{}"), 400)
            for key, value in (
                ("Idempotency-Key", RENEW),
                ("X-FolioView-Author-Key", self.f.root_id),
                ("X-FolioView-Authority-Delegation", MARKER),
            ):
                self.failure(self.client.get(url, headers={**self.headers, key: value}), 400)
            self.failure(
                self.client.get(
                    url, headers=[*self.headers.items(), ("X-FolioView-Contract", CONTRACT_VERSION)]
                ),
                400,
            )
        self.assertEqual(len(self.vaults.current(UID)["vault"]["registryHistory"]), 1)

    def test_write_requires_single_contract_operation_and_forbids_author_overrides(self):
        packet = self.packet()
        url = self.base + "/key-renewals"
        self.failure(self.client.post(url, headers=self.headers, json=packet), 400)
        for headers in (
            [("Authorization", "Bearer " + OWNER_A), ("Idempotency-Key", RENEW)],
            [*self.headers.items(), ("Idempotency-Key", RENEW), ("Idempotency-Key", RENEW)],
            [
                *self.headers.items(),
                ("X-FolioView-Contract", CONTRACT_VERSION),
                ("Idempotency-Key", RENEW),
            ],
            {**self.headers, "Idempotency-Key": RENEW, "X-FolioView-Author-Key": self.f.root_id},
            {**self.headers, "Idempotency-Key": RENEW, "X-FolioView-Authority-Delegation": MARKER},
        ):
            self.failure(self.client.post(url, headers=headers, json=packet), 400)
        self.failure(self.renew(packet, operation="short"), 400)
        self.failure(
            self.client.post(
                url + "?expectedVersion=1",
                headers={**self.headers, "Idempotency-Key": RENEW},
                json=packet,
            ),
            400,
        )
        self.assertEqual(len(self.vaults.current(UID)["vault"]["registryHistory"]), 1)

    def test_closed_json_duplicate_fields_media_and_streamed_size_budget(self):
        packet = self.packet()
        url = self.base + "/key-renewals"
        headers = {**self.headers, "Idempotency-Key": RENEW}
        for extra in ({"uid": OTHER_UID}, {"privateKey": MARKER}, {"rootJwk": self.f.root_public}):
            self.failure(self.renew({**packet, **extra}), 400)
        for missing in ("registryBundle", "archive", "command", "archiveCommand"):
            self.failure(self.renew({k: v for k, v in packet.items() if k != missing}), 400)
        raw = json.dumps(packet)
        duplicate = '{"contractVersion":"' + CONTRACT_VERSION + '",' + raw[1:]
        self.failure(
            self.client.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                content=duplicate,
            ),
            400,
        )
        self.failure(
            self.client.post(url, headers={**headers, "Content-Type": "text/plain"}, content=raw),
            415,
        )
        self.failure(
            self.client.post(
                url,
                headers=[
                    *headers.items(),
                    ("Content-Type", "application/json"),
                    ("Content-Type", "application/json"),
                ],
                content=raw,
            ),
            415,
        )
        self.failure(
            self.client.post(
                url,
                headers={**headers, "Content-Type": "application/json", "Content-Length": "1"},
                content=b"x" * (MAX_HTTP_WRITE_BYTES + 1),
            ),
            413,
        )
        self.assertEqual(len(self.vaults.current(UID)["vault"]["registryHistory"]), 1)

    def test_both_root_commands_are_independently_bounded_and_fail_without_echoing(self):
        packet = self.packet()
        for field in ("command", "archiveCommand"):
            changed = copy.deepcopy(packet)
            changed[field]["payload"] = "A" * 8193
            self.failure(self.renew(changed), 413)
        corrupt = copy.deepcopy(packet)
        corrupt["command"]["signature"] = "A" * 86
        self.failure(self.renew(corrupt), 422)
        self.assertEqual(len(self.vaults.current(UID)["vault"]["registryHistory"]), 1)

    def test_google_login_does_not_authorize_device_signed_root_commands(self):
        state = self.lifecycle.state(UID, self.f.vault)
        self.failure(self.renew(self.f.renewal(state, signer="device_sig")), 422)
        packet = self.packet()
        archive_payload = strict_json_loads(b64url_decode(packet["archiveCommand"]["payload"]))
        packet["archiveCommand"] = self.f.sign(archive_payload, "device_sig")
        self.failure(self.renew(packet), 422)
        self.assertEqual(len(self.vaults.current(UID)["vault"]["registryHistory"]), 1)

    def test_paths_use_bounded_validated_vault_and_operation_identifiers(self):
        invalid_base = "/api/v2/vaults/invalid!"
        self.failure(
            self.client.get(invalid_base + "/key-renewal-state", headers=self.headers), 400
        )
        self.failure(
            self.client.get(
                invalid_base + "/key-renewal-operations/" + RENEW, headers=self.headers
            ),
            400,
        )
        self.failure(
            self.client.post(
                invalid_base + "/key-renewals",
                headers={**self.headers, "Idempotency-Key": RENEW},
                json=self.packet(),
            ),
            400,
        )
        oversized_operation = "a" * 161
        self.failure(
            self.client.get(
                self.base + "/key-renewal-operations/" + oversized_operation,
                headers=self.headers,
            ),
            400,
        )

    def test_missing_receipts_remain_formal_no_store_errors(self):
        self.failure(
            self.client.get(self.base + "/key-renewal-operations/" + RENEW, headers=self.headers),
            404,
        )
        self.failure(
            self.client.get(self.base + "/key-renewal-operations/short", headers=self.headers), 400
        )

    def test_default_dependencies_share_the_configured_store_without_service_cache(self):
        with patch("app.api.get_store", return_value=self.store):
            service = get_key_renewal_service()
            self.assertIs(service.store, self.store)
            self.assertIs(get_lifecycle_service().store, self.store)
            self.assertIs(get_service().store, self.store)
            self.assertIsNot(get_key_renewal_service(), service)


if __name__ == "__main__":
    unittest.main()
