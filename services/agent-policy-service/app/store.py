"""Live CAS witness plus immutable snapshots. Backups can never select the head.

The witness is a distinct authoritative store, excluded from snapshot restore.
Missing/unreadable live state is an outage, never implicit initialization.
"""

import os
import re
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

from .contracts import Conflict, Unavailable, closed, copy, digest, number

MAX_STATE_BYTES = 524288


class FileSnapshots:
    def __init__(self, directory):
        self.directory = Path(directory)

    def read(self, fingerprint):
        validate_schema("Digest", fingerprint)
        try:
            raw = (self.directory / (fingerprint + ".json")).read_bytes()
            if len(raw) > MAX_STATE_BYTES:
                raise Unavailable
            value = strict_json_loads(raw, max_bytes=MAX_STATE_BYTES)
            if digest(value) != fingerprint:
                raise Unavailable
            return value
        except Exception:
            raise Unavailable from None

    def put(self, value):
        raw = canonical_json(value)
        if len(raw) > MAX_STATE_BYTES:
            raise Unavailable
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        fingerprint = digest(value)
        path = self.directory / (fingerprint + ".json")
        descriptor, temporary = tempfile.mkstemp(dir=self.directory, prefix=".snapshot-")
        try:
            with os.fdopen(descriptor, "wb") as file:
                file.write(raw)
                file.flush()
                os.fsync(file.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                if self.read(fingerprint) != value:
                    raise Unavailable from None
            directory = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return fingerprint


class SQLiteWitness:
    def __init__(self, path):
        self.path = Path(path)

    def initialize_storage(self):
        # Explicit offline bootstrap only, never called by request construction.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS policy_head "
                "(id INTEGER PRIMARY KEY, body TEXT NOT NULL)"
            )
            db.commit()
        os.chmod(self.path, 0o600)

    def read(self):
        if not self.path.is_file():
            raise Unavailable
        try:
            with closing(sqlite3.connect(self.path, timeout=5)) as db:
                row = db.execute("SELECT body FROM policy_head WHERE id=1").fetchone()
            return None if row is None else strict_json_loads(row[0], max_bytes=4096)
        except Exception:
            raise Unavailable from None

    def cas(self, previous, value):
        if not self.path.is_file():
            raise Unavailable
        with closing(sqlite3.connect(self.path, timeout=5)) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT body FROM policy_head WHERE id=1").fetchone()
            actual = None if row is None else strict_json_loads(row[0], max_bytes=4096)
            if actual != previous:
                raise Conflict
            if value != previous:
                db.execute(
                    "INSERT INTO policy_head VALUES (1, ?) "
                    "ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                    (canonical_json(value).decode(),),
                )
            db.commit()


class FirestoreWitness:
    def __init__(self, project, database, epoch, *, client=None):
        if not re.fullmatch(r"[a-z][a-z0-9-]{3,62}", project) or not re.fullmatch(
            r"[a-z][a-z0-9-]{2,62}", database
        ):
            raise Unavailable
        if database == "default" or "FIRESTORE_EMULATOR_HOST" in os.environ:
            raise Unavailable
        from google.cloud import firestore

        self.client = client or firestore.Client(project=project, database=database)
        self.ref = self.client.document("policy_live_heads/" + digest(epoch))

    def read(self):
        try:
            row = self.ref.get(timeout=4, retry=None)
            return row.to_dict() if row.exists else None
        except Exception:
            raise Unavailable from None

    def cas(self, previous, value):
        from google.cloud import firestore

        from folioview_shared.firestore import BoundedTransaction

        @firestore.transactional
        def commit(transaction):
            row = self.ref.get(transaction=transaction, timeout=4, retry=None)
            if (row.to_dict() if row.exists else None) != previous:
                raise Conflict
            if value != previous:
                transaction.set(self.ref, value)

        try:
            commit(BoundedTransaction(self.client, max_attempts=3))
        except Conflict:
            raise
        except Exception:
            raise Unavailable from None


class GCSSnapshots:
    def __init__(self, bucket, *, client=None):
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{2,221}", bucket):
            raise Unavailable
        from google.cloud import storage

        self.client = client or storage.Client()
        self.bucket = self.client.bucket(bucket)

    def read(self, fingerprint):
        validate_schema("Digest", fingerprint)
        try:
            blob = self.bucket.blob("policy-state/" + fingerprint + ".json")
            blob.reload(timeout=4, retry=None)
            if blob.size is None or blob.size > MAX_STATE_BYTES:
                raise Unavailable
            raw = blob.download_as_bytes(
                if_generation_match=blob.generation, timeout=4, retry=None, checksum="crc32c"
            )
            value = strict_json_loads(raw, max_bytes=MAX_STATE_BYTES)
            if digest(value) != fingerprint:
                raise Unavailable
            return value
        except Exception:
            raise Unavailable from None

    def put(self, value):
        from google.api_core.exceptions import PreconditionFailed

        raw = canonical_json(value)
        if len(raw) > MAX_STATE_BYTES:
            raise Unavailable
        fingerprint = digest(value)
        try:
            self.bucket.blob("policy-state/" + fingerprint + ".json").upload_from_string(
                raw,
                content_type="application/json",
                if_generation_match=0,
                timeout=4,
                retry=None,
                checksum="crc32c",
            )
        except PreconditionFailed:
            if self.read(fingerprint) != value:
                raise Unavailable from None
        except Exception:
            raise Unavailable from None
        return fingerprint


class StateStore:
    def __init__(self, witness, snapshots, domain):
        self.witness, self.snapshots, self.domain = witness, snapshots, domain

    def load(self):
        head = self.witness.read()
        if head is None:
            raise Unavailable
        closed(head, {"domain", "sequence", "digest", "previous"}, maximum=4096)
        number(head["sequence"])
        validate_schema("Digest", head["digest"])
        if head["domain"] != self.domain:
            raise Unavailable
        state = self.snapshots.read(head["digest"])
        if (state.get("domain"), state.get("sequence"), state.get("previous")) != (
            self.domain,
            head["sequence"],
            head["previous"],
        ):
            raise Unavailable
        return head, state

    def bootstrap(self, state):
        if (
            state["domain"] != self.domain
            or state["sequence"] != 1
            or state["previous"] is not None
        ):
            raise Unavailable
        fingerprint = self.snapshots.put(state)
        self.witness.cas(
            None, {"domain": self.domain, "sequence": 1, "digest": fingerprint, "previous": None}
        )

    def transact(self, action):
        for _ in range(3):
            head, state = self.load()
            before = copy(state)
            result = action(state)
            try:
                if state == before:
                    self.witness.cas(head, head)
                else:
                    state.update(sequence=head["sequence"] + 1, previous=head["digest"])
                    number(state["sequence"])
                    fingerprint = self.snapshots.put(state)
                    self.witness.cas(
                        head,
                        {
                            "domain": self.domain,
                            "sequence": state["sequence"],
                            "digest": fingerprint,
                            "previous": head["digest"],
                        },
                    )
                return copy(result)
            except Conflict:
                continue
        raise Unavailable


def configured_store(config):
    if os.getenv("POLICY_STORE_BACKEND", "cloud") == "sqlite" and "K_SERVICE" not in os.environ:
        witness = SQLiteWitness(os.getenv("POLICY_LOCAL_WITNESS", ""))
        snapshots = FileSnapshots(os.getenv("POLICY_LOCAL_SNAPSHOTS", ""))
    else:
        if os.getenv("POLICY_STORE_BACKEND", "cloud") != "cloud":
            raise Unavailable
        witness = FirestoreWitness(
            config.public["witnessProject"],
            config.public["witnessDatabase"],
            config.public["stateEpoch"],
        )
        snapshots = GCSSnapshots(config.public["snapshotBucket"])
    return StateStore(witness, snapshots, config.domain)
