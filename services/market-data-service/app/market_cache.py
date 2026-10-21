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
from google.cloud.firestore_v1.transaction import Transaction


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

    def claim(self, key: str, now: float, cost: int = 1) -> str | None:
        """Return None for an acquired lease, otherwise a public-safe reason."""
        raise NotImplementedError

    def put(self, key: str, value: dict[str, Any], now: float) -> None:
        raise NotImplementedError

    def fail(self, key: str, now: float, *, rate_limited: bool = False) -> None:
        raise NotImplementedError

    def invalidate(self, key: str) -> None:
        """Discard an optional process-local read copy, never shared limits."""


def bounded_int(name: str, default: int, lower: int, upper: int) -> int:
    try:
        return max(lower, min(upper, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


def reserve(state: dict[str, Any], now: float, cost: int, limit: int) -> str | None:
    """Called only inside a database transaction; limits apply across all instances."""
    day = int(now // 86400)
    if state.get("day") != day:
        state.update(day=day, count=0)
    if state.get("cooldown", 0) > now:
        return "Yahoo is temporarily unavailable; cached data will be used."
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

    def claim(self, key: str, now: float, cost: int = 1) -> str | None:
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
            reason = reserve(state, now, cost, self.daily_limit)
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

    def fail(self, key: str, now: float, *, rate_limited: bool = False) -> None:
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
            state["cooldown"] = now + (900 if rate_limited else 300)
            db.execute("UPDATE market_state SET value=? WHERE id=1", (json.dumps(state),))


class BoundedTransaction(Transaction):
    """Firestore 2.x transaction lifecycle RPCs otherwise ignore request timeouts.

    The SDK's public transaction decorator supplies conflict retries but its
    lifecycle methods expose no timeout. Keep its serialization/transaction
    state, and explicitly bound those three RPCs as well as document reads.
    """

    def _begin(self, retry_id=None):
        if self.in_progress:
            raise ValueError("Transaction already in progress")
        response = self._client._firestore_api.begin_transaction(
            request={
                "database": self._client._database_string,
                "options": self._options_protobuf(retry_id),
            },
            metadata=self._client._rpc_metadata,
            retry=None,
            timeout=4,
        )
        self._id = response.transaction

    def _commit(self):
        if not self.in_progress:
            raise ValueError("Transaction not started")
        response = self._client._firestore_api.commit(
            request={
                "database": self._client._database_string,
                "writes": self._write_pbs,
                "transaction": self._id,
            },
            metadata=self._client._rpc_metadata,
            retry=None,
            timeout=4,
        )
        self._clean_up()
        self.write_results = list(response.write_results)
        self.commit_time = response.commit_time
        return self.write_results

    def _rollback(self):
        try:
            self._client._firestore_api.rollback(
                request={"database": self._client._database_string, "transaction": self._id},
                metadata=self._client._rpc_metadata,
                retry=None,
                timeout=4,
            )
        finally:
            self._clean_up()


class FirestoreMarketCache(MarketCache):
    """A single collection; transactions coordinate budgets and refresh leases."""

    def __init__(self, project_id: str, database: str = "(default)"):
        super().__init__()
        try:
            self.client = firestore.Client(project=project_id, database=database)
            self.collection = self.client.collection("market_data_cache")
            self.read_cache = OrderedDict()
            self.read_cache_lock = RLock()
        except Exception as error:
            raise CacheUnavailable from error

    def document(self, key: str):
        return self.collection.document(hashlib.sha256(key.encode()).hexdigest())

    def get(self, key: str) -> Entry | None:
        with self.read_cache_lock:
            local = self.read_cache.get(key)
        if local and local[0] > time.monotonic():
            return local[1]
        try:
            row = self.document(key).get(timeout=4, retry=None).to_dict()
            entry = Entry(row["value"], row["updated"]) if row and "value" in row else None
            self.remember(key, entry)
            return entry
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

    def claim(self, key: str, now: float, cost: int = 1) -> str | None:
        entry_ref = self.document(key)
        state_ref = self.collection.document("shared_upstream_budget")

        @firestore.transactional
        def claim_transaction(transaction):
            row = entry_ref.get(transaction=transaction, timeout=4, retry=None).to_dict() or {}
            state = state_ref.get(transaction=transaction, timeout=4, retry=None).to_dict() or {}
            refresh_after = row.get("value", {}).get(
                "_refreshAfter", row.get("updated", 0) + self.fresh_seconds
            )
            if refresh_after > now:
                return "A newer cached snapshot is available. Please try again shortly."
            if row.get("lease", 0) > now or row.get("retry", 0) > now:
                return "A market refresh is already pending or cooling down."
            reason = reserve(state, now, cost, self.daily_limit)
            if reason:
                return reason
            transaction.set(state_ref, state)
            transaction.set(entry_ref, {"lease": now + self.lease_seconds}, merge=True)
            return None

        try:
            return claim_transaction(BoundedTransaction(self.client, max_attempts=2))
        except Exception as error:
            raise CacheUnavailable from error

    def put(self, key: str, value: dict[str, Any], now: float) -> None:
        reference = self.document(key)

        @firestore.transactional
        def write_if_newer(transaction):
            row = reference.get(transaction=transaction, timeout=4, retry=None).to_dict() or {}
            if row.get("updated", 0) > now:
                return Entry(row["value"], row["updated"])
            transaction.set(reference, {"value": value, "updated": now, "lease": 0, "retry": 0})
            return Entry(value, now)

        try:
            json.dumps(value, allow_nan=False)
            stored = write_if_newer(BoundedTransaction(self.client, max_attempts=2))
            self.remember(key, stored)
        except Exception as error:
            raise CacheUnavailable from error

    def fail(self, key: str, now: float, *, rate_limited: bool = False) -> None:
        try:
            batch = self.client.batch()
            batch.set(self.document(key), {"lease": 0, "retry": now + 300}, merge=True)
            batch.set(
                self.collection.document("shared_upstream_budget"),
                {"cooldown": now + (900 if rate_limited else 300)},
                merge=True,
            )
            batch.commit(timeout=4, retry=None)
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
