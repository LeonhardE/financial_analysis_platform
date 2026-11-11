"""Opt-in exact Agent request proofs; no bearer, browser unlock or caller UID."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .agent_transport import recovery_transport
from .api import _invoke, body
from .catalogue import CatalogueService, get_sources
from .oauth_config import OAuthConfig
from .persistent_execution import PersistentExecutionService
from .persistent_publication_routes import publication_enabled
from .store import get_store
from .vaults import VaultService

router = APIRouter(
    prefix="/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}",
    route_class=PrivateRoute,
)


def execution_enabled():
    return os.getenv("HUB_PERSISTENT_EXECUTION_ENABLED") == "1" and publication_enabled()


def get_execution():
    def configured():
        if not execution_enabled():
            raise ContractError("authorization_unavailable")
        config = OAuthConfig.environment()
        store = get_store()
        return PersistentExecutionService(
            store,
            CatalogueService(VaultService(store), get_sources()),
            audience=config.issuer,
            managed_only=True,
            client_ids=[c.client_id for c in config.clients],
        )

    return _invoke(configured)


Service = Annotated[PersistentExecutionService, Depends(get_execution)]


def endpoint(method):
    async def handle(owner: str, vault: str, connection: str, request: Request, service: Service):
        _invoke(lambda: recovery_transport(request))
        value = await body(request, {"contractVersion", "proof", "request"}, max_bytes=65536)
        return await run_in_threadpool(
            _invoke,
            lambda: getattr(service, method)(
                owner, vault, connection, value["proof"], request.url.path, value["request"]
            ),
        )

    handle.__name__ = "persistent_" + method
    return handle


ROUTES = {
    "session": "session",
    "consent-receipts": "consent_receipt",
    "tasks": "tasks",
    "task-input": "task_input",
    "runs/begin": "begin",
    "runs/receipt": "run_receipt",
    "runs/input": "input",
}
for route, method in ROUTES.items():
    router.add_api_route("/" + route, endpoint(method), methods=["POST"])
