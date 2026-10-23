"""Identity and private stock watchlists, deployed independently of Market."""

from typing import Annotated

from fastapi import Depends

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.http import create_app

from .watchlist import router as watchlist_router

app = create_app("FolioView User API", private=True, methods=("GET", "PUT", "DELETE"))
app.include_router(watchlist_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "user"}


@app.get("/api/v1/me", response_model=CurrentUser)
def current_user(user: Annotated[CurrentUser, Depends(require_google_user)]) -> CurrentUser:
    return user
