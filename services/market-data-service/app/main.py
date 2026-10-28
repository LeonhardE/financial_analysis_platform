"""Public market data API; no identity or user-configuration handlers."""

import os
from typing import Annotated, Literal

from fastapi import Depends, Query, Response

from folioview_shared.http import create_app

from .cost_controls import MarketCostRoute
from .market_data import MarketService, get_market_service
from .stock_metrics import router as stock_metrics_router

app = create_app(
    "FolioView Market API",
    description="Anonymous cached US market snapshots, instruments, and chart data.",
)
app.router.route_class = MarketCostRoute
app.include_router(stock_metrics_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "market",
        "data_source": os.getenv("MARKET_DATA_SOURCE", "yfinance"),
    }


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
