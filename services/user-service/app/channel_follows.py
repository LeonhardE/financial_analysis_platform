"""User-owned manual channel lists with atomic, bounded content revisions.

These lists remain in User's existing plaintext domain. They contain no video
material, are never resolved over the network, and are not an agent projection.
"""

import asyncio
import hashlib
import json
import os
import re
import sqlite3
import time
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from google.cloud import firestore
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.firestore import BoundedTransaction
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key
from folioview_shared.instruments import iso_time

LIMIT = 50
MAX_BODY_BYTES = 131_072
MAX_REVISION = 9_007_199_254_740_991
UNAVAILABLE = "Your channel follows are temporarily unavailable. Please try again later."
LOCATOR = re.compile(r"(?:@|https://(?:www\.)?youtube\.com/@)([A-Za-z0-9_.-]{1,64})\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")


class ChannelFollowsUnavailable(Exception):
    """Storage or a content/version pair cannot be used safely."""


class ChannelRevisionConflict(Exception):
    """The list has changed since the caller's last read."""


class ChannelInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: Annotated[str, Field(min_length=1, max_length=120)]
    handleOrUrl: Annotated[str, Field(min_length=1, max_length=256)]
    note: Annotated[str, Field(max_length=1000)]


class ChannelFollow(ChannelInput):
    followId: Annotated[str, Field(min_length=1, max_length=128)]
    verification: Literal["user_provided"]
    addedAt: Annotated[str, Field(min_length=20, max_length=40)]


class ChannelFollowsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: Annotated[int, Field(ge=0, le=MAX_REVISION)]
    items: Annotated[list[ChannelInput], Field(max_length=LIMIT)]


class ChannelFollowsResponse(BaseModel):
    revision: Annotated[int, Field(ge=0, le=MAX_REVISION)]
    items: Annotated[list[ChannelFollow], Field(max_length=LIMIT)]
    limit: Literal[50] = LIMIT


def normalize_locator(value: str) -> str:
    match = LOCATOR.fullmatch(value)
    if match is None:
        raise ValueError("Unsupported manual channel locator")
    return f"https://www.youtube.com/@{match[1].lower()}"


def normalize_inputs(items: list[ChannelInput]) -> list[dict]:
    result = []
    locators = set()
    for item in items:
        row = item.model_dump()
        row["handleOrUrl"] = normalize_locator(row["handleOrUrl"])
        if row["handleOrUrl"] in locators:
            raise ValueError("Duplicate manual channel locator")
        locators.add(row["handleOrUrl"])
        result.append(row)
    # Validate UTF-8, depth and finite data without altering user-provided text.
    canonical_json(result)
    return result


def content_digest(items: list[dict]) -> str:
    """Internal consistency guard only; never expose low-entropy list hashes."""
    return hashlib.sha256(canonical_json(items)).hexdigest()


def version_key(uid: str) -> str:
    return f"{owner_key(uid)}_channel_follows"


def checked_pair(content: object, metadata: object) -> dict:
    """Read an exact content/version pair; GET never initializes or repairs it."""
    if content is None and metadata is None:
        return {"revision": 0, "items": [], "limit": LIMIT}
    try:
        if (
            type(content) is not dict
            or set(content) != {"version", "items"}
            or type(content["version"]) is not int
            or content["version"] != 1
            or type(content["items"]) is not list
            or len(content["items"]) > LIMIT
            or type(metadata) is not dict
            or set(metadata)
            != {"version", "ref", "revision", "sourceEpoch", "contentDigest", "updatedAt"}
            or type(metadata["version"]) is not int
            or metadata["version"] != 1
            or type(metadata["revision"]) is not int
            or not 1 <= metadata["revision"] <= MAX_REVISION
            or type(metadata["sourceEpoch"]) is not int
            or not 1 <= metadata["sourceEpoch"] <= MAX_REVISION
        ):
            raise ValueError
        ref = metadata["ref"]
        if (
            type(ref) is not dict
            or set(ref) != {"kind", "sourceService", "resourceId", "incarnation"}
            or ref["kind"] != "channel_follows"
            or ref["sourceService"] != "user"
            or not all(
                type(ref[key]) is str and IDENTIFIER.fullmatch(ref[key])
                for key in ("resourceId", "incarnation")
            )
        ):
            raise ValueError
        _checked_timestamp(metadata["updatedAt"])
        rows, ids, locators = [], set(), set()
        for raw in content["items"]:
            row = ChannelFollow.model_validate(raw).model_dump()
            if (
                not IDENTIFIER.fullmatch(row["followId"])
                or row["followId"] in ids
                or normalize_locator(row["handleOrUrl"]) != row["handleOrUrl"]
                or row["handleOrUrl"] in locators
            ):
                raise ValueError
            _checked_timestamp(row["addedAt"])
            ids.add(row["followId"])
            locators.add(row["handleOrUrl"])
            rows.append(row)
        rows.sort(key=lambda row: (_checked_timestamp(row["addedAt"]), row["followId"]))
        if rows != content["items"] or metadata["contentDigest"] != content_digest(rows):
            raise ValueError
        return {"revision": metadata["revision"], "items": rows, "limit": LIMIT}
    except (ValueError, TypeError, KeyError, ContractError) as error:
        raise ChannelFollowsUnavailable from error


def _checked_timestamp(value):
    if type(value) is not str or not 20 <= len(value) <= 40 or not value.endswith("Z"):
        raise ValueError
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo != UTC:
        raise ValueError
    return parsed


def replace_pair(content, metadata, expected_revision: int, incoming: list[dict]):
    current = checked_pair(content, metadata)
    if current["revision"] != expected_revision:
        raise ChannelRevisionConflict
    old = {row["handleOrUrl"]: row for row in current["items"]}
    same_content = len(old) == len(incoming) and all(
        row["handleOrUrl"] in old
        and all(old[row["handleOrUrl"]][key] == row[key] for key in ("name", "note"))
        for row in incoming
    )
    if same_content:
        return current, None, None
    if current["revision"] == MAX_REVISION:
        raise ChannelFollowsUnavailable
    now = iso_time(time.time())
    rows = []
    for row in incoming:
        previous = old.get(row["handleOrUrl"])
        rows.append(
            {
                **row,
                "followId": previous["followId"] if previous else f"cf_{uuid4().hex}",
                "verification": "user_provided",
                "addedAt": previous["addedAt"] if previous else now,
            }
        )
    rows.sort(key=lambda row: (_checked_timestamp(row["addedAt"]), row["followId"]))
    ref = (
        metadata["ref"]
        if metadata
        else {
            "kind": "channel_follows",
            "sourceService": "user",
            "resourceId": f"cf_{uuid4().hex}",
            "incarnation": uuid4().hex,
        }
    )
    new_content = {"version": 1, "items": rows}
    new_metadata = {
        "version": 1,
        "ref": ref,
        "revision": current["revision"] + 1,
        "sourceEpoch": metadata["sourceEpoch"] if metadata else 1,
        "contentDigest": content_digest(rows),
        "updatedAt": now,
    }
    return checked_pair(new_content, new_metadata), new_content, new_metadata


class ChannelFollowsStore:
    def get(self, uid: str) -> dict:
        raise NotImplementedError

    def replace(self, uid: str, expected_revision: int, items: list[dict]) -> dict:
        raise NotImplementedError


class SQLiteChannelFollowsStore(ChannelFollowsStore):
    """Local development only; content and versions commit in one transaction."""

    def __init__(self, path: str):
        self.path = path
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with self.connection() as db:
                db.execute(
                    "CREATE TABLE IF NOT EXISTS user_channel_follows "
                    "(owner TEXT PRIMARY KEY, value TEXT NOT NULL)"
                )
                db.execute(
                    "CREATE TABLE IF NOT EXISTS user_resource_versions "
                    "(owner TEXT PRIMARY KEY, value TEXT NOT NULL)"
                )
            Path(path).chmod(0o600)
        except OSError as error:
            raise ChannelFollowsUnavailable from error

    @contextmanager
    def connection(self):
        try:
            with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
                yield db
        except (sqlite3.Error, OSError, ValueError, TypeError, ContractError) as error:
            raise ChannelFollowsUnavailable from error

    @staticmethod
    def read(db, uid):
        values = []
        for table, key in (
            ("user_channel_follows", owner_key(uid)),
            ("user_resource_versions", version_key(uid)),
        ):
            row = db.execute(f"SELECT value FROM {table} WHERE owner=?", (key,)).fetchone()
            values.append(strict_json_loads(row[0]) if row else None)
        return values

    def get(self, uid: str) -> dict:
        with self.connection() as db:
            db.execute("BEGIN")
            return checked_pair(*self.read(db, uid))

    def replace(self, uid: str, expected_revision: int, items: list[dict]) -> dict:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            result, content, metadata = replace_pair(*self.read(db, uid), expected_revision, items)
            if content is not None:
                for table, key, value in (
                    ("user_channel_follows", owner_key(uid), content),
                    ("user_resource_versions", version_key(uid), metadata),
                ):
                    db.execute(
                        f"INSERT INTO {table}(owner, value) VALUES (?, ?) "
                        "ON CONFLICT(owner) DO UPDATE SET value=excluded.value",
                        (key, json.dumps(value, allow_nan=False)),
                    )
            return result


class FirestoreChannelFollowsStore(ChannelFollowsStore):
    """Bounded consistent reads and CAS writes; never caches user responses."""

    def __init__(self, project: str, database: str):
        try:
            self.client = firestore.Client(project=project, database=database)
        except Exception as error:
            raise ChannelFollowsUnavailable from error

    def references(self, uid):
        return (
            self.client.collection("user_channel_follows").document(owner_key(uid)),
            self.client.collection("user_resource_versions").document(version_key(uid)),
        )

    def _operation(self, uid, change=None):
        content_ref, metadata_ref = self.references(uid)

        @firestore.transactional
        def operation(transaction):
            content = content_ref.get(transaction=transaction, timeout=4, retry=None).to_dict()
            metadata = metadata_ref.get(transaction=transaction, timeout=4, retry=None).to_dict()
            if change is None:
                return checked_pair(content, metadata)
            expected_revision, items = change
            result, content, metadata = replace_pair(content, metadata, expected_revision, items)
            if content is not None:
                transaction.set(content_ref, content)
                transaction.set(metadata_ref, metadata)
            return result

        try:
            return operation(BoundedTransaction(self.client, max_attempts=2))
        except ChannelRevisionConflict:
            raise
        except Exception as error:
            raise ChannelFollowsUnavailable from error

    def get(self, uid: str) -> dict:
        return self._operation(uid)

    def replace(self, uid: str, expected_revision: int, items: list[dict]) -> dict:
        return self._operation(uid, (expected_revision, items))


def create_channel_follows_store() -> ChannelFollowsStore:
    on_cloud_run = "K_SERVICE" in os.environ
    backend = os.getenv("USER_STORE_BACKEND") or os.getenv(
        "MARKET_CACHE_BACKEND", "firestore" if on_cloud_run else "sqlite"
    )
    if on_cloud_run and (
        backend != "firestore"
        or os.getenv("FIRESTORE_EMULATOR_HOST")
        or os.getenv("FIREBASE_AUTH_EMULATOR_HOST")
    ):
        raise ChannelFollowsUnavailable
    if backend == "firestore":
        project = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise ChannelFollowsUnavailable
        database = os.getenv("FIRESTORE_DATABASE") or os.getenv(
            "MARKET_FIRESTORE_DATABASE", "(default)"
        )
        return FirestoreChannelFollowsStore(project, database)
    if backend == "sqlite":
        return SQLiteChannelFollowsStore(
            os.getenv("CHANNEL_FOLLOWS_DB_PATH")
            or os.getenv("WATCHLIST_DB_PATH", "/tmp/financial-analysis/watchlists.sqlite3")
        )
    raise ChannelFollowsUnavailable


@lru_cache(maxsize=4)
def configured_store(configuration: tuple[str, ...]) -> ChannelFollowsStore:
    return create_channel_follows_store()


def get_channel_follows_store() -> ChannelFollowsStore:
    keys = (
        "USER_STORE_BACKEND",
        "MARKET_CACHE_BACKEND",
        "FIREBASE_PROJECT_ID",
        "GOOGLE_CLOUD_PROJECT",
        "FIRESTORE_DATABASE",
        "MARKET_FIRESTORE_DATABASE",
        "CHANNEL_FOLLOWS_DB_PATH",
        "WATCHLIST_DB_PATH",
        "K_SERVICE",
        "FIRESTORE_EMULATOR_HOST",
        "FIREBASE_AUTH_EMULATOR_HOST",
    )
    configuration = tuple(os.getenv(key, "") for key in keys) + (str("K_SERVICE" in os.environ),)
    try:
        return configured_store(configuration)
    except ChannelFollowsUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


async def checked_update(request: Request) -> tuple[int, list[dict]]:
    raw = bytearray()
    try:
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                if len(raw) + len(chunk) > MAX_BODY_BYTES:
                    raise HTTPException(413, "Request body is too large")
                raw.extend(chunk)
    except TimeoutError as error:
        raise HTTPException(408, "The request body took too long") from error
    try:
        update = ChannelFollowsUpdate.model_validate(
            strict_json_loads(bytes(raw), max_bytes=MAX_BODY_BYTES)
        )
        return update.expectedRevision, normalize_inputs(update.items)
    except (ValueError, ValidationError, ContractError) as error:
        raise HTTPException(422, "Invalid channel follows request") from error


class PrivateChannelFollowsRoute(PrivateRoute):
    unavailable_message = UNAVAILABLE

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def channel_handler(request):
            try:
                return await handler(request)
            except RequestValidationError:
                return channel_error(422)
            except HTTPException as error:
                return channel_error(error.status_code, error.headers)

        return channel_handler


def channel_error(status, headers=None):
    codes = {
        401: ("unauthenticated", "A valid signed identity is required."),
        403: ("forbidden", "This request is not authorized."),
        408: ("request_timeout", "The request body took too long."),
        409: ("version_conflict", "The channel list has changed. Reload before saving."),
        413: ("body_too_large", "The request body is too large."),
        422: ("invalid_request", "Invalid channel follows request."),
        503: ("source_unavailable", UNAVAILABLE),
    }
    code, message = codes.get(status, ("invalid_request", "Invalid channel follows request."))
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
                "requestId": uuid4().hex,
                "retryable": status == 503,
            }
        },
        headers={**(headers or {}), "Cache-Control": "no-store"},
    )


router = APIRouter(
    prefix="/api/v1/channel-follows",
    tags=["channel-follows"],
    route_class=PrivateChannelFollowsRoute,
)
User = Annotated[CurrentUser, Depends(require_google_user)]
Store = Annotated[ChannelFollowsStore, Depends(get_channel_follows_store)]


@router.get("", response_model=ChannelFollowsResponse)
def list_channel_follows(user: User, store: Store) -> dict:
    try:
        return store.get(user.uid)
    except ChannelFollowsUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error


_UPDATE_SCHEMA = ChannelFollowsUpdate.model_json_schema()
_UPDATE_SCHEMA["properties"]["items"]["items"] = _UPDATE_SCHEMA.pop("$defs")["ChannelInput"]


@router.put(
    "",
    response_model=ChannelFollowsResponse,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {"schema": _UPDATE_SCHEMA},
            },
        }
    },
)
async def replace_channel_follows(request: Request, user: User, store: Store) -> dict:
    expected_revision, items = await checked_update(request)
    try:
        return await run_in_threadpool(store.replace, user.uid, expected_revision, items)
    except ChannelRevisionConflict as error:
        raise HTTPException(409, "Channel revision conflict") from error
    except ChannelFollowsUnavailable as error:
        raise HTTPException(503, UNAVAILABLE) from error
