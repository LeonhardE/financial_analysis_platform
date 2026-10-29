"""Strict HTTP adaptation for the separately authorized v2 Muse OAuth surface.

The consent UI is a configured owner application. This module never collects a
Google token in a form, forwards it to Muse or returns private resource content.
"""

import asyncio
import re
import secrets
from typing import Annotated
from urllib.parse import parse_qsl, urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, body, transport
from .oauth import OAuthFailure, get_oauth_service
from .store import StoreUnavailable

COOKIE = "fv_oauth_flow"
COOKIE_PATH = "/api/v2/agent-authorizations"
PRIVATE = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
AUTHORIZE_FIELDS = {
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    "resource",
}
TOKEN_FIELDS = {
    "grant_type",
    "client_id",
    "code",
    "redirect_uri",
    "code_verifier",
    "refresh_token",
    "resource",
    "scope",
}
REVOKE_FIELDS = {"client_id", "token", "token_type_hint", "resource"}


def _error(error, status=400):
    return JSONResponse(
        {"error": error, "error_description": "OAuth request rejected."},
        status_code=status,
        headers=PRIVATE,
    )


class OAuthRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def invoke(request):
            try:
                return await handler(request)
            except OAuthFailure as error:
                return _error(error.code, error.status)
            except ContractError as error:
                if error.code == "authorization_unavailable":
                    return _error("temporarily_unavailable", 503)
                return _error("invalid_request")
            except StoreUnavailable:
                return _error("temporarily_unavailable", 503)
            except HTTPException as error:
                return _error("invalid_request", error.status_code)
            except Exception:
                return _error("temporarily_unavailable", 503)

        return invoke


router = APIRouter(route_class=OAuthRoute)
owner_router = APIRouter(route_class=PrivateRoute)
agent_router = APIRouter(prefix="/agent/v2", route_class=OAuthRoute)
Service = Annotated[object, Depends(get_oauth_service)]


def _pairs(raw, allowed):
    if len(raw) > 8192 or re.search(rb"%(?![a-fA-F0-9]{2})", raw):
        raise OAuthFailure("invalid_request")
    try:
        values = parse_qsl(
            raw.decode("ascii"),
            keep_blank_values=True,
            strict_parsing=True,
            encoding="utf-8",
            errors="strict",
            max_num_fields=16,
        )
    except (ValueError, UnicodeError):
        raise OAuthFailure("invalid_request") from None
    names = [name for name, _ in values]
    if len(names) != len(set(names)) or not set(names) <= allowed:
        raise OAuthFailure("invalid_request")
    if any(
        len(value) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value) for _, value in values
    ):
        raise OAuthFailure("invalid_request")
    return dict(values)


async def _form(request, allowed):
    if request.query_params or len(request.headers.getlist("content-type")) != 1:
        raise OAuthFailure("invalid_request")
    if request.headers["content-type"].split(";", 1)[0].lower() != (
        "application/x-www-form-urlencoded"
    ):
        raise OAuthFailure("invalid_request")
    raw = bytearray()
    try:
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                if len(chunk) > 8192 - len(raw):
                    raise OAuthFailure("invalid_request")
                raw.extend(chunk)
    except TimeoutError:
        raise OAuthFailure("invalid_request") from None
    return _pairs(bytes(raw), allowed)


def _headers(request):
    values = request.headers.getlist("authorization")
    if len(values) > 1:
        raise OAuthFailure("invalid_client", 401)
    return {"Authorization": values[0]} if values else {}


def _browser(request, service):
    # SameSite alone is not CSRF protection. Owner calls require a trusted Origin,
    # the flow cookie and the normal Firebase owner plus versioned JSON contract.
    expected = urlsplit(service.config.consent_url)
    origin = f"{expected.scheme}://{expected.netloc}"
    if request.headers.getlist("origin") != [origin]:
        raise ContractError("insufficient_scope")
    cookie_headers = request.headers.getlist("cookie")
    matches = []
    for header in cookie_headers:
        for item in header.split(";"):
            name, separator, value = item.strip().partition("=")
            if separator and name == COOKIE:
                matches.append(value)
    if len(matches) != 1 or re.fullmatch(r"[A-Za-z0-9_-]{43}", matches[0]) is None:
        raise ContractError("insufficient_scope")
    return matches[0]


@router.get("/.well-known/oauth-authorization-server")
def metadata(service: Service):
    return JSONResponse(service.metadata(), headers=PRIVATE)


@router.get("/.well-known/oauth-protected-resource/mcp/v2")
def protected_metadata(service: Service):
    return JSONResponse(service.protected_metadata(), headers=PRIVATE)


@router.get("/oauth/authorize")
async def authorize(request: Request, service: Service):
    values = _pairs(request.scope["query_string"], AUTHORIZE_FIELDS)
    browser = secrets.token_urlsafe(32)
    pending = await run_in_threadpool(service.authorize, values, browser)
    response = RedirectResponse(
        service.config.consent_url + "?" + urlencode({"request": pending}),
        status_code=303,
        headers=PRIVATE,
    )
    response.set_cookie(
        COOKIE,
        browser,
        max_age=600,
        httponly=True,
        secure=urlsplit(service.config.issuer).scheme == "https",
        samesite="lax",
        path=COOKIE_PATH,
    )
    return response


async def _protocol(request, service, endpoint, fields):
    form = await _form(request, fields)
    status, value, headers = await run_in_threadpool(
        service.protocol, form, _headers(request), endpoint
    )
    return JSONResponse(value, status_code=status, headers={**dict(headers), **PRIVATE})


@router.post("/oauth/token")
async def token(request: Request, service: Service):
    return await _protocol(request, service, "token", TOKEN_FIELDS)


@router.post("/oauth/revoke")
async def revoke(request: Request, service: Service):
    return await _protocol(request, service, "revoke", REVOKE_FIELDS)


@owner_router.get("/api/v2/agent-authorizations/{request_id}")
async def authorization_status(request_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: transport(request))
    browser = _invoke(lambda: _browser(request, service))
    return await run_in_threadpool(_invoke, lambda: service.status(user.uid, request_id, browser))


@owner_router.post("/api/v2/agent-authorizations/{request_id}/claim")
async def claim(request_id: str, request: Request, user: Owner, service: Service):
    await body(request, {"contractVersion"})
    browser = _invoke(lambda: _browser(request, service))
    return await run_in_threadpool(_invoke, lambda: service.claim(user.uid, request_id, browser))


@owner_router.post("/api/v2/agent-authorizations/{request_id}/prepare")
async def prepare(request_id: str, request: Request, user: Owner, service: Service):
    value = await body(request, {"contractVersion", "taskIds", "connectionId", "approvedScopes"})
    if (
        type(value["approvedScopes"]) is not list
        or not value["approvedScopes"]
        or any(type(scope) is not str for scope in value["approvedScopes"])
    ):
        raise HTTPException(400, {"code": "malformed_request"})
    browser = _invoke(lambda: _browser(request, service))
    return await run_in_threadpool(
        _invoke,
        lambda: service.prepare(
            user.uid,
            request_id,
            browser,
            value["taskIds"],
            value["connectionId"],
            value["approvedScopes"],
        ),
    )


@owner_router.post("/api/v2/agent-authorizations/{request_id}/decision")
async def decide(request_id: str, request: Request, user: Owner, service: Service):
    value = await body(request, {"contractVersion", "decision", "signedGrants"})
    browser = _invoke(lambda: _browser(request, service))
    location = await run_in_threadpool(
        _invoke,
        lambda: service.decide(
            user.uid, request_id, browser, value["decision"], value["signedGrants"]
        ),
    )
    # The owner UI follows this registered OAuth redirect after receiving the
    # authenticated response. The location never contains a Firebase credential.
    response = JSONResponse({"redirectUri": location}, headers=PRIVATE)
    response.delete_cookie(COOKIE, path=COOKIE_PATH)
    return response


@owner_router.get("/api/v2/agent-connections")
async def connections(request: Request, user: Owner, service: Service):
    _invoke(lambda: transport(request))
    return await run_in_threadpool(_invoke, lambda: service.connections(user.uid))


@owner_router.post("/api/v2/agent-connections/{connection_id}/revoke")
async def revoke_connection(connection_id: str, request: Request, user: Owner, service: Service):
    await body(request, {"contractVersion"})
    return await run_in_threadpool(
        _invoke, lambda: service.revoke_connection(user.uid, connection_id)
    )


@owner_router.post("/api/v2/agent-connections/{connection_id}/grants/{grant_id}/revoke")
async def revoke_grant(
    connection_id: str, grant_id: str, request: Request, user: Owner, service: Service
):
    await body(request, {"contractVersion"})
    return await run_in_threadpool(
        _invoke, lambda: service.revoke_grant(user.uid, connection_id, grant_id)
    )


@agent_router.get("/authorization")
async def authorization(request: Request, service: Service):
    if request.query_params:
        raise OAuthFailure("invalid_request")

    def rejected():
        response = _error("invalid_token", 401)
        response.headers["WWW-Authenticate"] = (
            'Bearer resource_metadata="'
            + service.config.issuer
            + '/.well-known/oauth-protected-resource/mcp/v2"'
        )
        return response

    values = request.headers.getlist("authorization")
    if len(values) != 1 or re.fullmatch(r"(?i:Bearer) [A-Za-z0-9_-]{43}", values[0]) is None:
        return rejected()
    try:
        principal = await run_in_threadpool(service.authenticate, values[0].split(" ", 1)[1])
    except OAuthFailure as error:
        if error.status == 401:
            return rejected()
        raise
    return JSONResponse(principal, headers=PRIVATE)
