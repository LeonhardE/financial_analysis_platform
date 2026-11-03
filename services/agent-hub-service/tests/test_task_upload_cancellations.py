"""Root-only permanent task operation fences and immutable cancellation facts."""

import copy
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fixtures import BOOT, OTHER_UID, UID
from key_renewal_fixtures import RENEW
from task_cancellation_fixtures import CANCEL, OP, TASK, CancellationFixture

from app.key_renewals import VaultKeyRenewalService
from app.store import SQLiteHubStore, SQLiteTransaction, StoreUnavailable, document_path
from app.task_upload_cancellations import PROFILE, ledger_path, operation_path
from app.tasks import TaskService
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode


class CancellationSetup:
    def prepare(self, store):
        self.store, self.clock = store, 1000
        self.f = CancellationFixture()
        self.vaults = VaultService(store, clock=lambda: self.clock)
        self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.tasks = TaskService(store, clock=lambda: self.clock)
        self.original_body = self.f.body()
        self.target = self.f.target(self.original_body)
        self.command = self.f.cancellation(self.target)

    def cancel(self, body=None, cancellation=CANCEL, task=TASK, uid=UID):
        return self.tasks.cancel_upload(
            uid, task, self.command if body is None else body, cancellation
        )

    def save(self, body=None):
        return self.tasks.create(
            UID, self.original_body if body is None else body, OP, self.f.kid("device_sig")
        )

    def receipt(self, cancellation=CANCEL, task=TASK, uid=UID):
        return self.tasks.upload_cancellation(uid, task, cancellation)

    def op_path(self):
        return operation_path(self.f.owner, self.f.vault, TASK, OP)

    def ledger_path(self):
        return ledger_path(self.f.owner, self.f.vault)

    def code(self, expected, action):
        with self.assertRaises(ContractError) as failed:
            action()
        self.assertEqual(failed.exception.code, expected)


class TaskCancellationTests(CancellationSetup, unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "cancellations.sqlite3"
        self.prepare(SQLiteHubStore(self.path))

    def snapshot(self):
        with closing(sqlite3.connect(self.path)) as connection:
            return connection.execute(
                "SELECT path,body FROM hub_documents ORDER BY path"
            ).fetchall()

    def test_cancel_wins_and_original_or_changed_packet_never_writes_task(self):
        result = self.cancel()
        self.assertEqual(set(result), {"contractVersion", "profile", "command", "receipt"})
        self.assertEqual(result["profile"], PROFILE)
        self.assertEqual(
            set(result["receipt"]),
            {
                "cancellationId",
                "ownerSubject",
                "vaultId",
                "rootKeyId",
                "rootEpoch",
                "target",
                "commandFingerprint",
                "outcome",
                "acceptedAt",
            },
        )
        self.assertEqual(result["receipt"]["outcome"], "cancelled")
        self.assertEqual(result["receipt"]["target"], self.target)
        self.assertEqual(result["receipt"]["acceptedAt"], 1000)
        before = self.snapshot()
        self.code("idempotency_conflict", self.save)
        self.code("idempotency_conflict", lambda: self.save(self.f.body()))
        self.code("not_found", lambda: self.tasks.operation(UID, TASK, OP))
        self.code("not_found", lambda: self.tasks.get(UID, TASK))
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(any(path.startswith("hub_task_indexes/") for path, _ in before))
        self.assertEqual(self.receipt(), result)

    def test_saved_wins_preserves_legacy_operation_row_and_original_get(self):
        saved, _ = self.save()
        original_row = self.store.transact(lambda unit: unit.get(self.op_path()))
        result = self.cancel()
        self.assertEqual(result["receipt"]["outcome"], "saved")
        self.assertEqual(self.store.transact(lambda unit: unit.get(self.op_path())), original_row)
        self.assertEqual(self.save(), (saved, True))
        operation = "synthetic_task_later_rule_update"
        self.tasks.update(
            UID,
            TASK,
            self.f.body(version=2, operation=operation),
            operation,
            self.f.kid("device_sig"),
        )
        self.clock = 5001
        self.assertEqual(self.receipt(), result)
        self.assertEqual(self.tasks.operation(UID, TASK, OP), saved)
        self.code("key_authorization_required", self.save)

    def test_restarts_lost_ack_and_legal_signature_variant_return_original_response(self):
        result = self.cancel()
        self.store = SQLiteHubStore(self.path)
        self.clock = 10**9
        self.tasks = TaskService(self.store, clock=lambda: self.clock)
        variant = copy.deepcopy(self.command)
        raw = b64url_decode(variant["command"]["signature"])
        order = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
        variant["command"]["signature"] = b64url_encode(
            raw[:32] + (order - int.from_bytes(raw[32:], "big")).to_bytes(32, "big")
        )
        self.assertNotEqual(variant, self.command)
        self.assertEqual(self.cancel(variant), result)
        self.assertEqual(self.receipt(), result)

    def test_only_root_can_cancel_after_device_expiry_and_after_revocation(self):
        for signer in ("device_sig", "recovery_enc"):
            with self.subTest(signer=signer), self.assertRaises(ContractError):
                self.cancel(self.f.cancellation(self.target, signer=signer))
        self.f.add_key("replacement_sig", "device_sig", "replacement")
        bundle = self.f.make_bundle(previous=self.f.registry, revoked=("device_sig",))
        self.vaults.update_registry(
            UID,
            self.f.vault,
            {"contractVersion": CONTRACT_VERSION, "expectedVersion": 1, "registryBundle": bundle},
            "synthetic_task_cancel_revocation",
        )
        self.clock = 5001
        self.assertEqual(self.cancel()["receipt"]["outcome"], "cancelled")

    def test_real_root_key_renewal_does_not_remove_or_bypass_old_fence(self):
        result = self.cancel()
        self.clock = 5001
        lifecycle = VaultLifecycleService(self.store, clock=lambda: self.clock)
        renewal = self.f.renewal(lifecycle.state(UID, self.f.vault), now=self.clock)
        VaultKeyRenewalService(self.store, clock=lambda: self.clock).renew(
            UID, self.f.vault, renewal, RENEW
        )
        self.assertEqual(self.receipt(), result)
        self.code("idempotency_conflict", self.save)

    def test_new_cancel_id_same_target_has_same_outcome_without_replacing_fence(self):
        first = self.cancel()
        fence = self.store.transact(lambda unit: unit.get(self.op_path()))
        second_id = "_synthetic_second_task_cancel"
        self.clock = 1001
        second = self.cancel(self.f.cancellation(self.target, second_id), second_id)
        self.assertEqual(second["receipt"]["outcome"], first["receipt"]["outcome"])
        self.assertEqual(second["receipt"]["target"], first["receipt"]["target"])
        self.assertEqual(second["receipt"]["acceptedAt"], 1001)
        self.assertEqual(self.store.transact(lambda unit: unit.get(self.op_path())), fence)
        self.assertEqual(self.receipt(), first)

    def test_same_cancel_or_original_operation_cannot_change_packet_or_binding(self):
        self.cancel()
        for field, value in [
            ("taskId", "another_task"),
            ("operationId", "synthetic_other_original_operation"),
            ("authorKeyId", self.f.root_id),
            ("envelopeFingerprint", "0" * 64),
            ("requestFingerprint", "1" * 64),
            ("packetDigest", "2" * 64),
        ]:
            target = {**self.target, field: value}
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.cancel(self.f.cancellation(target))
        second = "synthetic_different_cancellation_id"
        self.code(
            "idempotency_conflict",
            lambda: self.cancel(
                self.f.cancellation({**self.target, "packetDigest": "0" * 64}, second), second
            ),
        )

    def test_saved_target_must_match_original_request_and_envelope(self):
        self.save()
        for field, value in [
            ("authorKeyId", self.f.root_id),
            ("envelopeFingerprint", "0" * 64),
            ("requestFingerprint", "1" * 64),
        ]:
            with self.subTest(field=field):
                self.code(
                    "idempotency_conflict",
                    lambda field=field, value=value: self.cancel(
                        self.f.cancellation({**self.target, field: value})
                    ),
                )
        # This digest belongs to the root-approved client packet, not a server
        # reconstruction of that packet's private local wrapper.
        target = {**self.target, "packetDigest": "2" * 64}
        self.assertEqual(self.cancel(self.f.cancellation(target))["receipt"]["target"], target)

    def test_wrong_owner_vault_task_epoch_and_open_payload_are_rejected(self):
        other = CancellationFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        with self.assertRaises(ContractError):
            self.cancel(uid=OTHER_UID)
        for changes in [
            {"ownerSubject": other.owner},
            {"vaultId": "another_vault"},
            {"rootKeyId": self.f.kid("device_sig")},
            {"rootEpoch": True},
            {"rootEpoch": 2},
            {"issuedAt": 1000},
            {"unexpected": True},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.cancel(self.f.cancellation(self.target, **changes))
        self.code("recipient_binding_mismatch", lambda: self.cancel(task="another_task"))
        self.code("not_found", lambda: self.receipt(task="another_task"))

    def test_global_vault_capacity_bounds_arbitrary_uncreated_tasks_and_allows_replay(self):
        first = self.cancel()
        for i in range(1, 32):
            task, operation, cancellation = (
                f"uncreated_{i}",
                f"synthetic_unknown_operation_{i:04}",
                f"synthetic_cancellation_{i:04}",
            )
            target = {**self.target, "taskId": task, "operationId": operation}
            self.cancel(self.f.cancellation(target, cancellation), cancellation, task)
        self.code(
            "version_conflict",
            lambda: self.cancel(
                self.f.cancellation(self.target, "synthetic_quota_extra_cancel"),
                "synthetic_quota_extra_cancel",
            ),
        )
        self.assertEqual(self.cancel(), first)
        self.assertFalse(
            any(
                path.startswith("hub_tasks/") or path.startswith("hub_task_indexes/")
                for path, _ in self.snapshot()
            )
        )

    def test_corrupt_ledger_receipt_or_tombstone_never_becomes_valid_absence(self):
        self.cancel()
        ledger = self.store.transact(lambda unit: unit.get(self.ledger_path()))
        tombstone = self.store.transact(lambda unit: unit.get(self.op_path()))
        for broken in [
            {**tombstone, "unexpected": True},
            {**tombstone, "cancellationId": []},
            {**tombstone, "commandFingerprint": "0" * 64},
            {**tombstone, "target": {**self.target, "packetDigest": "0" * 64}},
        ]:
            self.store.transact(lambda unit, broken=broken: unit.put(self.op_path(), broken))
            for action in (self.receipt, self.save, lambda: self.tasks.operation(UID, TASK, OP)):
                with self.assertRaises(StoreUnavailable):
                    action()
        self.store.transact(lambda unit: unit.put(self.op_path(), tombstone))
        bad = copy.deepcopy(ledger)
        bad["records"][CANCEL]["receipt"]["outcome"] = "saved"
        self.store.transact(lambda unit: unit.put(self.ledger_path(), bad))
        with self.assertRaises(StoreUnavailable):
            self.receipt()

    def test_missing_fence_or_ledger_blocks_new_writer_and_receipt(self):
        self.cancel()
        for removed in (self.op_path(), self.ledger_path()):
            before = self.snapshot()
            with closing(sqlite3.connect(self.path)) as connection, connection:
                connection.execute("DELETE FROM hub_documents WHERE path=?", (removed,))
            if removed == self.ledger_path():
                self.code("not_found", self.receipt)
            else:
                with self.assertRaises(StoreUnavailable):
                    self.receipt()
            for action in (self.save, lambda: self.tasks.operation(UID, TASK, OP)):
                with self.assertRaises(StoreUnavailable):
                    action()
            with closing(sqlite3.connect(self.path)) as connection, connection:
                connection.executemany(
                    "INSERT OR REPLACE INTO hub_documents(path,body) VALUES(?,?)", before
                )

    def test_cancellation_partial_write_failure_rolls_back_both_documents(self):
        before = self.snapshot()
        original = SQLiteTransaction.put

        def fail_fence(unit, path, value):
            if path == self.op_path():
                raise StoreUnavailable
            return original(unit, path, value)

        with (
            patch.object(SQLiteTransaction, "put", fail_fence),
            self.assertRaises(StoreUnavailable),
        ):
            self.cancel()
        self.assertEqual(self.snapshot(), before)

    def test_saved_receipt_rechecks_original_immutable_history_on_every_read(self):
        self.save()
        self.assertEqual(self.cancel()["receipt"]["outcome"], "saved")
        path = document_path("hub_task_versions", self.f.owner, self.f.vault, TASK, "1")
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("DELETE FROM hub_documents WHERE path=?", (path,))
        with self.assertRaises(StoreUnavailable):
            self.receipt()
        with self.assertRaises(StoreUnavailable):
            self.cancel()

    def test_corrupt_persisted_root_command_never_returns_a_decision_or_allows_upload(self):
        self.cancel()
        ledger = self.store.transact(lambda unit: unit.get(self.ledger_path()))
        signature = ledger["records"][CANCEL]["command"]["signature"]
        ledger["records"][CANCEL]["command"]["signature"] = (
            "A" if signature[0] != "A" else "B"
        ) + signature[1:]
        self.store.transact(lambda unit: unit.put(self.ledger_path(), ledger))
        for action in (self.receipt, self.cancel, self.save):
            with self.assertRaises(StoreUnavailable):
                action()

    def test_update_and_transition_cancellation_does_not_pause_or_replace_current_task(self):
        first, _ = self.save()
        for mode, operation in [
            ("update", "synthetic_cancel_update_0001"),
            ("transition", "synthetic_cancel_transition_0001"),
        ]:
            body = self.f.body(
                version=2,
                operation=operation,
                action="pause" if mode == "transition" else None,
                epoch=2,
            )
            target = self.f.target(body, operation=operation, mode=mode)
            cancellation = "synthetic_cancel_control_" + mode
            result = self.cancel(self.f.cancellation(target, cancellation), cancellation)
            self.assertEqual(result["receipt"]["outcome"], "cancelled")
            self.code(
                "idempotency_conflict",
                lambda mode=mode, operation=operation, body=body: getattr(self.tasks, mode)(
                    UID, TASK, body, operation, self.f.kid("device_sig")
                ),
            )
        self.assertEqual(self.tasks.get(UID, TASK), first)

    def test_saved_update_and_transition_keep_their_original_exact_write_replays(self):
        self.save()
        for version, mode in [(2, "update"), (3, "transition")]:
            operation = f"synthetic_saved_{mode}_original"
            body = self.f.body(
                version=version,
                operation=operation,
                action="pause" if mode == "transition" else None,
                epoch=2,
            )
            accepted = getattr(self.tasks, mode)(
                UID, TASK, body, operation, self.f.kid("device_sig")
            )[0]
            target = self.f.target(body, operation=operation, mode=mode)
            cancellation = f"synthetic_saved_{mode}_cancel"
            result = self.cancel(self.f.cancellation(target, cancellation), cancellation)
            self.assertEqual(result["receipt"]["outcome"], "saved")
            self.assertEqual(self.tasks.operation(UID, TASK, operation), accepted)
            self.assertEqual(
                getattr(self.tasks, mode)(UID, TASK, body, operation, self.f.kid("device_sig")),
                (accepted, True),
            )
