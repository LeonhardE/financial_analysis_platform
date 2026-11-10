"""Independent live witness, immutable snapshot replay refusal and CAS recovery."""

import copy
import sqlite3
from contextlib import closing

from fixtures import CONNECTION, UID, PolicyFixture

from app.config import Config
from app.contracts import Unavailable
from app.store import SQLiteWitness, StateStore
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json


class StoreTests(PolicyFixture):
    def test_old_backup_cannot_replace_current_snapshot_or_clear_revocation(self):
        before_head, before = self.store.load()
        self.revoke()
        after_head, after = self.store.load()
        self.assertGreater(after_head["sequence"], before_head["sequence"])
        path = self.snapshots.directory / (after_head["digest"] + ".json")
        path.write_bytes(canonical_json(before))
        with self.assertRaises(Unavailable):
            self.owner_state()
        self.assertEqual(self.witness.read(), after_head)
        self.assertNotEqual(before_head["digest"], after_head["digest"])

    def test_missing_latest_snapshot_or_witness_never_loads_an_older_backup(self):
        self.revoke()
        head, _ = self.store.load()
        (self.snapshots.directory / (head["digest"] + ".json")).unlink()
        with self.assertRaises(Unavailable):
            self.owner_state()
        missing = StateStore(
            SQLiteWitness(self.directory / "missing.sqlite3"), self.snapshots, self.config.domain
        )
        with self.assertRaises(Unavailable):
            missing.load()
        self.assertFalse((self.directory / "missing.sqlite3").exists())

    def test_missing_live_head_is_not_reinitialized_by_request_recovery(self):
        with closing(sqlite3.connect(self.witness.path)) as db:
            db.execute("DELETE FROM policy_head")
            db.commit()
        with self.assertRaises(Unavailable):
            self.owner_state()
        self.assertIsNone(self.witness.read())

    def test_root_pinned_callback_witness_or_kms_changes_cannot_select_old_state(self):
        for field, value in [
            ("issuer", "https://other.example"),
            ("witnessDatabase", "other-witness"),
            ("snapshotBucket", "other-snapshots"),
            ("kmsRecoveryKey", self.value["kmsRecoveryKey"] + "2"),
        ]:
            cfg = Config.parse(self.value | {field: value}, enabled=True)
            with self.subTest(field=field), self.assertRaises(Unavailable):
                StateStore(self.witness, self.snapshots, cfg.domain).load()
        changed = copy.deepcopy(self.value)
        changed["clients"][0]["redirectUris"] = ["https://other.example/callback"]
        cfg = Config.parse(changed, enabled=True)
        with self.assertRaises(Unavailable):
            StateStore(self.witness, self.snapshots, cfg.domain).load()

    def test_concurrent_head_change_retries_then_preserves_current_terminal_state(self):
        original = self.witness.cas
        armed = [True]

        def race(previous, value):
            if armed[0] and value != previous:
                armed[0] = False
                self.revoke()
            return original(previous, value)

        self.witness.cas = race
        c = self.owner_state()
        parameters = {"certificateDigest": "f" * 64}
        command = self.control(
            "certificate",
            version=c["stateVersion"],
            head=c["stateHead"],
            parameters={"parameters": parameters, "approval": None},
        )
        with self.assertRaises(ContractError):
            self.policy.control(
                UID,
                CONNECTION,
                {
                    "action": "certificate",
                    "parameters": parameters,
                    "approval": None,
                    "command": command,
                },
            )
        self.assertEqual(self.owner_state()["status"], "revoked")
