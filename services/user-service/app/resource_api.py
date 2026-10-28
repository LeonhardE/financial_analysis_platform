"""Metadata-only v2 source interfaces behind both workload and user delegation."""

import asyncio
import os
import time
from functools import lru_cache
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.delegation import (
    CatalogueRequirement,
    DelegatedPrincipal,
    DelegationVerifier,
    make_delegation_dependency,
)
from folioview_shared.encrypted import CONTRACT_VERSION
from folioview_shared.encrypted.budgets import require_contract
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.http import PrivateRoute
from folioview_shared.instruments import iso_time
from folioview_shared.service_identity import GoogleCallerVerifier

from .resource_versions import KINDS
from .resources import (
    InitializationLimit,
    ResourceUnavailable,
    UserResourceStore,
    get_resource_store,
)

MAX_BODY_BYTES = 131_072
Kind = Literal["watchlist", "channel_follows"]
Identifier = Annotated[
    str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
]


class InitializeResource(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Kind
    operationKey: Identifier


class UserResourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Kind
    sourceService: Literal["user"]
    resourceId: Identifier
    incarnation: Identifier


class MetadataRead(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    contractVersion: Literal[CONTRACT_VERSION]
    refs: Annotated[list[UserResourceRef], Field(min_length=1, max_length=2)]


class ResourceRoute(PrivateRoute):
    def get_route_handler(self):
        # Preserve ContractError before the shared generic private wrapper maps
        # unknown exceptions to 503; this wrapper still sanitizes every failure.
        handler = APIRoute.get_route_handler(self)

        async def resource_handler(request):
            try:
                return await handler(request)
            except ContractError as error:
                return contract_error(error)
            except RequestValidationError:
                return (
                    contract_error(ContractError("malformed_request"))
                    if request.url.path.startswith("/internal/v2/")
                    else error_response(422)
                )
            except HTTPException as error:
                if request.url.path.startswith("/internal/v2/"):
                    code = {
                        401: "invalid_token",
                        403: "insufficient_scope",
                        404: "not_found",
                        413: "payload_too_large",
                        503: "source_unavailable",
                    }.get(
                        error.status_code,
                        "malformed_request",
                    )
                    return contract_error(ContractError(code))
                return error_response(error.status_code, error.headers)
            except Exception:
                return (
                    contract_error(ContractError("source_unavailable"))
                    if request.url.path.startswith("/internal/v2/")
                    else error_response(503)
                )

        return resource_handler


def contract_error(error):
    return JSONResponse(
        status_code=error.status,
        content=error.response(uuid4().hex),
        headers={
            "Cache-Control": "no-store",
            "X-FolioView-Contract": CONTRACT_VERSION,
            **({"WWW-Authenticate": "Bearer"} if error.status == 401 else {}),
        },
    )


class V2MetadataErrors:
    """Frame framework/CORS/missing-route errors too; legacy User routes stay unchanged."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/internal/v2/"):
            return await self.app(scope, receive, send)
        replaced = False

        async def framed(message):
            nonlocal replaced
            if message["type"] == "http.response.start" and message["status"] >= 400:
                headers = dict(message.get("headers", []))
                if headers.get(b"x-folioview-contract") != CONTRACT_VERSION.encode():
                    code = {
                        401: "invalid_token",
                        403: "insufficient_scope",
                        404: "not_found",
                        413: "payload_too_large",
                        503: "source_unavailable",
                    }.get(
                        message["status"],
                        "malformed_request",
                    )
                    response = contract_error(ContractError(code))
                    await response(scope, receive, send)
                    replaced = True
                    return
            if not replaced:
                await send(message)

        await self.app(scope, receive, framed)


def error_response(status, headers=None, message_override=None):
    code, message = {
        401: ("unauthenticated", "A valid signed identity is required."),
        403: ("forbidden", "This source operation is not authorized."),
        404: ("not_found", "The source resource is not available."),
        408: ("request_timeout", "The request body took too long."),
        409: ("version_conflict", "The source state has changed."),
        413: ("body_too_large", "The request body is too large."),
        422: ("invalid_request", "Invalid source request."),
        503: ("source_unavailable", "Source metadata is temporarily unavailable."),
    }.get(status, ("invalid_request", "Invalid source request."))
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message_override or message,
                "requestId": uuid4().hex,
                "retryable": status == 503,
            }
        },
        headers={**(headers or {}), "Cache-Control": "no-store"},
    )


async def body(request, model):
    raw = bytearray()
    try:
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                if len(raw) + len(chunk) > MAX_BODY_BYTES:
                    raise HTTPException(413)
                raw.extend(chunk)
        decoded = strict_json_loads(bytes(raw), max_bytes=MAX_BODY_BYTES)
        if request.url.path.startswith("/internal/v2/"):
            require_contract(request.headers.get("x-folioview-contract"), decoded)
        return model.model_validate(decoded)
    except TimeoutError as error:
        if request.url.path.startswith("/internal/v2/"):
            raise ContractError("malformed_request") from error
        raise HTTPException(408) from error
    except ContractError as error:
        if request.url.path.startswith("/internal/v2/"):
            raise
        raise HTTPException(422) from error
    except (ValidationError, ValueError) as error:
        if request.url.path.startswith("/internal/v2/"):
            raise ContractError("malformed_request") from error
        raise HTTPException(422) from error


def require_v2(request):
    if request.headers.getlist("x-folioview-contract") != [CONTRACT_VERSION]:
        raise ContractError("unsupported_contract")


def query_kind(request):
    if (
        any(key != "kind" for key in request.query_params)
        or len(request.query_params.getlist("kind")) > 1
    ):
        raise ContractError("unsupported_query")
    kind = request.query_params.get("kind")
    if kind is not None and kind not in KINDS:
        raise ContractError("unsupported_query")
    return kind


@lru_cache(maxsize=4)
def configured_verifier(configuration):
    service_audience, delegation_audience, issuer, callers = configuration
    try:
        if (
            not service_audience
            or service_audience.endswith("/")
            or delegation_audience != service_audience + "/internal/v2"
        ):
            raise ValueError
        allowed = strict_json_loads(callers, max_bytes=4096)
        if type(allowed) is not dict or not 1 <= len(allowed) <= 8:
            raise ValueError
        caller = GoogleCallerVerifier(service_audience, allowed)
        return DelegationVerifier(
            issuer=issuer,
            audience=delegation_audience,
            source_service="user",
            caller_verifier=caller,
        )
    except Exception:
        raise ContractError("authorization_unavailable") from None


def get_delegation_verifier():
    return configured_verifier(
        tuple(
            os.getenv(key, "")
            for key in (
                "USER_SERVICE_AUDIENCE",
                "USER_DELEGATION_AUDIENCE",
                "USER_DELEGATION_ISSUER",
                "USER_TRUSTED_HUB_CALLERS",
            )
        )
    )


def delegated_metadata(
    request: Request,
    response: Response,
    verifier: Annotated[DelegationVerifier, Depends(get_delegation_verifier)],
) -> DelegatedPrincipal:
    require_v2(request)
    kind = query_kind(request)

    def requirement(_request, principal):
        # The route selects the optional requested kind. An omitted filter lists
        # only kinds authorized by the signed catalogue delegation, never all
        # resources simply because a caller knows the owner UID.
        return CatalogueRequirement(frozenset({kind}) if kind else principal.resource_kinds)

    try:
        return make_delegation_dependency(verifier, requirement)(request, response)
    except HTTPException as error:
        code = {401: "invalid_token", 403: "insufficient_scope"}.get(
            error.status_code,
            "authorization_unavailable",
        )
        raise ContractError(code) from None


public = APIRouter(
    prefix="/api/v1/resource-initializations", tags=["resources"], route_class=ResourceRoute
)
internal = APIRouter(
    prefix="/internal/v2/resources", tags=["source-metadata"], route_class=ResourceRoute
)
User = Annotated[CurrentUser, Depends(require_google_user)]
Store = Annotated[UserResourceStore, Depends(get_resource_store)]
Principal = Annotated[DelegatedPrincipal, Depends(delegated_metadata)]


@public.post("", status_code=201)
async def initialize_resource(request: Request, user: User, store: Store):
    update = await body(request, InitializeResource)
    try:
        return await run_in_threadpool(store.initialize, user.uid, update.kind, update.operationKey)
    except InitializationLimit:
        return error_response(
            409,
            message_override=(
                "The initialization receipt limit is reached. Retry an existing operation key."
            ),
        )
    except ResourceUnavailable as error:
        raise HTTPException(503) from error


@internal.get("/catalogue")
def catalogue(request: Request, principal: Principal, store: Store):
    kind = query_kind(request)
    selected = (kind,) if kind else tuple(sorted(principal.resource_kinds))
    try:
        items = store.read(principal.owner_uid, selected)
        return {
            "contractVersion": CONTRACT_VERSION,
            "items": list(items.values()),
            "readAt": iso_time(time.time()),
        }
    except ResourceUnavailable as error:
        raise HTTPException(503) from error


async def read_current_metadata(request, principal, store, *, states=False):
    update = await body(request, MetadataRead)
    refs = [ref.model_dump() for ref in update.refs]
    if len({ref.kind for ref in update.refs}) != len(refs):
        raise HTTPException(422)
    selected = tuple(ref.kind for ref in update.refs)
    if not set(selected) <= principal.resource_kinds:
        raise HTTPException(403)
    kind = query_kind(request)
    if kind is not None and set(selected) != {kind}:
        raise HTTPException(403)
    try:
        current = await run_in_threadpool(store.read, principal.owner_uid, selected)
    except ResourceUnavailable as error:
        raise HTTPException(503) from error
    # Each ref/incarnation is compared against the current signed-owner store;
    # foreign owner and absent/old-incarnation requests share one failure.
    if any(current[ref["kind"]]["ref"] != ref for ref in refs):
        raise HTTPException(404)
    items = [current[ref["kind"]] for ref in refs]
    if states:
        observed = iso_time(time.time())
        items = [
            {
                "ref": item["ref"],
                "sourceEpoch": item["sourceEpoch"],
                "revision": item["revision"],
                "state": "active",
                "observedAt": observed,
            }
            for item in items
        ]
    return {"contractVersion": CONTRACT_VERSION, "items": items}


@internal.post("/projections/read")
async def projections(request: Request, principal: Principal, store: Store):
    return await read_current_metadata(request, principal, store)


@internal.post("/states/read")
async def states(request: Request, principal: Principal, store: Store):
    return await read_current_metadata(request, principal, store, states=True)
