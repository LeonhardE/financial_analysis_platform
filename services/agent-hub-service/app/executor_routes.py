"""Independent ciphertext protocol, closed JSON and exact Agent PoP; default off."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.http import PrivateRoute

from .api import Owner, _invoke, body
from .catalogue import CatalogueService, get_sources
from .executor_connections import ExecutorConfig, ExecutorIdentityService
from .executor_content import ExecutorExecution, ExecutorPublications, ExecutorResources
from .identity_recovery_routes import recovery_transport
from .persistent_routes import control_transport
from .store import get_store
from .vaults import VaultService

owner_router = APIRouter(prefix="/api/v2/executor-connections", route_class=PrivateRoute)
agent_router = APIRouter(
    prefix="/agent/v3/persistent/executor/owners/{owner}/vaults/{vault}/connections/{connection}",
    route_class=PrivateRoute,
)


def get_identities():
    # Owner history and terminal narrowing work without any enabled transport.
    return ExecutorIdentityService(get_store())


def get_resources():
    return ExecutorResources(get_store())


def get_publications():
    return ExecutorPublications(get_store())


def _enabled(service):
    config = ExecutorConfig.environment()
    store = get_store()
    if service is ExecutorIdentityService:
        return service(store, config=config)
    return service(store, CatalogueService(VaultService(store), get_sources()), config=config)


def get_registration():
    return _invoke(lambda: _enabled(ExecutorIdentityService))


def get_approval():
    return _invoke(lambda: _enabled(ExecutorResources))


def get_publisher():
    return _invoke(lambda: _enabled(ExecutorPublications))


def get_execution():
    return _invoke(lambda: _enabled(ExecutorExecution))


Identities = Annotated[ExecutorIdentityService, Depends(get_identities)]
Registration = Annotated[ExecutorIdentityService, Depends(get_registration)]
Resources = Annotated[ExecutorResources, Depends(get_resources)]
Approval = Annotated[ExecutorResources, Depends(get_approval)]
Publications = Annotated[ExecutorPublications, Depends(get_publications)]
Publisher = Annotated[ExecutorPublications, Depends(get_publisher)]
Execution = Annotated[ExecutorExecution, Depends(get_execution)]


def bounded(value):
    check_read_response(value)
    return value


@owner_router.get("/{vault}/{connection}")
def state(vault: str, connection: str, request: Request, user: Owner, service: Identities):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: bounded(service.state(user.uid, vault, connection)))


@owner_router.get("/{vault}/{connection}/identity-operations/{operation}")
def identity_receipt(
    vault: str, connection: str, operation: str, request: Request, user: Owner, service: Identities
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: bounded(service.receipt(user.uid, vault, connection, operation)))


@owner_router.post("/{vault}/{connection}/bindings", status_code=201)
async def register(
    vault: str, connection: str, request: Request, user: Owner, service: Registration
):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(
        request, {"contractVersion", "command", "approval", "scope"}, max_bytes=69632
    )
    return await run_in_threadpool(
        _invoke,
        lambda: bounded(
            service.register(
                user.uid,
                vault,
                connection,
                value["command"],
                value["approval"],
                value["scope"],
                request.headers["idempotency-key"],
            )
        ),
    )


@owner_router.post("/{vault}/{connection}/revocations", status_code=201)
async def revoke(vault: str, connection: str, request: Request, user: Owner, service: Identities):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(request, {"contractVersion", "command"}, max_bytes=24576)
    return await run_in_threadpool(
        _invoke,
        lambda: bounded(
            service.command(
                user.uid,
                vault,
                connection,
                value["command"],
                request.headers["idempotency-key"],
                revoke=True,
            )
        ),
    )


@owner_router.get("/{vault}/{connection}/resource-consent")
def resource_state(vault: str, connection: str, request: Request, user: Owner, service: Resources):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: bounded(service.state(user.uid, vault, connection)))


@owner_router.get("/{vault}/{connection}/resource-operations/{operation}")
def resource_receipt(
    vault: str, connection: str, operation: str, request: Request, user: Owner, service: Resources
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: bounded(service.receipt(user.uid, vault, connection, operation)))


@owner_router.post("/{vault}/{connection}/resource-approvals", status_code=201)
async def approve_resources(
    vault: str, connection: str, request: Request, user: Owner, service: Approval
):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(request, {"contractVersion", "command"}, max_bytes=98304)
    return await run_in_threadpool(
        _invoke,
        lambda: bounded(
            service.command(
                user.uid, vault, connection, value["command"], request.headers["idempotency-key"]
            )
        ),
    )


@owner_router.post("/{vault}/{connection}/resource-revocations", status_code=201)
async def revoke_resources(
    vault: str, connection: str, request: Request, user: Owner, service: Resources
):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(request, {"contractVersion", "command"}, max_bytes=98304)
    return await run_in_threadpool(
        _invoke,
        lambda: bounded(
            service.command(
                user.uid,
                vault,
                connection,
                value["command"],
                request.headers["idempotency-key"],
                revoke=True,
            )
        ),
    )


@owner_router.get("/{vault}/{connection}/publication-operations/{operation}")
def publication_receipt(
    vault: str,
    connection: str,
    operation: str,
    request: Request,
    user: Owner,
    service: Publications,
):
    _invoke(lambda: control_transport(request))
    return _invoke(lambda: bounded(service.receipt(user.uid, vault, connection, operation)))


@owner_router.post("/{vault}/{connection}/publications", status_code=201)
async def publish(vault: str, connection: str, request: Request, user: Owner, service: Publisher):
    _invoke(lambda: control_transport(request, operation=True))
    value = await body(request, {"contractVersion", "envelope"}, max_bytes=540672)
    return await run_in_threadpool(
        _invoke,
        lambda: bounded(
            service.publish(
                user.uid, vault, connection, value["envelope"], request.headers["idempotency-key"]
            )
        ),
    )


def endpoint(method, maximum):
    async def handle(owner: str, vault: str, connection: str, request: Request, service: Execution):
        _invoke(lambda: recovery_transport(request))
        value = await body(request, {"contractVersion", "proof", "request"}, max_bytes=maximum)
        return await run_in_threadpool(
            _invoke,
            lambda: bounded(
                getattr(service, method)(
                    owner, vault, connection, value["proof"], request.url.path, value["request"]
                )
            ),
        )

    handle.__name__ = "executor_" + method
    return handle


for route, method, maximum in (
    ("session", "session", 65536),
    ("consent-receipts", "consent_receipt", 65536),
    ("tasks", "tasks", 65536),
    ("runs/begin", "begin", 65536),
    ("runs/receipt", "run_receipt", 65536),
    ("runs/input", "input", 65536),
    ("runs/submit", "submit", 557056),
    ("runs/result-receipt", "result_receipt", 24576),
):
    agent_router.add_api_route("/" + route, endpoint(method, maximum), methods=["POST"])
