"""Yahoo snapshots through yfinance. No account tokens or user profile data are sent."""

import math
from calendar import monthrange
from datetime import date, datetime
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

from folioview_shared.instruments import (
    ALIASES as ALIASES,
)
from folioview_shared.instruments import (
    DEFAULT_BY_SYMBOL as DEFAULT_BY_SYMBOL,
)
from folioview_shared.instruments import (
    DEFAULT_INSTRUMENTS as DEFAULT_INSTRUMENTS,
)
from folioview_shared.instruments import (
    SYMBOL_PATTERN,
    Instrument,
    iso_time,
)
from folioview_shared.instruments import (
    canonical_symbol as canonical_symbol,
)
from folioview_shared.instruments import (
    static_search as static_search,
)

NEW_YORK = ZoneInfo("America/New_York")
US_EXCHANGES = {"NMS", "NGM", "NCM", "NYQ", "NAS", "NYSE", "NASDAQ"}
DOWNLOAD_LOCK = Lock()
# The public range is intentionally bounded: no arbitrary provider parameters,
# minute-by-minute polling, or intraday requests beyond Yahoo's retention window.
HISTORY_RANGES = {
    "1d": ("5d", "5m"),
    "1w": ("5d", "30m"),
    "1m": ("3mo", "1d"),
    "3m": ("3mo", "1d"),
    "1y": ("1y", "1d"),
}


class UpstreamError(Exception):
    def __init__(self, *, rate_limited: bool = False):
        super().__init__("Yahoo market data is temporarily unavailable")
        self.rate_limited = rate_limited


def valid_candles(frame, now: float, interval="1d") -> list[dict[str, Any]]:
    """Drop malformed rows rather than emitting NaN/Infinity or inconsistent OHLC."""
    result = {}
    today = datetime.fromtimestamp(now, NEW_YORK).date()
    for index, row in frame.iterrows():
        try:
            if interval == "1d":
                trading_date = date.fromisoformat(str(index.date()))
                candle_time = trading_date.isoformat()
            else:
                # Intraday timestamps must be timezone-aware. Guessing a zone
                # would move bars by hours, especially across daylight saving.
                if index.tzinfo is None:
                    continue
                instant = index.to_pydatetime().astimezone(NEW_YORK)
                trading_date = instant.date()
                candle_time = int(instant.timestamp())
                if (
                    candle_time > now
                    or instant.weekday() >= 5
                    or not (9, 30) <= (instant.hour, instant.minute) < (16, 0)
                ):
                    continue
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
            result[candle_time] = {
                "time": candle_time,
                "open": round(opening, 6),
                "high": round(high, 6),
                "low": round(low, 6),
                "close": round(close, 6),
                "volume": int(volume),
            }
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            continue
    return [result[key] for key in sorted(result)]


def calendar_start(last_date: date, months: int) -> date:
    """Calendar range start, clamped for month ends and leap days."""
    year, month = divmod(last_date.year * 12 + last_date.month - 1 - months, 12)
    return date(year, month + 1, min(last_date.day, monthrange(year, month + 1)[1]))


def candle_payload(
    instrument: Instrument, frame, now: float, chart_range="1m"
) -> dict[str, Any] | None:
    _, interval = HISTORY_RANGES[chart_range]
    intraday = interval != "1d"
    candles = valid_candles(frame, now, interval)
    if not candles or (not intraday and len(candles) < 2):
        return None
    local_now = datetime.fromtimestamp(now, NEW_YORK)
    last_date = (
        datetime.fromtimestamp(candles[-1]["time"], NEW_YORK).date().isoformat()
        if intraday
        else candles[-1]["time"]
    )
    if (local_now.date() - date.fromisoformat(last_date)).days > 7:
        return None
    # The date can appear before the session closes. 16:15 is deliberately
    # conservative, including the publication delay and early-close sessions.
    latest = candles[-1]["close"]
    if intraday:
        sessions = {
            candle["time"]: datetime.fromtimestamp(candle["time"], NEW_YORK).date().isoformat()
            for candle in candles
        }
        prior_session = [candle for candle in candles if sessions[candle["time"]] < last_date]
        previous = prior_session[-1]["close"] if prior_session else None
        selected_dates = sorted(set(sessions.values()))[-(1 if chart_range == "1d" else 5) :]
        selected = [candle for candle in candles if sessions[candle["time"]] in selected_dates]
        partial = now < candles[-1]["time"] + (300 if interval == "5m" else 1800)
    else:
        previous = candles[-2]["close"]
        start = calendar_start(
            date.fromisoformat(last_date), {"1m": 1, "3m": 3, "1y": 12}[chart_range]
        )
        selected = [candle for candle in candles if candle["time"] >= start.isoformat()]
        partial = last_date == local_now.date().isoformat() and (
            local_now.hour,
            local_now.minute,
        ) < (16, 15)
    return {
        **instrument.public(),
        "range": chart_range,
        "interval": interval,
        "source": "yfinance",
        "isMock": False,
        "candles": selected,
        "latestClose": latest,
        "changePercent": round((latest / previous - 1) * 100, 2) if previous else None,
        "dataDate": last_date,
        "fetchedAt": iso_time(now),
        "isStale": False,
        "isPartial": partial,
        "adjustment": "split_and_dividend_adjusted",
        "warning": None,
    }


class YahooProvider:
    def history(
        self, instruments: list[Instrument], now: float, chart_range="1m"
    ) -> dict[str, dict[str, Any]]:
        period, interval = HISTORY_RANGES[chart_range]
        symbols = [item.yahoo_symbol for item in instruments]
        try:
            # Cached market browsing does not need pandas/numpy or Yahoo's
            # client. Defer their startup cost until a real refresh is needed.
            import yfinance as yf

            # One parallel batch keeps a cold ten-symbol overview bounded by the
            # individual timeout rather than ten sequential network timeouts.
            # yfinance's downloader uses process-wide shared dictionaries.
            # Separate HTTP requests must not enter it concurrently.
            with DOWNLOAD_LOCK:
                frame = yf.download(
                    tickers=symbols,
                    period=period,
                    interval=interval,
                    ignore_tz=interval == "1d",
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
                    payload = candle_payload(instrument, item_frame, now, chart_range)
                    if payload:
                        output[instrument.symbol] = payload
                except (KeyError, TypeError):
                    continue
            return output
        except Exception as error:
            raise UpstreamError(rate_limited="ratelimit" in type(error).__name__.lower()) from error

    def search(self, query: str) -> list[Instrument]:
        try:
            import yfinance as yf

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
