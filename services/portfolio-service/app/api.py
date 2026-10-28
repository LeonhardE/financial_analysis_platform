"""Bounded owner HTTP transport for the encrypted Portfolio store."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.constants import (
    CONTRACT_VERSION,
    MAX_CONTROL_BYTES,
    MAX_HTTP_WRITE_BYTES,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.http import PrivateRoute

from .holdings import PortfolioError, PortfolioService
from .store import get_store

router = APIRouter(prefix="/api/v2/holdings/sources", route_class=PrivateRoute)
WRITE_BODY_TIMEOUT_SECONDS = 5


def get_service():
    return PortfolioService(get_store())


Owner = Annotated[CurrentUser, Depends(require_google_user)]
Service = Annotated[PortfolioService, Depends(get_service)]


def _transport(request: Request, *, write=False):
    if request.query_params:
        raise ContractError("unsupported_query")
    name = "x-folioview-contract"
    if request.headers.getlist(name) != [CONTRACT_VERSION]:
        raise ContractError("unsupported_contract")
    if write:
        if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
            raise ContractError("unsupported_media_type")
        for name in ("idempotency-key", "x-folioview-author-key"):
            if len(request.headers.getlist(name)) != 1:
                raise ContractError("malformed_request")


def _invoke(action):
    try:
        return action()
    except ContractError as error:
        raise HTTPException(
            error.status, {"code": error.code}, headers={"Cache-Control": "no-store"}
        ) from None
    except PortfolioError as error:
        raise HTTPException(
            error.status, {"code": error.code}, headers={"Cache-Control": "no-store"}
        ) from None


@router.get("/{source_id}")
def metadata(source_id: str, request: Request, user: Owner, service: Service):
    def read():
        _transport(request)
        return service.metadata(user.uid, source_id)

    return _invoke(read)


@router.get("/{source_id}/latest")
def latest(source_id: str, request: Request, user: Owner, service: Service):
    def read():
        _transport(request)
        return service.snapshot(user.uid, source_id)

    return _invoke(read)


@router.get("/{source_id}/snapshots/{snapshot_id}")
def snapshot(source_id: str, snapshot_id: str, request: Request, user: Owner, service: Service):
    def read():
        _transport(request)
        return service.snapshot(user.uid, source_id, snapshot_id)

    return _invoke(read)


@router.get("/{source_id}/operations/{operation_id}")
def receipt(source_id: str, operation_id: str, request: Request, user: Owner, service: Service):
    def read():
        _transport(request)
        return service.receipt(user.uid, source_id, operation_id)

    return _invoke(read)


@router.put("/{source_id}/snapshots/{snapshot_id}")
async def commit(source_id: str, snapshot_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: _transport(request, write=True))
    value = await _read_json(request, max_bytes=MAX_HTTP_WRITE_BYTES)
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "expectedRevision", "carrier"}
        or value["contractVersion"] != CONTRACT_VERSION
    ):
        raise HTTPException(400, {"code": "malformed_request"})

    return await run_in_threadpool(
        _invoke,
        lambda: service.commit(
            user.uid,
            source_id,
            snapshot_id,
            expected_revision=value["expectedRevision"],
            writer_key_id=request.headers["x-folioview-author-key"],
            operation_id=request.headers["idempotency-key"],
            carrier=value["carrier"],
            contract_header=request.headers["x-folioview-contract"],
        ),
    )


async def _read_json(request, *, max_bytes):
    try:
        body = bytearray()
        async with asyncio.timeout(WRITE_BODY_TIMEOUT_SECONDS):
            async for chunk in request.stream():
                if len(chunk) > max_bytes - len(body):
                    raise ContractError("payload_too_large")
                body.extend(chunk)
        return strict_json_loads(bytes(body), max_bytes=max_bytes)
    except ContractError as error:
        raise HTTPException(error.status, {"code": error.code}) from None
    except TimeoutError:
        raise HTTPException(400, {"code": "malformed_request"}) from None


@router.post("/{source_id}/mutations/{action}", status_code=202)
async def begin_mutation(
    source_id: str, action: str, request: Request, user: Owner, service: Service
):
    _invoke(lambda: _transport(request, write=True))
    value = await _read_json(request, max_bytes=MAX_CONTROL_BYTES + 1024)
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "expectedVersion", "expectedSourceEpoch", "command"}
        or value["contractVersion"] != CONTRACT_VERSION
    ):
        raise HTTPException(400, {"code": "malformed_request"})
    return await run_in_threadpool(
        _invoke,
        lambda: service.begin_mutation(
            user.uid,
            source_id,
            action,
            expected_version=value["expectedVersion"],
            expected_source_epoch=value["expectedSourceEpoch"],
            operation_id=request.headers["idempotency-key"],
            writer_key_id=request.headers["x-folioview-author-key"],
            command=value["command"],
        ),
    )


@router.get("/{source_id}/mutations/{operation_id}")
def mutation(source_id: str, operation_id: str, request: Request, user: Owner, service: Service):
    def read():
        _transport(request)
        return service.mutation(user.uid, source_id, operation_id)

    return _invoke(read)
