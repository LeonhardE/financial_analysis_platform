"""Private bounded watchlists, isolated by verified identity and durable across restarts."""

import hashlib
import json
import os
import sqlite3
import time
from contextlib import closing, contextmanager
from datetime import datetime
from functools import lru_cache
from pathlib import Path as FilePath
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from google.cloud import firestore
from pydantic import BaseModel, ConfigDict, Field
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .auth import CurrentUser, require_google_user
from .market_cache import BoundedTransaction, CacheUnavailable
from .market_data import MarketService, get_market_service
from .yahoo_provider import (
    DEFAULT_BY_SYMBOL,
    SYMBOL_PATTERN,
    UpstreamError,
    canonical_symbol,
    iso_time,
)

LIMIT = 50
UNAVAILABLE = "Your watchlist is temporarily unavailable. Please try again later."


class WatchlistUnavailable(Exception):
    """Storage or stored data could not be used safely."""


class WatchlistFull(Exception):
    """The bounded user document is full."""


class WatchlistItem(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    symbol: Annotated[str, Field(min_length=1, max_length=14)]
    name: Annotated[str, Field(min_length=1, max_length=180)]
    instrumentType: Literal["stock", "index"]
    currency: Literal["USD"]
    addedAt: Annotated[str, Field(min_length=20, max_length=40)]


class WatchlistResponse(BaseModel):
    items: list[WatchlistItem]
    limit: Literal[50] = LIMIT


def owner_key(uid: str) -> str:
    # A Firebase UID is an opaque identifier, never a path supplied by a caller.
    return hashlib.sha256(uid.encode()).hexdigest()


def checked_items(value: object) -> list[dict]:
    """Reject malformed stored documents rather than overwriting private data."""
    if value is None:
        return []
    if not isinstance(value, dict) or value.get("version") != 1:
        raise WatchlistUnavailable
    rows = value.get("items")
    if not isinstance(rows, list) or len(rows) > LIMIT:
        raise WatchlistUnavailable
    result = []
    symbols = set()
    try:
        for row in rows:
            item = WatchlistItem.model_validate(row).model_dump()
            timestamp = datetime.fromisoformat(item["addedAt"].replace("Z", "+00:00"))
            if (
                not SYMBOL_PATTERN.fullmatch(item["symbol"])
                or item["symbol"] in symbols
                or timestamp.tzinfo is None
                or (
                    item["instrumentType"] == "index"
                    and (
                        item["symbol"] not in DEFAULT_BY_SYMBOL
                        or DEFAULT_BY_SYMBOL[item["symbol"]].instrument_type != "index"
                    )
                )
            ):
                raise WatchlistUnavailable
            symbols.add(item["symbol"])
            result.append(item)
        return sorted(
            result,
            key=lambda item: (
                datetime.fromisoformat(item["addedAt"].replace("Z", "+00:00")),
                item["symbol"],
            ),
        )
    except (ValueError, TypeError, KeyError) as error:
        raise WatchlistUnavailable from error


def update_items(items: list[dict], symbol: str, item: dict | None) -> tuple[list[dict], bool]:
    existing = any(row["symbol"] == symbol for row in items)
    if item is not None:
        if existing:
            return items, False
        if len(items) >= LIMIT:
            raise WatchlistFull
        return checked_items({"version": 1, "items": [*items, item]}), True
    return [row for row in items if row["symbol"] != symbol], existing


class WatchlistStore:
    def get(self, uid: str) -> list[dict]:
        raise NotImplementedError

    def change(self, uid: str, symbol: str, item: dict | None) -> list[dict]:
        raise NotImplementedError


class SQLiteWatchlistStore(WatchlistStore):
    """Persistent local development storage; never used in Cloud Run."""

    def __init__(self, path: str):
        self.path = path
        try:
            FilePath(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with self.connection() as db:
                db.execute(
                    "CREATE TABLE IF NOT EXISTS user_watchlists "
                    "(owner TEXT PRIMARY KEY, value TEXT NOT NULL)"
                )
            FilePath(path).chmod(0o600)
        except OSError as error:
            raise WatchlistUnavailable from error

    @contextmanager
    def connection(self):
        try:
            with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
                yield db
        except (sqlite3.Error, OSError, ValueError, TypeError) as error:
            raise WatchlistUnavailable from error

    @staticmethod
    def read(db, owner):
        row = db.execute("SELECT value FROM user_watchlists WHERE owner=?", (owner,)).fetchone()
        return checked_items(json.loads(row[0]) if row else None)

    def get(self, uid: str) -> list[dict]:
        with self.connection() as db:
            return self.read(db, owner_key(uid))

    def change(self, uid: str, symbol: str, item: dict | None) -> list[dict]:
        owner = owner_key(uid)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            items, changed = update_items(self.read(db, owner), symbol, item)
            if changed:
                db.execute(
                    "INSERT INTO user_watchlists(owner, value) VALUES (?, ?) "
                    "ON CONFLICT(owner) DO UPDATE SET value=excluded.value",
                    (owner, json.dumps({"version": 1, "items": items}, allow_nan=False)),
                )
            return items


class FirestoreWatchlistStore(WatchlistStore):
    """One user document, one bounded read, and atomic capped modifications."""

    def __init__(self, project: str, database: str):
        try:
            self.client = firestore.Client(project=project, database=database)
            self.collection = self.client.collection("user_watchlists")
        except Exception as error:
            raise WatchlistUnavailable from error

    def document(self, uid: str):
        return self.collection.document(owner_key(uid))

    def get(self, uid: str) -> list[dict]:
        try:
            return checked_items(self.document(uid).get(timeout=4, retry=None).to_dict())
        except Exception as error:
            raise WatchlistUnavailable from error

    def change(self, uid: str, symbol: str, item: dict | None) -> list[dict]:
        reference = self.document(uid)

        @firestore.transactional
        def change_transaction(transaction):
            current = reference.get(transaction=transaction, timeout=4, retry=None).to_dict()
            items, changed = update_items(checked_items(current), symbol, item)
            if changed:
                transaction.set(reference, {"version": 1, "items": items})
            return items

        try:
            return change_transaction(BoundedTransaction(self.client, max_attempts=2))
        except WatchlistFull:
            raise
        except Exception as error:
            raise WatchlistUnavailable from error


def create_watchlist_store() -> WatchlistStore:
    on_cloud_run = "K_SERVICE" in os.environ
    backend = os.getenv("MARKET_CACHE_BACKEND", "firestore" if on_cloud_run else "sqlite")
    if on_cloud_run and (
        backend != "firestore"
        or os.getenv("FIRESTORE_EMULATOR_HOST")
        or os.getenv("FIREBASE_AUTH_EMULATOR_HOST")
    ):
        raise WatchlistUnavailable
    if backend == "firestore":
        project = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise WatchlistUnavailable
        return FirestoreWatchlistStore(project, os.getenv("MARKET_FIRESTORE_DATABASE", "(default)"))
    if backend == "sqlite":
        return SQLiteWatchlistStore(
            os.getenv("WATCHLIST_DB_PATH", "/tmp/financial-analysis/watchlists.sqlite3")
        )
    raise WatchlistUnavailable


@lru_cache(maxsize=4)
def configured_store(configuration: tuple[str, ...]) -> WatchlistStore:
    # Cache database clients, never user responses or identity information.
    return create_watchlist_store()


def get_watchlist_store() -> WatchlistStore:
    configuration = tuple(
        os.getenv(key, "")
        for key in (
            "MARKET_CACHE_BACKEND",
            "MARKET_FIRESTORE_DATABASE",
            "FIREBASE_PROJECT_ID",
            "GOOGLE_CLOUD_PROJECT",
            "K_SERVICE",
            "WATCHLIST_DB_PATH",
            "FIRESTORE_EMULATOR_HOST",
            "FIREBASE_AUTH_EMULATOR_HOST",
        )
    ) + (str("K_SERVICE" in os.environ),)
    try:
        return configured_store(configuration)
    except WatchlistUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


def validated_symbol(raw: str) -> str:
    symbol = canonical_symbol(raw)
    if not SYMBOL_PATTERN.fullmatch(symbol):
        raise HTTPException(400, "Invalid stock symbol")
    return symbol


def response(items: list[dict]) -> dict:
    return {"items": items, "limit": LIMIT}


class PrivateWatchlistRoute(APIRoute):
    unavailable_message = UNAVAILABLE

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                return await handler(request)
            except (HTTPException, RequestValidationError):
                raise
            except Exception as error:
                # Keep unexpected SDK/serialization details out of private API
                # responses, and let the no-store middleware cover this error.
                raise HTTPException(503, self.unavailable_message) from error

        return private_handler


router = APIRouter(
    prefix="/api/v1/watchlist", tags=["watchlist"], route_class=PrivateWatchlistRoute
)
User = Annotated[CurrentUser, Depends(require_google_user)]
Store = Annotated[WatchlistStore, Depends(get_watchlist_store)]
Symbol = Annotated[str, Path(min_length=1, max_length=32)]


@router.get("", response_model=WatchlistResponse)
def list_watchlist(user: User, store: Store) -> dict:
    try:
        return response(store.get(user.uid))
    except WatchlistUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


@router.put("/{symbol}", response_model=WatchlistResponse)
def add_watchlist_item(
    symbol: Symbol,
    user: User,
    store: Store,
    market: Annotated[MarketService, Depends(get_market_service)],
) -> dict:
    symbol = validated_symbol(symbol)
    try:
        current = store.get(user.uid)
        # No upstream lookup, timestamp change, or database write on duplicate add.
        if any(item["symbol"] == symbol for item in current):
            return response(current)
        if len(current) >= LIMIT:
            raise WatchlistFull
        if market.source == "mock" and symbol not in DEFAULT_BY_SYMBOL:
            raise HTTPException(404, "US stock symbol not found")
        instrument = market.resolve_instrument(symbol, market.clock())
        item = {**instrument.public(), "addedAt": iso_time(time.time())}
        if item["symbol"] != symbol:
            raise WatchlistUnavailable
        return response(store.change(user.uid, symbol, item))
    except WatchlistFull as error:
        raise HTTPException(409, f"Your watchlist can contain up to {LIMIT} instruments") from error
    except (WatchlistUnavailable, CacheUnavailable, UpstreamError) as error:
        raise HTTPException(503, UNAVAILABLE) from error
    except HTTPException as error:
        if error.status_code in (429, 503):
            raise HTTPException(503, "Stock validation is temporarily unavailable") from error
        raise


@router.delete("/{symbol}", response_model=WatchlistResponse)
def remove_watchlist_item(symbol: Symbol, user: User, store: Store) -> dict:
    symbol = validated_symbol(symbol)
    try:
        # Removal and listing work even when Yahoo or the market cache is down.
        return response(store.change(user.uid, symbol, None))
    except WatchlistUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


class PrivateWatchlistHeaders:
    """Apply no-store to successful, authentication, validation, and CORS responses."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        path = scope.get("path", "")
        private = any(
            path == prefix or path.startswith(f"{prefix}/")
            for prefix in ("/api/v1/watchlist", "/api/v1/preferences")
        )
        if scope["type"] != "http" or not private:
            await self.app(scope, receive, send)
            return

        async def private_send(message: Message):
            if message["type"] == "http.response.start":
                headers = [
                    pair for pair in message.get("headers", []) if pair[0] != b"cache-control"
                ]
                message = {**message, "headers": [*headers, (b"cache-control", b"no-store")]}
            await send(message)

        await self.app(scope, receive, private_send)
