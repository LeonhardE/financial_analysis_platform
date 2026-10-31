"""Real owner transport with disabled issuance; only synthetic identities and state."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_oauth as oauth_fixtures
from fastapi.testclient import TestClient
from fixtures import OTHER_UID, UID

from app.oauth import OwnerConnectionService
from app.store import SQLiteHubStore, StoreUnavailable
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class OwnerConnectionRolloutTests(unittest.TestCase):
    def setUp(self):
        self.flags = patch.dict(
            os.environ, HUB_OAUTH_ENABLED="0", HUB_ENCRYPTED_ADAPTER_ENABLED="0"
        )
        self.flags.start()
        self.addCleanup(self.flags.stop)
        from app.main import app

        self.app = app
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = SQLiteHubStore(Path(self.directory.name) / "owner-connections.sqlite3")
        self.store_patch = patch("app.oauth.get_store", side_effect=lambda: self.store)
        self.storage = self.store_patch.start()
        self.addCleanup(self.store_patch.stop)
        firebase_app = patch("folioview_shared.auth._get_firebase_app", return_value=object())
        firebase_app.start()
        self.addCleanup(firebase_app.stop)
        verifier = patch("folioview_shared.auth.auth.verify_id_token", side_effect=self.claims)
        self.verifier = verifier.start()
        self.addCleanup(verifier.stop)
        self.client = TestClient(self.app, base_url=oauth_fixtures.ISSUER)
        self.addCleanup(self.client.close)

    def claims(self, token, *, app, check_revoked):
        from firebase_admin import auth

        self.assertTrue(check_revoked)
        if token == "synthetic_revoked":
            raise auth.RevokedIdTokenError("Synthetic revoked identity")
        if token not in ("synthetic_A", "synthetic_B", "synthetic_password"):
            raise auth.InvalidIdTokenError("Synthetic invalid identity")
        return {
            "uid": OTHER_UID if token == "synthetic_B" else UID,
            "firebase": {
                "sign_in_provider": "password" if token == "synthetic_password" else "google.com"
            },
        }

    def headers(self, token="synthetic_A"):
        return {
            "Authorization": "Bearer " + token,
            "X-FolioView-Contract": CONTRACT_VERSION,
        }

    def seed_connection(self):
        case = oauth_fixtures.OAuthTests(methodName="runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        tokens, prepared, _ = case.consent()
        self.store = case.store
        return case, tokens, prepared

    def test_disabled_rollout_owner_list_is_valid_empty_without_oauth_configuration(self):
        with patch("app.oauth_config.OAuthConfig.environment", side_effect=AssertionError):
            response = self.client.get("/api/v2/agent-connections", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json(),
            {"contractVersion": CONTRACT_VERSION, "items": [], "authorizationAttempts": []},
        )
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertTrue(self.verifier.call_args.kwargs["check_revoked"])

    def test_disabled_rollout_preserves_history_and_actual_connection_revocation(self):
        case, tokens, prepared = self.seed_connection()
        owner = OwnerConnectionService(self.store, clock=lambda: case.now)
        self.assertEqual(owner.connections(UID), case.service.connections(UID))
        self.assertFalse(hasattr(owner, "config"))
        with patch("app.oauth_config.OAuthConfig.environment", side_effect=AssertionError):
            listed = self.client.get("/api/v2/agent-connections", headers=self.headers())
            self.assertEqual(listed.status_code, 200, listed.text)
            self.assertEqual(listed.json()["items"][0]["connectionId"], prepared["connectionId"])
            self.assertEqual(len(listed.json()["authorizationAttempts"]), 1)
            other = self.client.get(
                "/api/v2/agent-connections", headers=self.headers("synthetic_B")
            )
            self.assertEqual(other.json()["items"], [])
            denied = self.client.post(
                f"/api/v2/agent-connections/{prepared['connectionId']}/revoke",
                headers=self.headers("synthetic_B"),
                json={"contractVersion": CONTRACT_VERSION},
            )
            self.assertEqual(denied.status_code, 404, denied.text)
            case.service.authenticate(tokens["access_token"])
            revoked = self.client.post(
                f"/api/v2/agent-connections/{prepared['connectionId']}/revoke",
                headers=self.headers(),
                json={"contractVersion": CONTRACT_VERSION},
            )
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertEqual(revoked.json()["connection"]["status"], "revoked")
        with self.assertRaises(oauth_fixtures.OAuthFailure):
            case.service.authenticate(tokens["access_token"])

    def test_disabled_rollout_grant_revocation_has_same_owner_and_task_boundary(self):
        case, tokens, prepared = self.seed_connection()
        connection = prepared["connectionId"]
        grant = prepared["prepared"]["tasks"][0]["grantId"]
        path = f"/api/v2/agent-connections/{connection}/grants/{grant}/revoke"
        with patch("app.oauth_config.OAuthConfig.environment", side_effect=AssertionError):
            denied = self.client.post(
                path,
                headers=self.headers("synthetic_B"),
                json={"contractVersion": CONTRACT_VERSION},
            )
            self.assertEqual(denied.status_code, 404, denied.text)
            response = self.client.post(
                path, headers=self.headers(), json={"contractVersion": CONTRACT_VERSION}
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["connection"]["grants"][0]["status"], "revoked")
        with self.assertRaises(oauth_fixtures.OAuthFailure) as denied:
            case.service.authenticate(tokens["access_token"], oauth_fixtures.TASK, "tasks:read")
        self.assertEqual(denied.exception.code, "insufficient_scope")

    def test_owner_identity_failures_precede_storage_for_list_revoke_and_capabilities(self):
        for token in (None, "synthetic_revoked", "synthetic_password", "synthetic_untrusted"):
            for method, path in (
                ("GET", "/api/v2/agent-connections"),
                ("GET", "/api/v2/agent-capabilities"),
                ("POST", "/api/v2/agent-connections/connection_A/revoke"),
                ("POST", "/api/v2/agent-connections/connection_A/grants/grant_A/revoke"),
            ):
                with self.subTest(token=token, path=path):
                    self.storage.reset_mock()
                    headers = self.headers(token) if token else {}
                    response = self.client.request(
                        method, path, headers=headers, json={"contractVersion": CONTRACT_VERSION}
                    )
                    self.assertEqual(response.status_code, 401, response.text)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                    self.storage.assert_not_called()

    def test_real_storage_failures_remain_503_instead_of_successful_empty_list(self):
        for fault in ("construct", "transaction"):
            with self.subTest(fault=fault):
                target = "app.oauth.get_store" if fault == "construct" else self.store
                context = (
                    patch(target, side_effect=StoreUnavailable)
                    if fault == "construct"
                    else patch.object(target, "transact", side_effect=StoreUnavailable)
                )
                with context:
                    response = self.client.get("/api/v2/agent-connections", headers=self.headers())
                self.assertEqual(response.status_code, 503, response.text)
                self.assertEqual(response.json()["error"]["code"], "authorization_unavailable")
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn("items", response.json())

    def test_capability_signal_is_closed_without_storage_or_oauth_config_when_disabled(self):
        with (
            patch("app.oauth.get_store", side_effect=AssertionError),
            patch("app.oauth_config.OAuthConfig.environment", side_effect=AssertionError),
        ):
            response = self.client.get("/api/v2/agent-capabilities", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json(),
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": "folioview.owner-agent-capabilities.v1",
                "ownerConnections": True,
                "museConnectionEnabled": False,
            },
        )
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_capabilities_require_both_exact_gates_and_valid_configuration(self):
        valid = {
            "HUB_OAUTH_ENABLED": "1",
            "HUB_ENCRYPTED_ADAPTER_ENABLED": "1",
            "HUB_OAUTH_ISSUER": oauth_fixtures.ISSUER,
            "HUB_OAUTH_CONSENT_URL": oauth_fixtures.ISSUER + "/consent",
            "HUB_OAUTH_CLIENTS_JSON": json.dumps(
                [
                    {
                        "provider": "muse",
                        "clientId": "synthetic_muse",
                        "redirectUris": [oauth_fixtures.CALLBACK],
                        "tokenEndpointAuthMethod": "none",
                        "secretSha256": None,
                    }
                ]
            ),
        }
        variants = [({}, True)]
        for key in ("HUB_OAUTH_ENABLED", "HUB_ENCRYPTED_ADAPTER_ENABLED"):
            variants.extend(({key: value}, False) for value in ("0", "true", "", "2"))
        variants.extend(
            [
                ({"HUB_OAUTH_CLIENTS_JSON": "[]"}, False),
                ({"HUB_OAUTH_CLIENTS_JSON": "invalid"}, False),
                ({"HUB_OAUTH_ISSUER": "https://synthetic-hub.example/path"}, False),
                ({"HUB_OAUTH_CONSENT_URL": "https://wrong.example/consent"}, False),
            ]
        )
        for changes, enabled in variants:
            with self.subTest(changes=changes), patch.dict(os.environ, valid | changes):
                response = self.client.get("/api/v2/agent-capabilities", headers=self.headers())
                self.assertEqual(response.status_code, 200, response.text)
                value = response.json()
                self.assertIs(value["museConnectionEnabled"], enabled)
                self.assertIs(value["ownerConnections"], True)
                self.assertEqual(len(value), 4)
                for private in ("synthetic_muse", "secretSha256", oauth_fixtures.CALLBACK):
                    self.assertNotIn(private, response.text)
        self.storage.assert_not_called()

    def test_capabilities_require_exact_transport_without_selector_queries(self):
        for path, headers, code in (
            ("/api/v2/agent-capabilities?uid=other", self.headers(), "unsupported_query"),
            (
                "/api/v2/agent-capabilities",
                {"Authorization": "Bearer synthetic_A"},
                "unsupported_contract",
            ),
        ):
            response = self.client.get(path, headers=headers)
            self.assertEqual(response.status_code, 400, response.text)
            self.assertEqual(response.json()["error"]["code"], code)
        self.storage.assert_not_called()
