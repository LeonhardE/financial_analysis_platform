"""Opaque owner vault archives and bounded public authority; agent workflows stay closed."""

from folioview_shared.http import create_app

from .account_assets import router as account_assets_router
from .agent_client_assets import router as agent_client_router
from .agent_credential_routes import router as agent_credential_router
from .api import internal_router, owner_router, public_router
from .catalogue import router as catalogue_router
from .errors import HubErrors
from .inbox import router as inbox_router
from .legacy_owner_routes import owner_router as legacy_owner_router
from .native_mcp import install_native_mcp
from .native_transport_routes import connections_router as native_connections_router
from .native_transport_routes import owner_router as native_transport_owner_router
from .native_transport_routes import router as native_transport_router
from .persistent_execution_routes import router as persistent_execution_router
from .persistent_plan_routes import agent_router as persistent_plan_agent_router
from .persistent_plan_routes import owner_router as persistent_plan_owner_router
from .persistent_publication_routes import router as persistent_publication_router
from .persistent_result_routes import agent_router as persistent_result_agent_router
from .persistent_result_routes import owner_router as persistent_result_owner_router
from .persistent_routes import router as persistent_owner_router
from .provider_connection_routes import router as provider_connection_router
from .task_center_routes import agent_router as task_center_agent_router
from .task_center_routes import owner_router as task_center_owner_router
from .tasks import router as tasks_router

app = create_app(
    "FolioView Agent Hub API",
    private=True,
    methods=("GET", "POST", "PUT", "PATCH"),
    description="Passkey-sealed owner archive and signed public directory. No content decryption.",
    private_prefixes=(
        "/api",
        "/internal",
        "/mcp",
        "/oauth",
        "/.well-known",
        "/connectors",
        "/agent",
    ),
)
app.include_router(owner_router)
app.include_router(internal_router)
app.include_router(public_router)
app.include_router(catalogue_router)
app.include_router(tasks_router)
app.include_router(persistent_owner_router)
app.include_router(agent_credential_router)
app.include_router(provider_connection_router)
app.include_router(task_center_owner_router)
app.include_router(task_center_agent_router)
app.include_router(agent_client_router)
app.include_router(account_assets_router)
app.include_router(persistent_publication_router)
app.include_router(persistent_execution_router)
app.include_router(persistent_plan_agent_router)
app.include_router(persistent_plan_owner_router)
app.include_router(persistent_result_agent_router)
app.include_router(persistent_result_owner_router)
app.include_router(native_transport_router)
app.include_router(native_transport_owner_router)
app.include_router(native_connections_router)
app.include_router(inbox_router)
app.include_router(legacy_owner_router)
app.add_middleware(HubErrors)
install_native_mcp(app)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-hub"}
