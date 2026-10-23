"""Public market identity contract, without provider, cache, or user storage code."""

import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

SYMBOL_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]{1,3})?$")


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
