"""Synthetic owner controls and local fences; internal ACKs are not live Hub proof."""

import copy
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fixtures import OPERATION, OTHER_UID, SOURCE, UID, HoldingsFixture

from app.holdings import PortfolioService
from app.lifecycle import MAX_SOURCE_MUTATIONS, mutation_path, state_path
from app.store import SQLitePortfolioStore, SQLiteTransaction, StoreUnavailable, document_path
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key


class SourceLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "portfolio.sqlite3"
        self.service = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 1000)
        self.fixture = HoldingsFixture()
        self.fixture.install(self.service)

    def assert_code(self, code, action):
        with self.assertRaises(ContractError) as result:
            action()
        self.assertEqual(result.exception.code, code)

    def test_pending_fence_is_durable_blocks_writes_and_retains_owner_history(self):
        original = self.fixture.write(self.service)
        command = self.fixture.control()
        pending = self.fixture.mutate(self.service, command=command)
        self.assertEqual((pending["state"], pending["sourceEpoch"]), ("pending", 2))
        self.assertIsNone(pending["completedAt"])
        restarted = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 1001)
        metadata = restarted.metadata(UID, SOURCE)
        self.assertEqual((metadata["state"], metadata["sourceEpoch"]), ("revoking", 2))
        self.assertEqual(pending, self.fixture.mutate(restarted, command=command))
        self.assertEqual(pending, restarted.mutation(UID, SOURCE, pending["operationId"]))
        self.assert_code("insufficient_scope", lambda: self.fixture.write(restarted))
        self.assertEqual(original, restarted.snapshot(UID, SOURCE)["receipt"])
        self.assertEqual(original, restarted.receipt(UID, SOURCE, OPERATION))

    def test_only_exact_internal_ack_finishes_and_old_ack_cannot_finish_new_pending(self):
        self.fixture.mutate(self.service)
        for fields in (
            {"epoch": 1},
            {"resource_ref": {**self.fixture.resource, "incarnation": "other_incarnation"}},
        ):
            self.assert_code(
                "recipient_binding_mismatch",
                lambda fields=fields: self.fixture.ack(self.service, **fields),
            )
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "revoking")
        first = self.fixture.ack(self.service)
        self.assertEqual(first["state"], "acknowledged")
        second = self.fixture.mutate(
            self.service, operation="synthetic_mutation_000002", version=3, epoch=2
        )
        self.assertEqual(first, self.fixture.ack(self.service))
        self.assertEqual(
            self.service.metadata(UID, SOURCE)["pendingMutationId"], second["operationId"]
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "revoking")

    def test_changed_signed_operation_and_cas_reject_without_advancing_fence(self):
        command = self.fixture.control()
        self.fixture.mutate(self.service, command=command)
        self.assert_code(
            "idempotency_conflict", lambda: self.fixture.mutate(self.service, action="disconnect")
        )
        self.assert_code(
            "insufficient_scope",
            lambda: self.fixture.mutate(self.service, operation="synthetic_other_pending"),
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["sourceEpoch"], 2)

    def test_stale_new_control_never_uses_self_reported_expected_authority(self):
        self.assert_code("version_conflict", lambda: self.fixture.mutate(self.service, version=2))
        self.assert_code("version_conflict", lambda: self.fixture.mutate(self.service, epoch=2))
        self.assertEqual(self.service.metadata(UID, SOURCE)["sourceEpoch"], 1)
        bad = self.fixture.control(
            parameters={"resourceRef": {**self.fixture.resource, "incarnation": "different"}}
        )
        self.assert_code(
            "recipient_binding_mismatch", lambda: self.fixture.mutate(self.service, command=bad)
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "active")

    def test_control_signature_and_headers_cannot_swap_owner_agent_or_operation(self):
        foreign = HoldingsFixture(OTHER_UID)
        foreign.install(self.service)
        self.assert_code(
            "invalid_signature",
            lambda: self.fixture.mutate(self.service, command=foreign.control()),
        )
        self.assert_code(
            "idempotency_conflict",
            lambda: self.fixture.mutate(
                self.service, command=self.fixture.control(operation="synthetic_wrong_operation")
            ),
        )
        command = self.fixture.control(ownerSubject=owner_key(OTHER_UID))
        self.assert_code(
            "recipient_binding_mismatch", lambda: self.fixture.mutate(self.service, command=command)
        )
        command = self.fixture.control()
        command["signature"] = "A" * 86
        self.assert_code(
            "invalid_signature", lambda: self.fixture.mutate(self.service, command=command)
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "active")

    def test_owner_and_multiple_sources_have_independent_mutations(self):
        foreign = HoldingsFixture(OTHER_UID)
        foreign.install(self.service)
        another = HoldingsFixture(UID, "holdings_B")
        another.install(self.service)
        saved = self.fixture.mutate(self.service, action="disconnect")
        for fixture in (foreign, another):
            self.assertEqual(self.service.metadata(fixture.uid, fixture.source)["state"], "active")
            self.assert_code(
                "not_found",
                lambda fixture=fixture: self.service.mutation(
                    fixture.uid, fixture.source, saved["operationId"]
                ),
            )
            self.assert_code("not_found", lambda fixture=fixture: fixture.ack(self.service))
            fixture.write(self.service)

    def test_disconnect_is_terminal_for_writes_but_owner_can_later_delete(self):
        self.fixture.write(self.service)
        self.fixture.mutate(self.service, action="disconnect")
        self.fixture.ack(self.service)
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "disconnected")
        self.fixture.install(self.service, version=3, epoch=2, active=True)
        self.assert_code("insufficient_scope", lambda: self.fixture.write(self.service))
        self.assertEqual(self.service.snapshot(UID, SOURCE)["receipt"]["sourceEpoch"], 1)
        deleted = self.fixture.mutate(
            self.service, action="delete", operation="synthetic_delete_000001", version=4, epoch=2
        )
        self.assertEqual(deleted["sourceEpoch"], 3)
        self.assert_code("not_found", lambda: self.service.snapshot(UID, SOURCE))
        self.assert_code("not_found", lambda: self.service.receipt(UID, SOURCE, OPERATION))
        self.fixture.ack(self.service, operation=deleted["operationId"], epoch=3)
        self.fixture.install(self.service, version=6, epoch=3, active=True)
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "deleted")
        self.assert_code("insufficient_scope", lambda: self.fixture.write(self.service))
        self.assert_code("not_found", lambda: self.service.snapshot(UID, SOURCE))
        # A tombstone retains ciphertext and immutable evidence; no hard purge claim.
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM portfolio_documents "
                    "WHERE path LIKE 'portfolio_snapshots/%'"
                ).fetchone()[0],
                1,
            )

    def test_replica_cannot_skip_pending_epoch_or_recreate_same_source_incarnation(self):
        self.fixture.mutate(self.service)
        self.assert_code(
            "version_conflict", lambda: self.fixture.install(self.service, version=2, epoch=3)
        )
        self.fixture.resource["incarnation"] = "replacement_incarnation"
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.fixture.install(self.service, version=2, epoch=2),
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "revoking")

    def test_vault_lock_still_denies_history_receipts_mutations_and_acks(self):
        self.fixture.write(self.service)
        self.fixture.mutate(self.service)
        self.fixture.install(self.service, version=2, epoch=2, active=False)
        for action in (
            lambda: self.service.snapshot(UID, SOURCE),
            lambda: self.service.receipt(UID, SOURCE, OPERATION),
            lambda: self.service.mutation(UID, SOURCE, "synthetic_mutation_000001"),
            lambda: self.fixture.ack(self.service),
        ):
            with self.assertRaises(ValueError) as result:
                action()
            self.assertEqual(result.exception.status, 403)

    def test_current_key_revocation_dominates_exact_control_replay(self):
        command = self.fixture.control()
        saved = self.fixture.mutate(self.service, command=command)
        self.fixture.add_key("new_device_sig", "device_sig", "new_device")
        bundle = self.fixture.make_bundle(previous=self.fixture.registry, revoked=("device_sig",))
        self.fixture.install(
            self.service, version=2, epoch=2, bundle=bundle, writer="new_device_sig"
        )
        self.assert_code(
            "key_authorization_required", lambda: self.fixture.mutate(self.service, command=command)
        )
        self.assertEqual(saved, self.service.mutation(UID, SOURCE, saved["operationId"]))

    def test_key_epoch_rotation_refuses_old_writes_and_preserves_owner_history(self):
        old, _ = self.fixture.message()
        original = self.fixture.write(self.service, carrier=old)
        bundle = self.fixture.make_bundle(previous=self.fixture.registry, key_epoch=2)
        self.fixture.install(self.service, version=1, bundle=bundle)
        self.assert_code(
            "recipient_binding_mismatch", lambda: self.fixture.write(self.service, carrier=old)
        )
        self.assertEqual(self.service.snapshot(UID, SOURCE)["receipt"], original)
        self.fixture.registry = self.fixture.verify(bundle, previous=self.fixture.registry)
        latest = self.fixture.write(
            self.service, snapshot="snapshot_2", revision=2, operation="synthetic_operation_000002"
        )
        self.assertEqual(latest, self.service.snapshot(UID, SOURCE)["receipt"])

    def test_failed_local_fence_write_rolls_back_all_three_records(self):
        original = SQLiteTransaction.put

        def fail(unit, path, value):
            if path.startswith("portfolio_source_mutations/"):
                raise RuntimeError("synthetic failure")
            return original(unit, path, value)

        with patch.object(SQLiteTransaction, "put", new=fail), self.assertRaises(RuntimeError):
            self.fixture.mutate(self.service)
        self.assertEqual(self.service.metadata(UID, SOURCE)["sourceEpoch"], 1)
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "active")

    def test_concurrent_upload_and_fence_never_writes_after_pending_commit(self):
        carrier, _ = self.fixture.message()

        def upload():
            try:
                return self.fixture.write(self.service, carrier=carrier)
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(upload)
            pending = pool.submit(self.fixture.mutate, self.service).result()
            result = first.result()
        self.assertEqual(pending["state"], "pending")
        self.assertTrue(isinstance(result, dict) or result == "insufficient_scope")
        self.assert_code(
            "insufficient_scope", lambda: self.fixture.write(self.service, carrier=carrier)
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["sourceEpoch"], 2)

    def test_mutation_limit_has_fixed_point_reads_and_preserves_old_receipt(self):
        saved = self.fixture.mutate(self.service)
        self.fixture.ack(self.service)
        path = state_path(owner_key(UID), SOURCE)
        self.service.store.transact(
            lambda unit: unit.put(
                path, {**unit.get(path), "mutationCount": MAX_SOURCE_MUTATIONS - 2}
            )
        )
        calls = []
        original = SQLiteTransaction.get

        def record(unit, path):
            calls.append(path)
            return original(unit, path)

        with patch.object(SQLiteTransaction, "get", new=record):
            self.assert_code(
                "version_conflict",
                lambda: self.fixture.mutate(
                    self.service, operation="synthetic_over_capacity", version=3, epoch=2
                ),
            )
        self.assertEqual(len(calls), 3)
        self.assertEqual(
            self.service.mutation(UID, SOURCE, saved["operationId"])["state"], "acknowledged"
        )
        disconnected = self.fixture.mutate(
            self.service,
            action="disconnect",
            operation="synthetic_reserved_disconnect",
            version=3,
            epoch=2,
        )
        self.assertEqual(disconnected["state"], "pending")
        self.fixture.ack(self.service, operation=disconnected["operationId"], epoch=3)
        deleted = self.fixture.mutate(
            self.service, action="delete", operation="synthetic_reserved_delete", version=5, epoch=3
        )
        self.assertEqual(deleted["state"], "pending")

    def test_corrupt_history_and_mutation_bindings_fail_closed(self):
        self.fixture.write(self.service)
        saved = self.fixture.mutate(self.service)
        mutation = mutation_path(owner_key(UID), SOURCE, saved["operationId"])
        original = self.service.store.transact(lambda unit: unit.get(mutation))
        self.service.store.transact(
            lambda unit: unit.put(mutation, {**original, "vaultId": "swapped_vault"})
        )
        with self.assertRaises(StoreUnavailable):
            self.service.mutation(UID, SOURCE, saved["operationId"])
        self.service.store.transact(lambda unit: unit.put(mutation, original))
        snapshot = document_path("portfolio_snapshots", owner_key(UID), SOURCE, "snapshot_1")
        original = self.service.store.transact(lambda unit: unit.get(snapshot))
        receipt = copy.deepcopy(original["receipt"])
        receipt["resourceRef"]["incarnation"] = "swapped_incarnation"
        self.service.store.transact(
            lambda unit: unit.put(snapshot, {**original, "receipt": receipt})
        )
        with self.assertRaises(StoreUnavailable):
            self.service.snapshot(UID, SOURCE)
        with sqlite3.connect(self.path) as connection:
            operation_path, operation_body = connection.execute(
                "SELECT path,body FROM portfolio_documents WHERE path LIKE 'portfolio_operations/%'"
            ).fetchone()
            operation = json.loads(operation_body)
            operation["receipt"]["envelopeFingerprint"] = "a" * 64
            connection.execute(
                "UPDATE portfolio_documents SET body=? WHERE path=?",
                (json.dumps(operation), operation_path),
            )
        with self.assertRaises(StoreUnavailable):
            self.service.receipt(UID, SOURCE, OPERATION)
