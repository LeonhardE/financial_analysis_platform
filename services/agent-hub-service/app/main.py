"""Opaque owner vault archives and bounded public authority; agent workflows stay closed."""

from folioview_shared.http import create_app

from .api import internal_router, owner_router, public_router
from .catalogue import router as catalogue_router
from .errors import HubErrors
from .executor_routes import agent_router as executor_agent_router
from .executor_routes import owner_router as executor_owner_router
from .helper_assets import router as helper_router
from .identity_recovery_routes import router as identity_recovery_router
from .inbox import router as inbox_router
from .mcp_transport import install_mcp
from .native_mcp import install_native_mcp
from .native_transport_routes import connections_router as native_connections_router
from .native_transport_routes import owner_router as native_transport_owner_router
from .native_transport_routes import router as native_transport_router
from .oauth_routes import agent_router
from .oauth_routes import owner_router as oauth_owner_router
from .oauth_routes import router as oauth_router
from .persistent_execution_routes import router as persistent_execution_router
from .persistent_plan_routes import agent_router as persistent_plan_agent_router
from .persistent_plan_routes import owner_router as persistent_plan_owner_router
from .persistent_publication_routes import router as persistent_publication_router
from .persistent_result_routes import agent_router as persistent_result_agent_router
from .persistent_result_routes import owner_router as persistent_result_owner_router
from .persistent_routes import router as persistent_owner_router
from .preparations import agent_router as preparation_agent_router
from .preparations import owner_router as preparation_owner_router
from .results import router as results_router
from .runs import router as runs_router
from .runtime_assets import router as runtime_assets_router
from .runtime_setup_routes import owner_router as runtime_setup_owner_router
from .runtime_setup_routes import public_router as runtime_setup_router
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
app.include_router(oauth_router)
app.include_router(oauth_owner_router)
app.include_router(agent_router)
app.include_router(preparation_owner_router)
app.include_router(preparation_agent_router)
app.include_router(persistent_owner_router)
app.include_router(persistent_publication_router)
app.include_router(persistent_execution_router)
app.include_router(persistent_plan_agent_router)
app.include_router(persistent_plan_owner_router)
app.include_router(persistent_result_agent_router)
app.include_router(persistent_result_owner_router)
app.include_router(executor_owner_router)
app.include_router(executor_agent_router)
app.include_router(native_transport_router)
app.include_router(native_transport_owner_router)
app.include_router(native_connections_router)
app.include_router(runtime_setup_router)
app.include_router(runtime_assets_router)
app.include_router(runtime_setup_owner_router)
app.include_router(identity_recovery_router)
app.include_router(runs_router)
app.include_router(results_router)
app.include_router(inbox_router)
app.include_router(helper_router)
app.add_middleware(HubErrors)
install_native_mcp(app)
install_mcp(app)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-hub"}
