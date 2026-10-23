"""FastAPI entrypoint for the local MVP."""

import os
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .auth import CurrentUser, require_google_user
from .market_data import MarketService, get_market_service
from .preferences import router as preferences_router
from .watchlist import PrivateWatchlistHeaders
from .watchlist import router as watchlist_router

app = FastAPI(
    title="Financial Analysis Platform API",
    version="0.1.0",
    description="Anonymous cached market snapshots and verified Google identity.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.add_middleware(PrivateWatchlistHeaders)
app.include_router(watchlist_router)
app.include_router(preferences_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "data_source": os.getenv("MARKET_DATA_SOURCE", "yfinance")}


@app.get("/api/v1/me", response_model=CurrentUser)
def current_user(
    user: Annotated[CurrentUser, Depends(require_google_user)], response: Response
) -> CurrentUser:
    response.headers["Cache-Control"] = "no-store"
    return user


@app.get("/api/stocks", response_model=None)
def list_stocks(
    service: Annotated[MarketService, Depends(get_market_service)],
    response: Response,
    cached: Annotated[bool, Query()] = False,
) -> dict | Response:
    result = service.overview(cached_only=cached)
    if cached:
        response.headers["Cache-Control"] = "no-store"
    return (
        result
        if result is not None
        else Response(status_code=204, headers={"Cache-Control": "no-store"})
    )


@app.get("/api/stocks/search")
def search_stocks(
    service: Annotated[MarketService, Depends(get_market_service)],
    q: Annotated[str, Query(min_length=1, max_length=50)],
) -> dict:
    return service.search(q)


@app.get("/api/stocks/{symbol}/candles", response_model=None)
def stock_candles(
    symbol: str,
    service: Annotated[MarketService, Depends(get_market_service)],
    response: Response,
    range: Annotated[Literal["1d", "1w", "1m", "3m", "1y"], Query()] = "1m",
    cached: Annotated[bool, Query()] = False,
) -> dict | Response:
    result = service.candles(symbol, range, cached_only=cached)
    if cached:
        response.headers["Cache-Control"] = "no-store"
    return (
        result
        if result is not None
        else Response(status_code=204, headers={"Cache-Control": "no-store"})
    )
