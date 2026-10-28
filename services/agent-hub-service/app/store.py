"""Bounded, atomic storage for ciphertext and trusted public authority replicas."""

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

COLLECTIONS = frozenset({"hub_vaults", "hub_operations"})


class StoreUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("Hub storage is temporarily unavailable.")


def document_id(*parts: str) -> str:
    return hashlib.sha256(canonical_json(list(parts))).hexdigest()


def document_path(collection: str, *parts: str) -> str:
    if collection not in COLLECTIONS:
        raise ValueError("Invalid Hub collection.")
    return f"{collection}/{document_id(*parts)}"


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
    encoded = Document(name=name, fields=encode_dict(data))._pb.SerializeToString()
    check_document_budget(data, encoded_document=encoded)
    return data


class SQLiteTransaction:
    def __init__(self, connection, store):
        self.connection = connection
        self.store = store

    def get(self, path: str) -> dict | None:
        row = self.connection.execute(
            "SELECT body FROM hub_documents WHERE path = ?", (path,)
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
            "INSERT INTO hub_documents(path, body) VALUES (?, ?) "
            "ON CONFLICT(path) DO UPDATE SET body = excluded.body",
            (path, canonical_json(data).decode()),
        )


class SQLiteHubStore:
    def __init__(self, path: str, *, project="local-hub", database="hub"):
        self.path = str(path)
        self.project = project
        self.database = database
        if self.path == ":memory:":
            raise ValueError("Use a private file for transactional local storage.")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with closing(self.connect()) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS hub_documents "
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

    def get(self, path: str) -> dict | None:
        row = self.store.client.document(path).get(
            transaction=self.transaction, timeout=4, retry=None
        )
        if not row.exists:
            return None
        value = row.to_dict()
        if type(value) is not dict:
            raise StoreUnavailable
        try:
            return strict_json_loads(canonical_json(value), max_bytes=MAX_STORED_DOCUMENT_BYTES)
        except ContractError:
            raise StoreUnavailable from None

    def put(self, path: str, value: dict) -> None:
        data = stored_document(
            value, path=path, project=self.store.project, database=self.store.database
        )
        self.pending.append((path, data))

    def flush(self):
        for path, data in self.pending:
            self.transaction.set(self.store.client.document(path), data)


class FirestoreHubStore:
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
    backend = os.getenv("AGENT_HUB_STORE_BACKEND", "firestore" if cloud else "sqlite")
    if cloud and (backend != "firestore" or "FIRESTORE_EMULATOR_HOST" in os.environ):
        raise StoreUnavailable
    if backend == "firestore":
        return FirestoreHubStore(
            os.getenv("FIREBASE_PROJECT_ID", "").strip(),
            os.getenv("FIRESTORE_DATABASE", "").strip(),
        )
    if backend == "sqlite":
        return SQLiteHubStore(
            os.getenv("AGENT_HUB_DB_PATH", "/tmp/folioview/agent-hub.sqlite3"),
        )
    raise StoreUnavailable
