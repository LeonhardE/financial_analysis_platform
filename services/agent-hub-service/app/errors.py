"""Formal v2 error framing, including auth, middleware and missing routes."""

import json
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from folioview_shared.encrypted.errors import ERROR_STATUS, ContractError

_STATUS_CODES = {
    400: "malformed_request",
    401: "invalid_token",
    403: "insufficient_scope",
    404: "not_found",
    405: "malformed_request",
    408: "malformed_request",
    409: "version_conflict",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "invalid_envelope",
}


class HubErrors:
    """No raw auth/validation/SDK diagnostics cross the v2 HTTP boundary.

    This wraps CORS as well as route handling, so rejected preflight requests use
    the same closed DTO. Buffered error bodies are bounded and never forwarded.
    Successful bodies and non-v2 endpoints remain unchanged.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or not scope.get("path", "").startswith(
            (
                "/api/v2/",
                "/internal/v2/",
                "/.well-known/",
                "/agent/v2/tasks/",
                "/agent/v2/preparations/",
                "/agent/v2/runs/",
            )
        ):
            await self.app(scope, receive, send)
            return
        start = None
        buffered = bytearray()
        response_started = False

        async def error_response(status, headers):
            code = _STATUS_CODES.get(
                status, "authorization_unavailable" if status >= 500 else "malformed_request"
            )
            try:
                value = json.loads(buffered)
                detail = value.get("detail") if type(value) is dict else None
                if type(detail) is dict and detail.get("code") in ERROR_STATUS:
                    code = detail["code"]
                elif (
                    type(value) is dict
                    and value.get("contractVersion") == "folioview.agent-workspace.v2.0"
                    and type(value.get("error")) is dict
                    and value["error"].get("code") in ERROR_STATUS
                ):
                    code = value["error"]["code"]
            except (ValueError, UnicodeError, TypeError):
                pass
            failure = ContractError(code)
            body = json.dumps(failure.response(uuid.uuid4().hex), separators=(",", ":")).encode()
            kept = [
                pair
                for pair in headers
                if pair[0].lower() not in {b"content-length", b"content-type", b"cache-control"}
            ]
            await send(
                {
                    "type": "http.response.start",
                    "status": failure.status,
                    "headers": [
                        *kept,
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"cache-control", b"no-store"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})

        async def boundary(message: Message):
            nonlocal start, response_started
            if message["type"] == "http.response.start":
                if message["status"] >= 400:
                    start = message
                    return
                response_started = True
            elif message["type"] == "http.response.body" and start is not None:
                chunk = message.get("body", b"")
                if len(buffered) + len(chunk) <= 8192:
                    buffered.extend(chunk)
                if not message.get("more_body", False):
                    response_started = True
                    await error_response(start["status"], start.get("headers", []))
                return
            await send(message)

        try:
            await self.app(scope, receive, boundary)
        except Exception:
            if response_started:
                raise
            buffered.clear()
            await error_response(503, [])
