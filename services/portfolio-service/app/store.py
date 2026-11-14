"""Bounded, atomic storage for ciphertext and trusted public authority replicas."""

import copy
import hashlib
import os
import sqlite3
from contextlib import closing
from functools import lru_cache
from pathlib import Path

from folioview_shared.encrypted.budgets import check_document_budget
from folioview_shared.encrypted.constants import MAX_STORED_DOCUMENT_BYTES
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads

COLLECTIONS = frozenset(
    {
        "portfolio_authorities",
        "portfolio_heads",
        "portfolio_snapshots",
        "portfolio_operations",
        "portfolio_source_states",
        "portfolio_source_mutations",
        "portfolio_upload_cancellations",
    }
)
MAX_BATCH_DOCUMENTS = 30


class StoreUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("Portfolio storage is temporarily unavailable.")


def _batch_paths(paths):
    if (
        type(paths) is not list
        or not 1 <= len(paths) <= MAX_BATCH_DOCUMENTS
        or any(type(path) is not str for path in paths)
        or len(set(paths)) != len(paths)
    ):
        raise StoreUnavailable
    return paths


def document_id(*parts: str) -> str:
    return hashlib.sha256(canonical_json(list(parts))).hexdigest()


def document_path(collection: str, *parts: str) -> str:
    if collection not in COLLECTIONS:
        raise ValueError("Invalid Portfolio collection.")
    return f"{collection}/{document_id(*parts)}"


def _read_document(value: dict, *, path: str) -> dict:
    """Read the original array or its bounded, canonical UTF-8 storage form.

    Only this existing, unindexed authority field may use bytes. Public APIs and
    signature verification continue to receive the original JSON arrays.
    """
    try:
        if path.split("/", 1)[0] in {"portfolio_authorities"} and isinstance(
            value.get("registryHistory"), bytes
        ):
            payload = value["registryHistory"]
            history = strict_json_loads(payload, max_bytes=MAX_STORED_DOCUMENT_BYTES)
            if type(history) is not list or canonical_json(history) != payload:
                raise StoreUnavailable
            value = {**value, "registryHistory": history}
        return strict_json_loads(canonical_json(value), max_bytes=MAX_STORED_DOCUMENT_BYTES)
    except ContractError:
        raise StoreUnavailable from None


def _firestore_document(value: dict, *, path: str) -> dict:
    if (
        path.split("/", 1)[0] == "portfolio_authorities"
        and type(value.get("registryHistory")) is list
    ):
        return {**value, "registryHistory": canonical_json(value["registryHistory"])}
    return value


def stored_document(value: dict, *, path: str, project: str, database: str) -> dict:
    """Account for the exact SDK Document, not a JSON-only size estimate.

    No client, credentials or RPC is constructed. Ciphertext is one JSON string,
    rather than a deeply indexed map. Deployment must exempt that opaque field
    from indexing before private content is enabled.
    """
    from google.cloud.firestore_v1._helpers import encode_dict
    from google.cloud.firestore_v1.types import Document

    data = strict_json_loads(canonical_json(value), max_bytes=MAX_STORED_DOCUMENT_BYTES)
    name = f"projects/{project}/databases/{database}/documents/{path}"
    encoded = Document(
        name=name, fields=encode_dict(_firestore_document(data, path=path))
    )._pb.SerializeToString()
    check_document_budget(data, encoded_document=encoded)
    return data


class SQLiteTransaction:
    def __init__(self, connection, store):
        self.connection = connection
        self.store = store

    def get(self, path: str) -> dict | None:
        row = self.connection.execute(
            "SELECT body FROM portfolio_documents WHERE path = ?", (path,)
        ).fetchone()
        if row is None:
            return None
        try:
            value = strict_json_loads(row[0], max_bytes=MAX_STORED_DOCUMENT_BYTES)
        except ContractError:
            raise StoreUnavailable from None
        if type(value) is not dict:
            raise StoreUnavailable
        return value

    def put(self, path: str, value: dict) -> None:
        data = stored_document(
            value, path=path, project=self.store.project, database=self.store.database
        )
        self.connection.execute(
            "INSERT INTO portfolio_documents(path, body) VALUES (?, ?) "
            "ON CONFLICT(path) DO UPDATE SET body = excluded.body",
            (path, canonical_json(data).decode()),
        )

    def get_many(self, paths: list[str]) -> dict:
        _batch_paths(paths)
        result = dict.fromkeys(paths)
        placeholders = ",".join("?" for _ in paths)
        for path, body in self.connection.execute(
            f"SELECT path, body FROM portfolio_documents WHERE path IN ({placeholders})", paths
        ):
            try:
                value = strict_json_loads(body, max_bytes=MAX_STORED_DOCUMENT_BYTES)
                if type(value) is not dict:
                    raise StoreUnavailable
                result[path] = value
            except ContractError:
                raise StoreUnavailable from None
        return result


class SQLitePortfolioStore:
    def __init__(self, path: str, *, project="local-portfolio", database="portfolio"):
        self.path = str(path)
        self.project = project
        self.database = database
        if self.path == ":memory:":
            raise ValueError("Use a private file for transactional local storage.")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with closing(self.connect()) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS portfolio_documents "
                "(path TEXT PRIMARY KEY, body TEXT NOT NULL)"
            )
        Path(self.path).chmod(0o600)

    def connect(self):
        return sqlite3.connect(self.path, timeout=4, isolation_level=None)

    def transact(self, callback):
        with closing(self.connect()) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                result = callback(SQLiteTransaction(connection, self))
                connection.commit()
                return result
            except Exception:
                connection.rollback()
                raise


class FirestoreTransaction:
    def __init__(self, transaction, store):
        self.transaction = transaction
        self.store = store
        self.pending = []
        self._reads = {}
        self._read_bytes = 0

    def _remember(self, values):
        for path, value in values.items():
            if path in self._reads or len(self._reads) >= 128:
                continue
            size = len(canonical_json(value))
            if self._read_bytes + size <= 8 * 1024 * 1024:
                self._reads[path] = copy.deepcopy(value)
                self._read_bytes += size

    def get(self, path: str) -> dict | None:
        if path in self._reads:
            return copy.deepcopy(self._reads[path])
        row = self.store.client.document(path).get(
            transaction=self.transaction, timeout=4, retry=None
        )
        value = None
        if row.exists:
            value = row.to_dict()
            if type(value) is not dict:
                raise StoreUnavailable
            value = _read_document(value, path=path)
        self._remember({path: value})
        return value

    def put(self, path: str, value: dict) -> None:
        data = stored_document(
            value, path=path, project=self.store.project, database=self.store.database
        )
        self.pending.append((path, _firestore_document(data, path=path)))

    def get_many(self, paths: list[str]) -> dict:
        _batch_paths(paths)
        result = {path: copy.deepcopy(self._reads.get(path)) for path in paths}
        missing = [path for path in paths if path not in self._reads]
        if not missing:
            return result
        seen = set()
        rows = self.store.client.get_all(
            [self.store.client.document(path) for path in missing],
            transaction=self.transaction,
            timeout=4,
            retry=None,
        )
        for row in rows:
            path = row.reference.path
            if path not in missing or path in seen:
                raise StoreUnavailable
            seen.add(path)
            if row.exists:
                value = row.to_dict()
                if type(value) is not dict:
                    raise StoreUnavailable
                result[path] = _read_document(value, path=path)
        if len(seen) != len(missing):
            raise StoreUnavailable
        self._remember({path: result[path] for path in missing})
        return result

    def flush(self):
        for path, data in self.pending:
            self.transaction.set(self.store.client.document(path), data)


class FirestorePortfolioStore:
    def __init__(self, project: str, database: str, *, client=None):
        from google.cloud import firestore

        if not project or not database or database == "(default)":
            raise StoreUnavailable
        self.project = project
        self.database = database
        self.client = (
            client if client is not None else firestore.Client(project=project, database=database)
        )

    def transact(self, callback):
        from google.cloud import firestore

        from folioview_shared.firestore import BoundedTransaction

        @firestore.transactional
        def run(transaction):
            unit = FirestoreTransaction(transaction, self)
            result = callback(unit)
            unit.flush()
            return result

        return run(BoundedTransaction(self.client, max_attempts=3))


@lru_cache(maxsize=1)
def get_store():
    """Load only for authenticated private requests, never process health."""
    cloud = "K_SERVICE" in os.environ
    backend = os.getenv("PORTFOLIO_STORE_BACKEND", "firestore" if cloud else "sqlite")
    if cloud and (backend != "firestore" or "FIRESTORE_EMULATOR_HOST" in os.environ):
        raise StoreUnavailable
    if backend == "firestore":
        return FirestorePortfolioStore(
            os.getenv("FIREBASE_PROJECT_ID", "").strip(),
            os.getenv("FIRESTORE_DATABASE", "").strip(),
        )
    if backend == "sqlite":
        return SQLitePortfolioStore(
            os.getenv("PORTFOLIO_DB_PATH", "/tmp/folioview/portfolio.sqlite3"),
        )
    raise StoreUnavailable
