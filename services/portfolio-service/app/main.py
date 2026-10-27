"""Build-only Portfolio skeleton without persistence or brokerage connections."""

from folioview_shared.http import create_app

app = create_app(
    "FolioView Portfolio API",
    private=True,
    description="Portfolio service skeleton. Private portfolio APIs are not implemented.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "portfolio"}
