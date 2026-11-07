"""Opt-in native account transport: bootstrap scope only, never financial authority.

Authlib still owns code/PKCE/client/refresh/revocation protocol. Separate credential
namespaces and a sliding idle refresh deadline do not change legacy OAuth rules.
"""

import hashlib
import secrets
import time
from dataclasses import dataclass

from authlib.oauth2.rfc6749 import AuthorizationServer
from authlib.oauth2.rfc6749.errors import OAuth2Error
from authlib.oauth2.rfc6750 import BearerTokenGenerator
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
)
from folioview_shared.identity import owner_key

from .oauth import (
    _S256,
    _TOKEN,
    MAX_CONNECTIONS,
    PENDING_SECONDS,
    OAuthFailure,
    OwnerConnectionService,
    _CodeGrant,
    _copy,
    _pending_bucket,
    _put,
    _random,
    _RefreshGrant,
    _Request,
    _Revoke,
    _row,
    _Server,
)
from .oauth_config import Client, digest
from .store import StoreUnavailable, document_path
from .vaults import _current, identifier

PROFILE = "folioview.persistent-account.v1"
SCOPE = "runtime:connect"
REFRESH_IDLE_SECONDS = 180 * 86400
AUTH_TABLES = {
    "hub_oauth_" + part: "hub_native_oauth_" + part
    for part in ("pending", "codes", "access", "refresh", "families")
}


class NativeUnit:
    """Only five Authlib credential tables are remapped; authority tables stay put."""

    def __init__(self, unit):
        self.unit = unit

    def _path(self, path):
        table, identifier = path.split("/", 1)
        return AUTH_TABLES.get(table, table) + "/" + identifier

    def get(self, path):
        return self.unit.get(self._path(path))

    def put(self, path, value):
        return self.unit.put(self._path(path), value)


class NativeClient(Client):
    def get_allowed_scope(self, scope):
        return SCOPE if set((scope or "").split()) == {SCOPE} else ""


@dataclass(frozen=True)
class NativeConfig:
    base: object

    @property
    def issuer(self):
        return self.base.issuer + "/oauth/persistent"

    @property
    def resource(self):
        return self.base.issuer + "/mcp/v3"

    @property
    def consent_url(self):
        return self.base.issuer + "/agent/v3/runtime/account-consent.html"

    @property
    def clients(self):
        return tuple(
            NativeClient(c.client_id, c.redirects, c.method, c.secret_hash)
            for c in self.base.clients
        )


@dataclass(frozen=True)
class NativePrincipal:
    owner_uid: str
    owner_subject: str
    vault_id: str
    connection_id: str
    authorization_id: str
    client_id: str
    expires_at: int


class NativeRevoke(_Revoke):
    def revoke_token(self, token, request):
        s = self.server.service
        # An explicit native disconnect stops that connection's PoP access too.
        # A stale family's token must not disconnect a repaired authorization.
        s._revoke_family(self.server.unit, token.value["familyId"], disconnect=True)


class NativeServer(_Server):
    def __init__(self, service, unit=None):
        AuthorizationServer.__init__(self, scopes_supported=[SCOPE])
        self.service, self.unit = service, unit
        self.register_token_generator(
            "default",
            BearerTokenGenerator(
                lambda **kwargs: _random("na_"),
                refresh_token_generator=lambda **kwargs: _random("nr_"),
                expires_generator=lambda *args, **kwargs: 600,
            ),
        )
        self.register_grant(_CodeGrant, [_S256(required=True)])
        self.register_grant(_RefreshGrant)
        self.register_endpoint(NativeRevoke)

    def save_token(self, token, request):
        now = self.service.now()
        context = request.user
        if not self.service._context_active(self.unit, context) or token.get("scope") != SCOPE:
            raise OAuthFailure("invalid_grant")
        conn = _row(
            self.unit, "hub_oauth_connections", context["ownerSubject"], context["connectionId"]
        )
        if conn["clientId"] != request.client.client_id:
            raise OAuthFailure("invalid_grant")
        family = _row(self.unit, "hub_oauth_families", context["familyId"])
        if family is not None and (
            family["revoked"]
            or family["expiresAt"] <= now
            or family["expiresAt"] - REFRESH_IDLE_SECONDS > now
        ):
            raise OAuthFailure("invalid_grant")
        if family is not None and request.form.get("grant_type") == "authorization_code":
            raise OAuthFailure("invalid_grant")
        if family is not None and family["currentRefreshHash"] != digest(
            request.form.get("refresh_token", "")
        ):
            raise OAuthFailure("invalid_grant")
        deadline = now + REFRESH_IDLE_SECONDS
        context = {**context, "expiresAt": deadline}
        family = {
            **context,
            "revoked": False,
            "issuedCount": 1 if family is None else family["issuedCount"] + 1,
            "currentRefreshHash": digest(token["refresh_token"]),
        }
        record = {
            **context,
            "client_id": request.client.client_id,
            "scope": SCOPE,
            "resource": self.service.config.resource,
            "revoked": False,
            "expiresAt": now + 600,
        }
        for collection, value, row in (
            ("hub_oauth_access", token["access_token"], record),
            (
                "hub_oauth_refresh",
                token["refresh_token"],
                {**record, "expiresAt": deadline, "used": False},
            ),
        ):
            if _row(self.unit, collection, digest(value)) is not None:
                raise StoreUnavailable
            _put(self.unit, collection, (digest(value),), row)
        _put(self.unit, "hub_oauth_families", (context["familyId"],), family)
        conn = _row(
            self.unit, "hub_oauth_connections", context["ownerSubject"], context["connectionId"]
        )
        conn["expiresAt"] = deadline
        conn["transportStatus"] = "active"
        _put(
            self.unit,
            "hub_oauth_connections",
            (context["ownerSubject"], context["connectionId"]),
            conn,
        )
        token["expires_in"] = 600


class NativeTransportService(OwnerConnectionService):
    def __init__(self, store, config, *, clock=time.time):
        super().__init__(store, clock=clock)
        self.config = NativeConfig(config)

    def transact(self, callback):
        return self.store.transact(lambda u: callback(NativeUnit(u)))

    def metadata(self):
        return {
            "issuer": self.config.issuer,
            "authorization_endpoint": self.config.issuer + "/authorize",
            "token_endpoint": self.config.issuer + "/token",
            "revocation_endpoint": self.config.issuer + "/revoke",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_methods_supported": sorted(
                {c.method for c in self.config.clients}
            ),
            "revocation_endpoint_auth_methods_supported": sorted(
                {c.method for c in self.config.clients}
            ),
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": [SCOPE],
            "authorization_response_iss_parameter_supported": True,
        }

    def protected_metadata(self):
        return {
            "resource": self.config.resource,
            "authorization_servers": [self.config.issuer],
            "scopes_supported": [SCOPE],
            "bearer_methods_supported": ["header"],
        }

    def authorize(self, params, browser):
        if (
            type(params) is not dict
            or set(params)
            != {
                "response_type",
                "client_id",
                "redirect_uri",
                "scope",
                "state",
                "resource",
                "code_challenge",
                "code_challenge_method",
            }
            or params.get("resource") != self.config.resource
            or set(params.get("scope", "").split()) != {SCOPE}
            or params.get("code_challenge_method") != "S256"
            or type(params.get("code_challenge")) is not str
            or not _TOKEN.fullmatch(params["code_challenge"])
            or len(params["code_challenge"]) != 43
            or not 16 <= len(params.get("state", "")) <= 1024
            or not _TOKEN.fullmatch(browser or "")
        ):
            raise OAuthFailure("invalid_request")
        params = _copy(params)
        params["scope"] = SCOPE
        try:
            NativeServer(self).get_consent_grant(
                _Request("GET", self.config.issuer + "/authorize", params)
            )
        except OAuth2Error:
            raise OAuthFailure("invalid_request") from None
        ident = _random("native_request_")

        def create(unit):
            bucket = _pending_bucket(unit, self.now())
            if len(bucket["entries"]) >= 64 or bucket["count"] >= 256:
                raise OAuthFailure("temporarily_unavailable", 503)
            bucket["count"] += 1
            bucket["entries"][ident] = {
                "params": params,
                "browserHash": digest(browser),
                "ownerSubject": None,
                "connectionId": _random("connection_"),
                "authorizationId": _random("authorization_"),
                "expiresAt": self.now() + PENDING_SECONDS,
                "status": "pending",
                "callback": None,
            }
            _put(unit, "hub_oauth_pending", ("pool",), bucket)

        self.transact(create)
        return ident

    def _pending(self, unit, uid, request, browser):
        owner = owner_key(uid)
        bucket = _pending_bucket(unit, self.now())
        row = bucket["entries"].get(request)
        if (
            row is None
            or row["expiresAt"] <= self.now()
            or not secrets.compare_digest(row["browserHash"], digest(browser))
            or row["ownerSubject"] not in (None, owner)
        ):
            raise ContractError("not_found")
        return owner, bucket, row

    def pending(self, uid, request, browser):
        def read(unit):
            owner, _, row = self._pending(unit, uid, request, browser)
            v = unit.get(document_path("hub_vaults", owner))
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "requestId": request,
                "clientId": row["params"]["client_id"],
                "scope": SCOPE,
                "status": row["status"],
                "expiresAt": row["expiresAt"],
                "vaultId": None if v is None else v["vaultId"],
                "authority": "account_link_only",
            }

        return self.transact(read)

    def _callback_key(self, browser):
        return hashlib.sha256(b"folioview.native-callback.v1\0" + browser.encode()).digest()

    def approve(self, uid, request, browser, vault):
        identifier(vault)
        family_id = _random("native_family_")
        aad = canonical_json([PROFILE, owner_key(uid), request])

        def write(unit):
            owner, bucket, pending = self._pending(unit, uid, request, browser)
            if pending["status"] == "approved":
                saved = pending["callback"]
                try:
                    return (
                        AESGCM(self._callback_key(browser))
                        .decrypt(
                            b64url_decode(saved["iv"], exact_bytes=12),
                            b64url_decode(saved["ciphertext"], max_bytes=8192),
                            aad,
                        )
                        .decode()
                    )
                except Exception:
                    raise StoreUnavailable from None
            _current(unit, owner, self.now(), vault)
            index = self._owner(unit, uid)
            conn = None
            for connection in index["connectionIds"]:
                candidate = _row(unit, "hub_oauth_connections", owner, connection)
                if candidate is None:
                    raise StoreUnavailable
                if (
                    candidate.get("transportKind") == "persistent_runtime"
                    and candidate["status"] == "active"
                    and candidate["clientId"] == pending["params"]["client_id"]
                    and candidate["vaultId"] == vault
                ):
                    if conn is not None:
                        raise StoreUnavailable
                    conn = candidate
            now = self.now()
            if conn is None:
                if len(index["connectionIds"]) >= MAX_CONNECTIONS:
                    raise ContractError("version_conflict")
                conn = {
                    "ownerSubject": owner,
                    "vaultId": vault,
                    "provider": "muse",
                    "clientId": pending["params"]["client_id"],
                    "connectionId": pending["connectionId"],
                    "authorizationCount": 0,
                    "approvedScopes": [SCOPE],
                    "grants": {},
                    "status": "active",
                    "transportKind": "persistent_runtime",
                }
                index["connectionIds"].append(conn["connectionId"])
            conn.update(
                transportStatus="awaiting_exchange",
                authorizationId=pending["authorizationId"],
                authorizationCount=conn["authorizationCount"] + 1,
                authorizedAt=now,
                expiresAt=now + REFRESH_IDLE_SECONDS,
            )
            context = {
                "ownerSubject": owner,
                "vaultId": vault,
                "connectionId": conn["connectionId"],
                "authorizationId": conn["authorizationId"],
                "grantRefs": {},
                "expiresAt": now + REFRESH_IDLE_SECONDS,
                "familyId": family_id,
            }
            server = NativeServer(self, unit)
            authorization_request = _Request(
                "GET", self.config.issuer + "/authorize", pending["params"]
            )
            status, _, headers = server.create_authorization_response(
                authorization_request,
                grant_user=context,
                grant=server.get_consent_grant(authorization_request),
            )
            if status != 302 or "Location" not in headers:
                raise OAuthFailure("invalid_request")
            callback = headers["Location"]
            # A transaction retry may mint a different uncommitted auth code;
            # use a fresh GCM nonce for each candidate callback encryption.
            iv = secrets.token_bytes(12)
            pending.update(
                status="approved",
                ownerSubject=owner,
                connectionId=conn["connectionId"],
                callback={
                    "iv": b64url_encode(iv),
                    "ciphertext": b64url_encode(
                        AESGCM(self._callback_key(browser)).encrypt(iv, callback.encode(), aad)
                    ),
                },
            )
            _put(unit, "hub_oauth_pending", ("pool",), bucket)
            _put(unit, "hub_oauth_connections", (owner, conn["connectionId"]), conn)
            _put(unit, "hub_oauth_owners", (owner,), index)
            return callback

        return self.transact(write)

    def _context_active(self, unit, context):
        conn = _row(unit, "hub_oauth_connections", context["ownerSubject"], context["connectionId"])
        return bool(
            conn
            and conn.get("transportKind") == "persistent_runtime"
            and conn.get("ownerSubject") == context["ownerSubject"]
            and conn.get("connectionId") == context["connectionId"]
            and conn.get("provider") == "muse"
            and conn["status"] == "active"
            and conn["vaultId"] == context["vaultId"]
            and conn["authorizationId"] == context["authorizationId"]
            and conn["clientId"] in {c.client_id for c in self.config.clients}
            and conn["approvedScopes"] == [SCOPE]
            and conn["grants"] == {}
        )

    def _token_active(self, unit, row):
        family = _row(unit, "hub_oauth_families", row["familyId"])
        return bool(
            not row["revoked"]
            and row["expiresAt"] > self.now()
            and row["resource"] == self.config.resource
            and row["scope"] == SCOPE
            and family
            and not family["revoked"]
            and family["expiresAt"] > self.now()
            and all(
                family[k] == row[k]
                for k in (
                    "ownerSubject",
                    "vaultId",
                    "connectionId",
                    "authorizationId",
                    "grantRefs",
                    "familyId",
                )
            )
            and self._context_active(unit, row)
        )

    def _revoke_family(self, unit, family_id, *, disconnect=False):
        family = _row(unit, "hub_oauth_families", family_id)
        if family is None:
            return
        family["revoked"] = True
        _put(unit, "hub_oauth_families", (family_id,), family)
        if self._context_active(unit, family):
            conn = _row(
                unit, "hub_oauth_connections", family["ownerSubject"], family["connectionId"]
            )
            if disconnect:
                conn["status"] = "revoked"
            conn["transportStatus"] = "revoked" if disconnect else "reauth_required"
            _put(
                unit,
                "hub_oauth_connections",
                (family["ownerSubject"], family["connectionId"]),
                conn,
            )

    def protocol(self, form, headers, endpoint):
        if endpoint not in {"token", "revoke"} or type(form) is not dict:
            raise OAuthFailure("invalid_request")
        if endpoint == "token":
            if form.get("resource") != self.config.resource:
                raise OAuthFailure("invalid_target")
            required = {"grant_type", "resource"}
            if form.get("grant_type") == "authorization_code":
                required |= {"code", "redirect_uri", "code_verifier"}
                optional = {"client_id"}
            elif form.get("grant_type") == "refresh_token":
                required |= {"refresh_token"}
                optional = {"client_id", "scope"}
            else:
                raise OAuthFailure("unsupported_grant_type")
            if not required <= set(form) or set(form) - required - optional:
                raise OAuthFailure("invalid_request")
            if "scope" in form and form["scope"] != SCOPE:
                raise OAuthFailure("invalid_scope")
        else:
            if "token" not in form or set(form) - {
                "client_id",
                "token",
                "token_type_hint",
                "resource",
            }:
                raise OAuthFailure("invalid_request")
            if "resource" in form and form["resource"] != self.config.resource:
                raise OAuthFailure("invalid_target")

        def run(unit):
            server = NativeServer(self, unit)
            request = _Request("POST", self.config.issuer + "/" + endpoint, _copy(form), headers)
            return (
                server.create_token_response(request)
                if endpoint == "token"
                else server.create_endpoint_response("revocation", request)
            )

        return self.transact(run)

    def principal(self, unit, token):
        if type(token) is not str or _TOKEN.fullmatch(token) is None:
            raise OAuthFailure("invalid_token", 401)
        row = _row(unit, "hub_oauth_access", digest(token))
        if row is None or not self._token_active(unit, row):
            raise OAuthFailure("invalid_token", 401)
        owner = unit.get(document_path("hub_oauth_owners", row["ownerSubject"]))
        if owner is None or owner_key(owner["ownerUid"]) != row["ownerSubject"]:
            raise StoreUnavailable
        conn = _row(unit, "hub_oauth_connections", row["ownerSubject"], row["connectionId"])
        if row["client_id"] != conn["clientId"]:
            raise OAuthFailure("invalid_token", 401)
        return NativePrincipal(
            owner["ownerUid"],
            row["ownerSubject"],
            row["vaultId"],
            row["connectionId"],
            row["authorizationId"],
            row["client_id"],
            row["expiresAt"],
        )

    def authenticate(self, token):
        return self.transact(lambda u: self.principal(u, token))


class NativeConnectionOwnerService(OwnerConnectionService):
    """Native owner history/disconnect does not depend on issuance configuration."""

    def _view(self, conn):
        for field in ("connectionId", "clientId", "vaultId"):
            identifier(conn[field])
        if conn["status"] not in {"active", "revoked"} or type(conn["expiresAt"]) is not int:
            raise StoreUnavailable
        account = "connected"
        if conn["status"] == "revoked":
            account = "revoked"
        elif conn["expiresAt"] <= self.now() or conn.get("transportStatus") == "reauth_required":
            account = "relogin_required"
        elif conn.get("transportStatus") == "awaiting_exchange":
            account = "connecting"
        return {
            "connectionId": conn["connectionId"],
            "clientId": conn["clientId"],
            "vaultId": conn["vaultId"],
            "provider": "muse",
            "status": conn["status"],
            "accountState": account,
            "linkedAt": conn["authorizedAt"],
        }

    def native_connections(self, uid):
        owner = owner_key(uid)

        def read(unit):
            index = self._owner(unit, uid)
            rows = []
            for ident in index["connectionIds"]:
                conn = _row(unit, "hub_oauth_connections", owner, ident)
                if conn is None or conn["ownerSubject"] != owner:
                    raise StoreUnavailable
                if conn.get("transportKind") == "persistent_runtime":
                    rows.append(self._view(conn))
            return {"contractVersion": CONTRACT_VERSION, "profile": PROFILE, "connections": rows}

        return self.store.transact(read)

    def native_disconnect(self, uid, connection):
        identifier(connection)
        owner = owner_key(uid)

        def write(unit):
            self._owner(unit, uid)
            conn = _row(unit, "hub_oauth_connections", owner, connection)
            if (
                conn is None
                or conn.get("ownerSubject") != owner
                or conn.get("transportKind") != "persistent_runtime"
            ):
                raise ContractError("not_found")
            conn.update(status="revoked", transportStatus="revoked")
            _put(unit, "hub_oauth_connections", (owner, connection), conn)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "connection": self._view(conn),
            }

        return self.store.transact(write)
