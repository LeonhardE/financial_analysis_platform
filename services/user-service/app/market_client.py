"""Resolve new watchlist symbols through the public Market API boundary."""

import asyncio
import json
import os
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from folioview_shared.instruments import DEFAULT_BY_SYMBOL, SYMBOL_PATTERN, Instrument

MAX_RESPONSE_BYTES = 64 * 1024
VALIDATION_SECONDS = 4
UNAVAILABLE = "Stock validation is temporarily unavailable"


class PublicInstrument(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    symbol: Annotated[str, Field(min_length=1, max_length=14)]
    name: Annotated[str, Field(min_length=1, max_length=180)]
    instrumentType: Literal["stock", "index"]
    currency: Literal["USD"]

    def checked(self) -> Instrument:
        if not SYMBOL_PATTERN.fullmatch(self.symbol) or not self.name.strip():
            raise ValueError("Invalid instrument")
        if self.instrumentType == "index" and (
            self.symbol not in DEFAULT_BY_SYMBOL
            or DEFAULT_BY_SYMBOL[self.symbol].instrument_type != "index"
        ):
            raise ValueError("Unknown index")
        return Instrument(self.symbol, self.name, self.instrumentType)


class MarketResolver:
    """One bounded request to a configured origin; no credentials or redirects."""

    def __init__(self, base_url: str, *, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url
        self.transport = transport

    def endpoint(self) -> str:
        parsed = urlsplit(self.base_url)
        if (
            parsed.scheme not in ("https", "http")
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/")
            or ("K_SERVICE" in os.environ and parsed.scheme != "https")
        ):
            raise ValueError("Invalid Market origin")
        return f"{self.base_url.rstrip('/')}/api/stocks/search"

    async def resolve(self, symbol: str) -> Instrument:
        try:
            endpoint = self.endpoint()
            # The wall-clock deadline covers DNS, connect, headers, and the full
            # streamed body, including a peer that drips bytes indefinitely.
            async with asyncio.timeout(VALIDATION_SECONDS):
                async with httpx.AsyncClient(
                    transport=self.transport,
                    timeout=VALIDATION_SECONDS,
                    follow_redirects=False,
                    trust_env=False,
                    headers={"Accept": "application/json", "Accept-Encoding": "identity"},
                ) as client:
                    async with client.stream("GET", endpoint, params={"q": symbol}) as result:
                        if result.status_code == 404:
                            raise HTTPException(404, "US stock symbol not found")
                        if result.status_code != 200:
                            raise ValueError("Market request failed")
                        if result.headers.get("content-encoding", "identity") != "identity":
                            raise ValueError("Unexpected encoded Market response")
                        content_length = result.headers.get("content-length")
                        if content_length is not None and int(content_length) > MAX_RESPONSE_BYTES:
                            raise ValueError("Market response exceeds limit")
                        body = bytearray()
                        async for chunk in result.aiter_raw():
                            if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                                raise ValueError("Market response exceeds limit")
                            body.extend(chunk)
            payload = json.loads(body)
            rows = payload.get("stocks") if isinstance(payload, dict) else None
            if not isinstance(rows, list) or len(rows) > 10:
                raise ValueError("Invalid Market response")
            instruments = [PublicInstrument.model_validate(row).checked() for row in rows]
            exact = [item for item in instruments if item.symbol == symbol]
            if not exact:
                raise HTTPException(404, "US stock symbol not found")
            if len(exact) != 1:
                raise ValueError("Ambiguous Market response")
            return exact[0]
        except HTTPException:
            raise
        except (
            httpx.HTTPError,
            httpx.InvalidURL,
            TimeoutError,
            ValueError,
            TypeError,
            ValidationError,
        ) as error:
            raise HTTPException(503, UNAVAILABLE) from error


def get_market_resolver() -> MarketResolver:
    # Configuration errors are checked only for a genuinely new symbol, so a
    # Market outage cannot break listing, removal, or idempotent duplicate adds.
    default = "" if "K_SERVICE" in os.environ else "http://127.0.0.1:8000"
    return MarketResolver(os.getenv("MARKET_API_BASE_URL", default))
