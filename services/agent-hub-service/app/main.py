"""Opaque owner vault archives and bounded public authority; agent workflows stay closed."""

from folioview_shared.http import create_app

from .api import internal_router, owner_router, public_router
from .catalogue import router as catalogue_router
from .errors import HubErrors
from .helper_assets import router as helper_router
from .inbox import router as inbox_router
from .mcp_transport import install_mcp
from .oauth_routes import agent_router
from .oauth_routes import owner_router as oauth_owner_router
from .oauth_routes import router as oauth_router
from .preparations import agent_router as preparation_agent_router
from .preparations import owner_router as preparation_owner_router
from .results import router as results_router
from .runs import router as runs_router
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
app.include_router(runs_router)
app.include_router(results_router)
app.include_router(inbox_router)
app.include_router(helper_router)
app.add_middleware(HubErrors)
install_mcp(app)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-hub"}
