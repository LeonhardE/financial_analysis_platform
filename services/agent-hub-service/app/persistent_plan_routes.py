"""Plan observations use Agent proofs; owner history never needs an Agent bearer."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.http import PrivateRoute

from .agent_transport import recovery_transport
from .api import Owner, _invoke, body
from .catalogue import CatalogueService, get_sources
from .oauth_config import OAuthConfig
from .persistent_execution_routes import execution_enabled
from .persistent_plans import PersistentOwnerPlanService, PersistentPlanService
from .persistent_routes import control_transport
from .store import get_store
from .vaults import VaultService

agent_router = APIRouter(
    prefix="/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/plans",
    route_class=PrivateRoute,
)
owner_router = APIRouter(prefix="/api/v2/persistent-plans", route_class=PrivateRoute)


def get_plan_service():
    def configured():
        if not execution_enabled():
            raise ContractError("authorization_unavailable")
        config = OAuthConfig.environment()
        store = get_store()
        return PersistentPlanService(
            store,
            CatalogueService(VaultService(store), get_sources()),
            audience=config.issuer,
            managed_only=True,
            client_ids=[c.client_id for c in config.clients],
        )

    return _invoke(configured)


def get_owner_plans():
    return PersistentOwnerPlanService(get_store())


Agent = Annotated[PersistentPlanService, Depends(get_plan_service)]
History = Annotated[PersistentOwnerPlanService, Depends(get_owner_plans)]


@agent_router.post("/state")
async def state(owner: str, vault: str, connection: str, request: Request, service: Agent):
    _invoke(lambda: recovery_transport(request))
    value = await body(request, {"contractVersion", "proof", "request"}, max_bytes=24576)
    return await run_in_threadpool(
        _invoke,
        lambda: service.plan_state(
            owner, vault, connection, value["proof"], request.url.path, value["request"]
        ),
    )


@agent_router.post("/report")
async def report(owner: str, vault: str, connection: str, request: Request, service: Agent):
    _invoke(lambda: recovery_transport(request))
    value = await body(request, {"contractVersion", "proof", "request"}, max_bytes=24576)
    return await run_in_threadpool(
        _invoke,
        lambda: service.report_plan(
            owner, vault, connection, value["proof"], request.url.path, value["request"]
        ),
    )


@owner_router.get("/{vault_id}/{connection_id}/{task_id}")
def owner_state(
    vault_id: str, connection_id: str, task_id: str, request: Request, user: Owner, service: History
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.state(user.uid, vault_id, connection_id, task_id))
