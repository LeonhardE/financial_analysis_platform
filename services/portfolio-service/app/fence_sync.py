"""Explicit owner-triggered, retryable delivery of durable source fences.

No browser-supplied ACK, destination, owner, ref or epoch is accepted. Network
I/O happens outside database transactions; only a validated fixed-Hub response
can complete the exact original pending mutation in a fresh transaction.
"""

import asyncio
import os
import re
import time
from datetime import datetime
from functools import lru_cache

import httpx
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute

from .api import Owner, Service, _invoke, _read_json, _transport
from .authority_sync import _origin
from .holdings import PortfolioError
from .lifecycle import public_mutation

MAX_ACK_BYTES = 8192
DELIVERY_TIMEOUT_SECONDS = 12
_TOKEN = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\Z")
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z\Z")
_ACK_FIELDS = {"contractVersion", "mutationId", "ref", "acknowledgedSourceEpoch", "acknowledgedAt"}
_REASONS = {"fence": "account_scope_changed", "disconnect": "disconnected", "delete": "deleted"}


def fence_request(mutation):
    return {
        "contractVersion": CONTRACT_VERSION,
        "ownerSubject": mutation["ownerSubject"],
        "mutationId": mutation["operationId"],
        "ref": mutation["resourceRef"],
        "expectedSourceEpoch": mutation["expectedSourceEpoch"],
        "newSourceEpoch": mutation["sourceEpoch"],
        "reason": _REASONS[mutation["action"]],
    }


def validate_ack(value, request):
    if (
        type(value) is not dict
        or set(value) != _ACK_FIELDS
        or value["contractVersion"] != CONTRACT_VERSION
        or value["mutationId"] != request["mutationId"]
        or canonical_json(value["ref"]) != canonical_json(request["ref"])
        or type(value["acknowledgedSourceEpoch"]) is not int
        or value["acknowledgedSourceEpoch"] != request["newSourceEpoch"]
        or type(value["acknowledgedAt"]) is not str
        or _TIME.fullmatch(value["acknowledgedAt"]) is None
    ):
        raise ContractError("source_unavailable")
    try:
        datetime.fromisoformat(value["acknowledgedAt"].replace("Z", "+00:00"))
    except ValueError:
        raise ContractError("source_unavailable") from None


async def workload_token(audience):
    """One cancellable metadata request for the existing Cloud Run identity."""
    try:
        async with httpx.AsyncClient(timeout=4, follow_redirects=False, trust_env=False) as client:
            async with client.stream(
                "GET",
                "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity",
                params={"audience": audience, "format": "full"},
                headers={"Metadata-Flavor": "Google", "Accept-Encoding": "identity"},
            ) as response:
                if (
                    response.status_code != 200
                    or response.headers.get("metadata-flavor") != "Google"
                ):
                    raise ContractError("authorization_unavailable")
                token = bytearray()
                async for chunk in response.aiter_raw():
                    if len(chunk) > 16_384 - len(token):
                        raise ContractError("authorization_unavailable")
                    token.extend(chunk)
        return token.decode("ascii").strip()
    except (httpx.HTTPError, UnicodeError):
        raise ContractError("authorization_unavailable") from None


class HubFenceClient:
    def __init__(
        self, origin, *, token_factory=workload_token, transport=None, clock=time.monotonic
    ):
        self.origin = _origin(origin)
        self.token_factory, self.transport, self.clock = token_factory, transport, clock

    async def invalidate(self, request):
        # Run on the server event loop so timeout cancellation closes sockets
        # without waiting for a per-request loop or SDK retry worker to finish.
        try:
            async with asyncio.timeout(DELIVERY_TIMEOUT_SECONDS):
                return await self._invalidate(request)
        except TimeoutError:
            raise ContractError("source_unavailable") from None

    async def _invalidate(self, request):
        # Snapshot before invoking external code. Callers derive this packet only
        # from Portfolio's stored owner-verified and signed mutation, never JSON.
        packet = canonical_json(request)
        request = strict_json_loads(packet, max_bytes=MAX_ACK_BYTES)
        deadline = self.clock() + DELIVERY_TIMEOUT_SECONDS
        try:
            token = await self.token_factory(self.origin)
            if self.clock() > deadline:
                raise ContractError("source_unavailable")
            if type(token) is not str or len(token) > 16_384 or _TOKEN.fullmatch(token) is None:
                raise ContractError("authorization_unavailable")
            async with httpx.AsyncClient(
                timeout=4, follow_redirects=False, trust_env=False, transport=self.transport
            ) as client:
                async with client.stream(
                    "POST",
                    self.origin + "/internal/v2/source-fences",
                    headers={
                        "Authorization": "Bearer " + token,
                        "X-FolioView-Contract": CONTRACT_VERSION,
                        "Content-Type": "application/json",
                        "Cache-Control": "no-store",
                        "Accept-Encoding": "identity",
                    },
                    content=packet,
                ) as response:
                    if (
                        response.headers.get("content-type", "").split(";", 1)[0]
                        != "application/json"
                        or response.headers.get("content-encoding", "identity") != "identity"
                    ):
                        raise ContractError("source_unavailable")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        if self.clock() > deadline:
                            raise ContractError("source_unavailable")
                        if len(chunk) > MAX_ACK_BYTES - len(body):
                            raise ContractError("payload_too_large")
                        body.extend(chunk)
                    status = response.status_code
            if self.clock() > deadline:
                raise ContractError("source_unavailable")
            value = strict_json_loads(bytes(body), max_bytes=MAX_ACK_BYTES)
            if status != 200:
                # Forward only closed contract codes, never upstream diagnostics.
                validate_schema("Error", value)
                code = value["error"]["code"]
                if (
                    code
                    in {
                        "invalid_token",
                        "insufficient_scope",
                        "not_found",
                        "version_conflict",
                        "idempotency_conflict",
                    }
                    and ContractError(code).status == status
                ):
                    raise ContractError(code)
                raise ContractError("source_unavailable")
            validate_ack(value, request)
            return value
        except ContractError as error:
            if error.code in {"invalid_envelope", "malformed_request"}:
                raise ContractError("source_unavailable") from None
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            raise ContractError("source_unavailable") from None


@lru_cache(maxsize=1)
def configured_client(origin):
    return HubFenceClient(origin)


async def synchronize(service, uid, source, operation, client_factory):
    mutation = await run_in_threadpool(service.fence_mutation, uid, source, operation)
    if mutation["state"] == "acknowledged":
        return {"contractVersion": CONTRACT_VERSION, **public_mutation(mutation)}
    request = fence_request(mutation)
    ack = await client_factory().invalidate(request)
    # Retain validation at the commit boundary even for injected transports.
    validate_ack(ack, request)
    return await run_in_threadpool(
        service.finish_fence,
        uid,
        source,
        operation_id=operation,
        resource_ref=request["ref"],
        source_epoch=request["newSourceEpoch"],
        expected_mutation=mutation,
    )


router = APIRouter(prefix="/api/v2/holdings/sources", route_class=PrivateRoute)


@router.post("/{source_id}/mutations/{operation_id}/synchronize")
async def synchronize_mutation(
    source_id: str, operation_id: str, request: Request, user: Owner, service: Service
):
    _invoke(lambda: _transport(request))
    if request.headers.getlist("content-type") != ["application/json"]:
        raise HTTPException(415, {"code": "unsupported_media_type"})
    value = await _read_json(request, max_bytes=1024)
    if type(value) is not dict or value != {"contractVersion": CONTRACT_VERSION}:
        raise HTTPException(400, {"code": "malformed_request"})
    try:
        return await synchronize(
            service,
            user.uid,
            source_id,
            operation_id,
            lambda: configured_client(os.getenv("PORTFOLIO_HUB_AUTHORITY_ORIGIN", "")),
        )
    except (ContractError, PortfolioError) as error:
        raise HTTPException(
            error.status, {"code": error.code}, headers={"Cache-Control": "no-store"}
        ) from None
