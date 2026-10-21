"""FastAPI entrypoint for the local MVP."""

import os
from typing import Annotated

from fastapi import Depends, FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .auth import CurrentUser, require_google_user
from .market_data import MarketService, get_market_service

app = FastAPI(
    title="Financial Analysis Platform API",
    version="0.1.0",
    description="Anonymous cached daily market data and verified Google identity.",
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
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "data_source": os.getenv("MARKET_DATA_SOURCE", "yfinance")}


@app.get("/api/v1/me", response_model=CurrentUser)
def current_user(
    user: Annotated[CurrentUser, Depends(require_google_user)], response: Response
) -> CurrentUser:
    response.headers["Cache-Control"] = "no-store"
    return user


@app.get("/api/stocks")
def list_stocks(service: Annotated[MarketService, Depends(get_market_service)]) -> dict:
    return service.overview()


@app.get("/api/stocks/search")
def search_stocks(
    service: Annotated[MarketService, Depends(get_market_service)],
    q: Annotated[str, Query(min_length=1, max_length=50)],
) -> dict:
    return service.search(q)


@app.get("/api/stocks/{symbol}/candles")
def stock_candles(
    symbol: str, service: Annotated[MarketService, Depends(get_market_service)]
) -> dict:
    return service.candles(symbol)
