"""Owner-only persistent identity controls, with explicit enrollment activation."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, body, transport
from .oauth_config import OAuthConfig
from .persistent_agents import PersistentAgentService
from .store import get_store

router = APIRouter(prefix="/api/v2/persistent-agents", route_class=PrivateRoute)


def enrollment_clients():
    if os.getenv("HUB_PERSISTENT_AGENTS_ENABLED") != "1":
        return ()
    return tuple(client.client_id for client in OAuthConfig.environment().clients)


def require_enrollment():
    clients = enrollment_clients()
    if not clients:
        raise ContractError("authorization_unavailable")
    return clients


def get_persistent_service():
    # History and narrowing controls stay available if enrollment is disabled.
    return PersistentAgentService(get_store())


Service = Annotated[PersistentAgentService, Depends(get_persistent_service)]


def control_transport(request, *, operation=False):
    transport(request, operation=operation)
    if (
        request.headers.getlist("x-folioview-author-key")
        or request.headers.getlist("x-folioview-delegation")
        or request.headers.getlist("x-folioview-authority-delegation")
        or (not operation and request.headers.getlist("idempotency-key"))
    ):
        raise ContractError("malformed_request")


@router.get("/capabilities")
def capabilities(request: Request, user: Owner):
    _invoke(lambda: control_transport(request))
    clients = _invoke(enrollment_clients)
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": "folioview.persistent-agent-capabilities.v1",
        "enrollmentEnabled": bool(clients),
        "resourceConsentEnabled": False,
        "executionEnabled": False,
    }


@router.get("/{vault_id}/{connection_id}")
def state(vault_id: str, connection_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.state(user.uid, vault_id, connection_id))


@router.get("/{vault_id}/{connection_id}/operations/{operation_id}")
def receipt(
    vault_id: str,
    connection_id: str,
    operation_id: str,
    request: Request,
    user: Owner,
    service: Service,
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.receipt(user.uid, vault_id, connection_id, operation_id))


@router.post("/{vault_id}/{connection_id}/bindings", status_code=201)
async def enroll(
    vault_id: str,
    connection_id: str,
    request: Request,
    user: Owner,
    service: Service,
):
    _invoke(lambda: control_transport(request, operation=True))
    clients = _invoke(require_enrollment)
    value = await body(request, {"contractVersion", "command"}, max_bytes=24576)
    activated = PersistentAgentService(service.store, client_ids=clients, clock=service.clock)
    return await run_in_threadpool(
        _invoke,
        lambda: activated.command(
            user.uid,
            vault_id,
            connection_id,
            value["command"],
            request.headers["idempotency-key"],
        ),
    )


@router.post("/{vault_id}/{connection_id}/revocations", status_code=201)
async def revoke(
    vault_id: str,
    connection_id: str,
    request: Request,
    user: Owner,
    service: Service,
):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(request, {"contractVersion", "command"}, max_bytes=24576)
    return await run_in_threadpool(
        _invoke,
        lambda: service.command(
            user.uid,
            vault_id,
            connection_id,
            value["command"],
            request.headers["idempotency-key"],
            revoke=True,
        ),
    )
