"""OAuth transport adversarial cases; no broker, cloud or real user credentials."""

import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.oauth import OAuthFailure, get_oauth_service
from app.oauth_routes import COOKIE, agent_router, owner_router, router
from folioview_shared.encrypted.constants import CONTRACT_VERSION

ISSUER = "https://synthetic-hub.example"
FLOW = "f" * 43
TOKEN = "t" * 43
REQUEST_ID = "synthetic_request"


class TransportService:
    def __init__(self):
        self.config = SimpleNamespace(issuer=ISSUER, consent_url=ISSUER + "/consent")
        self.calls = []
        self.auth_failure = None

    def metadata(self):
        return {"issuer": ISSUER, "token_endpoint": ISSUER + "/oauth/token"}

    def protected_metadata(self):
        return {"resource": ISSUER + "/mcp/v2"}

    def authorize(self, params, browser):
        self.calls.append(("authorize", params, browser))
        return REQUEST_ID

    def protocol(self, form, headers, endpoint):
        self.calls.append((endpoint, form, headers))
        return 200, {"accepted": True}, {}

    def claim(self, uid, request_id, browser):
        self.calls.append(("claim", uid, request_id, browser))
        return {"requestId": request_id}

    def status(self, uid, request_id, browser):
        self.calls.append(("status", uid, request_id, browser))
        return {"requestId": request_id, "status": "pending"}

    def prepare(self, uid, request_id, browser, tasks, connection_id, approved_scopes):
        self.calls.append(
            ("prepare", uid, request_id, browser, tasks, connection_id, approved_scopes)
        )
        return {"requestId": request_id}

    def decide(self, uid, request_id, browser, decision, grants):
        self.calls.append(("decide", uid, request_id, browser, decision, grants))
        return "https://synthetic-client.example/callback?code=synthetic"

    def connections(self, uid):
        self.calls.append(("connections", uid))
        return {"items": []}

    def revoke_connection(self, uid, connection_id):
        self.calls.append(("revoke", uid, connection_id))
        return {"state": "revoked"}

    def revoke_grant(self, uid, connection_id, grant_id):
        self.calls.append(("revoke_grant", uid, connection_id, grant_id))
        return {"state": "revoked"}

    def authenticate(self, token):
        self.calls.append(("authenticate", token))
        if self.auth_failure:
            raise self.auth_failure
        return {"connectionId": "synthetic_connection", "signedGrantPresent": False}


class OAuthTransportTests(unittest.TestCase):
    def setUp(self):
        self.service = TransportService()
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.include_router(owner_router)
        self.app.include_router(agent_router)
        self.app.dependency_overrides[get_oauth_service] = lambda: self.service
        self.app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid="verified_A")
        self.client = TestClient(self.app, base_url=ISSUER, follow_redirects=False)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION, "Origin": ISSUER}
        self.client.cookies.set(COOKIE, FLOW, domain="synthetic-hub.example", path="/")

    def test_authorize_binds_opaque_flow_cookie_and_fixed_consent_redirect(self):
        response = self.client.get("/oauth/authorize", params={"client_id": "muse"})
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], ISSUER + "/consent?request=" + REQUEST_ID)
        cookie = response.headers["set-cookie"]
        for expected in (
            "HttpOnly",
            "Secure",
            "SameSite=lax",
            "Max-Age=600",
            "Path=/api/v2/agent-authorizations",
        ):
            self.assertIn(expected, cookie)
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(len(self.service.calls[0][2]), 43)

    def test_duplicate_unknown_malformed_and_large_authorize_fields_fail_before_domain(self):
        for query in (
            "client_id=x&client_id=y",
            "ownerSubject=A",
            "state=%GG",
            "state=%FF",
            "state=%00",
            "state=" + "x" * 9000,
        ):
            with self.subTest(query=query[:40]):
                response = self.client.get("/oauth/authorize?" + query)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "invalid_request")
                self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.service.calls, [])

    def test_token_form_and_client_auth_are_forwarded_without_query_or_duplicate_ambiguity(self):
        response = self.client.post(
            "/oauth/token",
            content="grant_type=authorization_code&client_id=muse",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": "Basic synthetic",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.service.calls,
            [
                (
                    "token",
                    {"grant_type": "authorization_code", "client_id": "muse"},
                    {"Authorization": "Basic synthetic"},
                )
            ],
        )
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_token_credentials_never_accepted_in_query_json_unknown_or_duplicate_fields(self):
        cases = [
            ("/oauth/token?client_id=muse", "grant_type=refresh_token", None),
            ("/oauth/token", "grant_type=x&grant_type=y", None),
            ("/oauth/token", "client_secret=synthetic-secret", None),
            ("/oauth/token", "scope=%GG", None),
            ("/oauth/token", "scope=" + "x" * 9000, None),
            ("/oauth/revoke", "token=one&token=two", None),
            ("/oauth/token", '{"grant_type":"refresh_token"}', "application/json"),
        ]
        for path, data, content_type in cases:
            with self.subTest(path=path, data=data[:30]):
                response = self.client.post(
                    path,
                    content=data,
                    headers={
                        "Content-Type": content_type or "application/x-www-form-urlencoded",
                    },
                )
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("synthetic-secret", response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.service.calls, [])
        duplicate = self.client.post(
            "/oauth/token",
            content="client_id=muse",
            headers=[
                ("Content-Type", "application/x-www-form-urlencoded"),
                ("Authorization", "Basic one"),
                ("Authorization", "Basic two"),
            ],
        )
        self.assertEqual(duplicate.status_code, 401)
        self.assertEqual(self.service.calls, [])

    def test_owner_consent_requires_version_origin_cookie_and_uses_verified_uid(self):
        path = f"/api/v2/agent-authorizations/{REQUEST_ID}/claim"
        value = {"contractVersion": CONTRACT_VERSION}
        response = self.client.post(path, json=value, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.service.calls[-1], ("claim", "verified_A", REQUEST_ID, FLOW))
        for changes in (
            {"Origin": "https://untrusted.example"},
            {"Origin": "null"},
            {"X-FolioView-Contract": "wrong"},
        ):
            response = self.client.post(path, json=value, headers={**self.headers, **changes})
            self.assertGreaterEqual(response.status_code, 400)
        self.client.cookies.clear()
        response = self.client.post(path, json=value, headers=self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.service.calls), 1)

    def test_owner_pending_status_requires_bound_browser_and_versioned_owner_request(self):
        path = f"/api/v2/agent-authorizations/{REQUEST_ID}"
        response = self.client.get(path, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "pending")
        self.assertEqual(self.service.calls[-1], ("status", "verified_A", REQUEST_ID, FLOW))
        response = self.client.get(path + "?owner=B", headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.client.cookies.clear()
        response = self.client.get(path, headers=self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.service.calls), 1)

    def test_owner_prepare_and_decision_reject_body_owner(
        self,
    ):
        prefix = f"/api/v2/agent-authorizations/{REQUEST_ID}"
        value = {
            "contractVersion": CONTRACT_VERSION,
            "taskIds": ["task_A"],
            "connectionId": None,
            "approvedScopes": ["tasks:read", "results:create", "receipts:read"],
        }
        prepared = self.client.post(prefix + "/prepare", json=value, headers=self.headers)
        self.assertEqual(prepared.status_code, 200)
        self.assertEqual(
            self.service.calls[-1],
            (
                "prepare",
                "verified_A",
                REQUEST_ID,
                FLOW,
                ["task_A"],
                None,
                ["tasks:read", "results:create", "receipts:read"],
            ),
        )
        for invalid in (None, "tasks:read", [], [None]):
            rejected = self.client.post(
                prefix + "/prepare", json={**value, "approvedScopes": invalid}, headers=self.headers
            )
            self.assertEqual(rejected.status_code, 400, rejected.text)
        rejected = self.client.post(
            prefix + "/prepare", json={**value, "owner": "B"}, headers=self.headers
        )
        self.assertEqual(rejected.status_code, 400)
        decision = self.client.post(
            prefix + "/decision",
            json={
                "contractVersion": CONTRACT_VERSION,
                "decision": "approve",
                "signedGrants": [],
            },
            headers=self.headers,
        )
        self.assertEqual(decision.status_code, 200)
        self.assertEqual(
            decision.json(),
            {
                "redirectUri": "https://synthetic-client.example/callback?code=synthetic",
            },
        )
        self.assertIn("Max-Age=0", decision.headers["set-cookie"])
        revoked = self.client.post(
            "/api/v2/agent-connections/connection_A/revoke",
            json={
                "contractVersion": CONTRACT_VERSION,
            },
            headers=self.headers,
        )
        self.assertEqual(revoked.status_code, 200)
        self.assertEqual(self.service.calls[-1], ("revoke", "verified_A", "connection_A"))

    def test_agent_authorization_uses_only_opaque_bearer_and_challenges_invalid_tokens(self):
        for headers in (
            {},
            {"Authorization": "Bearer firebase.jwt.signature"},
            {"Authorization": "Basic synthetic"},
        ):
            response = self.client.get("/agent/v2/authorization", headers=headers)
            self.assertEqual(response.status_code, 401)
            self.assertIn(
                ISSUER + "/.well-known/oauth-protected-resource/mcp/v2",
                response.headers["www-authenticate"],
            )
        self.assertEqual(self.service.calls, [])
        response = self.client.get(
            "/agent/v2/authorization",
            headers={
                "Authorization": "Bearer " + TOKEN,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["signedGrantPresent"])
        self.assertEqual(self.service.calls[-1], ("authenticate", TOKEN))
        self.service.auth_failure = OAuthFailure("invalid_token", 401)
        response = self.client.get(
            "/agent/v2/authorization",
            headers={
                "Authorization": "Bearer " + TOKEN,
            },
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("www-authenticate", response.headers)

    def test_discovery_is_configuration_driven_and_does_not_follow_host_headers(self):
        response = self.client.get(
            "/.well-known/oauth-authorization-server",
            headers={
                "Host": "untrusted.example",
                "X-Forwarded-Host": "untrusted.example",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["issuer"], ISSUER)
        resource = self.client.get("/.well-known/oauth-protected-resource/mcp/v2")
        self.assertEqual(resource.json()["resource"], ISSUER + "/mcp/v2")


class OAuthProductionAppTests(unittest.TestCase):
    """Real ASGI and SQLite lifecycle, with only Firebase verification simulated."""

    def setUp(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        from fixtures import BOOT, OTHER_UID, UID
        from test_task_routes import HttpTaskFixture, NoSources

        from app.main import app
        from app.oauth import OAuthService
        from app.oauth_config import Client, OAuthConfig
        from app.store import SQLiteHubStore
        from app.tasks import TaskService
        from app.vaults import VaultService

        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLiteHubStore(Path(directory.name) / "oauth.sqlite3")
        self.clock = [1000]
        self.vaults = VaultService(self.store, clock=lambda: self.clock[0])
        self.fixtures = {UID: HttpTaskFixture(UID), OTHER_UID: HttpTaskFixture(OTHER_UID)}
        self.task_ids = {UID: "oauth_task_A", OTHER_UID: "oauth_task_B"}
        tasks = TaskService(self.store, NoSources(), clock=lambda: self.clock[0])
        for uid, fixture in self.fixtures.items():
            self.vaults.bootstrap(uid, fixture.bootstrap(), BOOT)
            operation = "synthetic_oauth_task_create_" + ("A" if uid == UID else "B")
            tasks.create(
                uid,
                fixture.body(task=self.task_ids[uid], operation=operation),
                operation,
                fixture.kid("device_sig"),
            )
        self.service = OAuthService(
            self.store,
            OAuthConfig(
                ISSUER,
                ISSUER + "/consent",
                (Client("synthetic_muse", ["https://synthetic-client.example/callback"]),),
            ),
            NoSources(),
            clock=lambda: self.clock[0],
        )
        self.app = app
        self.app.dependency_overrides[get_oauth_service] = lambda: self.service
        self.addCleanup(self.app.dependency_overrides.clear)
        self.client = TestClient(self.app, base_url=ISSUER, follow_redirects=False)
        self.addCleanup(self.client.close)
        from folioview_shared import auth as auth_module

        self.real_firebase_app = auth_module._get_firebase_app
        self.auth_app = object()
        patcher = patch("folioview_shared.auth._get_firebase_app", return_value=self.auth_app)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.firebase = patch("folioview_shared.auth.auth.verify_id_token", side_effect=self.claims)
        self.verify = self.firebase.start()
        self.addCleanup(self.firebase.stop)
        self.uid_a, self.uid_b = UID, OTHER_UID

    def claims(self, token, *, app, check_revoked):
        from firebase_admin import auth

        self.assertIs(app, self.auth_app)
        self.assertTrue(check_revoked)
        if token not in {
            "synthetic_firebase_A",
            "synthetic_firebase_B",
            "synthetic_wrong_provider",
        }:
            raise auth.InvalidIdTokenError("Synthetic rejected token")
        uid = self.uid_b if token == "synthetic_firebase_B" else self.uid_a
        return {
            "uid": uid,
            "firebase": {
                "sign_in_provider": "password"
                if token == "synthetic_wrong_provider"
                else "google.com",
            },
        }

    def headers(self, uid=None):
        return {
            "Authorization": "Bearer synthetic_firebase_" + ("B" if uid == self.uid_b else "A"),
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Origin": ISSUER,
        }

    def start(self, uid=None, *, connection_id=None, signed=True):
        import hashlib
        from urllib.parse import parse_qs, urlsplit

        from folioview_shared.encrypted.jsonutil import b64url_encode

        uid = uid or self.uid_a
        verifier = "v" * 64
        params = {
            "response_type": "code",
            "client_id": "synthetic_muse",
            "redirect_uri": "https://synthetic-client.example/callback",
            "scope": "tasks:read results:create receipts:read",
            "state": "synthetic_state_1234567890",
            "resource": self.service.config.resource,
            "code_challenge": b64url_encode(hashlib.sha256(verifier.encode()).digest()),
            "code_challenge_method": "S256",
        }
        opened = self.client.get("/oauth/authorize", params=params)
        self.assertEqual(opened.status_code, 303, opened.text)
        pending = parse_qs(urlsplit(opened.headers["location"]).query)["request"][0]
        prefix = f"/api/v2/agent-authorizations/{pending}"
        claimed = self.client.post(
            prefix + "/claim",
            json={
                "contractVersion": CONTRACT_VERSION,
            },
            headers=self.headers(uid),
        )
        self.assertEqual(claimed.status_code, 200, claimed.text)
        connection = claimed.json()["connectionId"] if connection_id is None else connection_id
        fixture = self.fixtures[uid]
        if signed:
            sig_name = "http_agent_sig_" + connection[-12:]
            enc_name = "http_agent_enc_" + connection[-12:]
            fixture.add_key(sig_name, "agent_sig", "synthetic_agent", connection)
            fixture.add_key(enc_name, "agent_enc", "synthetic_agent", connection)
            prior = fixture.registry
            bundle = fixture.make_bundle(previous=prior)
            self.vaults.update_registry(
                uid,
                fixture.vault,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "expectedVersion": prior.registry_sequence,
                    "registryBundle": bundle,
                },
                "synthetic_oauth_pair_" + connection[-20:],
            )
            fixture.bundle = bundle
            fixture.registry = fixture.verify(bundle, previous=prior)
        prepared = self.client.post(
            prefix + "/prepare",
            json={
                "contractVersion": CONTRACT_VERSION,
                "taskIds": [self.task_ids[uid]],
                "connectionId": connection_id,
                "approvedScopes": ["tasks:read", "results:create", "receipts:read"],
            },
            headers=self.headers(uid),
        )
        self.assertEqual(prepared.status_code, 200, prepared.text)
        data = prepared.json()
        grants = []
        if signed:
            grant = data["prepared"]["tasks"][0]
            payload = fixture.base("agent_key_grant") | {
                "connectionId": connection,
                "authorizationId": data["authorizationId"],
                "deviceSigningKeyId": fixture.kid("device_sig"),
                "taskId": grant["taskId"],
                "taskVersions": [grant["taskVersion"]],
                "executionEpoch": grant["executionEpoch"],
                "grantId": grant["grantId"],
                "grantEpoch": grant["grantEpoch"],
                "resourceBindings": [],
                "capabilities": ["decrypt_task", "encrypt_result"],
                "agentSigningKeyId": fixture.kid(sig_name),
                "agentSigningKeyEpoch": 1,
                "agentEncryptionKeyId": fixture.kid(enc_name),
                "agentEncryptionKeyEpoch": 1,
                "keyEpoch": fixture.registry.key_epoch,
                "writebackRecipientKeyIds": sorted(
                    [
                        fixture.kid("device_enc"),
                        fixture.kid("recovery_enc"),
                    ]
                ),
                "historyPolicy": "none",
                "notBefore": 900,
                "expiresAt": 1500,
                "registrySequence": fixture.registry.registry_sequence,
                "checkpointDigest": fixture.registry.checkpoint_digest,
            }
            grants = [fixture.sign(payload)]
        decided = self.client.post(
            prefix + "/decision",
            json={
                "contractVersion": CONTRACT_VERSION,
                "decision": "approve",
                "signedGrants": grants,
            },
            headers=self.headers(uid),
        )
        self.assertEqual(decided.status_code, 200, decided.text)
        redirect = parse_qs(urlsplit(decided.json()["redirectUri"]).query)
        self.assertEqual(redirect["iss"], [ISSUER])
        self.assertEqual(redirect["state"], [params["state"]])
        exchanged = self.client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "client_id": "synthetic_muse",
                "redirect_uri": params["redirect_uri"],
                "resource": self.service.config.resource,
                "code": redirect["code"][0],
                "code_verifier": verifier,
            },
        )
        self.assertEqual(exchanged.status_code, 200, exchanged.text)
        self.assertEqual(exchanged.headers["cache-control"], "no-store")
        return exchanged.json(), connection

    def test_actual_app_google_claim_signed_grant_pkce_refresh_and_revoke(self):
        token, connection = self.start()
        principal = self.service.authenticate(
            token["access_token"], self.task_ids[self.uid_a], "tasks:read"
        )
        self.assertEqual(principal["connectionId"], connection)
        self.assertEqual(principal["taskIds"], [self.task_ids[self.uid_a]])
        status = self.client.get(
            "/agent/v2/authorization",
            headers={
                "Authorization": "Bearer " + token["access_token"],
            },
        )
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json()["connectionId"], connection)
        refreshed = self.client.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": token["refresh_token"],
                "client_id": "synthetic_muse",
                "resource": self.service.config.resource,
                "scope": "tasks:read",
            },
        )
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        rotated = refreshed.json()
        self.assertNotEqual(rotated["refresh_token"], token["refresh_token"])
        self.assertEqual(rotated["scope"], "tasks:read")
        revoked = self.client.post(
            "/oauth/revoke",
            data={
                "token": rotated["refresh_token"],
                "token_type_hint": "refresh_token",
                "client_id": "synthetic_muse",
                "resource": self.service.config.resource,
            },
        )
        self.assertEqual(revoked.status_code, 200, revoked.text)
        denied = self.client.get(
            "/agent/v2/authorization",
            headers={
                "Authorization": "Bearer " + rotated["access_token"],
            },
        )
        self.assertEqual(denied.status_code, 401, denied.text)
        self.assertIn("www-authenticate", denied.headers)
        self.assertGreaterEqual(self.verify.call_count, 3)

    def test_actual_app_same_client_two_owners_and_connection_revocation_are_isolated(self):
        a, a_connection = self.start(self.uid_a)
        b, b_connection = self.start(self.uid_b)
        self.assertNotEqual(a_connection, b_connection)
        listed_a = self.client.get("/api/v2/agent-connections", headers=self.headers(self.uid_a))
        listed_b = self.client.get("/api/v2/agent-connections", headers=self.headers(self.uid_b))
        self.assertEqual([row["connectionId"] for row in listed_a.json()["items"]], [a_connection])
        self.assertEqual([row["connectionId"] for row in listed_b.json()["items"]], [b_connection])
        forged = self.client.post(
            f"/api/v2/agent-connections/{b_connection}/revoke",
            json={
                "contractVersion": CONTRACT_VERSION,
            },
            headers=self.headers(self.uid_a),
        )
        self.assertEqual(forged.status_code, 404, forged.text)
        revoked = self.client.post(
            f"/api/v2/agent-connections/{a_connection}/revoke",
            json={
                "contractVersion": CONTRACT_VERSION,
            },
            headers=self.headers(self.uid_a),
        )
        self.assertEqual(revoked.status_code, 200)
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(a["access_token"])
        self.assertEqual(self.service.authenticate(b["access_token"])["connectionId"], b_connection)
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(b["access_token"], self.task_ids[self.uid_a], "tasks:read")

    def test_actual_owner_dependency_rejects_agent_token_and_non_google_provider(self):
        for token in ("synthetic_wrong_provider", "o" * 43):
            response = self.client.get(
                "/api/v2/agent-connections",
                headers={
                    "Authorization": "Bearer " + token,
                    "X-FolioView-Contract": CONTRACT_VERSION,
                },
            )
            self.assertEqual(response.status_code, 401, response.text)
        self.verify.assert_called()
        self.assertTrue(all(call.kwargs["check_revoked"] for call in self.verify.call_args_list))

    def test_actual_same_owner_independent_agent_connections_keep_other_agents_active(self):
        first, first_connection = self.start(self.uid_a)
        second, second_connection = self.start(self.uid_a)
        other, other_connection = self.start(self.uid_b)
        self.assertNotEqual(first_connection, second_connection)
        for token in (first, second):
            self.service.authenticate(
                token["access_token"], self.task_ids[self.uid_a], "tasks:read"
            )
        response = self.client.post(
            f"/api/v2/agent-connections/{first_connection}/revoke",
            json={"contractVersion": CONTRACT_VERSION},
            headers=self.headers(self.uid_a),
        )
        self.assertEqual(response.status_code, 200, response.text)
        with self.assertRaises(OAuthFailure):
            self.service.authenticate(first["access_token"])
        self.assertEqual(
            self.service.authenticate(
                second["access_token"], self.task_ids[self.uid_a], "tasks:read"
            )["connectionId"],
            second_connection,
        )
        self.assertEqual(
            self.service.authenticate(
                other["access_token"], self.task_ids[self.uid_b], "tasks:read"
            )["connectionId"],
            other_connection,
        )

    def test_only_one_agents_key_revocation_preserves_other_agents_content_authority(self):
        from folioview_shared.encrypted.errors import ContractError

        first, first_connection = self.start(self.uid_a)
        second, second_connection = self.start(self.uid_a)
        other, _ = self.start(self.uid_b)
        fixture = self.fixtures[self.uid_a]
        previous = fixture.registry
        revoked = [
            "http_agent_sig_" + first_connection[-12:],
            "http_agent_enc_" + first_connection[-12:],
        ]
        bundle = fixture.make_bundle(
            previous=previous, revoked=revoked, key_epoch=previous.key_epoch
        )
        self.vaults.update_registry(
            self.uid_a,
            fixture.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": previous.registry_sequence,
                "registryBundle": bundle,
            },
            "synthetic_oauth_agent_key_revoke_0001",
        )
        self.service.authenticate(first["access_token"])
        with self.assertRaises(ContractError):
            self.service.authenticate(
                first["access_token"], self.task_ids[self.uid_a], "tasks:read"
            )
        self.assertEqual(
            self.service.authenticate(
                second["access_token"], self.task_ids[self.uid_a], "tasks:read"
            )["connectionId"],
            second_connection,
        )
        self.service.authenticate(other["access_token"], self.task_ids[self.uid_b], "tasks:read")

    def test_actual_claim_prevents_google_account_swap_in_same_browser_flow(self):
        from urllib.parse import parse_qs, urlsplit

        from test_oauth import authorization_params

        params = authorization_params(
            client_id="synthetic_muse", redirect_uri="https://synthetic-client.example/callback"
        )
        opened = self.client.get("/oauth/authorize", params=params)
        self.assertEqual(opened.status_code, 303, opened.text)
        pending = parse_qs(urlsplit(opened.headers["location"]).query)["request"][0]
        path = f"/api/v2/agent-authorizations/{pending}/claim"
        first = self.client.post(
            path, json={"contractVersion": CONTRACT_VERSION}, headers=self.headers(self.uid_a)
        )
        self.assertEqual(first.status_code, 200, first.text)
        swapped = self.client.post(
            path, json={"contractVersion": CONTRACT_VERSION}, headers=self.headers(self.uid_b)
        )
        self.assertEqual(swapped.status_code, 404, swapped.text)
        resumed = self.client.post(
            path, json={"contractVersion": CONTRACT_VERSION}, headers=self.headers(self.uid_a)
        )
        self.assertEqual(resumed.status_code, 200, resumed.text)
        self.assertEqual(resumed.json()["authorizationId"], first.json()["authorizationId"])

    def test_actual_google_project_mismatch_fails_closed_before_verifying_owner_token(self):
        import os
        from unittest.mock import patch

        self.verify.reset_mock()
        with (
            patch("folioview_shared.auth._get_firebase_app", side_effect=self.real_firebase_app),
            patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "synthetic_expected_project"}),
            patch(
                "folioview_shared.auth.firebase_admin.get_app",
                return_value=SimpleNamespace(project_id="synthetic_other_project"),
            ),
        ):
            response = self.client.get("/api/v2/agent-connections", headers=self.headers())
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.verify.assert_not_called()
