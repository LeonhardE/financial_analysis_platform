"""Owner-only encrypted holdings storage without a brokerage connection."""

from folioview_shared.http import create_app

from .api import router as holdings_router
from .authority_sync import router as authority_router
from .errors import PortfolioErrors
from .fence_sync import router as fence_router
from .resource_api import router as resources_router

app = create_app(
    "FolioView Portfolio API",
    private=True,
    private_prefixes=("/api/", "/internal/"),
    methods=("GET", "PUT", "POST"),
    description=(
        "Encrypted owner holdings snapshots. "
        "No brokerage login or browser-supplied authority enrollment API."
    ),
)
app.include_router(holdings_router)
app.include_router(authority_router)
app.include_router(fence_router)
app.include_router(resources_router)
app.add_middleware(PortfolioErrors)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "portfolio"}
