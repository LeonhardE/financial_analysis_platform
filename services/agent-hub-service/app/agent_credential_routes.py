"""Owner-only credential controls. Agent bootstrap is a separately verified Native API."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.agent_credentials import (
    AGENT_CREDENTIAL_PROFILE,
    CREDENTIAL_NOTICE_SECONDS,
    DEFAULT_CREDENTIAL_SECONDS,
)
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .agent_credentials import AgentCredentialService
from .agent_rollout import uid_allowed
from .api import Owner, _invoke, body
from .oauth_config import OAuthConfig
from .persistent_execution_routes import execution_enabled
from .persistent_routes import control_transport
from .store import get_store

router = APIRouter(prefix="/api/v3/agent-credentials", route_class=PrivateRoute)


def agent_owned_enabled():
    try:
        return (
            os.getenv("HUB_AGENT_OWNED_CREDENTIALS_ENABLED") == "1"
            and os.getenv("HUB_PERSISTENT_TRANSPORT_ENABLED") == "1"
            and os.getenv("HUB_PERSISTENT_MCP_ENABLED") == "1"
            and execution_enabled()
        )
    except ContractError:
        return False


def get_credential_service():
    def configured():
        config = OAuthConfig.environment()
        return AgentCredentialService(
            get_store(), audience=config.issuer, client_ids=[c.client_id for c in config.clients]
        )

    return _invoke(configured)


Service = Annotated[AgentCredentialService, Depends(get_credential_service)]


@router.get("/capabilities")
def capabilities(request: Request, user: Owner):
    _invoke(lambda: control_transport(request))
    enabled = _invoke(agent_owned_enabled) and uid_allowed(user.uid)
    if enabled:
        try:
            OAuthConfig.environment()
        except ContractError:
            enabled = False
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": AGENT_CREDENTIAL_PROFILE,
        "enabled": enabled,
        "defaultValiditySeconds": DEFAULT_CREDENTIAL_SECONDS,
        "noticeSeconds": CREDENTIAL_NOTICE_SECONDS,
    }


@router.get("/{vault}/{connection}")
def state(vault: str, connection: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.state(user.uid, vault, connection))


@router.get("/{vault}/{connection}/setups/{intent}")
def setup(
    vault: str, connection: str, intent: str, request: Request, user: Owner, service: Service
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.owner_setup(user.uid, vault, connection, intent))


@router.get("/{vault}/{connection}/operations/{operation}")
def receipt(
    vault: str, connection: str, operation: str, request: Request, user: Owner, service: Service
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.receipt(user.uid, vault, connection, operation))


@router.post("/{vault}/{connection}/approvals", status_code=201)
async def approve(vault: str, connection: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: control_transport(request, operation=True))

    def require_enabled():
        if not agent_owned_enabled() or not uid_allowed(user.uid):
            raise ContractError("authorization_unavailable")

    _invoke(require_enabled)
    value = await body(request, {"contractVersion", "command"}, max_bytes=33000)
    return await run_in_threadpool(
        _invoke,
        lambda: service.command(
            user.uid, vault, connection, value["command"], request.headers["idempotency-key"]
        ),
    )


@router.get("/{vault}/{connection}/restoration")
def restoration_head(vault: str, connection: str, request: Request, user: Owner, service: Service):
    from .credential_restoration import head

    _invoke(lambda: control_transport(request))
    return _invoke(lambda: head(service, user.uid, vault, connection))


@router.get("/{vault}/{connection}/restoration/{source_connection}/{fingerprint}")
def restoration_source(
    vault: str,
    connection: str,
    source_connection: str,
    fingerprint: str,
    request: Request,
    user: Owner,
    service: Service,
):
    from .credential_restoration import source

    _invoke(lambda: control_transport(request))
    return _invoke(
        lambda: source(service, user.uid, vault, connection, source_connection, fingerprint)
    )
