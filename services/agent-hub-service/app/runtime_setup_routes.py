"""Candidate runtime first pairing: key possession/association, never authority."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, body
from .identity_recovery_routes import recovery_transport
from .native_transport_routes import get_native_transport
from .persistent_routes import control_transport
from .runtime_setup import RuntimeSetupService

public_router = APIRouter(prefix="/agent/v3/runtime/setups", route_class=PrivateRoute)
owner_router = APIRouter(prefix="/api/v2/runtime-setups", route_class=PrivateRoute)


def get_runtime_setup():
    def configured():
        if os.getenv("HUB_PERSISTENT_MCP_ENABLED") != "1":
            raise ContractError("authorization_unavailable")
        return RuntimeSetupService(get_native_transport())

    return _invoke(configured)


Service = Annotated[RuntimeSetupService, Depends(get_runtime_setup)]


@public_router.get("/{intent_id}")
def public_state(intent_id: str, request: Request, service: Service):
    _invoke(lambda: recovery_transport(request))
    return _invoke(lambda: service.public_state(intent_id))


@public_router.post("/{intent_id}/offers", status_code=201)
async def offer(intent_id: str, request: Request, service: Service):
    _invoke(lambda: recovery_transport(request))
    value = await body(request, {"contractVersion", "proof"}, max_bytes=24576)
    return await run_in_threadpool(_invoke, lambda: service.offer(intent_id, value["proof"]))


@owner_router.get("/{intent_id}")
def owner_state(intent_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.owner_state(user.uid, intent_id))


@owner_router.post("/{intent_id}/completion")
async def complete(intent_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    await body(request, {"contractVersion"}, max_bytes=4096)
    return await run_in_threadpool(_invoke, lambda: service.complete(user.uid, intent_id))
