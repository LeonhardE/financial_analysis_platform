"""Owner-only, explicitly gated provider migration; reads survive a disabled gate."""

import asyncio
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.provider_connections import PROVIDER_CONNECTION_PROFILE
from folioview_shared.http import PrivateRoute

from .agent_credential_routes import agent_owned_enabled
from .agent_rollout import uid_allowed
from .api import Owner, _invoke, body
from .oauth_config import OAuthConfig
from .persistent_routes import control_transport
from .provider_connections import ProviderConnectionService
from .store import get_store

router = APIRouter(prefix="/api/v3/provider-connections", route_class=PrivateRoute)


def provider_slots_enabled():
    return os.getenv("HUB_PROVIDER_CONNECTION_SLOTS_ENABLED") == "1" and agent_owned_enabled()


def get_provider_service():
    def configured():
        config = OAuthConfig.environment()
        return ProviderConnectionService(
            get_store(), audience=config.issuer, client_ids=[c.client_id for c in config.clients]
        )

    return _invoke(configured)


Service = Annotated[ProviderConnectionService, Depends(get_provider_service)]


@router.get("/capabilities")
def capabilities(request: Request, user: Owner):
    _invoke(lambda: control_transport(request))
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": PROVIDER_CONNECTION_PROFILE,
        "enabled": _invoke(provider_slots_enabled) and uid_allowed(user.uid),
        "providers": ["muse", "chatgpt"],
        "automaticMigration": False,
    }


@router.get("/{vault}/summary")
async def summary(vault: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    async with asyncio.timeout(5):
        async for chunk in request.stream():
            if chunk:
                raise HTTPException(400, {"code": "malformed_request"})
    return await run_in_threadpool(_invoke, lambda: service.summary(user.uid, vault))


@router.get("/{vault}/{provider}")
def state(vault: str, provider: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.state(user.uid, vault, provider))


@router.get("/{vault}/{provider}/operations/{operation}")
def receipt(
    vault: str, provider: str, operation: str, request: Request, user: Owner, service: Service
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.receipt(user.uid, vault, provider, operation))


@router.post("/{vault}/{provider}/commands", status_code=201)
async def command(vault: str, provider: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request, operation=True))

    def require_enabled():
        if not provider_slots_enabled() or not uid_allowed(user.uid):
            raise ContractError("authorization_unavailable")

    _invoke(require_enabled)
    value = await body(request, {"contractVersion", "command"}, max_bytes=140000)
    return await run_in_threadpool(
        _invoke,
        lambda: service.command(
            user.uid, vault, provider, value["command"], request.headers["idempotency-key"]
        ),
    )
