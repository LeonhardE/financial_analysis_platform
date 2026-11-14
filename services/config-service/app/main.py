"""Private user configuration API, independently deployable from Market and User."""

from folioview_shared.http import create_app

from .preferences import currency_router, language_router, router

app = create_app(
    "FolioView Config API",
    private=True,
    methods=("GET", "PUT"),
    description="Private account preferences with version-fenced writes.",
)
app.include_router(router)
app.include_router(currency_router)
app.include_router(language_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "config"}
