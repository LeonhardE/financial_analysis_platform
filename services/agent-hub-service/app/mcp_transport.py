"""Disabled-by-default, stateless official MCP transport over opaque Hub OAuth.

The SDK is imported only when both existing producer flags enable this adapter.
No token, user, private key, pending callback or agent session is cached here.
"""

import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from folioview_shared.encrypted.constants import (
    CONTRACT_VERSION,
    MAX_HTTP_WRITE_BYTES,
    MAX_READ_BYTES,
)
from folioview_shared.encrypted.errors import ERROR_STATUS, ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads

from .agent_tools import INPUTS, AgentTools, input_schema, output_schema
from .oauth import OAuthFailure, get_oauth_service


def enabled():
    return all(
        os.getenv(flag) == "1" for flag in ("HUB_OAUTH_ENABLED", "HUB_ENCRYPTED_ADAPTER_ENABLED")
    )


def failure(error):
    if isinstance(error, OAuthFailure):
        return "invalid_token" if error.status == 401 else "insufficient_scope"
    if isinstance(error, ContractError):
        code = {
            "untrusted_key": "recipient_binding_mismatch",
            "rollback_detected": "registry_conflict",
        }.get(error.code, error.code)
        return code if code in ERROR_STATUS else "malformed_request"
    return "authorization_unavailable"


def protocol_response(body):
    """Keep MCP framing while removing legacy SDK validation diagnostics."""
    if not body:
        return bytes(body)
    value = strict_json_loads(bytes(body), max_bytes=MAX_READ_BYTES)
    if type(value) is dict and type(value.get("error")) is dict:
        error = value["error"]
        code = error.get("code")
        if type(code) is not int:
            code = -32603
        message = {
            -32700: "Parse error",
            -32600: "Invalid request",
            -32601: "Method not found",
            -32602: "Invalid parameters",
            -32603: "Internal error",
        }.get(code, "Protocol request failed")
        return canonical_json(
            {
                "jsonrpc": "2.0",
                "id": value.get("id"),
                "error": {"code": code, "message": message},
            }
        )
    return bytes(body)


def create_server(oauth):
    # Pin the public SDK API; no private Next/agent runtime dependencies.
    from mcp.server import MCPServer
    from mcp.server.auth.middleware.auth_context import get_access_token
    from mcp.server.auth.provider import AccessToken
    from mcp.server.auth.settings import AuthSettings
    from mcp.server.lowlevel.helper_types import ReadResourceContents
    from mcp.server.transport_security import TransportSecuritySettings
    from mcp_types import CallToolResult, TextContent, Tool, ToolAnnotations

    domain = AgentTools(oauth)

    class Verifier:
        async def verify_token(self, token):
            try:
                principal = await run_in_threadpool(oauth.authenticate, token)
                return AccessToken(
                    token=token,
                    client_id=principal["clientId"],
                    scopes=principal["scopes"],
                    expires_at=principal["expiresAt"],
                    resource=oauth.config.resource,
                    # Connection + authorization prevent cross-agent SDK principal reuse.
                    subject=principal["connectionId"] + ":" + principal["authorizationId"],
                    claims={"iss": oauth.config.issuer},
                )
            except Exception:
                return None

    class EncryptedServer(MCPServer):
        async def list_tools(self):
            return [
                Tool(
                    name=name,
                    description="FolioView encrypted v2: " + name,
                    input_schema=input_schema(name),
                    output_schema=output_schema(name),
                    annotations=ToolAnnotations(
                        read_only_hint=name
                        in {"list_tasks_v2", "get_task_v2", "get_run_inputs_v2", "get_receipt_v2"},
                        destructive_hint=False,
                        idempotent_hint=True,
                        open_world_hint=False,
                    ),
                )
                for name in INPUTS
            ]

        async def call_tool(self, name, arguments, context=None):
            try:
                auth = get_access_token()
                if auth is None:
                    raise ContractError("invalid_token")
                value = await run_in_threadpool(domain.call, auth.token, name, arguments)
                # Never duplicate a large carrier in text and structured content.
                result = CallToolResult(
                    content=[
                        TextContent(
                            type="text", text="null" if value is None else "Encrypted v2 response."
                        )
                    ],
                    structured_content=value,
                    is_error=False,
                )
                if (
                    len(
                        canonical_json(
                            result.model_dump(mode="json", by_alias=True, exclude_none=True)
                        )
                    )
                    > MAX_READ_BYTES - 4096
                ):
                    raise ContractError("payload_too_large")
                return result
            except Exception as error:
                return CallToolResult(
                    content=[TextContent(type="text", text=failure(error))], is_error=True
                )

        async def read_resource(self, uri, context=None):
            try:
                auth = get_access_token()
                if auth is None:
                    raise ContractError("invalid_token")
                value = await run_in_threadpool(domain.resource, auth.token, str(uri))
                if len(canonical_json(value)) > MAX_READ_BYTES - 4096:
                    raise ContractError("payload_too_large")
            except Exception as error:
                # A bounded fixed error object avoids SDK exception/URI logging.
                value = {"contractVersion": CONTRACT_VERSION, "error": {"code": failure(error)}}
            return [
                ReadResourceContents(
                    content=canonical_json(value).decode(), mime_type="application/json"
                )
            ]

    server = EncryptedServer(
        "FolioView encrypted agent workspace",
        token_verifier=Verifier(),
        auth=AuthSettings(
            issuer_url=oauth.config.issuer,
            resource_server_url=oauth.config.resource,
            required_scopes=[],
            validate_token_resource=True,
        ),
        subscriptions=False,
        log_level="CRITICAL",
    )
    # Transport parse failures must not log submitted ciphertext, URIs or credentials.
    # Domain exceptions above are sanitized independently of this defense in depth.
    logging.getLogger("mcp").setLevel(logging.CRITICAL)
    parsed = urlsplit(oauth.config.issuer)
    application = server.streamable_http_app(
        streamable_http_path="/v2",
        json_response=True,
        stateless_http=True,
        max_request_body_size=MAX_HTTP_WRITE_BYTES,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[parsed.netloc],
            allowed_origins=[oauth.config.issuer],
        ),
    )
    return server, application


class MCPBoundary:
    def __init__(self, factory=get_oauth_service):
        self.factory, self.application, self.issuer = factory, None, None

    @asynccontextmanager
    async def lifespan(self):
        if not enabled():
            yield
            return
        try:
            oauth = self.factory()
            server, application = create_server(oauth)
        except Exception:
            # Misconfiguration cannot make health depend on Firebase/ADC.
            yield
            return
        async with server.session_manager.run():
            self.application, self.issuer = application, oauth.config.issuer
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
                    + '/.well-known/oauth-protected-resource/mcp/v2"'
                )
            await JSONResponse({"error": code}, status_code=status, headers=headers)(
                scope, receive, send
            )

        if scope["type"] != "http":
            return
        # Mounted SDK metadata aliases and old transports are intentionally absent.
        if scope["path"] != "/mcp/v2":
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

        await self.application(scope, replay, no_store)


def install_mcp(app, *, factory=get_oauth_service):
    boundary = MCPBoundary(factory)
    previous = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(host):
        async with previous(host), boundary.lifespan():
            yield

    app.router.lifespan_context = lifespan

    async def old_namespace(request):
        return JSONResponse(
            {"detail": "Not Found"}, status_code=404, headers={"Cache-Control": "no-store"}
        )

    app.add_route(
        "/mcp",
        old_namespace,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        include_in_schema=False,
    )
    app.mount("/mcp", boundary)
    return boundary
