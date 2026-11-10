"""Authlib code/S256/refresh/revocation over the live policy CAS state.

Refresh handles are signed opaque tickets: authenticated old generations can
revoke a replayed family without retaining an unbounded list of spent secrets.
"""

import logging
from dataclasses import dataclass
from typing import ClassVar
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from authlib.oauth2.rfc6749 import AuthorizationServer, OAuth2Request
from authlib.oauth2.rfc6749.grants import AuthorizationCodeGrant, RefreshTokenGrant
from authlib.oauth2.rfc6749.models import AuthorizationCodeMixin, TokenMixin
from authlib.oauth2.rfc6749.requests import BasicOAuth2Payload
from authlib.oauth2.rfc6750 import BearerTokenGenerator
from authlib.oauth2.rfc7009 import RevocationEndpoint
from authlib.oauth2.rfc7636 import CodeChallenge

from folioview_shared.encrypted.crypto import verify_jws
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)

from .contracts import SCOPES, closed, copy, deny, digest, random, root_control, token_hash

logging.getLogger("authlib.oauth2").setLevel(logging.WARNING)


class Request(OAuth2Request):
    def __init__(self, method, uri, data, headers=None):
        super().__init__(method, uri, headers=headers)
        self.payload = BasicOAuth2Payload(data)

    @property
    def args(self):
        return self.payload.data if self.method == "GET" else {}

    @property
    def form(self):
        return self.payload.data if self.method == "POST" else {}


@dataclass
class Code(AuthorizationCodeMixin):
    value: dict

    def __getattr__(self, k):
        return self.value[k]

    def get_redirect_uri(self):
        return self.value["redirect_uri"]

    def get_scope(self):
        return self.value["scope"]


@dataclass
class Token(TokenMixin):
    value: dict

    def get_scope(self):
        return self.value["scope"]

    def check_client(self, client):
        return self.value["client_id"] == client.client_id


class Server(AuthorizationServer):
    def __init__(self, policy, state):
        super().__init__(scopes_supported=sorted(SCOPES))
        self.policy, self.state = policy, state
        self.register_token_generator(
            "default",
            BearerTokenGenerator(
                lambda **kw: random(),
                refresh_token_generator=self.refresh_ticket,
                expires_generator=lambda *a, **kw: 300,
            ),
        )
        self.register_grant(CodeGrant, [S256(required=True)])
        self.register_grant(RefreshGrant)
        self.register_endpoint(Revoke)

    def query_client(self, client_id):
        return self.policy.config.client(client_id)

    def create_oauth2_request(self, request):
        return request

    def send_signal(self, name, **kwargs):
        pass

    def handle_response(self, status, body, headers):
        headers = dict(headers)
        headers.update(
            {"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer"}
        )
        if "Location" in headers:
            u = urlsplit(headers["Location"])
            params = parse_qsl(u.query, keep_blank_values=True) + [
                ("iss", self.policy.config.issuer)
            ]
            headers["Location"] = urlunsplit((u.scheme, u.netloc, u.path, urlencode(params), ""))
        if isinstance(body, dict) and "error" in body:
            body = {"error": body["error"], "error_description": "OAuth request rejected."}
        return {"status": status, "body": body or "", "headers": headers}

    def refresh_ticket(self, *, client, user, scope, **kw):
        family = self.state["families"].get(user["familyId"])
        rotation = 1 if family is None else family["rotation"] + 1
        payload = {
            "profile": "folioview.policy-refresh.v1",
            "issuer": self.policy.config.issuer,
            "audience": self.policy.config.public["audience"],
            "client_id": client.client_id,
            "familyId": user["familyId"],
            "connectionId": user["connectionId"],
            "rotation": rotation,
            "bindingDigest": user["bindingDigest"],
            "approvalFingerprint": user["approvalFingerprint"],
            "expiresAt": user["expiresAt"],
            "scope": scope,
            "nonce": random(),
        }
        return "prf_" + b64url_encode(canonical_json(self.policy.signer.sign(payload)))

    def save_token(self, token, request):
        p, state = self.policy, self.state
        user = request.user
        conn = p.connection(state, user["connectionId"], active=True)
        family = state["families"].get(user["familyId"])
        if family is None:
            if len(state["families"]) >= 64:
                deny("version_conflict")
            family = {
                **copy(user),
                "client_id": request.client.client_id,
                "scope": token["scope"],
                "rotation": 0,
                "revoked": False,
                "refreshHash": None,
            }
        if (
            family["revoked"]
            or family["expiresAt"] <= p.now()
            or family["rotation"] >= 9007199254740990
        ):
            deny()
        if family["bindingDigest"] != digest(conn["binding"]):
            deny()
        state["access"] = {k: v for k, v in state["access"].items() if v["expiresAt"] > p.now()}
        if len(state["access"]) >= 128:
            deny("version_conflict")
        family["rotation"] += 1
        family["scope"] = token["scope"]
        family["refreshHash"] = token_hash(token["refresh_token"])
        expires = min(p.now() + 300, family["expiresAt"])
        state["access"][token_hash(token["access_token"])] = {
            "familyId": user["familyId"],
            "expiresAt": expires,
            "rotation": family["rotation"],
            "client_id": request.client.client_id,
            "scope": token["scope"],
        }
        state["families"][user["familyId"]] = family
        token["expires_in"] = expires - p.now()

    def refresh_record(self, value, client_id=None, *, replay=True):
        try:
            if type(value) is not str or not value.startswith("prf_"):
                return None
            signed = strict_json_loads(b64url_decode(value[4:], max_bytes=12288), max_bytes=12288)
            record = verify_jws(signed, self.policy.config.policy_jwk, typ="fv-control+jws")
            closed(
                record,
                {
                    "profile",
                    "issuer",
                    "audience",
                    "client_id",
                    "familyId",
                    "connectionId",
                    "rotation",
                    "bindingDigest",
                    "approvalFingerprint",
                    "expiresAt",
                    "scope",
                    "nonce",
                },
                maximum=8192,
            )
            if (
                record["profile"] != "folioview.policy-refresh.v1"
                or record["issuer"] != self.policy.config.issuer
                or record["audience"] != self.policy.config.public["audience"]
                or (client_id is not None and record["client_id"] != client_id)
            ):
                return None
            family = self.state["families"].get(record["familyId"])
            if family is None or family["client_id"] != record["client_id"]:
                return None
            if (
                type(record["rotation"]) is not int
                or record["bindingDigest"] != family["bindingDigest"]
                or record["approvalFingerprint"] != family["approvalFingerprint"]
            ):
                return None
            if record["rotation"] < family["rotation"] and replay:
                revoke_family(self.policy, self.state, record["familyId"])
                return None
            if (
                family["revoked"]
                or family["expiresAt"] <= self.policy.now()
                or record["rotation"] > family["rotation"]
                or (
                    replay
                    and (
                        record["rotation"] != family["rotation"]
                        or token_hash(value) != family["refreshHash"]
                    )
                )
            ):
                return None
            self.policy.connection(self.state, family["connectionId"], active=replay)
            return family
        except Exception:
            return None


class CodeGrant(AuthorizationCodeGrant):
    TOKEN_ENDPOINT_AUTH_METHODS: ClassVar[list[str]] = ["none", "client_secret_basic"]

    def save_authorization_code(self, code, request):
        data = request.payload.data
        s = self.server
        s.state["codes"][token_hash(code)] = {
            "client_id": request.client.client_id,
            "redirect_uri": data["redirect_uri"],
            "scope": data["scope"],
            "code_challenge": data["code_challenge"],
            "code_challenge_method": "S256",
            "context": copy(request.user),
            "expiresAt": s.policy.now() + 300,
            "used": False,
        }

    def query_authorization_code(self, code, client):
        s = self.server
        row = s.state["codes"].get(token_hash(code))
        if row is None or row["client_id"] != client.client_id:
            return None
        if row["used"]:
            revoke_family(s.policy, s.state, row["context"]["familyId"])
            return None
        if (
            row["expiresAt"] <= s.policy.now()
            or self.request.form.get("resource") != s.policy.config.public["audience"]
        ):
            return None
        conn = s.policy.connection(s.state, row["context"]["connectionId"], active=True)
        if row["context"]["bindingDigest"] != digest(conn["binding"]):
            return None
        return Code({**row, "codeHash": token_hash(code)})

    def delete_authorization_code(self, code):
        self.server.state["codes"][code.codeHash]["used"] = True

    def authenticate_user(self, code):
        return code.context


class RefreshGrant(RefreshTokenGrant):
    TOKEN_ENDPOINT_AUTH_METHODS: ClassVar[list[str]] = ["none", "client_secret_basic"]
    INCLUDE_NEW_REFRESH_TOKEN = True

    def authenticate_refresh_token(self, token):
        s = self.server
        family = s.refresh_record(token, self.request.client.client_id)
        if (
            family is None
            or self.request.form.get("resource") != s.policy.config.public["audience"]
        ):
            return None
        return Token(copy(family))

    def authenticate_user(self, record):
        return {
            k: record.value[k]
            for k in (
                "familyId",
                "connectionId",
                "bindingDigest",
                "approvalFingerprint",
                "expiresAt",
            )
        }

    def revoke_old_credential(self, record):
        # save_token already advanced the signed generation atomically.
        pass


class Revoke(RevocationEndpoint):
    CLIENT_AUTH_METHODS: ClassVar[list[str]] = ["none", "client_secret_basic"]

    def query_token(self, value, token_type_hint):
        s = self.server
        row = s.state["access"].get(token_hash(value))
        if row is not None:
            return Token({**s.state["families"][row["familyId"]], "familyId": row["familyId"]})
        record = s.refresh_record(value, replay=False)
        return None if record is None else Token(copy(record))

    def revoke_token(self, token, request):
        revoke_family(self.server.policy, self.server.state, token.value["familyId"])


class S256(CodeChallenge):
    SUPPORTED_CODE_CHALLENGE_METHOD: ClassVar[list[str]] = ["S256"]


def revoke_family(policy, state, family_id):
    family = state["families"].get(family_id)
    if family is not None and not family["revoked"]:
        family["revoked"] = True
        conn = policy.connection(state, family["connectionId"])
        policy.bump(conn)
        conn["bootstrapUntil"] = 0
        policy.audit(state, "oauth_revoke", family["connectionId"], {"familyId": family_id})


def authenticate_access(policy, state, access, conn, purpose):
    record = state["access"].get(token_hash(access))
    if record is None or record["expiresAt"] <= policy.now():
        deny()
    family = state["families"].get(record["familyId"])
    if (
        family is None
        or family["revoked"]
        or family["expiresAt"] <= policy.now()
        or family["rotation"] != record["rotation"]
        or family["bindingDigest"] != digest(conn["binding"])
        or family["connectionId"] != conn["binding"]["connectionId"]
        or (purpose is not None and "executor:" + purpose not in record["scope"].split())
    ):
        deny("insufficient_scope")


class OAuth:
    def __init__(self, policy):
        self.policy = policy

    def request(self, method, path, data, headers=None):
        if type(data) is not dict or any(
            type(v) is not str or len(v) > 16384 for v in data.values()
        ):
            deny("malformed_request")
        return Request(method, self.policy.config.issuer + path, data, headers)

    def begin(self, data):
        self.policy.active()
        closed(
            data,
            {
                "response_type",
                "client_id",
                "redirect_uri",
                "scope",
                "resource",
                "state",
                "code_challenge",
                "code_challenge_method",
            },
            maximum=8192,
        )
        if (
            data["resource"] != self.policy.config.public["audience"]
            or not data["scope"]
            or set(data["scope"].split()) - SCOPES
            or len(set(data["scope"].split())) != len(data["scope"].split())
            or not 22 <= len(data["state"]) <= 128
            or data["code_challenge_method"] != "S256"
        ):
            deny("malformed_request")
        request = self.request("GET", "/oauth/authorize", data)
        Server(self.policy, {}).get_consent_grant(request)
        cookie = random()

        def save(state):
            self.policy.state(state)
            state["pending"] = {
                k: v for k, v in state["pending"].items() if v["expiresAt"] > self.policy.now()
            }
            if len(state["pending"]) >= 16:
                deny("version_conflict")
            pending = random("pauth_")
            state["pending"][pending] = {
                "data": copy(data),
                "cookieHash": token_hash(cookie),
                "expiresAt": self.policy.now() + 300,
                "used": False,
            }
            return {
                "pendingId": pending,
                "consentUrl": self.policy.config.public["consentUrl"]
                + "?"
                + urlencode({"request": pending}),
            }

        result = self.policy.store.transact(save)
        return result, cookie

    def pending(self, uid, pending, cookie):
        self.policy.owner(uid)

        def read(state):
            row = state["pending"].get(pending)
            if (
                row is None
                or row["cookieHash"] != token_hash(cookie)
                or row["expiresAt"] <= self.policy.now()
                or row["used"]
            ):
                deny()
            return {
                "pendingId": pending,
                "requestDigest": digest(row["data"]),
                "clientId": row["data"]["client_id"],
                "resource": row["data"]["resource"],
                "scope": row["data"]["scope"],
                "expiresAt": row["expiresAt"],
            }

        return self.policy.store.transact(read)

    def approve(self, uid, pending, cookie, connection, command):
        from folioview_shared.encrypted.crypto import signing_input_fingerprint

        self.policy.owner(uid)
        self.policy.active()

        def apply(state):
            c = self.policy.connection(state, connection, active=True)
            row = state["pending"].get(pending)
            if (
                row is None
                or row["cookieHash"] != token_hash(cookie)
                or row["expiresAt"] <= self.policy.now()
                or row["used"]
                or row["data"]["client_id"] != c["binding"]["clientId"]
            ):
                deny()
            root_control(
                command,
                self.policy.config,
                action="oauth_approve",
                connection=connection,
                version=c["stateVersion"],
                head=c["stateHead"],
                parameters={"pendingId": pending, "requestDigest": digest(row["data"])},
                now=self.policy.now(),
            )
            state["codes"] = {
                k: v for k, v in state["codes"].items() if v["expiresAt"] > self.policy.now()
            }
            if len(state["codes"]) >= 64:
                deny("version_conflict")
            from folioview_shared.encrypted.crypto import _signed_parts

            _, approval = _signed_parts(c["approval"])
            context = {
                "connectionId": connection,
                "familyId": random("pfam_"),
                "bindingDigest": digest(c["binding"]),
                "approvalFingerprint": signing_input_fingerprint(c["approval"]),
                "expiresAt": min(self.policy.now() + 30 * 86400, approval["expiresAt"]),
            }
            server = Server(self.policy, state)
            oauth_request = self.request("GET", "/oauth/authorize", row["data"])
            response = server.create_authorization_response(
                oauth_request, grant_user=context, grant=server.get_consent_grant(oauth_request)
            )
            if response["status"] in {302, 303} and "error=" not in response["headers"].get(
                "Location", ""
            ):
                row["used"] = True
                self.policy.bump(c)
                self.policy.audit(state, "oauth_approve", connection, command)
            return response

        return self.policy.store.transact(apply)

    def token(self, data, headers=None, *, revoke=False):
        if not revoke:
            self.policy.active()
        allowed = (
            {"token", "token_type_hint", "client_id"}
            if revoke
            else {
                "grant_type",
                "code",
                "redirect_uri",
                "client_id",
                "code_verifier",
                "resource",
                "refresh_token",
                "scope",
            }
        )
        if not set(data) <= allowed:
            deny("malformed_request")

        def apply(state):
            self.policy.state(state)
            server = Server(self.policy, state)
            request = self.request(
                "POST", "/oauth/revoke" if revoke else "/oauth/token", data, headers
            )
            if revoke:
                return server.create_endpoint_response("revocation", request)
            return server.create_token_response(request)

        return self.policy.store.transact(apply)
