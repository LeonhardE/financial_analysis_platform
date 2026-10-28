"""Consistent User source metadata and explicit legacy/empty initialization.

No content, content hash or count is returned to Hub. User lists are not copied
into Hub; trusted clients read their own lists to form encrypted Run evidence.
"""

import hashlib
import json
import os
import sqlite3
from contextlib import closing, contextmanager
from copy import deepcopy
from functools import lru_cache
from pathlib import Path

from google.cloud import firestore

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import strict_json_loads
from folioview_shared.firestore import BoundedTransaction
from folioview_shared.identity import owner_key

from .channel_follows import ChannelFollowsUnavailable, checked_pair
from .resource_versions import (
    KINDS,
    MAX_REVISION,
    checked_time,
    new_version,
    validate_version,
    version_key,
)
from .watchlist import WatchlistUnavailable, checked_items

MAX_INITIALIZATION_OPERATIONS = 32

COLLECTIONS = {"watchlist": "user_watchlists", "channel_follows": "user_channel_follows"}


class ResourceUnavailable(Exception):
    """Stored source data and its version cannot safely be used."""


class InitializationLimit(Exception):
    """The fixed per-owner/source receipt budget is exhausted; replay still works."""


def read_pair(kind, content, metadata):
    if kind not in KINDS:
        raise ResourceUnavailable
    try:
        if kind == "channel_follows":
            items = checked_pair(content, metadata)["items"]
        else:
            if content is None and metadata is not None:
                raise ResourceUnavailable
            items = checked_items(content)
            validate_version(kind, items, metadata)
        return items, metadata
    except (
        ValueError,
        TypeError,
        KeyError,
        ContractError,
        WatchlistUnavailable,
        ChannelFollowsUnavailable,
    ) as error:
        raise ResourceUnavailable from error


def summary(kind, items, metadata):
    return {
        "kind": kind,
        "sourceService": "user",
        "state": "uninitialized" if metadata is None else ("ready" if items else "empty"),
        "ref": deepcopy(metadata["ref"]) if metadata else None,
        "revision": metadata["revision"] if metadata else None,
        "sourceEpoch": metadata["sourceEpoch"] if metadata else None,
        "updatedAt": metadata["updatedAt"] if metadata else None,
    }


def initialization_key(uid, kind, operation_key):
    return hashlib.sha256(f"{owner_key(uid)}:{kind}:{operation_key}".encode()).hexdigest()


def initialization(kind, content, metadata, aggregate, operation_key):
    items, metadata = read_pair(kind, content, metadata)
    if aggregate is None:
        operations = {}
    else:
        if (
            type(aggregate) is not dict
            or set(aggregate) != {"version", "kind", "operations"}
            or type(aggregate["version"]) is not int
            or aggregate["version"] != 1
            or aggregate["kind"] != kind
            or type(aggregate["operations"]) is not dict
            or not 1 <= len(aggregate["operations"]) <= MAX_INITIALIZATION_OPERATIONS
            or metadata is None
        ):
            raise ResourceUnavailable
        operations = aggregate["operations"]
        for key, result in operations.items():
            if (
                type(key) is not str
                or len(key) != 64
                or any(char not in "0123456789abcdef" for char in key)
                or type(result) is not dict
                or set(result)
                != {"kind", "sourceService", "state", "ref", "revision", "sourceEpoch", "updatedAt"}
                or result["kind"] != kind
                or result["sourceService"] != "user"
                or result["state"] not in {"ready", "empty"}
                or result["ref"] != metadata["ref"]
                or type(result["revision"]) is not int
                or not 0 <= result["revision"] <= min(MAX_REVISION, metadata["revision"])
                or type(result["sourceEpoch"]) is not int
                or not 1 <= result["sourceEpoch"] <= metadata["sourceEpoch"]
            ):
                raise ResourceUnavailable
            checked_time(result["updatedAt"])
    if operation_key in operations:
        result = operations[operation_key]
        if result["sourceEpoch"] != metadata["sourceEpoch"]:
            raise ResourceUnavailable
        # The current content/digest is checked even for retries. Same-key
        # replay is allowed after the receipt budget fills, without new writes.
        return deepcopy(result), None, None, None
    if len(operations) == MAX_INITIALIZATION_OPERATIONS:
        raise InitializationLimit
    new_content, new_metadata = None, None
    if metadata is None:
        metadata = new_version(kind, items, initial=True)
        new_content = {"version": 1, "items": items}
        new_metadata = metadata
    result = summary(kind, items, metadata)
    aggregate = {
        "version": 1,
        "kind": kind,
        "operations": {**operations, operation_key: deepcopy(result)},
    }
    return result, new_content, new_metadata, aggregate


class UserResourceStore:
    def read(self, uid: str, kinds: tuple[str, ...]) -> dict[str, dict]:
        raise NotImplementedError

    def initialize(self, uid: str, kind: str, operation_key: str) -> dict:
        raise NotImplementedError


class SQLiteUserResourceStore(UserResourceStore):
    def __init__(self, path: str):
        self.path = path
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with self.connection() as db:
                for table in (
                    *COLLECTIONS.values(),
                    "user_resource_versions",
                    "user_resource_initializations",
                ):
                    db.execute(
                        f"CREATE TABLE IF NOT EXISTS {table} "
                        "(owner TEXT PRIMARY KEY, value TEXT NOT NULL)"
                    )
            Path(path).chmod(0o600)
        except OSError as error:
            raise ResourceUnavailable from error

    @contextmanager
    def connection(self):
        try:
            with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
                yield db
        except (sqlite3.Error, OSError, ValueError, TypeError, ContractError) as error:
            raise ResourceUnavailable from error

    @staticmethod
    def value(db, table, key):
        row = db.execute(f"SELECT value FROM {table} WHERE owner=?", (key,)).fetchone()
        return strict_json_loads(row[0]) if row else None

    @classmethod
    def pair(cls, db, uid, kind):
        return (
            cls.value(db, COLLECTIONS[kind], owner_key(uid)),
            cls.value(db, "user_resource_versions", version_key(uid, kind)),
        )

    def read(self, uid, kinds):
        if not kinds or not set(kinds) <= KINDS:
            raise ResourceUnavailable
        with self.connection() as db:
            db.execute("BEGIN")
            return {
                kind: summary(kind, *read_pair(kind, *self.pair(db, uid, kind))) for kind in kinds
            }

    def initialize(self, uid, kind, operation_key):
        if kind not in KINDS:
            raise ResourceUnavailable
        key = version_key(uid, kind)
        operation = initialization_key(uid, kind, operation_key)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            result, content, metadata, receipt = initialization(
                kind,
                *self.pair(db, uid, kind),
                self.value(db, "user_resource_initializations", key),
                operation,
            )
            writes = []
            if content is not None:
                writes.extend(
                    [
                        (COLLECTIONS[kind], owner_key(uid), content),
                        ("user_resource_versions", version_key(uid, kind), metadata),
                    ]
                )
            if receipt is not None:
                writes.append(("user_resource_initializations", key, receipt))
            for table, identity, value in writes:
                db.execute(
                    f"INSERT INTO {table}(owner, value) VALUES (?, ?) "
                    "ON CONFLICT(owner) DO UPDATE SET value=excluded.value",
                    (identity, json.dumps(value, allow_nan=False)),
                )
            return result


class FirestoreUserResourceStore(UserResourceStore):
    def __init__(self, project: str, database: str):
        try:
            self.client = firestore.Client(project=project, database=database)
        except Exception as error:
            raise ResourceUnavailable from error

    def references(self, uid, kind):
        return (
            self.client.collection(COLLECTIONS[kind]).document(owner_key(uid)),
            self.client.collection("user_resource_versions").document(version_key(uid, kind)),
        )

    def read(self, uid, kinds):
        if not kinds or not set(kinds) <= KINDS:
            raise ResourceUnavailable

        @firestore.transactional
        def read_transaction(transaction):
            result = {}
            for kind in kinds:
                content_ref, metadata_ref = self.references(uid, kind)
                content = content_ref.get(transaction=transaction, timeout=4, retry=None).to_dict()
                metadata = metadata_ref.get(
                    transaction=transaction, timeout=4, retry=None
                ).to_dict()
                result[kind] = summary(kind, *read_pair(kind, content, metadata))
            return result

        try:
            return read_transaction(BoundedTransaction(self.client, max_attempts=2))
        except Exception as error:
            raise ResourceUnavailable from error

    def initialize(self, uid, kind, operation_key):
        if kind not in KINDS:
            raise ResourceUnavailable
        content_ref, metadata_ref = self.references(uid, kind)
        receipt_ref = self.client.collection("user_resource_initializations").document(
            version_key(uid, kind)
        )

        @firestore.transactional
        def initialize_transaction(transaction):
            content = content_ref.get(transaction=transaction, timeout=4, retry=None).to_dict()
            metadata = metadata_ref.get(transaction=transaction, timeout=4, retry=None).to_dict()
            prior = receipt_ref.get(transaction=transaction, timeout=4, retry=None).to_dict()
            result, content, metadata, receipt = initialization(
                kind,
                content,
                metadata,
                prior,
                initialization_key(uid, kind, operation_key),
            )
            if content is not None:
                transaction.set(content_ref, content)
                transaction.set(metadata_ref, metadata)
            if receipt is not None:
                transaction.set(receipt_ref, receipt)
            return result

        try:
            return initialize_transaction(BoundedTransaction(self.client, max_attempts=2))
        except InitializationLimit:
            raise
        except Exception as error:
            raise ResourceUnavailable from error


def create_resource_store():
    on_cloud = "K_SERVICE" in os.environ
    backend = os.getenv("USER_STORE_BACKEND") or os.getenv(
        "MARKET_CACHE_BACKEND", "firestore" if on_cloud else "sqlite"
    )
    if on_cloud and (
        backend != "firestore"
        or os.getenv("FIRESTORE_EMULATOR_HOST")
        or os.getenv("FIREBASE_AUTH_EMULATOR_HOST")
    ):
        raise ResourceUnavailable
    if backend == "firestore":
        project = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise ResourceUnavailable
        return FirestoreUserResourceStore(
            project,
            os.getenv("FIRESTORE_DATABASE") or os.getenv("MARKET_FIRESTORE_DATABASE", "(default)"),
        )
    if backend == "sqlite":
        path = os.getenv("WATCHLIST_DB_PATH", "/tmp/financial-analysis/watchlists.sqlite3")
        # A single transaction must see both sources and their metadata. Separate
        # local files configured in the old override cannot provide this promise.
        follows_path = os.getenv("CHANNEL_FOLLOWS_DB_PATH")
        if follows_path and follows_path != path:
            raise ResourceUnavailable
        return SQLiteUserResourceStore(path)
    raise ResourceUnavailable


@lru_cache(maxsize=4)
def configured_store(configuration):
    return create_resource_store()


def get_resource_store():
    keys = (
        "USER_STORE_BACKEND",
        "MARKET_CACHE_BACKEND",
        "FIREBASE_PROJECT_ID",
        "GOOGLE_CLOUD_PROJECT",
        "FIRESTORE_DATABASE",
        "MARKET_FIRESTORE_DATABASE",
        "WATCHLIST_DB_PATH",
        "CHANNEL_FOLLOWS_DB_PATH",
        "K_SERVICE",
        "FIRESTORE_EMULATOR_HOST",
        "FIREBASE_AUTH_EMULATOR_HOST",
    )
    return configured_store(
        tuple(os.getenv(key, "") for key in keys) + (str("K_SERVICE" in os.environ),)
    )
