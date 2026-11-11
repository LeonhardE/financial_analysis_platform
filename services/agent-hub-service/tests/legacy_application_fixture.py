"""Isolated historical-format producer fixture; never imported by the deployed app.

These old transports generate signed P1/v2 records for Owner history regression
checks. Production route closure is asserted independently against app.main.
"""

from app.api import internal_router, owner_router, public_router
from app.catalogue import router as catalogue
from app.errors import HubErrors
from app.helper_assets import router as helper
from app.inbox import router as inbox
from app.mcp_transport import install_mcp
from app.oauth_routes import agent_router as agent
from app.oauth_routes import owner_router as consent
from app.oauth_routes import router as oauth
from app.preparations import agent_router as agent_preparation
from app.preparations import owner_router as owner_preparation
from app.results import router as results
from app.runs import router as runs
from app.tasks import router as tasks
from folioview_shared.http import create_app

app = create_app(
    "Historical format fixture",
    private=True,
    methods=("GET", "POST", "PUT", "PATCH"),
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
for router in (
    owner_router,
    internal_router,
    public_router,
    catalogue,
    tasks,
    oauth,
    consent,
    agent,
    owner_preparation,
    agent_preparation,
    runs,
    results,
    inbox,
    helper,
):
    app.include_router(router)
app.add_middleware(HubErrors)
install_mcp(app)


@app.get("/health")
def health():
    return {"status": "ok", "service": "historical-fixture"}
