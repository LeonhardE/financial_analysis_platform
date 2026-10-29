"""Opaque owner vault archives and bounded public authority; agent workflows stay closed."""

from folioview_shared.http import create_app

from .api import internal_router, owner_router, public_router
from .catalogue import router as catalogue_router
from .errors import HubErrors

app = create_app(
    "FolioView Agent Hub API",
    private=True,
    methods=("GET", "POST", "PUT"),
    description="Passkey-sealed owner archive and signed public directory. No content decryption.",
    private_prefixes=("/api", "/internal", "/mcp", "/oauth", "/.well-known", "/connectors"),
)
app.include_router(owner_router)
app.include_router(internal_router)
app.include_router(public_router)
app.include_router(catalogue_router)
app.add_middleware(HubErrors)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-hub"}
