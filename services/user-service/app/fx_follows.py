"""Owner-only manual FX follows and default-follow suppression; no Config RPC."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.http import PrivateRoute
from folioview_shared.valuation import (
    ValuationError,
    fx_preferences,
    load_valuation_schema,
    validate_valuation_schema,
)

from .watchlist import (
    FxPreferencesConflict,
    WatchlistStore,
    WatchlistUnavailable,
    get_watchlist_store,
)

UNAVAILABLE = "Your currency follows are temporarily unavailable. Please try again later."
MAX_BODY_BYTES = 4096


class PrivateFxRoute(PrivateRoute):
    unavailable_message = UNAVAILABLE


router = APIRouter(prefix="/api/v1/fx-follows", tags=["fx-follows"], route_class=PrivateFxRoute)
User = Annotated[CurrentUser, Depends(require_google_user)]
Store = Annotated[WatchlistStore, Depends(get_watchlist_store)]


async def checked_update(request):
    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        != "application/json"
    ):
        raise HTTPException(415, "Send currency follows as JSON.")
    raw = bytearray()
    try:
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                if len(raw) + len(chunk) > MAX_BODY_BYTES:
                    raise HTTPException(413, "The currency follows request is too large.")
                raw.extend(chunk)
    except TimeoutError:
        raise HTTPException(408, "The request body took too long.") from None
    try:
        value = validate_valuation_schema(
            "FxPreferencesUpdate", strict_json_loads(bytes(raw), max_bytes=MAX_BODY_BYTES)
        )
        fx_preferences(value["preferences"])
        return value
    except (ContractError, ValuationError, ValueError, TypeError):
        raise HTTPException(422, "Invalid currency follows request.") from None


@router.get("")
def get_fx_follows(user: User, store: Store) -> dict:
    try:
        return store.get_fx(user.uid)
    except WatchlistUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


@router.put(
    "",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {"schema": load_valuation_schema("FxPreferencesUpdate")}
            },
        }
    },
)
async def replace_fx_follows(request: Request, user: User, store: Store) -> dict:
    value = await checked_update(request)
    try:
        return await run_in_threadpool(store.save_fx, user.uid, value)
    except FxPreferencesConflict as error:
        raise HTTPException(409, "Currency follows changed. Reload before saving again.") from error
    except WatchlistUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error
