"""Default-off additive task-center producer, Owner history and PoP-only Agent context."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.task_center import TASK_CENTER_PROFILE
from folioview_shared.http import PrivateRoute

from .agent_rollout import uid_allowed
from .agent_transport import recovery_transport
from .api import Owner, _invoke, body
from .persistent_execution_routes import get_execution
from .persistent_routes import control_transport
from .provider_connection_routes import provider_slots_enabled
from .store import get_store
from .task_center import TaskCenterAgentService
from .task_center_results import TaskCenterResultService

owner_router = APIRouter(prefix="/api/v3/task-center", route_class=PrivateRoute)
agent_router = APIRouter(
    prefix="/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/task-center",
    route_class=PrivateRoute,
)


def task_center_enabled():
    return os.getenv("HUB_TASK_CENTER_ENABLED") == "1" and provider_slots_enabled()


def get_owner_center():
    return TaskCenterResultService(get_store())


def get_agent_center():
    current = get_execution()
    return TaskCenterAgentService(
        current.store,
        current.catalogue,
        audience=current.audience,
        client_ids=current.client_ids,
        managed_only=True,
        clock=current.clock,
    )


OwnerService = Annotated[TaskCenterResultService, Depends(get_owner_center)]
AgentService = Annotated[TaskCenterAgentService, Depends(get_agent_center)]


@owner_router.get("/capabilities")
def capabilities(request: Request, user: Owner):
    _invoke(lambda: control_transport(request))
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": TASK_CENTER_PROFILE,
        "enabled": _invoke(task_center_enabled) and uid_allowed(user.uid),
        "actions": ["set_rules", "set_assignment", "remove_assignment"],
        "dispatchSupported": False,
        "nativeScheduleAttested": False,
    }


@owner_router.get("/{vault}/tasks/{task}")
def state(vault: str, task: str, request: Request, user: Owner, service: OwnerService):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.state(user.uid, vault, task))


@owner_router.get("/{vault}/tasks/{task}/operations/{operation}")
def receipt(
    vault: str, task: str, operation: str, request: Request, user: Owner, service: OwnerService
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: service.receipt(user.uid, vault, task, operation))


@owner_router.post("/{vault}/tasks/{task}/commands", status_code=201)
async def command(vault: str, task: str, request: Request, user: Owner, service: OwnerService):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(request, {"contractVersion", "command"}, max_bytes=24576)

    def apply():
        _, payload = _signed_parts(value["command"])
        # Narrowing survives rollback. The service still verifies Owner signature,
        # exact task/version/assignment and Root registry before changing anything.
        if payload.get("action") != "remove_assignment" and (
            not task_center_enabled() or not uid_allowed(user.uid)
        ):
            raise ContractError("authorization_unavailable")
        return service.command(
            user.uid, vault, task, value["command"], request.headers["idempotency-key"]
        )

    return await run_in_threadpool(_invoke, apply)


@owner_router.post("/{vault}/tasks/{task}/results/query")
async def results(vault: str, task: str, request: Request, user: Owner, service: OwnerService):
    _invoke(lambda: control_transport(request))
    value = await body(request, {"contractVersion", "request"}, max_bytes=8192)
    return await run_in_threadpool(
        _invoke, lambda: service.results(user.uid, vault, task, value["request"])
    )


@owner_router.post("/{vault}/tasks/{task}/progress/query")
async def progress(vault: str, task: str, request: Request, user: Owner, service: OwnerService):
    _invoke(lambda: control_transport(request))
    value = await body(request, {"contractVersion", "request"}, max_bytes=8192)
    return await run_in_threadpool(
        _invoke, lambda: service.progress(user.uid, vault, task, value["request"])
    )


def endpoint(method):
    async def handle(
        owner: str, vault: str, connection: str, request: Request, service: AgentService
    ):
        _invoke(lambda: recovery_transport(request))

        def enabled():
            if not task_center_enabled():
                raise ContractError("authorization_unavailable")
            from .store import document_path

            indexed = service.store.transact(
                lambda u: u.get(document_path("hub_oauth_owners", owner))
            )
            if indexed is None or not uid_allowed(indexed.get("ownerUid", "")):
                raise ContractError("authorization_unavailable")

        _invoke(enabled)
        value = await body(request, {"contractVersion", "proof", "request"}, max_bytes=65536)
        return await run_in_threadpool(
            _invoke,
            lambda: getattr(service, method)(
                owner, vault, connection, value["proof"], request.url.path, value["request"]
            ),
        )

    handle.__name__ = "task_center_" + method
    return handle


for route, method in {
    "context": "context",
    "prepare": "prepare",
    "plans/report": "report_plan",
}.items():
    agent_router.add_api_route("/" + route, endpoint(method), methods=["POST"])
