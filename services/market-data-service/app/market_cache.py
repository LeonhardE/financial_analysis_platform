"""Shared market cache and atomic upstream limits, with a local SQLite implementation."""

import hashlib
import json
import os
import sqlite3
import time
from collections import OrderedDict
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any

from google.cloud import firestore

from folioview_shared.firestore import BoundedTransaction

from .cost_controls import MarketLimited, get_cost_controls


class CacheUnavailable(Exception):
    """The shared cache cannot safely reserve upstream capacity."""


@dataclass(frozen=True)
class Entry:
    value: dict[str, Any] | None
    updated_at: float


class MarketCache:
    def __init__(self):
        self.daily_limit = bounded_int("MARKET_UPSTREAM_DAILY_LIMIT", 200, 10, 1000)
        self.lease_seconds = 45
        self.fresh_seconds = bounded_int("MARKET_CACHE_TTL_SECONDS", 3600, 900, 86400)

    def get(self, key: str) -> Entry | None:
        raise NotImplementedError

    def get_many(self, keys: list[str]) -> dict[str, Entry | None]:
        return {key: self.get(key) for key in batch_keys(keys)}

    def claim(self, key: str, now: float, cost: int = 1, *, provider: str = "yahoo") -> str | None:
        """Return None for an acquired lease, otherwise a public-safe reason."""
        raise NotImplementedError

    def put(self, key: str, value: dict[str, Any], now: float) -> None:
        raise NotImplementedError

    def fail(
        self, key: str, now: float, *, rate_limited: bool = False, provider: str = "yahoo"
    ) -> None:
        raise NotImplementedError

    def invalidate(self, key: str) -> None:
        """Discard an optional process-local read copy, never shared limits."""


def bounded_int(name: str, default: int, lower: int, upper: int) -> int:
    try:
        return max(lower, min(upper, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


def batch_keys(keys):
    if (
        type(keys) is not list
        or len(keys) > 50
        or any(type(key) is not str or not 1 <= len(key) <= 128 for key in keys)
    ):
        raise CacheUnavailable
    return list(dict.fromkeys(keys))


def cooldown_key(provider: str) -> str:
    # Keep the original Yahoo field and total budget. A separate free FX source
    # must neither trigger nor inherit Yahoo's availability cooldown.
    if provider not in {"yahoo", "bank_of_canada"}:
        raise CacheUnavailable
    return "cooldown" if provider == "yahoo" else "bank_of_canada_cooldown"


def reserve(
    state: dict[str, Any], now: float, cost: int, limit: int, *, provider: str = "yahoo"
) -> str | None:
    """Called only inside a database transaction; limits apply across all instances."""
    day = int(now // 86400)
    if state.get("day") != day:
        state.update(day=day, count=0)
    if state.get(cooldown_key(provider), 0) > now:
        return (
            "Yahoo is temporarily unavailable; cached data will be used."
            if provider == "yahoo"
            else "Reference exchange rates are temporarily unavailable; cached data will be used."
        )
    if state.get("window", 0) <= now - 60:
        state.update(window=now, window_count=0)
    if state.get("count", 0) + cost > limit:
        return "The shared daily market refresh limit has been reached."
    if state.get("window_count", 0) + cost > 20:
        return "Market refreshes are temporarily limited. Please try again shortly."
    state["count"] = state.get("count", 0) + cost
    state["window_count"] = state.get("window_count", 0) + cost
    return None


class SQLiteMarketCache(MarketCache):
    """Persistent local cache. Never permitted as the Cloud Run shared limiter."""

    def __init__(self, path: str):
        super().__init__()
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS market_entries "
                "(key TEXT PRIMARY KEY, value TEXT, updated REAL DEFAULT 0, "
                "lease REAL DEFAULT 0, retry REAL DEFAULT 0)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS market_state (id INTEGER PRIMARY KEY, value TEXT)"
            )
            db.execute("INSERT OR IGNORE INTO market_state VALUES (1, '{}')")

    @contextmanager
    def connection(self):
        try:
            with closing(sqlite3.connect(self.path, timeout=3)) as db, db:
                db.row_factory = sqlite3.Row
                yield db
        except (sqlite3.Error, OSError, ValueError) as error:
            raise CacheUnavailable from error

    def get(self, key: str) -> Entry | None:
        with self.connection() as db:
            row = db.execute(
                "SELECT value, updated FROM market_entries WHERE key=?", (key,)
            ).fetchone()
        return Entry(json.loads(row["value"]), row["updated"]) if row and row["value"] else None

    def get_many(self, keys):
        keys = batch_keys(keys)
        if not keys:
            return {}
        with self.connection() as db:
            rows = db.execute(
                "SELECT key,value,updated FROM market_entries WHERE key IN ("
                + ",".join("?" for _ in keys)
                + ")",
                keys,
            ).fetchall()
        result = {key: None for key in keys}
        for row in rows:
            if row["value"]:
                result[row["key"]] = Entry(json.loads(row["value"]), row["updated"])
        return result

    def claim(self, key: str, now: float, cost: int = 1, *, provider: str = "yahoo") -> str | None:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT lease, retry, updated, value FROM market_entries WHERE key=?", (key,)
            ).fetchone()
            value = json.loads(row["value"]) if row and row["value"] else {}
            refresh_after = (
                value.get("_refreshAfter", row["updated"] + self.fresh_seconds) if row else 0
            )
            if refresh_after > now:
                return "A newer cached snapshot is available. Please try again shortly."
            if row and (row["lease"] > now or row["retry"] > now):
                return "A market refresh is already pending or cooling down."
            state = json.loads(
                db.execute("SELECT value FROM market_state WHERE id=1").fetchone()[0]
            )
            reason = reserve(state, now, cost, self.daily_limit, provider=provider)
            if reason:
                return reason
            db.execute("UPDATE market_state SET value=? WHERE id=1", (json.dumps(state),))
            db.execute(
                "INSERT INTO market_entries(key, lease) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET lease=excluded.lease",
                (key, now + self.lease_seconds),
            )
        return None

    def put(self, key: str, value: dict[str, Any], now: float) -> None:
        encoded = json.dumps(value, allow_nan=False)
        with self.connection() as db:
            db.execute(
                "INSERT INTO market_entries(key,value,updated) VALUES (?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
                "updated=excluded.updated, lease=0, retry=0 "
                "WHERE market_entries.updated <= excluded.updated",
                (key, encoded, now),
            )

    def fail(
        self, key: str, now: float, *, rate_limited: bool = False, provider: str = "yahoo"
    ) -> None:
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO market_entries(key,retry) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET lease=0,retry=excluded.retry",
                (key, now + 300),
            )
            state = json.loads(
                db.execute("SELECT value FROM market_state WHERE id=1").fetchone()[0]
            )
            state[cooldown_key(provider)] = now + (900 if rate_limited else 300)
            db.execute("UPDATE market_state SET value=? WHERE id=1", (json.dumps(state),))


class FirestoreMarketCache(MarketCache):
    """A single collection; transactions coordinate budgets and refresh leases."""

    def __init__(self, project_id: str, database: str = "(default)", *, controls=None):
        super().__init__()
        self.controls = controls if controls is not None else get_cost_controls()
        try:
            self.client = firestore.Client(project=project_id, database=database)
            self.collection = self.client.collection("market_data_cache")
            self.read_cache = OrderedDict()
            self.read_cache_lock = RLock()
        except Exception as error:
            raise CacheUnavailable from error

    def document(self, key: str):
        return self.collection.document(hashlib.sha256(key.encode()).hexdigest())

    def read_document(self, reference, transaction=None):
        self.controls.storage.charge()
        kwargs = {"timeout": 4, "retry": None}
        if transaction is not None:
            kwargs["transaction"] = transaction
        return reference.get(**kwargs).to_dict()

    def queue_writes(self, transaction, writes):
        # Reserve the whole batch immediately before staging it. A failed
        # reservation stages nothing; exceptions in a transaction roll it back.
        self.controls.storage.charge(len(writes))
        for reference, value, merge in writes:
            transaction.set(reference, value, **({"merge": True} if merge else {}))

    def get(self, key: str) -> Entry | None:
        with self.read_cache_lock:
            local = self.read_cache.get(key)
        if local and local[0] > time.monotonic():
            return local[1]
        try:
            row = self.read_document(self.document(key))
            entry = Entry(row["value"], row["updated"]) if row and "value" in row else None
            self.remember(key, entry)
            return entry
        except MarketLimited:
            raise
        except Exception as error:
            raise CacheUnavailable from error

    def remember(self, key: str, entry: Entry | None):
        with self.read_cache_lock:
            self.read_cache[key] = (time.monotonic() + 30, entry)
            self.read_cache.move_to_end(key)
            while len(self.read_cache) > 128:
                self.read_cache.popitem(last=False)

    def invalidate(self, key: str):
        with self.read_cache_lock:
            self.read_cache.pop(key, None)

    def get_many(self, keys):
        keys = batch_keys(keys)
        result = {}
        missing = {}
        with self.read_cache_lock:
            for key in keys:
                local = self.read_cache.get(key)
                if local and local[0] > time.monotonic():
                    result[key] = local[1]
                else:
                    missing[self.document(key).id] = key
        if not missing:
            return result
        # One bounded SDK stream, still charged once per attempted document.
        # Do not publish partial negative reads if the stream fails midway.
        self.controls.storage.charge(len(missing))
        try:
            fetched = {}
            references = [self.document(key) for key in missing.values()]
            for snapshot in self.client.get_all(references, timeout=4, retry=None):
                identity = snapshot.reference.id
                if identity not in missing or identity in fetched:
                    raise CacheUnavailable
                row = snapshot.to_dict()
                fetched[identity] = (
                    Entry(row["value"], row["updated"]) if row and "value" in row else None
                )
            if set(fetched) != set(missing):
                raise CacheUnavailable
            for identity, entry in fetched.items():
                key = missing[identity]
                self.remember(key, entry)
                result[key] = entry
            return result
        except MarketLimited:
            raise
        except Exception as error:
            raise CacheUnavailable from error

    def claim(self, key: str, now: float, cost: int = 1, *, provider: str = "yahoo") -> str | None:
        entry_ref = self.document(key)
        state_ref = self.collection.document("shared_upstream_budget")

        @firestore.transactional
        def claim_transaction(transaction):
            row = self.read_document(entry_ref, transaction) or {}
            state = self.read_document(state_ref, transaction) or {}
            refresh_after = row.get("value", {}).get(
                "_refreshAfter", row.get("updated", 0) + self.fresh_seconds
            )
            if refresh_after > now:
                return "A newer cached snapshot is available. Please try again shortly."
            if row.get("lease", 0) > now or row.get("retry", 0) > now:
                return "A market refresh is already pending or cooling down."
            reason = reserve(state, now, cost, self.daily_limit, provider=provider)
            if reason:
                return reason
            self.queue_writes(
                transaction,
                [
                    (state_ref, state, False),
                    (entry_ref, {"lease": now + self.lease_seconds}, True),
                ],
            )
            return None

        try:
            return claim_transaction(BoundedTransaction(self.client, max_attempts=2))
        except MarketLimited:
            raise
        except Exception as error:
            raise CacheUnavailable from error

    def put(self, key: str, value: dict[str, Any], now: float) -> None:
        reference = self.document(key)

        @firestore.transactional
        def write_if_newer(transaction):
            row = self.read_document(reference, transaction) or {}
            if row.get("updated", 0) > now:
                return Entry(row["value"], row["updated"])
            self.queue_writes(
                transaction,
                [
                    (reference, {"value": value, "updated": now, "lease": 0, "retry": 0}, False),
                ],
            )
            return Entry(value, now)

        try:
            json.dumps(value, allow_nan=False)
            stored = write_if_newer(BoundedTransaction(self.client, max_attempts=2))
            self.remember(key, stored)
        except MarketLimited:
            raise
        except Exception as error:
            raise CacheUnavailable from error

    def fail(
        self, key: str, now: float, *, rate_limited: bool = False, provider: str = "yahoo"
    ) -> None:
        try:
            batch = self.client.batch()
            self.queue_writes(
                batch,
                [
                    (self.document(key), {"lease": 0, "retry": now + 300}, True),
                    (
                        self.collection.document("shared_upstream_budget"),
                        {cooldown_key(provider): now + (900 if rate_limited else 300)},
                        True,
                    ),
                ],
            )
            batch.commit(timeout=4, retry=None)
        except MarketLimited:
            raise
        except Exception as error:
            raise CacheUnavailable from error


def create_cache() -> MarketCache:
    on_cloud_run = bool(os.getenv("K_SERVICE"))
    backend = os.getenv("MARKET_CACHE_BACKEND", "firestore" if on_cloud_run else "sqlite")
    if on_cloud_run and os.getenv("FIRESTORE_EMULATOR_HOST"):
        raise CacheUnavailable("Cloud Run cannot use a local Firestore emulator")
    if on_cloud_run and backend != "firestore":
        raise CacheUnavailable("Cloud Run requires the shared Firestore market cache")
    if backend == "firestore":
        project = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise CacheUnavailable("A project ID is required for Firestore")
        return FirestoreMarketCache(project, os.getenv("MARKET_FIRESTORE_DATABASE", "(default)"))
    if backend == "sqlite":
        return SQLiteMarketCache(
            os.getenv("MARKET_CACHE_PATH", "/tmp/financial-analysis/market.sqlite3")
        )
    raise CacheUnavailable("Unknown market cache backend")
