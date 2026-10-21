"""Yahoo daily data through yfinance. No account tokens or user profile data are sent."""

import math
import re
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

import yfinance as yf

NEW_YORK = ZoneInfo("America/New_York")
SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?$")
US_EXCHANGES = {"NMS", "NGM", "NCM", "NYQ", "NAS", "NYSE", "NASDAQ"}
DOWNLOAD_LOCK = Lock()


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    instrument_type: str = "stock"
    yahoo_symbol: str = ""

    def public(self) -> dict[str, str]:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "instrumentType": self.instrument_type,
            "currency": "USD",
        }

    def stored(self) -> dict[str, str]:
        return asdict(self)


DEFAULT_INSTRUMENTS = (
    Instrument("SPX", "S&P 500", "index", "^GSPC"),
    Instrument("IXIC", "Nasdaq Composite", "index", "^IXIC"),
    Instrument("DJI", "Dow Jones Industrial Average", "index", "^DJI"),
    Instrument("AAPL", "Apple", yahoo_symbol="AAPL"),
    Instrument("MSFT", "Microsoft", yahoo_symbol="MSFT"),
    Instrument("GOOGL", "Alphabet", yahoo_symbol="GOOGL"),
    Instrument("AMZN", "Amazon", yahoo_symbol="AMZN"),
    Instrument("NVDA", "NVIDIA", yahoo_symbol="NVDA"),
    Instrument("META", "Meta Platforms", yahoo_symbol="META"),
    Instrument("TSLA", "Tesla", yahoo_symbol="TSLA"),
)
DEFAULT_BY_SYMBOL = {instrument.symbol: instrument for instrument in DEFAULT_INSTRUMENTS}
ALIASES = {
    "^GSPC": "SPX",
    "^IXIC": "IXIC",
    "^DJI": "DJI",
    "标普": "SPX",
    "纳斯达克": "IXIC",
    "道琼斯": "DJI",
    "苹果": "AAPL",
    "微软": "MSFT",
    "谷歌": "GOOGL",
    "亚马逊": "AMZN",
    "英伟达": "NVDA",
    "特斯拉": "TSLA",
}


class UpstreamError(Exception):
    def __init__(self, *, rate_limited: bool = False):
        super().__init__("Yahoo daily market data is temporarily unavailable")
        self.rate_limited = rate_limited


def canonical_symbol(value: str) -> str:
    symbol = value.strip().upper()
    return ALIASES.get(symbol, symbol)


def static_search(query: str) -> list[Instrument]:
    needle = query.casefold().strip()
    alias = ALIASES.get(query.strip()) or ALIASES.get(query.strip().upper())
    return [
        item
        for item in DEFAULT_INSTRUMENTS
        if needle in item.symbol.casefold()
        or needle in item.name.casefold()
        or item.symbol == alias
    ]


def iso_time(now: float) -> str:
    return datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z")


def valid_candles(frame, now: float) -> list[dict[str, Any]]:
    """Drop malformed rows rather than emitting NaN/Infinity or inconsistent OHLC."""
    result = {}
    today = datetime.fromtimestamp(now, NEW_YORK).date()
    for index, row in frame.iterrows():
        try:
            trading_date = date.fromisoformat(str(index.date()))
            values = [float(row[field]) for field in ("Open", "High", "Low", "Close", "Volume")]
            opening, high, low, close, volume = values
            if (
                trading_date > today
                or not all(math.isfinite(value) for value in values)
                or min(opening, high, low, close) <= 0
                or volume < 0
                or high < max(opening, close, low)
                or low > min(opening, close, high)
            ):
                continue
            result[trading_date.isoformat()] = {
                "time": trading_date.isoformat(),
                "open": round(opening, 6),
                "high": round(high, 6),
                "low": round(low, 6),
                "close": round(close, 6),
                "volume": int(volume),
            }
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            continue
    return [result[key] for key in sorted(result)]


def candle_payload(instrument: Instrument, frame, now: float) -> dict[str, Any] | None:
    candles = valid_candles(frame, now)
    if len(candles) < 2:
        return None
    local_now = datetime.fromtimestamp(now, NEW_YORK)
    last_date = candles[-1]["time"]
    if (local_now.date() - date.fromisoformat(last_date)).days > 7:
        return None
    # The date can appear before the session closes. 16:15 is deliberately
    # conservative, including the publication delay and early-close sessions.
    partial = last_date == local_now.date().isoformat() and (local_now.hour, local_now.minute) < (
        16,
        15,
    )
    latest = candles[-1]["close"]
    previous = candles[-2]["close"]
    return {
        **instrument.public(),
        "range": "1m",
        "source": "yfinance",
        "isMock": False,
        "candles": [
            candle
            for candle in candles
            if candle["time"] >= (date.fromisoformat(last_date) - timedelta(days=31)).isoformat()
        ],
        "latestClose": latest,
        "changePercent": round((latest / previous - 1) * 100, 2),
        "dataDate": last_date,
        "fetchedAt": iso_time(now),
        "isStale": False,
        "isPartial": partial,
        "adjustment": "split_and_dividend_adjusted",
        "warning": None,
    }


class YahooProvider:
    def history(self, instruments: list[Instrument], now: float) -> dict[str, dict[str, Any]]:
        symbols = [item.yahoo_symbol for item in instruments]
        try:
            # One parallel batch keeps a cold ten-symbol overview bounded by the
            # individual timeout rather than ten sequential network timeouts.
            # yfinance's downloader uses process-wide shared dictionaries.
            # Separate HTTP requests must not enter it concurrently.
            with DOWNLOAD_LOCK:
                frame = yf.download(
                    tickers=symbols,
                    period="3mo",
                    interval="1d",
                    auto_adjust=True,
                    actions=False,
                    prepost=False,
                    progress=False,
                    threads=4,
                    group_by="ticker",
                    timeout=6,
                    multi_level_index=True,
                )
            output = {}
            for instrument in instruments:
                try:
                    item_frame = frame[instrument.yahoo_symbol]
                    payload = candle_payload(instrument, item_frame, now)
                    if payload:
                        output[instrument.symbol] = payload
                except (KeyError, TypeError):
                    continue
            return output
        except Exception as error:
            raise UpstreamError(rate_limited="ratelimit" in type(error).__name__.lower()) from error

    def search(self, query: str) -> list[Instrument]:
        try:
            quotes = yf.Search(
                query,
                max_results=10,
                news_count=0,
                lists_count=0,
                recommended=0,
                include_cb=False,
                timeout=6,
            ).quotes
        except Exception as error:
            raise UpstreamError(rate_limited="ratelimit" in type(error).__name__.lower()) from error
        output = []
        seen = set()
        for quote in quotes:
            symbol = str(quote.get("symbol", "")).upper()
            name = str(quote.get("longname") or quote.get("shortname") or symbol).strip()
            if (
                quote.get("quoteType") != "EQUITY"
                or quote.get("exchange") not in US_EXCHANGES
                or quote.get("currency") not in (None, "USD")
                or not SYMBOL_PATTERN.fullmatch(symbol)
                or symbol in seen
                or not name
            ):
                continue
            seen.add(symbol)
            output.append(Instrument(symbol, name[:120], yahoo_symbol=symbol))
        return output[:10]
