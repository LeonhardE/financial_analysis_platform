"""Owner-only opt-in Root publication producer; no Agent read authority here."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, body
from .catalogue import CatalogueService, get_sources
from .persistent_publications import PersistentPublicationService
from .persistent_routes import control_transport, resource_approval_enabled
from .store import get_store
from .vaults import VaultService

router = APIRouter(prefix="/api/v2/persistent-content", route_class=PrivateRoute)


def publication_enabled():
    return os.getenv("HUB_PERSISTENT_PUBLICATIONS_ENABLED") == "1" and resource_approval_enabled()


def require_publication():
    if not publication_enabled():
        raise ContractError("authorization_unavailable")


def get_publications():
    store = get_store()
    return PersistentPublicationService(store, CatalogueService(VaultService(store), get_sources()))


Service = Annotated[PersistentPublicationService, Depends(get_publications)]


@router.get("/{vault_id}/tasks/{task_id}/authority")
def authority(vault_id: str, task_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.task_state(user.uid, vault_id, task_id))


@router.get("/{vault_id}/connections/{connection_id}/operations/{operation_id}")
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


@router.post("/{vault_id}/connections/{connection_id}/publications", status_code=201)
async def publish(
    vault_id: str, connection_id: str, request: Request, user: Owner, service: Service
):
    _invoke(lambda: control_transport(request, operation=True))
    _invoke(require_publication)
    value = await body(request, {"contractVersion", "envelope"}, max_bytes=540672)
    return await run_in_threadpool(
        _invoke,
        lambda: service.publish(
            user.uid, vault_id, connection_id, value["envelope"], request.headers["idempotency-key"]
        ),
    )
