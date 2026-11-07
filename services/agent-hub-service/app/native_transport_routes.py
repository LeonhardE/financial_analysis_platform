"""Separate native account OAuth and same-origin, cookie-bound owner consent."""

import os
import re
import secrets
from typing import Annotated
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, body
from .native_transport import PROFILE, SCOPE, NativeTransportService
from .oauth import PENDING_SECONDS
from .oauth_config import OAuthConfig
from .oauth_routes import (
    AUTHORIZE_FIELDS,
    PRIVATE,
    REVOKE_FIELDS,
    TOKEN_FIELDS,
    OAuthRoute,
    _pairs,
    _protocol,
)
from .persistent_routes import control_transport
from .store import get_store

COOKIE = "fv_native_oauth_flow"
COOKIE_PATH = "/api/v2/persistent-account-authorizations"
router = APIRouter(route_class=OAuthRoute)
owner_router = APIRouter(prefix=COOKIE_PATH, route_class=PrivateRoute)


def get_native_transport():
    def configured():
        if os.getenv("HUB_PERSISTENT_TRANSPORT_ENABLED") != "1":
            raise ContractError("authorization_unavailable")
        config = OAuthConfig.environment()
        return NativeTransportService(get_store(), config)

    return _invoke(configured)


Service = Annotated[NativeTransportService, Depends(get_native_transport)]


def native_browser(request, service):
    parsed = urlsplit(service.config.consent_url)
    if request.headers.getlist("origin") != [f"{parsed.scheme}://{parsed.netloc}"]:
        raise ContractError("insufficient_scope")
    found = []
    for raw in request.headers.getlist("cookie"):
        for part in raw.split(";"):
            key, separator, value = part.strip().partition("=")
            if separator and key == COOKIE:
                found.append(value)
    if len(found) != 1 or re.fullmatch(r"[A-Za-z0-9_-]{43}", found[0]) is None:
        raise ContractError("insufficient_scope")
    return found[0]


@router.get("/.well-known/oauth-authorization-server/oauth/persistent")
def metadata(service: Service):
    return JSONResponse(service.metadata(), headers=PRIVATE)


@router.get("/.well-known/oauth-protected-resource/mcp/v3")
def protected_metadata(service: Service):
    return JSONResponse(service.protected_metadata(), headers=PRIVATE)


@router.get("/oauth/persistent/authorize")
async def authorize(request: Request, service: Service):
    values = _pairs(request.scope["query_string"], AUTHORIZE_FIELDS)
    browser = secrets.token_urlsafe(32)
    ident = await run_in_threadpool(service.authorize, values, browser)
    response = RedirectResponse(
        service.config.consent_url + "?" + urlencode({"request": ident}),
        status_code=303,
        headers=PRIVATE,
    )
    response.set_cookie(
        COOKIE,
        browser,
        max_age=PENDING_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
        path=COOKIE_PATH,
    )
    return response


@router.post("/oauth/persistent/token")
async def token(request: Request, service: Service):
    return await _protocol(request, service, "token", TOKEN_FIELDS)


@router.post("/oauth/persistent/revoke")
async def revoke(request: Request, service: Service):
    return await _protocol(request, service, "revoke", REVOKE_FIELDS)


@owner_router.get("/capabilities")
def capabilities(request: Request, user: Owner):
    _invoke(lambda: control_transport(request))

    def configured():
        if os.getenv("HUB_PERSISTENT_TRANSPORT_ENABLED") != "1":
            return False
        OAuthConfig.environment()
        return True

    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": PROFILE,
        "accountLinkEnabled": _invoke(configured),
        "scope": SCOPE,
        "runtimeReady": False,
    }


@owner_router.get("/{request_id}")
async def pending(request_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    cookie = _invoke(lambda: native_browser(request, service))
    return await run_in_threadpool(_invoke, lambda: service.pending(user.uid, request_id, cookie))


@owner_router.post("/{request_id}/pending")
async def browser_pending(request_id: str, request: Request, user: Owner, service: Service):
    # Same-origin GET is not required to carry Origin. A closed POST lets the
    # browser send it naturally while preserving the exact cookie/Origin guard.
    _invoke(lambda: control_transport(request))
    cookie = _invoke(lambda: native_browser(request, service))
    await body(request, {"contractVersion"}, max_bytes=4096)
    return await run_in_threadpool(_invoke, lambda: service.pending(user.uid, request_id, cookie))


@owner_router.post("/{request_id}/approvals")
async def approve(request_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    cookie = _invoke(lambda: native_browser(request, service))
    value = await body(request, {"contractVersion", "vaultId"}, max_bytes=4096)
    callback = await run_in_threadpool(
        _invoke, lambda: service.approve(user.uid, request_id, cookie, value["vaultId"])
    )
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": PROFILE,
        "redirectTo": callback,
    }


def get_native_connections():
    from .native_transport import NativeConnectionOwnerService

    return NativeConnectionOwnerService(get_store())


Connections = Annotated[object, Depends(get_native_connections)]
connections_router = APIRouter(prefix="/api/v2/persistent-connections", route_class=PrivateRoute)


@connections_router.get("")
def connections(request: Request, user: Owner, service: Connections):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.native_connections(user.uid))


@connections_router.post("/{connection_id}/revocations")
async def disconnect(connection_id: str, request: Request, user: Owner, service: Connections):
    _invoke(lambda: control_transport(request))
    await body(request, {"contractVersion"}, max_bytes=4096)
    return await run_in_threadpool(
        _invoke, lambda: service.native_disconnect(user.uid, connection_id)
    )
