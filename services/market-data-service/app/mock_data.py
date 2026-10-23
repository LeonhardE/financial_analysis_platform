"""Deterministic local-only market data used by the MVP."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from math import sin
from typing import TypedDict
from zoneinfo import ZoneInfo


class StockDefinition(TypedDict):
    name: str
    closes: list[float]
    base_volume: int


TRADING_DATES = [
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-31",
    "2026-09-01",
]


# These values are intentionally fictional and must never be treated as live quotes.
STOCKS: dict[str, StockDefinition] = {
    "AAPL": {
        "name": "Apple",
        "closes": [
            211.2,
            212.8,
            211.9,
            214.6,
            215.4,
            217.1,
            216.2,
            218.7,
            220.3,
            219.4,
            221.8,
            223.1,
            222.5,
            224.9,
            226.2,
            225.4,
            227.6,
            228.1,
            226.9,
            229.5,
            231.0,
            230.4,
        ],
        "base_volume": 48_000_000,
    },
    "MSFT": {
        "name": "Microsoft",
        "closes": [
            512.4,
            509.8,
            514.2,
            516.1,
            513.7,
            518.5,
            520.2,
            519.1,
            522.6,
            524.0,
            521.8,
            525.4,
            527.3,
            526.0,
            529.6,
            531.2,
            528.7,
            532.4,
            534.1,
            533.0,
            536.2,
            537.5,
        ],
        "base_volume": 22_000_000,
    },
    "GOOGL": {
        "name": "Alphabet",
        "closes": [
            191.6,
            192.4,
            190.8,
            193.7,
            194.5,
            195.2,
            194.1,
            196.8,
            198.0,
            197.3,
            199.4,
            200.1,
            198.9,
            201.2,
            202.6,
            201.7,
            203.5,
            204.2,
            203.1,
            205.4,
            206.0,
            207.3,
        ],
        "base_volume": 28_000_000,
    },
    "AMZN": {
        "name": "Amazon",
        "closes": [
            226.1,
            224.8,
            227.6,
            229.2,
            228.4,
            230.7,
            232.1,
            231.0,
            233.8,
            235.2,
            234.1,
            236.4,
            237.0,
            235.6,
            238.2,
            239.5,
            237.9,
            240.4,
            241.8,
            240.7,
            243.1,
            244.0,
        ],
        "base_volume": 36_000_000,
    },
    "NVDA": {
        "name": "NVIDIA",
        "closes": [
            179.4,
            181.2,
            180.1,
            183.5,
            185.0,
            184.2,
            186.7,
            188.4,
            187.1,
            190.2,
            192.0,
            190.8,
            193.6,
            195.1,
            194.0,
            196.8,
            198.5,
            197.2,
            200.1,
            202.4,
            201.0,
            204.3,
        ],
        "base_volume": 112_000_000,
    },
    "META": {
        "name": "Meta Platforms",
        "closes": [
            746.0,
            751.4,
            748.2,
            756.1,
            759.8,
            755.6,
            763.2,
            768.5,
            765.1,
            772.4,
            777.0,
            773.3,
            781.6,
            785.2,
            779.8,
            788.4,
            793.1,
            789.5,
            797.8,
            802.4,
            799.0,
            806.7,
        ],
        "base_volume": 15_000_000,
    },
    "TSLA": {
        "name": "Tesla",
        "closes": [
            309.5,
            314.2,
            311.0,
            318.6,
            322.4,
            319.1,
            326.8,
            331.2,
            327.5,
            335.0,
            340.4,
            336.2,
            343.8,
            347.1,
            341.5,
            350.2,
            355.6,
            351.0,
            359.4,
            363.8,
            358.2,
            366.5,
        ],
        "base_volume": 94_000_000,
    },
}


OPEN_OFFSETS = [-0.7, 0.9, -0.4, 0.6, -0.8, 0.3, -0.5]
HIGH_OFFSETS = [1.6, 2.1, 1.4, 2.4, 1.8]
LOW_OFFSETS = [1.3, 1.9, 1.5, 2.2, 1.7]
VOLUME_OFFSETS = [0, 1_300_000, -900_000, 2_100_000, -1_200_000, 700_000]


def build_candles(symbol: str) -> list[dict[str, int | float | str]]:
    """Build a stable OHLCV series from the fixed close-price fixtures."""

    stock = STOCKS[symbol]
    candles: list[dict[str, int | float | str]] = []

    for index, (trading_date, close) in enumerate(zip(TRADING_DATES, stock["closes"], strict=True)):
        reference = stock["closes"][index - 1] if index else close - 0.8
        open_price = round(reference + OPEN_OFFSETS[index % len(OPEN_OFFSETS)], 2)
        high = round(max(open_price, close) + HIGH_OFFSETS[index % len(HIGH_OFFSETS)], 2)
        low = round(min(open_price, close) - LOW_OFFSETS[index % len(LOW_OFFSETS)], 2)
        volume = stock["base_volume"] + VOLUME_OFFSETS[index % len(VOLUME_OFFSETS)]
        candles.append(
            {
                "time": trading_date,
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            }
        )

    return candles


MOCK_CANDLES = {symbol: build_candles(symbol) for symbol in STOCKS}


def mock_range_candles(symbol: str, chart_range: str) -> list[dict[str, int | float | str]]:
    """Deterministic fictional range fixtures, never a production fallback."""
    daily = MOCK_CANDLES.get(symbol, MOCK_CANDLES["AAPL"])
    if chart_range == "1m":
        return daily
    if chart_range in {"3m", "1y"}:
        last_day = date.fromisoformat(daily[-1]["time"])
        first_fixture = date.fromisoformat(daily[0]["time"])
        start = last_day - timedelta(days=92 if chart_range == "3m" else 365)
        previous_close = daily[0]["open"]
        earlier = []
        day = first_fixture - timedelta(days=1)
        while day >= start:
            if day.weekday() < 5:
                offset = (first_fixture - day).days
                close = round(daily[0]["open"] * (1 - offset * 0.0004 + sin(offset / 9) * 0.025), 2)
                opening = previous_close
                earlier.append(
                    {
                        "time": day.isoformat(),
                        "open": opening,
                        "high": round(max(opening, close) * 1.004, 2),
                        "low": round(min(opening, close) * 0.996, 2),
                        "close": close,
                        "volume": daily[0]["volume"],
                    }
                )
                previous_close = close
            day -= timedelta(days=1)
        return [*reversed(earlier), *daily]

    step = 5 if chart_range == "1d" else 30
    sessions = daily[-(1 if chart_range == "1d" else 5) :]
    intraday = []
    count = 390 // step
    for candle in sessions:
        opening = datetime.combine(
            date.fromisoformat(candle["time"]), time(9, 30), ZoneInfo("America/New_York")
        )
        previous_close = candle["open"]
        for index in range(count):
            progress = (index + 1) / count
            close = round(
                candle["open"]
                + (candle["close"] - candle["open"]) * progress
                + sin(progress * 12) * candle["close"] * 0.001 * (1 - progress),
                2,
            )
            intraday.append(
                {
                    "time": int((opening + timedelta(minutes=index * step)).timestamp()),
                    "open": previous_close,
                    "high": round(max(previous_close, close) * 1.0005, 2),
                    "low": round(min(previous_close, close) * 0.9995, 2),
                    "close": close,
                    "volume": int(candle["volume"] / count),
                }
            )
            previous_close = close
    return intraday
