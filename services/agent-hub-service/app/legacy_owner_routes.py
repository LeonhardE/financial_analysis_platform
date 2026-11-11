"""Historical Owner connection reads and narrowing; no legacy bearer/grant creation."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, body, transport
from .oauth import get_owner_connection_service

owner_router = APIRouter(route_class=PrivateRoute)
OwnerConnections = Annotated[object, Depends(get_owner_connection_service)]


@owner_router.get("/api/v2/agent-capabilities")
async def agent_capabilities(request: Request, user: Owner):
    _invoke(lambda: transport(request))
    return {
        "contractVersion": "folioview.agent-workspace.v2.0",
        "profile": "folioview.owner-agent-capabilities.v1",
        "ownerConnections": True,
        "museConnectionEnabled": False,
    }


@owner_router.get("/api/v2/agent-connections")
async def connections(request: Request, user: Owner, service: OwnerConnections):
    _invoke(lambda: transport(request))
    return await run_in_threadpool(_invoke, lambda: service.connections(user.uid))


@owner_router.post("/api/v2/agent-connections/{connection_id}/revoke")
async def revoke_connection(
    connection_id: str, request: Request, user: Owner, service: OwnerConnections
):
    await body(request, {"contractVersion"})
    return await run_in_threadpool(
        _invoke, lambda: service.revoke_connection(user.uid, connection_id)
    )


@owner_router.post("/api/v2/agent-connections/{connection_id}/grants/{grant_id}/revoke")
async def revoke_grant(
    connection_id: str, grant_id: str, request: Request, user: Owner, service: OwnerConnections
):
    await body(request, {"contractVersion"})
    return await run_in_threadpool(
        _invoke, lambda: service.revoke_grant(user.uid, connection_id, grant_id)
    )
