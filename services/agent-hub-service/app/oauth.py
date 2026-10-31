"""Durable OAuth consent and per-task authority; never decrypts owner content.

Authlib performs the protocol checks. Each code exchange/refresh/revocation runs
inside one storage transaction. A fresh server adapter is local to that transaction,
so concurrent requests cannot share request state or a storage unit.
"""

import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import ClassVar
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from authlib.oauth2.rfc6749 import AuthorizationServer, OAuth2Request
from authlib.oauth2.rfc6749.errors import OAuth2Error
from authlib.oauth2.rfc6749.grants import AuthorizationCodeGrant, RefreshTokenGrant
from authlib.oauth2.rfc6749.models import AuthorizationCodeMixin, TokenMixin
from authlib.oauth2.rfc6749.requests import BasicOAuth2Payload
from authlib.oauth2.rfc6750 import BearerTokenGenerator
from authlib.oauth2.rfc7009 import RevocationEndpoint
from authlib.oauth2.rfc7636 import CodeChallenge

from folioview_shared.encrypted.authority import verify_agent_grant
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.identity import owner_key

from .fences import require_current_bindings
from .oauth_config import SCOPES, OAuthConfig, digest
from .store import StoreUnavailable, document_path, get_store
from .tasks import TaskService, _head, _index
from .vaults import _current, identifier


@dataclass(frozen=True)
class AgentPrincipal:
    owner_uid: str
    owner_subject: str
    connection_id: str
    authorization_id: str
    client_id: str
    scopes: tuple[str, ...]
    task_ids: tuple[str, ...]
    expires_at: int
    grant: object = None


logging.getLogger("authlib.oauth2").setLevel(logging.WARNING)
PENDING_SECONDS = 600
FAMILY_SECONDS = 30 * 86400
MAX_CONNECTIONS = 32
MAX_AUTHORIZATIONS = 32
MAX_ROTATIONS = 8192
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43,128}\Z")


class OAuthFailure(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status
        super().__init__("OAuth request rejected.")


def _copy(value):
    return strict_json_loads(canonical_json(value))


def _random(prefix=""):
    return prefix + secrets.token_urlsafe(32)


def _row(unit, collection, *parts):
    value = unit.get(document_path(collection, *parts))
    if value is not None and type(value) is not dict:
        raise StoreUnavailable
    return value


def _put(unit, collection, parts, value):
    unit.put(document_path(collection, *parts), value)


def _pending_bucket(unit, now):
    value = _row(unit, "hub_oauth_pending", "pool")
    if value is None:
        value = {"window": now // 3600, "count": 0, "entries": {}}
    if set(value) != {"window", "count", "entries"} or type(value["entries"]) is not dict:
        raise StoreUnavailable
    if len(value["entries"]) > 64 or type(value["count"]) is not int:
        raise StoreUnavailable
    if value["window"] != now // 3600:
        value["window"], value["count"] = now // 3600, 0
    value["entries"] = {k: v for k, v in value["entries"].items() if v["expiresAt"] > now}
    return value


class _Request(OAuth2Request):
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
class _Code(AuthorizationCodeMixin):
    value: dict

    def __getattr__(self, name):
        return self.value[name]

    def get_redirect_uri(self):
        return self.value["redirect_uri"]

    def get_scope(self):
        return self.value["scope"]

    def check_client(self, client):
        return self.value["client_id"] == client.client_id


@dataclass
class _Token(TokenMixin):
    value: dict
    kind: str
    token_hash: str

    def get_scope(self):
        return self.value["scope"]

    def check_client(self, client):
        return self.value["client_id"] == client.client_id


class _Server(AuthorizationServer):
    def __init__(self, service, unit=None):
        super().__init__(scopes_supported=sorted(SCOPES))
        self.service, self.unit = service, unit
        self.register_token_generator(
            "default",
            BearerTokenGenerator(
                lambda **kwargs: _random(),
                refresh_token_generator=lambda **kwargs: _random(),
                expires_generator=lambda *args, **kwargs: 600,
            ),
        )
        self.register_grant(_CodeGrant, [_S256(required=True)])
        self.register_grant(_RefreshGrant)
        self.register_endpoint(_Revoke)

    def query_client(self, client_id):
        return next((c for c in self.service.config.clients if c.client_id == client_id), None)

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
            query = parse_qsl(u.query, keep_blank_values=True) + [
                ("iss", self.service.config.issuer)
            ]
            headers["Location"] = urlunsplit((u.scheme, u.netloc, u.path, urlencode(query), ""))
        if isinstance(body, dict) and "error" in body:
            body = {"error": body["error"], "error_description": "OAuth request rejected."}
        return status, body or "", headers

    def save_token(self, token, request):
        now, unit = self.service.now(), self.unit
        context = request.user
        family = _row(unit, "hub_oauth_families", context["familyId"])
        if family is None:
            family = {**context, "revoked": False, "issuedCount": 0}
        if (
            family["revoked"]
            or family["issuedCount"] >= MAX_ROTATIONS
            or family["expiresAt"] <= now
        ):
            raise OAuthFailure("invalid_grant")
        family["issuedCount"] += 1
        scope = token["scope"]
        record = {
            **context,
            "client_id": request.client.client_id,
            "scope": scope,
            "resource": self.service.config.resource,
            "revoked": False,
            "expiresAt": min(now + 600, context["expiresAt"]),
        }
        _put(unit, "hub_oauth_access", (digest(token["access_token"]),), record)
        if "refresh_token" in token:
            _put(
                unit,
                "hub_oauth_refresh",
                (digest(token["refresh_token"]),),
                {
                    **record,
                    "expiresAt": context["expiresAt"],
                    "used": False,
                },
            )
        _put(unit, "hub_oauth_families", (context["familyId"],), family)
        token["expires_in"] = record["expiresAt"] - now


class _CodeGrant(AuthorizationCodeGrant):
    TOKEN_ENDPOINT_AUTH_METHODS: ClassVar[list[str]] = ["none", "client_secret_basic"]

    def save_authorization_code(self, code, request):
        data, server = request.payload.data, self.server
        _put(
            server.unit,
            "hub_oauth_codes",
            (digest(code),),
            {
                "client_id": request.client.client_id,
                "redirect_uri": data["redirect_uri"],
                "scope": data["scope"],
                "code_challenge": data["code_challenge"],
                "code_challenge_method": "S256",
                "context": request.user,
                "expiresAt": server.service.now() + 120,
                "used": False,
                "resource": server.service.config.resource,
            },
        )

    def query_authorization_code(self, code, client):
        server = self.server
        row = _row(server.unit, "hub_oauth_codes", digest(code))
        if not row or row["client_id"] != client.client_id:
            return None
        if row["used"]:
            server.service._revoke_family(server.unit, row["context"]["familyId"])
            return None
        if row["expiresAt"] <= server.service.now() or row["resource"] != self.request.form.get(
            "resource"
        ):
            return None
        if not server.service._context_active(server.unit, row["context"]):
            return None
        return _Code({**row, "codeHash": digest(code)})

    def delete_authorization_code(self, record):
        row = {k: v for k, v in record.value.items() if k != "codeHash"}
        row["used"] = True
        _put(self.server.unit, "hub_oauth_codes", (record.codeHash,), row)

    def authenticate_user(self, record):
        return record.context


class _RefreshGrant(RefreshTokenGrant):
    TOKEN_ENDPOINT_AUTH_METHODS: ClassVar[list[str]] = ["none", "client_secret_basic"]
    INCLUDE_NEW_REFRESH_TOKEN = True

    def authenticate_refresh_token(self, value):
        s = self.server
        row = _row(s.unit, "hub_oauth_refresh", digest(value))
        if not row or row["client_id"] != self.request.client.client_id:
            return None
        if row["used"]:
            s.service._revoke_family(s.unit, row["familyId"])
            return None
        if not s.service._token_active(s.unit, row) or row["resource"] != self.request.form.get(
            "resource"
        ):
            return None
        return _Token(row, "refresh", digest(value))

    def authenticate_user(self, record):
        return {
            k: record.value[k]
            for k in (
                "ownerSubject",
                "vaultId",
                "connectionId",
                "authorizationId",
                "grantRefs",
                "expiresAt",
                "familyId",
            )
        }

    def revoke_old_credential(self, record):
        record.value["used"] = True
        _put(self.server.unit, "hub_oauth_refresh", (record.token_hash,), record.value)


class _Revoke(RevocationEndpoint):
    CLIENT_AUTH_METHODS: ClassVar[list[str]] = ["none", "client_secret_basic"]

    def query_token(self, token_string, token_type_hint):
        for kind in ("access", "refresh"):
            row = _row(self.server.unit, "hub_oauth_" + kind, digest(token_string))
            if row:
                return _Token(row, kind, digest(token_string))
        return None

    def revoke_token(self, token, request):
        if token.kind == "refresh":
            self.server.service._revoke_family(self.server.unit, token.value["familyId"])
        else:
            token.value["revoked"] = True
            _put(self.server.unit, "hub_oauth_access", (token.token_hash,), token.value)


class _S256(CodeChallenge):
    SUPPORTED_CODE_CHALLENGE_METHOD: ClassVar[list[str]] = ["S256"]


class OwnerConnectionService:
    """Owner history and revocation remain available while issuance is disabled."""

    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def now(self):
        value = self.clock()
        if type(value) not in (int, float) or not 0 <= value <= 253402300799:
            raise StoreUnavailable
        return int(value)

    def _owner(self, unit, uid):
        owner = owner_key(uid)
        record = _row(unit, "hub_oauth_owners", owner)
        if record is None:
            return {"ownerSubject": owner, "ownerUid": uid, "connectionIds": [], "attempts": {}}
        if (
            set(record) != {"ownerSubject", "ownerUid", "connectionIds", "attempts"}
            or record["ownerSubject"] != owner
            or record["ownerUid"] != uid
            or type(record["connectionIds"]) is not list
            or len(record["connectionIds"]) > MAX_CONNECTIONS
            or type(record["attempts"]) is not dict
            or len(record["attempts"]) > 64
        ):
            raise StoreUnavailable
        return record

    def _connection_view(self, conn):
        return {
            "connectionId": conn["connectionId"],
            "provider": "muse",
            "clientId": conn["clientId"],
            "authorizationId": conn["authorizationId"],
            "status": "expired"
            if conn["status"] == "active" and conn["expiresAt"] <= self.now()
            else conn["status"],
            "authorizedAt": conn["authorizedAt"],
            "expiresAt": conn["expiresAt"],
            "approvedScopes": conn["approvedScopes"],
            "grants": [
                {
                    k: g[k]
                    for k in (
                        "taskId",
                        "taskVersion",
                        "executionEpoch",
                        "resourceBindings",
                        "grantId",
                        "grantEpoch",
                        "status",
                        "authorizedAt",
                        "readObserved",
                        "resultSaved",
                    )
                }
                | {"signedGrantPresent": g["keyGrantJson"] is not None}
                for g in conn["grants"].values()
            ],
        }

    def connections(self, uid):
        owner = owner_key(uid)

        def run(unit):
            record = self._owner(unit, uid)
            rows, connections = [], {}
            for ident in record["connectionIds"]:
                row = _row(unit, "hub_oauth_connections", owner, ident)
                if row is None or row["ownerSubject"] != owner:
                    raise StoreUnavailable
                connections[ident] = row
                rows.append(self._connection_view(row))
            attempts = []
            for saved in record["attempts"].values():
                value = _copy(saved)
                conn = connections.get(value["connectionId"])
                if value["status"] == "pending" and value["expiresAt"] <= self.now():
                    value["status"] = "expired"
                elif value["status"] == "authorized":
                    if conn is None:
                        raise StoreUnavailable
                    if conn["authorizationId"] != value["authorizationId"]:
                        value["status"] = "superseded"
                    elif conn["status"] == "revoked":
                        value["status"] = "revoked"
                    elif value["expiresAt"] <= self.now():
                        value["status"] = "expired"
                attempts.append(value)
            return {
                "contractVersion": CONTRACT_VERSION,
                "items": rows,
                "authorizationAttempts": attempts,
            }

        return self.store.transact(run)

    def revoke_connection(self, uid, connection_id):
        return self._revoke_owner(uid, connection_id)

    def revoke_grant(self, uid, connection_id, grant_id):
        identifier(grant_id)
        return self._revoke_owner(uid, connection_id, grant_id)

    def _revoke_owner(self, uid, connection_id, grant_id=None):
        identifier(connection_id)
        owner = owner_key(uid)

        def run(unit):
            conn = _row(unit, "hub_oauth_connections", owner, connection_id)
            if conn is None or conn["ownerSubject"] != owner:
                raise ContractError("not_found")
            if grant_id is None:
                conn["status"] = "revoked"
                for grant in conn["grants"].values():
                    grant["status"] = "revoked"
            else:
                grant = next((g for g in conn["grants"].values() if g["grantId"] == grant_id), None)
                if grant is None:
                    raise ContractError("not_found")
                grant["status"] = "revoked"
            _put(unit, "hub_oauth_connections", (owner, connection_id), conn)
            return {"contractVersion": CONTRACT_VERSION, "connection": self._connection_view(conn)}

        return self.store.transact(run)


class OAuthService(OwnerConnectionService):
    def __init__(self, store, config, catalogue=None, *, clock=time.time):
        super().__init__(store, clock=clock)
        self.config, self.catalogue = config, catalogue

    def metadata(self):
        return {
            "issuer": self.config.issuer,
            "authorization_endpoint": self.config.issuer + "/oauth/authorize",
            "token_endpoint": self.config.issuer + "/oauth/token",
            "revocation_endpoint": self.config.issuer + "/oauth/revoke",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_methods_supported": sorted(
                {c.method for c in self.config.clients}
            ),
            "revocation_endpoint_auth_methods_supported": sorted(
                {c.method for c in self.config.clients}
            ),
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": sorted(SCOPES),
            "authorization_response_iss_parameter_supported": True,
        }

    def protected_metadata(self):
        return {
            "resource": self.config.resource,
            "authorization_servers": [self.config.issuer],
            "scopes_supported": sorted(SCOPES),
            "bearer_methods_supported": ["header"],
        }

    def authorize(self, params, browser_secret):
        fields = {
            "response_type",
            "client_id",
            "redirect_uri",
            "scope",
            "state",
            "resource",
            "code_challenge",
            "code_challenge_method",
        }
        if (
            type(params) is not dict
            or set(params) != fields
            or params["resource"] != self.config.resource
            or params["code_challenge_method"] != "S256"
            or re.fullmatch(r"[A-Za-z0-9_-]{43}", params["code_challenge"]) is None
            or not 16 <= len(params["state"]) <= 1024
            or not params["scope"]
            or len(params["scope"]) > 512
            or set(params["scope"].split()) - SCOPES
            or _TOKEN.fullmatch(browser_secret or "") is None
        ):
            raise OAuthFailure("invalid_request")
        params = _copy(params)
        params["scope"] = " ".join(sorted(set(params["scope"].split())))
        request = _Request("GET", self.config.issuer + "/oauth/authorize", params)
        try:
            _Server(self).get_consent_grant(request)
        except OAuth2Error:
            raise OAuthFailure("invalid_request") from None
        request_id = _random("request_")
        now = self.now()

        def create(unit):
            bucket = _pending_bucket(unit, now)
            if len(bucket["entries"]) >= 64 or bucket["count"] >= 256:
                raise OAuthFailure("temporarily_unavailable", 503)
            bucket["count"] += 1
            bucket["entries"][request_id] = {
                "params": params,
                "browserHash": digest(browser_secret),
                "ownerSubject": None,
                "connectionId": _random("connection_"),
                "authorizationId": _random("authorization_"),
                "expiresAt": now + PENDING_SECONDS,
                "status": "pending",
                "prepared": None,
            }
            _put(unit, "hub_oauth_pending", ("pool",), bucket)

        self.store.transact(create)
        return request_id

    def _pending(self, unit, uid, request_id, browser_secret, *, claim=False):
        identifier(request_id)
        bucket = _pending_bucket(unit, self.now())
        value = bucket["entries"].get(request_id)
        if (
            value is None
            or type(browser_secret) is not str
            or not secrets.compare_digest(value["browserHash"], digest(browser_secret))
            or value["ownerSubject"] not in (None, owner_key(uid))
        ):
            raise ContractError("not_found")
        if value["ownerSubject"] is None:
            if not claim or value["status"] != "pending":
                raise ContractError("not_found")
            vault, _ = _current(unit, owner_key(uid), self.now())
            value["ownerSubject"], value["vaultId"] = owner_key(uid), vault["vaultId"]
        return bucket, value

    def _pending_response(self, row):
        return {
            "contractVersion": CONTRACT_VERSION,
            "provider": "muse",
            "status": row["status"],
            "clientId": row["params"]["client_id"],
            "scopes": row["params"]["scope"].split(),
            "connectionId": row["connectionId"],
            "authorizationId": row["authorizationId"],
            "expiresAt": row["expiresAt"],
            "prepared": row["prepared"],
        }

    def _attempt(self, unit, uid, request_id, row):
        record = self._owner(unit, uid)
        attempts, now = record["attempts"], self.now()
        if request_id not in attempts and len(attempts) >= 64:
            terminal = [
                key
                for key, value in attempts.items()
                if value["status"] != "pending" or value["expiresAt"] <= now
            ]
            if not terminal:
                raise ContractError("version_conflict")
            del attempts[terminal[0]]
        previous = attempts.get(request_id)
        attempts[request_id] = {
            "requestId": request_id,
            "clientId": row["params"]["client_id"],
            "connectionId": row["connectionId"],
            "authorizationId": row["authorizationId"],
            "status": row["status"],
            "createdAt": previous["createdAt"] if previous else now,
            "updatedAt": now,
            "expiresAt": row["prepared"]["authorizationExpiresAt"]
            if row["status"] == "authorized"
            else row["expiresAt"],
        }
        _put(unit, "hub_oauth_owners", (owner_key(uid),), record)
        return record

    def claim(self, uid, request_id, browser_secret):
        def run(unit):
            bucket, row = self._pending(unit, uid, request_id, browser_secret, claim=True)
            self._attempt(unit, uid, request_id, row)
            _put(unit, "hub_oauth_pending", ("pool",), bucket)
            return self._pending_response(row)

        return self.store.transact(run)

    def status(self, uid, request_id, browser_secret):
        return self.store.transact(
            lambda u: self._pending_response(self._pending(u, uid, request_id, browser_secret)[1])
        )

    def prepare(
        self,
        uid,
        request_id,
        browser_secret,
        task_ids,
        connection_id=None,
        approved_scopes=None,
        *,
        history_policy="none",
        source_versions=None,
    ):
        if history_policy not in {"none", "selected"}:
            raise ContractError("malformed_request")
        if (
            type(task_ids) is not list
            or not 1 <= len(task_ids) <= 10
            or any(type(task) is not str for task in task_ids)
            or len(set(task_ids)) != len(task_ids)
        ):
            raise ContractError("malformed_request")
        for task in task_ids:
            identifier(task)
        if connection_id is not None:
            identifier(connection_id)

        def run(unit):
            bucket, row = self._pending(unit, uid, request_id, browser_secret)
            if row["status"] != "pending":
                raise ContractError("version_conflict")
            owner = owner_key(uid)
            vault, registry = _current(unit, owner, self.now())
            index = _index(unit, owner, vault["vaultId"])
            requested_scopes = set(row["params"]["scope"].split())
            if approved_scopes is not None and (
                type(approved_scopes) is not list
                or any(type(s) is not str for s in approved_scopes)
            ):
                raise ContractError("malformed_request")
            chosen_scopes = requested_scopes if approved_scopes is None else set(approved_scopes)
            if (
                (
                    approved_scopes is not None
                    and (
                        type(approved_scopes) is not list
                        or any(type(s) is not str for s in approved_scopes)
                        or len(chosen_scopes) != len(approved_scopes)
                    )
                )
                or not chosen_scopes
                or not chosen_scopes <= requested_scopes
            ):
                raise ContractError("insufficient_scope")
            selected_connection = connection_id or row["connectionId"]
            if row["prepared"] is not None:
                if (
                    row["prepared"]["taskIds"] != task_ids
                    or row["connectionId"] != selected_connection
                    or row["prepared"]["approvedScopes"] != sorted(chosen_scopes)
                    or row["prepared"].get("historyPolicy", "none") != history_policy
                ):
                    raise ContractError("version_conflict")
                return self._pending_response(row)
            conn = None
            if connection_id is not None:
                conn = _row(unit, "hub_oauth_connections", owner, connection_id)
                if (
                    conn is None
                    or conn["clientId"] != row["params"]["client_id"]
                    or conn["status"] != "active"
                ):
                    raise ContractError("not_found")
                row["connectionId"] = connection_id
            generation = conn["authorizationCount"] + 1 if conn else 1
            if generation > MAX_AUTHORIZATIONS:
                raise ContractError("version_conflict")
            tasks = []
            for task in task_ids:
                head = _head(unit, owner, vault["vaultId"], task, index)
                if head is None or head["metadata"]["status"] != "active":
                    raise ContractError("not_found")
                meta = head["metadata"]
                require_current_bindings(unit, owner, meta["resourceBindings"])
                previous = conn["grants"].get(task) if conn else None
                tasks.append(
                    {
                        "taskId": task,
                        "taskVersion": meta["taskVersion"],
                        "executionEpoch": meta["executionEpoch"],
                        "resourceBindings": meta["resourceBindings"],
                        "grantId": _random("grant_"),
                        "grantEpoch": previous["grantEpoch"] + 1 if previous else 1,
                    }
                )
                if history_policy == "selected":
                    selected = []
                    for binding in meta["resourceBindings"]:
                        source = (source_versions or {}).get(canonical_json(binding["ref"]))
                        if source is None or source["sourceEpoch"] != binding["sourceEpoch"]:
                            raise ContractError("source_unavailable")
                        selected.append(source)
                    tasks[-1]["selectedResourceVersions"] = selected
            row["prepared"] = {
                "taskIds": task_ids,
                "approvedScopes": sorted(chosen_scopes),
                "tasks": tasks,
                "authorizationCount": generation,
                "keyEpoch": registry.key_epoch,
                "registrySequence": registry.registry_sequence,
                "checkpointDigest": registry.checkpoint_digest,
                "authorizationExpiresAt": self.now() + FAMILY_SECONDS,
                "historyPolicy": history_policy,
            }
            _put(unit, "hub_oauth_pending", ("pool",), bucket)
            return self._pending_response(row)

        return self.store.transact(run)

    def _grant(self, signed, prepared, row, registry, now):
        grant = verify_agent_grant(
            signed,
            registry=registry,
            owner_subject=row["ownerSubject"],
            vault_id=row["vaultId"],
            connection_id=row["connectionId"],
            authorization_id=row["authorizationId"],
            task_id=prepared["taskId"],
            task_version=prepared["taskVersion"],
            execution_epoch=prepared["executionEpoch"],
            grant_id=prepared["grantId"],
            grant_epoch=prepared["grantEpoch"],
            now=now,
            authorization_expires_at=row["prepared"]["authorizationExpiresAt"],
        )
        bindings = [
            {"ref": b["ref"], "sourceEpoch": b["sourceEpoch"]} for b in grant["resourceBindings"]
        ]
        if canonical_json(bindings) != canonical_json(prepared["resourceBindings"]):
            raise ContractError("recipient_binding_mismatch")
        # Explicit current-version re-sharing does not approve arbitrary historical rules.
        policy = row["prepared"].get("historyPolicy", "none")
        if grant["taskVersions"] != [prepared["taskVersion"]] or grant["historyPolicy"] != policy:
            raise ContractError("insufficient_scope")
        if policy == "selected":
            versions = prepared.get("selectedResourceVersions", [])
            for binding in grant["resourceBindings"]:
                selected = next((v for v in versions if v["ref"] == binding["ref"]), None)
                if (
                    selected is None
                    or binding["versionAccess"] != "selected"
                    or binding["selectedVersions"] != [selected["revision"]]
                ):
                    raise ContractError("insufficient_scope")
        scopes = set(row["prepared"]["approvedScopes"])
        if (
            "decrypt_task" in grant["capabilities"]
            and "tasks:read" not in scopes
            or "encrypt_result" in grant["capabilities"]
            and not scopes & {"results:create", "results:revise"}
            or "decrypt_resources" in grant["capabilities"]
            and not scopes & {"runs:create", "runs:read"}
        ):
            raise ContractError("insufficient_scope")
        for binding in bindings:
            required = {
                "holdings": "portfolio:read",
                "watchlist": "watchlist:read",
                "channel_follows": "channel_follows:read",
            }[binding["ref"]["kind"]]
            if required not in scopes:
                raise ContractError("insufficient_scope")
        return grant

    def decide(self, uid, request_id, browser_secret, decision, signed_grants):
        if (
            decision not in {"approve", "deny", "cancel"}
            or type(signed_grants) is not list
            or len(signed_grants) > 10
        ):
            raise ContractError("malformed_request")
        # Read only the snapshot to collect active-source evidence outside the write transaction.
        pending = self.store.transact(
            lambda u: _copy(self._pending(u, uid, request_id, browser_secret)[1])
        )
        if decision == "approve":
            if pending["prepared"] is None:
                raise ContractError("malformed_request")
            resources = [b for t in pending["prepared"]["tasks"] for b in t["resourceBindings"]]
            unique = {canonical_json(b): b for b in resources}
            TaskService(self.store, self.catalogue, clock=self.clock)._fresh(
                uid, list(unique.values())
            )

        def run(unit):
            bucket, row = self._pending(unit, uid, request_id, browser_secret)
            if row != pending or row["status"] != "pending":
                raise ContractError("version_conflict")
            if decision != "approve":
                if signed_grants:
                    raise ContractError("malformed_request")
                row["status"] = "denied" if decision == "deny" else "cancelled"
                self._attempt(unit, uid, request_id, row)
                _put(unit, "hub_oauth_pending", ("pool",), bucket)
                data = {
                    "error": "access_denied",
                    "state": row["params"]["state"],
                    "iss": self.config.issuer,
                }
                return row["params"]["redirect_uri"] + "?" + urlencode(data)
            now, owner = self.now(), owner_key(uid)
            vault, registry = _current(unit, owner, now)
            if row["prepared"]["keyEpoch"] != registry.key_epoch:
                raise ContractError("stale_key_epoch")
            index = _index(unit, owner, vault["vaultId"])
            owner_record = self._owner(unit, uid)
            conn = _row(unit, "hub_oauth_connections", owner, row["connectionId"])
            generation = conn["authorizationCount"] + 1 if conn else 1
            if generation != row["prepared"]["authorizationCount"] or (
                conn and conn["status"] != "active"
            ):
                raise ContractError("version_conflict")
            if conn is None and len(owner_record["connectionIds"]) >= MAX_CONNECTIONS:
                raise ContractError("version_conflict")
            by_task = {}
            for signed in signed_grants:
                _, payload = _signed_parts(signed)
                if payload.get("taskId") in by_task:
                    raise ContractError("malformed_request")
                by_task[payload.get("taskId")] = signed
            selected = row["prepared"]["tasks"]
            if by_task and set(by_task) != {t["taskId"] for t in selected}:
                raise ContractError("malformed_request")
            grants = {}
            for prepared in selected:
                task = prepared["taskId"]
                head = _head(unit, owner, vault["vaultId"], task, index)
                if (
                    head is None
                    or head["metadata"]["status"] != "active"
                    or any(
                        head["metadata"][k] != prepared[k]
                        for k in ("taskVersion", "executionEpoch", "resourceBindings")
                    )
                ):
                    raise ContractError("version_conflict")
                require_current_bindings(unit, owner, prepared["resourceBindings"])
                if task in by_task:
                    self._grant(by_task[task], prepared, row, registry, now)
                grants[task] = {
                    **prepared,
                    "status": "active",
                    "keyGrantJson": canonical_json(by_task[task]).decode()
                    if task in by_task
                    else None,
                    "authorizedAt": now,
                    "readObserved": False,
                    "resultSaved": False,
                }
            context = {
                "ownerSubject": owner,
                "vaultId": vault["vaultId"],
                "connectionId": row["connectionId"],
                "authorizationId": row["authorizationId"],
                "familyId": _random("family_"),
                "grantRefs": {
                    t: {"grantId": g["grantId"], "grantEpoch": g["grantEpoch"]}
                    for t, g in grants.items()
                },
                "expiresAt": row["prepared"]["authorizationExpiresAt"],
            }
            new_connection = {
                "ownerSubject": owner,
                "vaultId": vault["vaultId"],
                "provider": "muse",
                "clientId": row["params"]["client_id"],
                "connectionId": row["connectionId"],
                "authorizationId": row["authorizationId"],
                "authorizationCount": generation,
                "approvedScopes": row["prepared"]["approvedScopes"],
                "status": "active",
                "authorizedAt": now,
                "expiresAt": context["expiresAt"],
                "grants": grants,
            }
            request = _Request(
                "GET",
                self.config.issuer + "/oauth/authorize",
                row["params"] | {"scope": " ".join(row["prepared"]["approvedScopes"])},
            )
            server = _Server(self, unit)
            consent_grant = server.get_consent_grant(request)
            result = server.create_authorization_response(
                request, grant_user=context, grant=consent_grant
            )
            if result[0] != 302 or "code=" not in result[2].get("Location", ""):
                raise StoreUnavailable
            if conn is None:
                owner_record["connectionIds"].append(row["connectionId"])
            _put(unit, "hub_oauth_connections", (owner, row["connectionId"]), new_connection)
            row["status"] = "authorized"
            owner_record["attempts"][request_id].update(
                status="authorized",
                connectionId=row["connectionId"],
                expiresAt=context["expiresAt"],
                updatedAt=now,
            )
            _put(unit, "hub_oauth_owners", (owner,), owner_record)
            _put(unit, "hub_oauth_pending", ("pool",), bucket)
            return result[2]["Location"]

        return self.store.transact(run)

    def _revoke_family(self, unit, family_id):
        row = _row(unit, "hub_oauth_families", family_id)
        if row:
            row["revoked"] = True
            _put(unit, "hub_oauth_families", (family_id,), row)

    def _context_active(self, unit, context):
        now = self.now()
        conn = _row(unit, "hub_oauth_connections", context["ownerSubject"], context["connectionId"])
        if (
            conn is None
            or conn["status"] != "active"
            or conn["authorizationId"] != context["authorizationId"]
            or conn["expiresAt"] <= now
        ):
            return False
        return True

    def _token_active(self, unit, row):
        if (
            row["revoked"]
            or row["expiresAt"] <= self.now()
            or row["resource"] != self.config.resource
        ):
            return False
        family = _row(unit, "hub_oauth_families", row["familyId"])
        return bool(
            family
            and not family["revoked"]
            and family["expiresAt"] > self.now()
            and self._context_active(unit, row)
        )

    def protocol(self, form, headers, endpoint):
        fields = (
            {
                "grant_type",
                "code",
                "redirect_uri",
                "client_id",
                "code_verifier",
                "resource",
                "refresh_token",
                "scope",
            }
            if endpoint == "token"
            else {"token", "token_type_hint", "client_id", "resource"}
        )
        if type(form) is not dict or set(form) - fields or endpoint not in {"token", "revoke"}:
            raise OAuthFailure("invalid_request")
        if (endpoint == "token" and form.get("resource") != self.config.resource) or (
            endpoint == "revoke" and "resource" in form and form["resource"] != self.config.resource
        ):
            raise OAuthFailure("invalid_target")
        if endpoint == "token":
            required = {"grant_type", "resource"}
            if form.get("grant_type") == "authorization_code":
                required |= {"code", "redirect_uri", "code_verifier"}
                allowed = required | {"client_id"}
            elif form.get("grant_type") == "refresh_token":
                required.add("refresh_token")
                allowed = required | {"client_id", "scope"}
            else:
                raise OAuthFailure("unsupported_grant_type")
            if not required <= set(form) or set(form) - allowed:
                raise OAuthFailure("invalid_request")
        elif "token" not in form:
            raise OAuthFailure("invalid_request")
        form = _copy(form)

        def run(unit):
            request = _Request("POST", self.config.issuer + "/oauth/" + endpoint, form, headers)
            server = _Server(self, unit)
            if endpoint == "token":
                return server.create_token_response(request)
            return server.create_endpoint_response("revocation", request)

        return self.store.transact(run)

    def authenticate(self, token, task_id=None, scope=None):
        principal = self.store.transact(
            lambda unit: self.authorize_in_transaction(unit, token, task_id, scope)
        )
        return {
            "contractVersion": CONTRACT_VERSION,
            "connectionId": principal.connection_id,
            "authorizationId": principal.authorization_id,
            "clientId": principal.client_id,
            "scopes": list(principal.scopes),
            "taskIds": list(principal.task_ids),
            "expiresAt": principal.expires_at,
        }

    def authorize_in_transaction(self, unit, token, task_id=None, scope=None):
        """Recheck the original bearer and all authority inside a consumer transaction.

        Consumers obtain fresh source state outside, then call this method in
        the SAME transaction as their mutation. Never reuse an earlier public
        authenticate DTO or a connection snapshot as authorization.
        """
        if type(token) is not str or _TOKEN.fullmatch(token) is None:
            raise OAuthFailure("invalid_token", 401)
        if task_id is not None:
            identifier(task_id)
        if scope is not None and scope not in SCOPES:
            raise OAuthFailure("insufficient_scope", 403)
        record = _row(unit, "hub_oauth_access", digest(token))
        if not record or not self._token_active(unit, record):
            raise OAuthFailure("invalid_token", 401)
        if scope is not None and scope not in record["scope"].split():
            raise OAuthFailure("insufficient_scope", 403)
        conn = _row(unit, "hub_oauth_connections", record["ownerSubject"], record["connectionId"])
        owner = _row(unit, "hub_oauth_owners", record["ownerSubject"])
        if owner is None or owner_key(owner["ownerUid"]) != record["ownerSubject"]:
            raise StoreUnavailable
        allowed = []
        for task, approved in record["grantRefs"].items():
            grant = conn["grants"].get(task)
            if (
                grant
                and grant["status"] == "active"
                and all(grant[k] == approved[k] for k in ("grantId", "grantEpoch"))
            ):
                allowed.append(task)
        verified = None
        if task_id is not None:
            if task_id not in allowed:
                raise OAuthFailure("insufficient_scope", 403)
            verified = self._key_authority(unit, conn, task_id, scope)
            if scope in {"runs:create", "runs:read"}:
                required = {
                    "holdings": "portfolio:read",
                    "watchlist": "watchlist:read",
                    "channel_follows": "channel_follows:read",
                }
                if any(
                    required[b["ref"]["kind"]] not in record["scope"].split()
                    for b in verified["resourceBindings"]
                ):
                    raise OAuthFailure("insufficient_scope", 403)
        return AgentPrincipal(
            owner["ownerUid"],
            record["ownerSubject"],
            conn["connectionId"],
            conn["authorizationId"],
            conn["clientId"],
            tuple(record["scope"].split()),
            tuple(sorted(allowed)),
            record["expiresAt"],
            verified,
        )

    def _key_authority(self, unit, conn, task_id, scope=None):
        """Consumer hook inside its mutation transaction; no plaintext or Run is created.

        Downstream adapters must additionally obtain fresh source state outside
        this transaction and verify concrete Run/version/capability bindings.
        This full guard is intentionally unsuitable for saved-receipt recovery.
        """
        grant = conn["grants"].get(task_id)
        if grant is None or grant["status"] != "active" or grant["keyGrantJson"] is None:
            raise OAuthFailure("insufficient_scope", 403)
        now, owner = self.now(), conn["ownerSubject"]
        vault, registry = _current(unit, owner, now)
        index = _index(unit, owner, vault["vaultId"])
        task = _head(unit, owner, vault["vaultId"], task_id, index)
        if task is None or task["metadata"]["status"] != "active":
            raise OAuthFailure("insufficient_scope", 403)
        meta = task["metadata"]
        verified = verify_agent_grant(
            strict_json_loads(grant["keyGrantJson"]),
            registry=registry,
            owner_subject=owner,
            vault_id=vault["vaultId"],
            connection_id=conn["connectionId"],
            authorization_id=conn["authorizationId"],
            task_id=task_id,
            task_version=meta["taskVersion"],
            execution_epoch=meta["executionEpoch"],
            grant_id=grant["grantId"],
            grant_epoch=grant["grantEpoch"],
            now=now,
            authorization_expires_at=conn["expiresAt"],
        )
        bindings = [
            {"ref": b["ref"], "sourceEpoch": b["sourceEpoch"]} for b in verified["resourceBindings"]
        ]
        if canonical_json(bindings) != canonical_json(meta["resourceBindings"]):
            raise ContractError("recipient_binding_mismatch")
        require_current_bindings(unit, owner, bindings)
        capabilities = set()
        if scope == "tasks:read":
            capabilities.add("decrypt_task")
        elif scope in {"runs:create", "runs:read"}:
            capabilities.add("decrypt_task")
            if bindings:
                capabilities.add("decrypt_resources")
        elif scope in {"portfolio:read", "watchlist:read", "channel_follows:read"}:
            capabilities.add("decrypt_resources")
            kind = {
                "portfolio:read": "holdings",
                "watchlist:read": "watchlist",
                "channel_follows:read": "channel_follows",
            }[scope]
            if not any(b["ref"]["kind"] == kind for b in bindings):
                raise OAuthFailure("insufficient_scope", 403)
        elif scope in {"results:create", "results:revise"}:
            capabilities.add("encrypt_result")
        if not capabilities <= set(verified["capabilities"]):
            raise OAuthFailure("insufficient_scope", 403)
        return verified


def get_owner_connection_service():
    return OwnerConnectionService(get_store())


def get_oauth_service():
    # Config validation precedes storage creation. Health/import never needs ADC.
    config = OAuthConfig.environment()
    from .catalogue import CatalogueService, get_sources
    from .vaults import VaultService

    store = get_store()
    return OAuthService(store, config, CatalogueService(VaultService(store), get_sources()))
