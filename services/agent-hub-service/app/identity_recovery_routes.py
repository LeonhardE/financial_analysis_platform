"""Gated public Agent challenge/proof transport; owner APIs are separate."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .api import _invoke, body, transport
from .identity_recovery import IdentityRecoveryService
from .oauth_config import OAuthConfig
from .store import get_store

router = APIRouter(prefix="/agent/v2/persistent/identity-recovery", route_class=PrivateRoute)


def get_identity_recovery_service():
    def configured():
        if any(
            os.getenv(flag) != "1"
            for flag in (
                "HUB_PERSISTENT_AGENTS_ENABLED",
                "HUB_PERSISTENT_IDENTITY_RECOVERY_ENABLED",
            )
        ):
            raise ContractError("authorization_unavailable")
        config = OAuthConfig.environment()
        return IdentityRecoveryService(
            get_store(),
            client_ids=[c.client_id for c in config.clients],
            audience=config.issuer + "/agent/v2/persistent/identity-recovery",
        )

    return _invoke(configured)


Service = Annotated[IdentityRecoveryService, Depends(get_identity_recovery_service)]


def recovery_transport(request):
    transport(request)
    if any(
        request.headers.getlist(key)
        for key in (
            "idempotency-key",
            "x-folioview-author-key",
            "x-folioview-delegation",
            "x-folioview-authority-delegation",
            "authorization",
        )
    ):
        raise ContractError("malformed_request")


@router.post("/challenges")
async def challenge(request: Request, service: Service):
    _invoke(lambda: recovery_transport(request))
    value = await body(
        request,
        {"contractVersion", "ownerSubject", "vaultId", "connectionId", "clientId"},
        max_bytes=4096,
    )
    return await run_in_threadpool(
        _invoke,
        lambda: service.challenge(
            value["ownerSubject"], value["vaultId"], value["connectionId"], value["clientId"]
        ),
    )


@router.post("/proofs")
async def recover(request: Request, service: Service):
    _invoke(lambda: recovery_transport(request))
    value = await body(
        request,
        {"contractVersion", "ownerSubject", "vaultId", "connectionId", "clientId", "proof"},
        max_bytes=32768,
    )
    return await run_in_threadpool(
        _invoke,
        lambda: service.recover(
            value["ownerSubject"],
            value["vaultId"],
            value["connectionId"],
            value["clientId"],
            value["proof"],
        ),
    )
