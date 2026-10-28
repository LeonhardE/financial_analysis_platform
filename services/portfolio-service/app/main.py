"""Owner-only encrypted holdings storage without a brokerage connection."""

from folioview_shared.http import create_app

from .api import router as holdings_router
from .errors import PortfolioErrors

app = create_app(
    "FolioView Portfolio API",
    private=True,
    methods=("GET", "PUT"),
    description="Encrypted owner holdings snapshots. No brokerage or authority enrollment API.",
)
app.include_router(holdings_router)
app.add_middleware(PortfolioErrors)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "portfolio"}
