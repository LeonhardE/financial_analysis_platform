"""Identity, stock watchlists and manual channel follows, independent of Market."""

from typing import Annotated

from fastapi import Depends

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.http import create_app

from .channel_follows import router as channel_follows_router
from .resource_api import V2MetadataErrors
from .resource_api import internal as metadata_router
from .resource_api import public as initialization_router
from .watchlist import router as watchlist_router

app = create_app(
    "FolioView User API",
    private=True,
    methods=("GET", "PUT", "DELETE", "POST"),
    private_prefixes=("/api/", "/internal/"),
)
app.add_middleware(V2MetadataErrors)
app.include_router(watchlist_router)
app.include_router(channel_follows_router)
app.include_router(initialization_router)
app.include_router(metadata_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "user"}


@app.get("/api/v1/me", response_model=CurrentUser)
def current_user(user: Annotated[CurrentUser, Depends(require_google_user)]) -> CurrentUser:
    return user
