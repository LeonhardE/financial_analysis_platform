"""Independent policy HTTP boundary; health needs no credentials or live state."""

import os
from typing import Annotated
from urllib.parse import parse_qsl

from authlib.oauth2.rfc6749.errors import OAuth2Error
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.http import PrivateResponseHeaders

from .attestation import GoogleAttestation
from .config import Config
from .contracts import Unavailable, closed, deny, https
from .oauth import OAuth
from .policy import Policy
from .signing import KMS
from .store import configured_store


class PolicyRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def protected(request):
            try:
                return await handler(request)
            except (ContractError, Unavailable, OAuth2Error, HTTPException, RequestValidationError):
                raise
            except Exception as error:
                raise HTTPException(503, "Policy authority unavailable.") from error

        return protected


app = FastAPI(title="FolioView Agent Policy", version="0.1.0")
app.router.route_class = PolicyRoute
app.add_middleware(PrivateResponseHeaders, prefixes=("/",))


def origins():
    try:
        return [
            https(v.strip(), origin=True)
            for v in os.getenv("CORS_ORIGINS", "").split(",")
            if v.strip()
        ]
    except ContractError:
        return []


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-FolioView-Contract"],
)


def get_policy():
    config = Config.environment()
    return Policy(config, configured_store(config), KMS(config), GoogleAttestation())


def get_active_policy():
    config = Config.environment(active=True)
    return Policy(config, configured_store(config), KMS(config), GoogleAttestation())


Service = Annotated[Policy, Depends(get_policy)]
Active = Annotated[Policy, Depends(get_active_policy)]
Owner = Annotated[CurrentUser, Depends(require_google_user)]


@app.exception_handler(ContractError)
async def contract_error(request, error):
    status = {
        "not_found": 404,
        "payload_too_large": 413,
        "idempotency_conflict": 409,
        "version_conflict": 409,
        "malformed_request": 400,
        "unsupported_contract": 400,
    }.get(error.code, 403)
    return JSONResponse(
        {"error": error.code}, status_code=status, headers={"Cache-Control": "no-store"}
    )


@app.exception_handler(Unavailable)
async def unavailable(request, error):
    return JSONResponse(
        {"error": "authorization_unavailable"},
        status_code=503,
        headers={"Cache-Control": "no-store"},
    )


@app.exception_handler(OAuth2Error)
async def oauth_error(request, error):
    return JSONResponse(
        {"error": error.error, "error_description": "OAuth request rejected."},
        status_code=400,
        headers={"Cache-Control": "no-store"},
    )


@app.exception_handler(HTTPException)
@app.exception_handler(RequestValidationError)
async def http_error(request, error):
    status = error.status_code if isinstance(error, HTTPException) else 400
    return JSONResponse(
        {"error": "request_rejected"}, status_code=status, headers={"Cache-Control": "no-store"}
    )


def transport(request, *, bearer=False):
    if request.query_params or any(
        request.headers.getlist(k)
        for k in (
            "idempotency-key",
            "x-folioview-owner",
            "x-folioview-author-key",
            "x-folioview-delegation",
            "x-folioview-authority-delegation",
        )
    ):
        deny("malformed_request")
    values = request.headers.getlist("authorization")
    if bearer:
        if (
            len(values) != 1
            or not values[0].startswith("Bearer ")
            or any(c.isspace() for c in values[0][7:])
        ):
            deny()
        return values[0][7:]


async def raw_body(request, maximum):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > maximum:
            deny("payload_too_large")
        raw.extend(chunk)
    return bytes(raw)


async def body(request, fields, maximum=65536):
    if request.headers.getlist("x-folioview-contract") != [
        CONTRACT_VERSION
    ] or request.headers.getlist("content-type") != ["application/json"]:
        deny("unsupported_contract")
    value = strict_json_loads(await raw_body(request, maximum), max_bytes=maximum)
    closed(value, set(fields) | {"contractVersion"}, maximum=maximum)
    if value["contractVersion"] != CONTRACT_VERSION:
        deny("unsupported_contract")
    return value


def bounded(value):
    check_read_response(value)
    return value


def cookie(request):
    if (
        len(request.headers.getlist("cookie")) != 1
        or request.headers["cookie"].count("__Host-policy-consent=") != 1
    ):
        deny()
    return request.cookies.get("__Host-policy-consent", "")


@app.get("/health")
def health():
    return {"status": "ok", "service": "agent-policy"}


@app.get("/.well-known/oauth-authorization-server")
def metadata(service: Active):
    origin = service.config.issuer
    return {
        "issuer": origin,
        "authorization_endpoint": origin + "/oauth/authorize",
        "token_endpoint": origin + "/oauth/token",
        "revocation_endpoint": origin + "/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_basic"],
        "authorization_response_iss_parameter_supported": True,
        "scopes_supported": ["executor:execute", "executor:write_report", "executor:recover"],
    }


@app.get("/oauth/authorize")
async def authorize(request: Request, service: Active):
    pairs = list(request.query_params.multi_items())
    if len({k for k, v in pairs}) != len(pairs) or request.headers.getlist("authorization"):
        deny("malformed_request")
    result, secret = await run_in_threadpool(OAuth(service).begin, dict(pairs))
    response = RedirectResponse(
        result["consentUrl"], status_code=303, headers={"Referrer-Policy": "no-referrer"}
    )
    response.set_cookie(
        "__Host-policy-consent",
        secret,
        max_age=300,
        secure=True,
        httponly=True,
        samesite="none",
        path="/",
    )
    return response


async def form(request):
    if request.query_params or len(request.headers.getlist("authorization")) > 1:
        deny("malformed_request")
    if request.headers.get("content-type", "").split(";")[0] != "application/x-www-form-urlencoded":
        deny("malformed_request")
    try:
        pairs = parse_qsl(
            (await raw_body(request, 24576)).decode("utf-8"),
            keep_blank_values=True,
            strict_parsing=True,
            max_num_fields=16,
        )
        if len({k for k, v in pairs}) != len(pairs):
            deny("malformed_request")
        return dict(pairs)
    except (ValueError, UnicodeError):
        deny("malformed_request")


def protocol_response(value):
    if isinstance(value["body"], dict):
        return JSONResponse(value["body"], status_code=value["status"], headers=value["headers"])
    return Response(value["body"], status_code=value["status"], headers=value["headers"])


@app.post("/oauth/token")
async def token(request: Request, service: Active):
    data = await form(request)
    return protocol_response(
        await run_in_threadpool(OAuth(service).token, data, dict(request.headers))
    )


@app.post("/oauth/revoke")
async def revoke(request: Request, service: Service):
    data = await form(request)
    return protocol_response(
        await run_in_threadpool(
            lambda: OAuth(service).token(data, dict(request.headers), revoke=True)
        )
    )


@app.get("/api/v1/connections/{connection}")
def owner_state(connection: str, request: Request, user: Owner, service: Service):
    transport(request)
    if request.headers.getlist("x-folioview-contract") != [CONTRACT_VERSION]:
        deny("unsupported_contract")
    return bounded(service.owner_state(user.uid, connection))


@app.post("/api/v1/enrollment-reviews")
async def enrollment_review(request: Request, user: Owner, service: Service):
    from .enrollment_review import review

    transport(request)
    value = await body(request, {"request"}, maximum=132096)
    return await run_in_threadpool(lambda: bounded(review(service, user.uid, value["request"])))


@app.post("/api/v1/connections/{connection}/certificate-reviews")
async def certificate_review(connection: str, request: Request, user: Owner, service: Service):
    from .enrollment_review import certificate_review as review

    transport(request)
    value = await body(request, {"request"}, maximum=18432)
    return await run_in_threadpool(
        lambda: bounded(review(service, user.uid, connection, value["request"]))
    )


@app.post("/api/v1/connections/{connection}/controls", status_code=201)
async def controls(connection: str, request: Request, user: Owner, service: Service):
    transport(request)
    value = await body(request, {"request"})
    return await run_in_threadpool(
        lambda: bounded(service.control(user.uid, connection, value["request"]))
    )


@app.post("/api/v1/connections/{connection}/checkpoint")
async def owner_checkpoint(connection: str, request: Request, user: Owner, service: Active):
    transport(request)
    await body(request, set())
    return await run_in_threadpool(lambda: bounded(service.owner_checkpoint(user.uid, connection)))


@app.get("/api/v1/authorizations/{pending}")
def pending_authorization(pending: str, request: Request, user: Owner, service: Active):
    transport(request)
    if request.headers.getlist("x-folioview-contract") != [CONTRACT_VERSION]:
        deny("unsupported_contract")
    return bounded(OAuth(service).pending(user.uid, pending, cookie(request)))


@app.post("/api/v1/authorizations/{pending}/approvals")
async def approve_authorization(pending: str, request: Request, user: Owner, service: Active):
    transport(request)
    value = await body(request, {"connectionId", "command"})
    result = await run_in_threadpool(
        OAuth(service).approve,
        user.uid,
        pending,
        cookie(request),
        value["connectionId"],
        value["command"],
    )
    if result["status"] not in {302, 303}:
        return protocol_response(result)
    response = JSONResponse(
        {"redirectUri": result["headers"]["Location"]}, headers={"Referrer-Policy": "no-referrer"}
    )
    response.delete_cookie(
        "__Host-policy-consent", secure=True, httponly=True, samesite="none", path="/"
    )
    return response


def agent_endpoint(method, *, release=False, workload=False):
    async def handle(connection: str, request: Request, service: Active):
        if workload:
            transport(request)
            if request.headers.getlist("authorization"):
                deny("malformed_request")
            access = None
        else:
            access = transport(request, bearer=True)
        value = await body(request, {"proof", "request"})
        args = (connection, access, value["proof"], request.url.path, value["request"])
        options = {"release": release} if method == "grant" else {}
        if workload:
            options["workload"] = True
        return await run_in_threadpool(lambda: bounded(getattr(service, method)(*args, **options)))

    handle.__name__ = "policy_" + method + ("_release" if release else "")
    return handle


for route, method, release in (
    ("challenges", "challenge", False),
    ("leases", "grant", False),
    ("releases", "grant", True),
    ("confirm", "confirm", False),
    ("checkpoint", "checkpoint_read", False),
    ("commits", "commit", False),
):
    app.add_api_route(
        "/v1/connections/{connection}/" + route,
        agent_endpoint(method, release=release),
        methods=["POST"],
    )

for route, method, release in (
    ("challenges", "challenge", False),
    ("releases", "grant", True),
    ("confirm", "confirm", False),
):
    app.add_api_route(
        "/workload/v1/connections/{connection}/" + route,
        agent_endpoint(method, release=release, workload=True),
        methods=["POST"],
    )
