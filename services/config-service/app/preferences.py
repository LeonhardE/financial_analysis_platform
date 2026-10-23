"""Explicitly saved UI preferences, private to the server-verified Firebase user."""

import asyncio
import json
import os
import sqlite3
from contextlib import closing, contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from google.cloud import firestore
from pydantic import BaseModel, ConfigDict, Field

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.firestore import BoundedTransaction
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

UNAVAILABLE = "Your preferences are temporarily unavailable. Please try again later."
MAX_BODY_BYTES = 1024
MAX_VERSION = 9007199254740991


class PreferencesUnavailable(Exception):
    """Preferences could not be safely read or saved."""


class PreferencesConflict(Exception):
    """A newer save completed after the caller read its version."""


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    theme: Literal["system", "light", "dark"]
    language: Literal["en", "zh"]
    defaultChartRange: Literal["1d", "1w", "1m", "3m", "1y"]


class PreferencesResponse(BaseModel):
    preferences: Preferences | None
    version: Annotated[int, Field(ge=0, le=MAX_VERSION)]


class PreferencesUpdate(Preferences):
    expectedVersion: Annotated[int, Field(ge=0, le=MAX_VERSION)]


def checked_preferences(value: object) -> dict | None:
    """Absence is distinct from saved defaults; malformed documents fail closed."""
    if value is None:
        return None
    if (
        not isinstance(value, dict)
        or set(value) not in ({"version", "preferences"}, {"version", "preferences", "revision"})
        or type(value["version"]) is not int
        or value["version"] != 1
        or type(value.get("revision", 1)) is not int
        or not 1 <= value.get("revision", 1) <= MAX_VERSION
    ):
        raise PreferencesUnavailable
    try:
        return Preferences.model_validate(value["preferences"]).model_dump()
    except (TypeError, ValueError) as error:
        raise PreferencesUnavailable from error


def checked_snapshot(value: object) -> dict:
    preferences = checked_preferences(value)
    # Local documents saved before optimistic concurrency are version 1. Reads
    # do not migrate or rewrite them; the next accepted save stores a revision.
    version = value.get("revision", 1) if value is not None else 0
    return {"preferences": preferences, "version": version}


def next_snapshot(current: dict, preferences: dict, expected_version: int) -> dict:
    if type(expected_version) is not int or not 0 <= expected_version <= MAX_VERSION:
        raise PreferencesUnavailable
    if current["version"] != expected_version:
        raise PreferencesConflict
    if expected_version == MAX_VERSION:
        raise PreferencesUnavailable
    # Even identical values must advance the fence: otherwise an older timed-out
    # PUT could still commit after this request successfully confirmed the values.
    return {"preferences": preferences, "version": expected_version + 1}


def stored_document(snapshot: dict) -> dict:
    return {"version": 1, "revision": snapshot["version"], "preferences": snapshot["preferences"]}


class PreferencesStore:
    def get(self, uid: str) -> dict:
        raise NotImplementedError

    def save(self, uid: str, preferences: dict, expected_version: int) -> dict:
        raise NotImplementedError


class SQLitePreferencesStore(PreferencesStore):
    """Durable local-only storage; no browser storage or process-wide user cache."""

    def __init__(self, path: str):
        self.path = path
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with self.connection() as db:
                db.execute(
                    "CREATE TABLE IF NOT EXISTS user_preferences "
                    "(owner TEXT PRIMARY KEY, value TEXT NOT NULL)"
                )
            Path(path).chmod(0o600)
        except OSError as error:
            raise PreferencesUnavailable from error

    @contextmanager
    def connection(self):
        try:
            with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
                yield db
        except (sqlite3.Error, OSError, ValueError, TypeError) as error:
            raise PreferencesUnavailable from error

    @staticmethod
    def read(db, owner: str) -> dict:
        row = db.execute("SELECT value FROM user_preferences WHERE owner=?", (owner,)).fetchone()
        return checked_snapshot(json.loads(row[0]) if row else None)

    def get(self, uid: str) -> dict:
        with self.connection() as db:
            return self.read(db, owner_key(uid))

    def save(self, uid: str, preferences: dict, expected_version: int) -> dict:
        checked = checked_preferences({"version": 1, "preferences": preferences})
        owner = owner_key(uid)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            current = self.read(db, owner)
            result = next_snapshot(current, checked, expected_version)
            db.execute(
                "INSERT INTO user_preferences(owner, value) VALUES (?, ?) "
                "ON CONFLICT(owner) DO UPDATE SET value=excluded.value",
                (owner, json.dumps(stored_document(result), allow_nan=False)),
            )
            return result


class FirestorePreferencesStore(PreferencesStore):
    """One bounded document per user; atomic version checks reject stale saves."""

    def __init__(self, project: str, database: str):
        try:
            self.client = firestore.Client(project=project, database=database)
            self.collection = self.client.collection("user_preferences")
        except Exception as error:
            raise PreferencesUnavailable from error

    def document(self, uid: str):
        return self.collection.document(owner_key(uid))

    def get(self, uid: str) -> dict:
        try:
            return checked_snapshot(self.document(uid).get(timeout=4, retry=None).to_dict())
        except Exception as error:
            raise PreferencesUnavailable from error

    def save(self, uid: str, preferences: dict, expected_version: int) -> dict:
        checked = checked_preferences({"version": 1, "preferences": preferences})
        reference = self.document(uid)

        @firestore.transactional
        def save_transaction(transaction):
            current = reference.get(transaction=transaction, timeout=4, retry=None).to_dict()
            result = next_snapshot(checked_snapshot(current), checked, expected_version)
            transaction.set(reference, stored_document(result))
            return result

        try:
            return save_transaction(BoundedTransaction(self.client, max_attempts=2))
        except PreferencesConflict:
            raise
        except Exception as error:
            raise PreferencesUnavailable from error


def create_preferences_store() -> PreferencesStore:
    on_cloud_run = "K_SERVICE" in os.environ
    backend = os.getenv(
        "CONFIG_STORE_BACKEND",
        os.getenv("MARKET_CACHE_BACKEND", "firestore" if on_cloud_run else "sqlite"),
    )
    if on_cloud_run and (
        backend != "firestore"
        or os.getenv("FIRESTORE_EMULATOR_HOST")
        or os.getenv("FIREBASE_AUTH_EMULATOR_HOST")
    ):
        raise PreferencesUnavailable
    if backend == "firestore":
        project = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise PreferencesUnavailable
        return FirestorePreferencesStore(
            project,
            os.getenv("FIRESTORE_DATABASE", os.getenv("MARKET_FIRESTORE_DATABASE", "(default)")),
        )
    if backend == "sqlite":
        return SQLitePreferencesStore(
            os.getenv("PREFERENCES_DB_PATH", "/tmp/financial-analysis/preferences.sqlite3")
        )
    raise PreferencesUnavailable


@lru_cache(maxsize=4)
def configured_preferences_store(configuration: tuple[str, ...]) -> PreferencesStore:
    # Only cache database clients. User responses always come from private storage.
    return create_preferences_store()


def get_preferences_store() -> PreferencesStore:
    configuration = tuple(
        os.getenv(key, "")
        for key in (
            "CONFIG_STORE_BACKEND",
            "FIRESTORE_DATABASE",
            "MARKET_CACHE_BACKEND",
            "MARKET_FIRESTORE_DATABASE",
            "FIREBASE_PROJECT_ID",
            "GOOGLE_CLOUD_PROJECT",
            "K_SERVICE",
            "PREFERENCES_DB_PATH",
            "FIRESTORE_EMULATOR_HOST",
            "FIREBASE_AUTH_EMULATOR_HOST",
        )
    ) + (str("K_SERVICE" in os.environ),)
    try:
        return configured_preferences_store(configuration)
    except PreferencesUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


class PrivatePreferencesRoute(PrivateRoute):
    unavailable_message = UNAVAILABLE

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded_handler(request: Request):
            if request.method == "PUT":
                body = bytearray()
                try:
                    async with asyncio.timeout(5):
                        async for chunk in request.stream():
                            if len(body) + len(chunk) > MAX_BODY_BYTES:
                                raise HTTPException(413, "The preferences request is too large")
                            body.extend(chunk)
                except TimeoutError as error:
                    raise HTTPException(408, "The preferences request took too long") from error

                async def receive_body():
                    return {"type": "http.request", "body": bytes(body), "more_body": False}

                # Replay the bounded body for FastAPI validation without parsing
                # arbitrary-sized JSON or changing Starlette's internal caches.
                request = Request(request.scope, receive=receive_body)
            return await handler(request)

        return bounded_handler


router = APIRouter(
    prefix="/api/v1/preferences", tags=["preferences"], route_class=PrivatePreferencesRoute
)
User = Annotated[CurrentUser, Depends(require_google_user)]
Store = Annotated[PreferencesStore, Depends(get_preferences_store)]


@router.get("", response_model=PreferencesResponse)
def get_preferences(user: User, store: Store) -> dict:
    try:
        return store.get(user.uid)
    except PreferencesUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


@router.put("", response_model=PreferencesResponse)
def save_preferences(preferences: PreferencesUpdate, user: User, store: Store) -> dict:
    try:
        return store.save(
            user.uid,
            preferences.model_dump(exclude={"expectedVersion"}),
            preferences.expectedVersion,
        )
    except PreferencesConflict as error:
        raise HTTPException(
            409, "Your preferences changed. Reload them before saving again."
        ) from error
    except PreferencesUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error
