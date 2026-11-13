"""Owner-only closed alias transport. No Agent path, migration or new key custody."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.private_display_names import (
    DISPLAY_NAME_PROFILE,
    MAX_DISPLAY_HTTP_BYTES,
)
from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, _lifecycle_read, body
from .persistent_routes import control_transport
from .private_display_names import PrivateDisplayNameService
from .store import get_store
from .vaults import MAX_SOURCES

router = APIRouter(prefix="/api/v3/private-display-names", route_class=PrivateRoute)


@lru_cache(maxsize=1)
def get_display_names():
    return PrivateDisplayNameService(get_store())


Service = Annotated[PrivateDisplayNameService, Depends(get_display_names)]


async def read_transport(request):
    _invoke(lambda: control_transport(request))
    await _lifecycle_read(request)


@router.get("/capabilities")
async def capabilities(request: Request, user: Owner):
    await read_transport(request)
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": DISPLAY_NAME_PROFILE,
        "enabled": True,
        "maxSources": MAX_SOURCES,
        "maxNameLength": 80,
    }


@router.get("/{vault}/holdings")
async def listing(vault: str, request: Request, user: Owner, service: Service):
    await read_transport(request)
    return await run_in_threadpool(_invoke, lambda: service.listing(user.uid, vault))


@router.get("/{vault}/holdings/{source}")
async def current(vault: str, source: str, request: Request, user: Owner, service: Service):
    await read_transport(request)
    return await run_in_threadpool(_invoke, lambda: service.read(user.uid, vault, source))


@router.get("/{vault}/holdings/{source}/operations/{operation}")
async def receipt(
    vault: str, source: str, operation: str, request: Request, user: Owner, service: Service
):
    await read_transport(request)
    return await run_in_threadpool(
        _invoke, lambda: service.read(user.uid, vault, source, operation)
    )


@router.post("/{vault}/holdings/{source}/commands", status_code=201)
async def write(vault: str, source: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(request, {"contractVersion", "command"}, max_bytes=MAX_DISPLAY_HTTP_BYTES)
    return await run_in_threadpool(
        _invoke,
        lambda: service.write(
            user.uid, vault, source, value["command"], request.headers["idempotency-key"]
        ),
    )
