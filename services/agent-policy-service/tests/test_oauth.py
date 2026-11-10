"""Authlib interoperability, exact callback/resource/PKCE, durable rotation and revocation."""

from dataclasses import replace
from urllib.parse import parse_qs, urlsplit

from authlib.integrations.httpx_client import OAuth2Client
from authlib.integrations.httpx_client._compat import httpx2 as native_http
from authlib.oauth2.rfc6749.errors import OAuth2Error
from fastapi.testclient import TestClient
from fixtures import CONNECTION, UID, VERIFIER, PolicyFixture

from app.contracts import digest
from app.main import app, get_active_policy, get_policy
from app.oauth import OAuth
from folioview_shared.encrypted.errors import ContractError


class OAuthTests(PolicyFixture):
    def refresh(self, token, **changes):
        return OAuth(self.policy).token(
            {
                "grant_type": "refresh_token",
                "client_id": "synthetic_native",
                "refresh_token": token,
                "resource": self.value["audience"],
                **changes,
            }
        )

    def test_actual_authlib_client_exchanges_code_and_rotates_refresh_over_http(self):
        app.dependency_overrides[get_active_policy] = lambda: self.policy
        app.dependency_overrides[get_policy] = lambda: self.policy
        self.addCleanup(app.dependency_overrides.clear)
        with TestClient(app, base_url=self.config.issuer) as api:

            def forward(request):
                response = api.request(
                    request.method,
                    str(request.url),
                    content=request.content,
                    headers=dict(request.headers),
                    follow_redirects=False,
                )
                return native_http.Response(
                    response.status_code, headers=response.headers, content=response.content
                )

            with OAuth2Client(
                "synthetic_native",
                redirect_uri="https://native.example/callback",
                scope="executor:execute executor:recover executor:write_report",
                code_challenge_method="S256",
                token_endpoint_auth_method="none",
                transport=native_http.MockTransport(forward),
            ) as native:
                url, state = native.create_authorization_url(
                    self.config.issuer + "/oauth/authorize",
                    state="synthetic_native_client_state_01",
                    code_verifier=VERIFIER,
                    resource=self.value["audience"],
                )
                data = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
                pending, cookie = OAuth(self.policy).begin(data)
                c = self.owner_state()
                command = self.control(
                    "oauth_approve",
                    version=c["stateVersion"],
                    head=c["stateHead"],
                    parameters={"pendingId": pending["pendingId"], "requestDigest": digest(data)},
                )
                result = OAuth(self.policy).approve(
                    UID, pending["pendingId"], cookie, CONNECTION, command
                )
                location = result["headers"]["Location"]
                self.assertEqual(parse_qs(urlsplit(location).query)["iss"], [self.config.issuer])
                token = native.fetch_token(
                    self.config.issuer + "/oauth/token",
                    authorization_response=location,
                    code_verifier=VERIFIER,
                    resource=self.value["audience"],
                )
                original = token["refresh_token"]
                rotated = native.refresh_token(
                    self.config.issuer + "/oauth/token", resource=self.value["audience"]
                )
                self.assertNotEqual(original, rotated["refresh_token"])
                self.policy = self.new_policy()
                again = self.refresh(rotated["refresh_token"])
                self.assertEqual(again["status"], 200, again)

    def test_refresh_replay_revokes_entire_family_and_survives_restart(self):
        token = self.authorize()
        rotated = self.refresh(token["refresh_token"])
        self.assertEqual(rotated["status"], 200)
        replay = self.refresh(token["refresh_token"])
        self.assertEqual(replay["body"]["error"], "invalid_grant")
        self.policy = self.new_policy()
        self.assertEqual(
            self.refresh(rotated["body"]["refresh_token"])["body"]["error"], "invalid_grant"
        )
        self.assertTrue(all(f["revoked"] for f in self.store.load()[1]["families"].values()))

    def test_refresh_scope_can_narrow_but_never_expand(self):
        token = self.authorize(scope="executor:execute executor:recover")
        denied = self.refresh(token["refresh_token"], scope="executor:write_report")
        self.assertEqual(denied["body"]["error"], "invalid_scope")
        good = self.refresh(token["refresh_token"], scope="executor:execute")
        self.assertEqual(good["status"], 200, good)
        self.assertEqual(good["body"]["scope"], "executor:execute")

    def test_authorization_refuses_bad_callback_resource_client_and_pkce_downgrade(self):
        for change in (
            {"redirect_uri": "https://attacker.example/callback"},
            {"resource": "https://hub.example"},
            {"client_id": "wrong_client"},
            {"code_challenge_method": "plain"},
            {"code_challenge": "x"},
            {"response_type": "token"},
            {"scope": "executor:root"},
        ):
            with self.subTest(change=change), self.assertRaises((ContractError, OAuth2Error)):
                OAuth(self.policy).begin(self.authorization_data(**change))
        self.assertEqual(self.store.load()[1]["pending"], {})

    def code(self):
        oauth = OAuth(self.policy)
        data = self.authorization_data()
        pending, cookie = oauth.begin(data)
        c = self.owner_state()
        command = self.control(
            "oauth_approve",
            version=c["stateVersion"],
            head=c["stateHead"],
            parameters={"pendingId": pending["pendingId"], "requestDigest": digest(data)},
        )
        response = oauth.approve(UID, pending["pendingId"], cookie, CONNECTION, command)
        return parse_qs(urlsplit(response["headers"]["Location"]).query)["code"][0]

    def exchange(self, code, **changes):
        return OAuth(self.policy).token(
            {
                "grant_type": "authorization_code",
                "client_id": "synthetic_native",
                "redirect_uri": "https://native.example/callback",
                "code_verifier": VERIFIER,
                "code": code,
                "resource": self.value["audience"],
                **changes,
            }
        )

    def test_wrong_verifier_callback_resource_and_expired_code_do_not_mint(self):
        code = self.code()
        for change in (
            {"code_verifier": "w" * 43},
            {"redirect_uri": "https://attacker.example/callback"},
            {"resource": "https://hub.example"},
        ):
            with self.subTest(change=change):
                result = self.exchange(code, **change)
                self.assertNotEqual(result["status"], 200, result)
        self.assertEqual(self.store.load()[1]["access"], {})
        self.now += 301
        self.assertNotEqual(self.exchange(code)["status"], 200)

    def test_code_replay_fences_issued_access_and_refresh(self):
        code = self.code()
        token = self.exchange(code)
        self.assertEqual(token["status"], 200, token)
        self.assertEqual(self.exchange(code)["body"]["error"], "invalid_grant")
        self.assertEqual(
            self.refresh(token["body"]["refresh_token"])["body"]["error"], "invalid_grant"
        )

    def test_wrong_owner_cookie_or_signed_request_cannot_approve(self):
        data = self.authorization_data()
        oauth = OAuth(self.policy)
        pending, cookie = oauth.begin(data)
        with self.assertRaises(ContractError):
            oauth.pending("other_owner", pending["pendingId"], cookie)
        with self.assertRaises(ContractError):
            oauth.pending(UID, pending["pendingId"], "wrong_cookie")
        c = self.owner_state()
        bad = self.control(
            "oauth_approve",
            version=c["stateVersion"],
            head=c["stateHead"],
            parameters={"pendingId": pending["pendingId"], "requestDigest": "a" * 64},
        )
        with self.assertRaises(ContractError):
            oauth.approve(UID, pending["pendingId"], cookie, CONNECTION, bad)
        self.assertEqual(self.store.load()[1]["codes"], {})

    def test_revocation_is_durable_even_with_issuance_disabled(self):
        token = self.authorize()
        self.policy = self.new_policy(replace(self.config, enabled=False))
        response = OAuth(self.policy).token(
            {"client_id": "synthetic_native", "token": token["refresh_token"]}, revoke=True
        )
        self.assertEqual(response["status"], 200, response)
        self.policy = self.new_policy()
        self.assertEqual(self.refresh(token["refresh_token"])["body"]["error"], "invalid_grant")

    def test_signed_refresh_handle_binding_tampering_cannot_revoke_or_grant(self):
        token = self.authorize()
        bad = token["refresh_token"][:-2] + "aa"
        self.assertEqual(self.refresh(bad)["body"]["error"], "invalid_grant")
        self.assertEqual(self.refresh(token["refresh_token"])["status"], 200)
        text = json_text(self.store.load()[1])
        self.assertNotIn(token["access_token"], text)
        self.assertNotIn(token["refresh_token"], text)


def json_text(value):
    from folioview_shared.encrypted.jsonutil import canonical_json

    return canonical_json(value).decode()


class ConfidentialClientTests(PolicyFixture):
    CLIENT_METHOD = "client_secret_basic"

    def test_exact_basic_secret_is_required_for_code_refresh_and_revocation(self):
        code = OAuthTests.code(self)
        data = {
            "grant_type": "authorization_code",
            "client_id": "synthetic_native",
            "code": code,
            "redirect_uri": "https://native.example/callback",
            "code_verifier": VERIFIER,
            "resource": self.value["audience"],
        }
        missing = OAuth(self.policy).token(data)
        self.assertEqual(missing["body"]["error"], "invalid_client")
        good = OAuth(self.policy).token(data, self.client_headers())
        self.assertEqual(good["status"], 200, good)
        refresh = {
            "grant_type": "refresh_token",
            "client_id": "synthetic_native",
            "refresh_token": good["body"]["refresh_token"],
            "resource": self.value["audience"],
        }
        self.assertEqual(OAuth(self.policy).token(refresh)["body"]["error"], "invalid_client")
        self.assertEqual(OAuth(self.policy).token(refresh, self.client_headers())["status"], 200)
