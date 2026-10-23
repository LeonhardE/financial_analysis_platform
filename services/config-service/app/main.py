"""Private user configuration API, independently deployable from Market and User."""

from folioview_shared.http import create_app

from .preferences import router

app = create_app(
    "FolioView Config API",
    private=True,
    methods=("GET", "PUT"),
    description="Private account preferences with version-fenced writes.",
)
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "config"}
