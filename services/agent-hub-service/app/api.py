"""Bounded opaque vault enrollment and public directory projection transports."""

import asyncio
import os
import re
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPBearer
from starlette.concurrency import run_in_threadpool

from folioview_shared.delegation import (
    CatalogueRequirement,
    DelegatedPrincipal,
    DelegationVerifier,
    make_delegation_dependency,
)
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_HTTP_WRITE_BYTES
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.service_identity import (
    GoogleCallerVerifier,
    IdentityVerificationUnavailable,
    InvalidIdentityToken,
    UntrustedServiceCaller,
)

from .fences import FenceService
from .signing import get_signer, mint_authority_token, origin, token_configuration
from .store import get_store
from .vaults import VaultService

owner_router = APIRouter(prefix="/api/v2/vaults", route_class=PrivateRoute)
internal_router = APIRouter(prefix="/internal/v2", route_class=PrivateRoute)
public_router = APIRouter(route_class=PrivateRoute)
_bearer = HTTPBearer(auto_error=False)


def _invoke(action):
    try:
        return action()
    except ContractError as error:
        # Foundation verifiers also expose client-only integrity findings. Map
        # those to the existing public wire vocabulary at this server boundary.
        code = {
            "untrusted_key": "recipient_binding_mismatch",
            "rollback_detected": "registry_conflict",
        }.get(error.code, error.code)
        failure = ContractError(code)
        raise HTTPException(
            failure.status, {"code": code}, headers={"Cache-Control": "no-store"}
        ) from None


async def require_owner(request: Request):
    # Keep health/import independent of Firebase/ADC. This is the existing strict
    # verifier, not an alternate token scheme or local auth bypass.
    credentials = await _bearer(request)
    from folioview_shared.auth import require_google_user

    return await run_in_threadpool(require_google_user, request, credentials)


def get_service():
    return VaultService(get_store())


def get_fence_service():
    return FenceService(get_store())


Owner = Annotated[object, Depends(require_owner)]
Service = Annotated[VaultService, Depends(get_service)]
Fences = Annotated[FenceService, Depends(get_fence_service)]


def transport(request, *, operation=False, author=False):
    if request.query_params:
        raise ContractError("unsupported_query")
    if request.headers.getlist("x-folioview-contract") != [CONTRACT_VERSION]:
        raise ContractError("unsupported_contract")
    for key, schema in (
        ("idempotency-key", "OperationIdentifier"),
        ("x-folioview-author-key", "KeyId"),
    ):
        if (key == "idempotency-key" and operation) or (key == "x-folioview-author-key" and author):
            if len(request.headers.getlist(key)) != 1:
                raise ContractError("malformed_request")
            validate_schema(schema, request.headers[key])


async def body(request, fields, *, max_bytes=MAX_HTTP_WRITE_BYTES):
    _invoke(lambda: transport(request))
    if (
        len(request.headers.getlist("content-type")) != 1
        or request.headers["content-type"].split(";", 1)[0].lower() != "application/json"
    ):
        raise HTTPException(415, {"code": "unsupported_media_type"})
    raw = bytearray()
    try:
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                if len(chunk) > max_bytes - len(raw):
                    raise ContractError("payload_too_large")
                raw.extend(chunk)
        value = strict_json_loads(bytes(raw), max_bytes=max_bytes)
        if (
            type(value) is not dict
            or set(value) != set(fields)
            or value.get("contractVersion") != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        return value
    except ContractError as error:
        raise HTTPException(error.status, {"code": error.code}) from None
    except TimeoutError:
        raise HTTPException(400, {"code": "malformed_request"}) from None


@owner_router.get("/current")
def current(request: Request, user: Owner, service: Service):
    _invoke(lambda: transport(request))
    return _invoke(lambda: service.current(user.uid))


@owner_router.post("", status_code=201)
async def bootstrap(request: Request, user: Owner, service: Service):
    _invoke(lambda: transport(request, operation=True))
    value = await body(
        request, {"contractVersion", "vaultId", "rootJwk", "rootKeyId", "registryBundle", "archive"}
    )
    return await run_in_threadpool(
        _invoke, lambda: service.bootstrap(user.uid, value, request.headers["idempotency-key"])
    )


@owner_router.put("/{vault_id}/registry")
async def registry(vault_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: transport(request, operation=True))
    value = await body(request, {"contractVersion", "expectedVersion", "registryBundle"})
    return await run_in_threadpool(
        _invoke,
        lambda: service.update_registry(
            user.uid, vault_id, value, request.headers["idempotency-key"]
        ),
    )


@owner_router.post("/{vault_id}/holdings-sources/{source_id}", status_code=201)
async def create_source(
    vault_id: str, source_id: str, request: Request, user: Owner, service: Service
):
    _invoke(lambda: transport(request, operation=True, author=True))
    value = await body(request, {"contractVersion", "command"})
    return await run_in_threadpool(
        _invoke,
        lambda: service.create_source(
            user.uid,
            vault_id,
            source_id,
            value,
            request.headers["idempotency-key"],
            request.headers["x-folioview-author-key"],
        ),
    )


@owner_router.post("/current/authority-token")
async def authority_token(request: Request, user: Owner, service: Service):
    await body(request, {"contractVersion"})

    def mint():
        if service.current(user.uid)["vault"] is None:
            raise ContractError("not_found")
        return mint_authority_token(user.uid, get_signer())

    return await run_in_threadpool(_invoke, mint)


@lru_cache(maxsize=4)
def configured_verifier(configuration):
    audience, caller, callers = configuration
    try:
        allowed = strict_json_loads(callers, max_bytes=4096)
        if (
            type(allowed) is not dict
            or not 1 <= len(allowed) <= 8
            or any(value != caller for value in allowed.values())
        ):
            raise ValueError
        return DelegationVerifier(
            issuer=audience,
            audience=audience + "/internal/v2",
            source_service="portfolio",
            caller_verifier=GoogleCallerVerifier(audience, allowed),
        )
    except Exception:
        raise ContractError("authorization_unavailable") from None


def get_delegation_verifier():
    def configured():
        audience, caller = token_configuration()
        return configured_verifier(
            (audience, caller, os.getenv("HUB_TRUSTED_PORTFOLIO_CALLERS", ""))
        )

    return _invoke(configured)


def require_delegation(
    request: Request,
    response: Response,
    verifier: Annotated[DelegationVerifier, Depends(get_delegation_verifier)],
) -> DelegatedPrincipal:
    _invoke(lambda: transport(request))
    return make_delegation_dependency(verifier, CatalogueRequirement(frozenset({"holdings"})))(
        request, response
    )


Principal = Annotated[DelegatedPrincipal, Depends(require_delegation)]


@lru_cache(maxsize=4)
def configured_fence_verifier(configuration):
    audience, caller, callers = configuration
    try:
        origin(audience)
        allowed = strict_json_loads(callers, max_bytes=4096)
        if (
            type(allowed) is not dict
            or not 1 <= len(allowed) <= 8
            or any(value != caller for value in allowed.values())
        ):
            raise ValueError
        return GoogleCallerVerifier(audience, allowed)
    except Exception:
        raise ContractError("authorization_unavailable") from None


def get_fence_verifier():
    # Reverse invalidation is a deliberately narrow workload-only callback.
    # It neither mints/uses a user delegation nor needs a signing KMS key.
    return _invoke(
        lambda: configured_fence_verifier(
            (
                os.getenv("HUB_SERVICE_AUDIENCE", ""),
                os.getenv("HUB_PORTFOLIO_CALLER_EMAIL", ""),
                os.getenv("HUB_TRUSTED_PORTFOLIO_CALLERS", ""),
            )
        )
    )


def require_fence_caller(
    request: Request,
    verifier: Annotated[GoogleCallerVerifier, Depends(get_fence_verifier)],
):
    _invoke(lambda: transport(request))
    # Only a full signed Authorization token is accepted. Cloud Run may strip
    # X-Serverless-Authorization signatures; that header is never proof here.
    tokens = request.headers.getlist("authorization")
    if not tokens:
        raise HTTPException(401, {"code": "invalid_token"})
    if (
        len(tokens) != 1
        or re.fullmatch(r"Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", tokens[0], re.I)
        is None
    ):
        raise HTTPException(401, {"code": "invalid_token"})
    if request.headers.getlist("x-folioview-delegation"):
        raise HTTPException(403, {"code": "insufficient_scope"})
    try:
        return verifier.verify(tokens[0].split(" ", 1)[1])
    except InvalidIdentityToken:
        raise HTTPException(401, {"code": "invalid_token"}) from None
    except UntrustedServiceCaller:
        raise HTTPException(403, {"code": "insufficient_scope"}) from None
    except IdentityVerificationUnavailable:
        raise HTTPException(503, {"code": "authorization_unavailable"}) from None


@internal_router.post("/source-fences")
async def invalidate_fence(
    request: Request,
    caller: Annotated[object, Depends(require_fence_caller)],
    service: Fences,
):
    value = await body(
        request,
        {
            "contractVersion",
            "ownerSubject",
            "mutationId",
            "ref",
            "expectedSourceEpoch",
            "newSourceEpoch",
            "reason",
        },
        max_bytes=8192,
    )
    return await run_in_threadpool(
        _invoke, lambda: service.invalidate(value, source_service="portfolio")
    )


@internal_router.post("/portfolio-authorities/read")
async def public_authority(request: Request, principal: Principal, service: Service):
    value = await body(request, {"contractVersion", "sourceId"})
    return await run_in_threadpool(
        _invoke, lambda: service.authority(principal.owner_uid, value["sourceId"])
    )


@public_router.get("/.well-known/jwks.json")
def jwks():
    return _invoke(lambda: get_signer().jwks())
