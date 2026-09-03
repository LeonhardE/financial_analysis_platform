"""FastAPI entrypoint for the local MVP."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .mock_data import MOCK_CANDLES, STOCKS

app = FastAPI(
    title="Financial Analysis Platform API",
    version="0.1.0",
    description="Local MVP API backed entirely by fixed mock data.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "data_source": "mock"}


@app.get("/api/stocks")
def list_stocks() -> dict[str, list[dict[str, float | str]]]:
    stocks = []
    for symbol, stock in STOCKS.items():
        closes = stock["closes"]
        first_close = closes[0]
        latest_close = closes[-1]
        change_percent = round(((latest_close - first_close) / first_close) * 100, 2)
        stocks.append(
            {
                "symbol": symbol,
                "name": stock["name"],
                "latestClose": latest_close,
                "changePercent": change_percent,
            }
        )
    return {"stocks": stocks}


@app.get("/api/stocks/{symbol}/candles")
def stock_candles(symbol: str) -> dict[str, object]:
    normalized_symbol = symbol.upper()
    stock = STOCKS.get(normalized_symbol)
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock symbol not found")

    return {
        "symbol": normalized_symbol,
        "name": stock["name"],
        "currency": "USD",
        "range": "1m",
        "isMock": True,
        "candles": MOCK_CANDLES[normalized_symbol],
    }
