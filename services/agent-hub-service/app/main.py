"""Build-only Agent Hub skeleton; private APIs and connector protocols follow later."""

from folioview_shared.http import create_app

app = create_app(
    "FolioView Agent Hub API",
    private=True,
    description="Build-only service skeleton. Only health is implemented.",
    private_prefixes=("/api", "/mcp", "/oauth", "/.well-known", "/connectors"),
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-hub"}
