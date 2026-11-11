"""Bootstrap-only MCP v3; financial APIs remain current Agent PoP endpoints."""

import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from folioview_shared.encrypted.constants import (
    MAX_HTTP_WRITE_BYTES,
    MAX_READ_BYTES,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads

from .mcp_transport import failure, protocol_response
from .native_transport import SCOPE
from .native_transport_routes import get_native_transport as get_native_service
from .runtime_setup import RuntimeSetupService


def enabled():
    return all(
        os.getenv(flag) == "1"
        for flag in ("HUB_PERSISTENT_TRANSPORT_ENABLED", "HUB_PERSISTENT_MCP_ENABLED")
    )


def create_native_server(oauth):
    from mcp.server import MCPServer
    from mcp.server.auth.middleware.auth_context import get_access_token
    from mcp.server.auth.provider import AccessToken
    from mcp.server.auth.settings import AuthSettings
    from mcp.server.transport_security import TransportSecuritySettings
    from mcp_types import CallToolResult, TextContent, Tool, ToolAnnotations

    owned = os.getenv("HUB_AGENT_OWNED_CREDENTIALS_ENABLED") == "1"
    if owned:
        from .helper_assets import _owner_origins
        from .native_credentials import NativeCredentialService

        owner_url = os.getenv("HUB_AGENT_OWNER_URL", "")
        if urlsplit(owner_url).scheme + "://" + urlsplit(owner_url).netloc not in _owner_origins():
            raise ContractError("authorization_unavailable")
        domain = NativeCredentialService(oauth, owner_url=owner_url)
    else:
        domain = RuntimeSetupService(oauth)

    class Verifier:
        async def verify_token(self, token):
            try:
                p = await run_in_threadpool(oauth.authenticate, token)
                return AccessToken(
                    token=token,
                    client_id=p.client_id,
                    scopes=[SCOPE],
                    expires_at=p.expires_at,
                    resource=oauth.config.resource,
                    subject=p.connection_id + ":" + p.authorization_id,
                    claims={"iss": oauth.config.issuer},
                )
            except Exception:
                return None

    class NativeServer(MCPServer):
        async def list_tools(self):
            if owned:
                return [
                    Tool(
                        name=name,
                        description=description,
                        input_schema=schema,
                        annotations=ToolAnnotations(
                            read_only_hint=name in {"agent_connection", "agent_activation"},
                            destructive_hint=False,
                            idempotent_hint=name != "prepare_agent_authorization",
                            open_world_hint=False,
                        ),
                    )
                    for name, description, schema in [
                        (
                            "agent_connection",
                            (
                                "Inspect this preregistered Agent connection. Credentials live "
                                "in the Agent "
                                "private directory. Missing/expired/rejected credentials "
                                "require user "
                                "reauthorization; never recreate them silently. OAuth grants no "
                                "financial access."
                            ),
                            {"type": "object", "properties": {}, "additionalProperties": False},
                        ),
                        (
                            "prepare_agent_authorization",
                            (
                                "Only for explicit connection or reauthorization: create a "
                                "10-minute pairing "
                                "intent. Run the reviewed local credential helper, submit only "
                                "its encrypted "
                                "public offer, then show the user its authorization link. "
                                "Private keys stay "
                                "local. A failed setup preserves the current connection."
                            ),
                            {"type": "object", "properties": {}, "additionalProperties": False},
                        ),
                        (
                            "submit_agent_offer",
                            (
                                "Submit the reviewed local helper's opaque encrypted public-key "
                                "offer. Do not "
                                "transcribe or upload private keys. This cannot activate keys "
                                "without the Owner's "
                                "signed approval."
                            ),
                            {
                                "type": "object",
                                "properties": {
                                    "setupIntentId": {"type": "string"},
                                    "offer": {
                                        "type": "object",
                                        "properties": {
                                            "version": {"const": 1},
                                            "iv": {"type": "string"},
                                            "ciphertext": {"type": "string"},
                                        },
                                        "required": ["version", "iv", "ciphertext"],
                                        "additionalProperties": False,
                                    },
                                },
                                "required": ["setupIntentId", "offer"],
                                "additionalProperties": False,
                            },
                        ),
                        (
                            "agent_activation",
                            (
                                "Get the opaque Owner-encrypted activation for this "
                                "connection's setup. Pass it "
                                "to the same local helper; it validates the trusted Root anchor "
                                "before activating "
                                "the locally saved keys. Never treats a platform receipt as a "
                                "native scheduled "
                                "task."
                            ),
                            {
                                "type": "object",
                                "properties": {"setupIntentId": {"type": "string"}},
                                "required": ["setupIntentId"],
                                "additionalProperties": False,
                            },
                        ),
                    ]
                ]
            return [
                Tool(
                    name="open_persistent_runtime",
                    description=(
                        "Open FolioView's fixed browser runtime. Reuse this connection's existing "
                        "protected browser window/tab and stored key profile; do not assume "
                        "a new window retains IndexedDB. Navigate the original fixed URL "
                        "in that context. Never generate replacement keys on resume; "
                        "first pairing requires owner review. Return public setup metadata only. "
                        "For scheduling, create or change the actual Muse native plan first; "
                        "then report its state through the fixed runtime reportPlan API. "
                        "A connection or report receipt never proves a native plan exists."
                    ),
                    input_schema={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False,
                    },
                    annotations=ToolAnnotations(
                        read_only_hint=False,
                        destructive_hint=False,
                        idempotent_hint=True,
                        open_world_hint=False,
                    ),
                ),
                Tool(
                    name="confirm_runtime_offer",
                    description=(
                        "Associate the opaque offer fingerprint from the fixed browser runtime "
                        "with this native connection. Do not transcribe keys. Owner approval "
                        "and protected host validation remain separate."
                    ),
                    input_schema={
                        "type": "object",
                        "properties": {
                            "setupIntentId": {"type": "string", "minLength": 22, "maxLength": 128},
                            "offerFingerprint": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
                        },
                        "required": ["setupIntentId", "offerFingerprint"],
                        "additionalProperties": False,
                    },
                    annotations=ToolAnnotations(
                        read_only_hint=False,
                        destructive_hint=False,
                        idempotent_hint=True,
                        open_world_hint=False,
                    ),
                ),
            ]

        async def call_tool(self, name, arguments, context=None):
            try:
                auth = get_access_token()
                if auth is None:
                    raise ContractError("invalid_token")
                if owned:
                    if name == "agent_connection" and arguments == {}:
                        value = await run_in_threadpool(domain.inspect, auth.token)
                    elif name == "prepare_agent_authorization" and arguments == {}:
                        value = await run_in_threadpool(domain.prepare, auth.token)
                    elif (
                        name == "submit_agent_offer"
                        and type(arguments) is dict
                        and set(arguments) == {"setupIntentId", "offer"}
                    ):
                        value = await run_in_threadpool(
                            domain.offer, auth.token, arguments["setupIntentId"], arguments["offer"]
                        )
                    elif (
                        name == "agent_activation"
                        and type(arguments) is dict
                        and set(arguments) == {"setupIntentId"}
                    ):
                        value = await run_in_threadpool(
                            domain.activation, auth.token, arguments["setupIntentId"]
                        )
                    else:
                        raise ContractError("malformed_request")
                elif name == "open_persistent_runtime" and arguments == {}:
                    value = await run_in_threadpool(domain.bootstrap, auth.token)
                elif (
                    name == "confirm_runtime_offer"
                    and type(arguments) is dict
                    and set(arguments) == {"setupIntentId", "offerFingerprint"}
                ):
                    value = await run_in_threadpool(
                        domain.confirm,
                        auth.token,
                        arguments["setupIntentId"],
                        arguments["offerFingerprint"],
                    )
                else:
                    raise ContractError("malformed_request")
                if len(canonical_json(value)) > 32768:
                    raise ContractError("payload_too_large")
                return CallToolResult(
                    content=[TextContent(type="text", text="Runtime connection response.")],
                    structured_content=value,
                    is_error=False,
                )
            except Exception as error:
                return CallToolResult(
                    content=[TextContent(type="text", text=failure(error))], is_error=True
                )

        async def read_resource(self, uri, context=None):
            # No financial resource or bearer-returning resource templates exist.
            raise ValueError("Unsupported resource.")

    server = NativeServer(
        "FolioView persistent runtime",
        token_verifier=Verifier(),
        auth=AuthSettings(
            issuer_url=oauth.config.issuer,
            resource_server_url=oauth.config.resource,
            required_scopes=[SCOPE],
            validate_token_resource=True,
        ),
        subscriptions=False,
        log_level="CRITICAL",
    )
    logging.getLogger("mcp").setLevel(logging.CRITICAL)
    origin = oauth.config.base.issuer
    application = server.streamable_http_app(
        streamable_http_path="/v3",
        json_response=True,
        stateless_http=True,
        max_request_body_size=MAX_HTTP_WRITE_BYTES,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[urlsplit(origin).netloc],
            allowed_origins=[origin],
        ),
    )
    return server, application


class NativeMCPBoundary:
    def __init__(self, factory=get_native_service):
        self.factory, self.application, self.issuer = factory, None, None

    @asynccontextmanager
    async def lifespan(self):
        if not enabled():
            yield
            return
        try:
            oauth = self.factory()
            server, application = create_native_server(oauth)
        except Exception:
            # Misconfiguration cannot make health depend on Firebase/ADC.
            yield
            return
        async with server.session_manager.run():
            self.application, self.issuer = application, oauth.config.base.issuer
            try:
                yield
            finally:
                self.application, self.issuer = None, None

    async def __call__(self, scope, receive, send):
        async def reject(code, status):
            headers = {"Cache-Control": "no-store"}
            if status == 401 and self.issuer:
                headers["WWW-Authenticate"] = (
                    'Bearer resource_metadata="'
                    + self.issuer
                    + '/.well-known/oauth-protected-resource/mcp/v3"'
                )
            await JSONResponse({"error": code}, status_code=status, headers=headers)(
                scope, receive, send
            )

        if scope["type"] != "http":
            return
        # Mounted SDK metadata aliases and old transports are intentionally absent.
        if scope["path"] != "/mcp/v3":
            await reject("not_found", 404)
            return
        if not enabled() or self.application is None:
            await reject("authorization_unavailable", 503)
            return
        headers = {}
        for name, value in scope["headers"]:
            headers.setdefault(name.lower(), []).append(value.decode("latin-1"))
        host = urlsplit(self.issuer).netloc
        if headers.get(b"host") != [host] or (
            b"origin" in headers and headers[b"origin"] != [self.issuer]
        ):
            await reject("invalid_origin", 403)
            return
        if scope.get("query_string") or any(
            h in headers for h in (b"x-folioview-delegation", b"x-serverless-authorization")
        ):
            await reject("malformed_request", 400)
            return
        auth = headers.get(b"authorization", [])
        if len(auth) != 1 or not auth[0].startswith("Bearer ") or auth[0].count(" ") != 1:
            await reject("invalid_token", 401)
            return
        # JSON response mode has no SSE listener, DELETE session or legacy endpoint.
        if scope["method"] != "POST":
            await reject("method_not_allowed", 405)
            return
        if headers.get(b"content-type") not in (
            ["application/json"],
            ["application/json; charset=utf-8"],
        ):
            await reject("malformed_request", 415)
            return
        if b"content-encoding" in headers or len(headers.get(b"content-length", [])) > 1:
            await reject("malformed_request", 400)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_HTTP_WRITE_BYTES:
                await reject("payload_too_large", 413)
                return
            if not message.get("more_body", False):
                break
        declared = headers.get(b"content-length")
        if declared is not None and (
            len(declared[0]) > 8
            or not declared[0].isascii()
            or not declared[0].isdigit()
            or int(declared[0]) != len(body)
        ):
            await reject("malformed_request", 400)
            return
        try:
            strict_json_loads(bytes(body), max_bytes=MAX_HTTP_WRITE_BYTES)
        except ContractError:
            await reject("malformed_request", 400)
            return
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        response_start, response_body, overflow = None, bytearray(), False

        async def no_store(message):
            nonlocal response_start, overflow
            if message["type"] == "http.response.start":
                message["headers"] = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"
                ] + [(b"cache-control", b"no-store")]
                response_start = message
            elif message["type"] == "http.response.body":
                if not overflow:
                    response_body.extend(message.get("body", b""))
                    if len(response_body) > MAX_READ_BYTES:
                        overflow = True
                        response_body.clear()
                if not message.get("more_body", False):
                    if overflow:
                        # Bound the ACTUAL MCP wrapper, including echoed IDs and
                        # JSON escaped resource text. Never send a partial packet.
                        await reject("payload_too_large", 413)
                    else:
                        try:
                            outgoing = protocol_response(response_body)
                        except ContractError:
                            await reject("authorization_unavailable", 503)
                            return
                        response_start["headers"] = [
                            (k, v)
                            for k, v in response_start["headers"]
                            if k.lower() != b"content-length"
                        ] + [(b"content-length", str(len(outgoing)).encode())]
                        await send(response_start)
                        await send({"type": "http.response.body", "body": outgoing})

        child = {**scope, "root_path": scope.get("root_path", "") + "/mcp"}
        await self.application(child, replay, no_store)


def install_native_mcp(app, *, factory=get_native_service):
    boundary = NativeMCPBoundary(factory)
    previous = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(host):
        async with previous(host), boundary.lifespan():
            yield

    app.router.lifespan_context = lifespan
    app.add_route(
        "/mcp/v3",
        boundary,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        include_in_schema=False,
    )
    return boundary
