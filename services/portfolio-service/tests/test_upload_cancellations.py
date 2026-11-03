"""Atomic root denial is distinct from an absent receipt or an expired writer."""

import copy
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from cancellation_fixtures import CANCEL, CancellationFixture
from fixtures import OPERATION, OTHER_UID, SOURCE, UID

from app.holdings import PortfolioError, PortfolioService, _operation_path
from app.store import SQLitePortfolioStore, StoreUnavailable, document_path
from app.upload_cancellations import ledger_path
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, strict_json_loads


class UploadCancellationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "portfolio.sqlite3"
        self.store = SQLitePortfolioStore(self.path)
        self.clock = 1000
        self.service = PortfolioService(self.store, clock=lambda: self.clock)
        self.f = CancellationFixture()
        self.f.install(self.service)
        self.body, self.carrier = self.f.cancellation()

    def cancel(self, body=None, cancellation=CANCEL):
        return self.service.cancel_upload(UID, SOURCE, body or self.body, cancellation)

    def code(self, code, call):
        with self.assertRaises(ContractError) as result:
            call()
        self.assertEqual(result.exception.code, code)

    def snapshot(self):
        with closing(sqlite3.connect(self.path)) as db:
            return db.execute("SELECT path, body FROM portfolio_documents ORDER BY path").fetchall()

    def test_cancel_wins_and_survives_restart_receipt_404_and_late_upload_409(self):
        self.code("not_found", lambda: self.service.upload_cancellation(UID, SOURCE, CANCEL))
        response = self.cancel()
        self.assertEqual(response["receipt"]["outcome"], "cancelled")
        self.assertEqual(set(response), {"contractVersion", "profile", "command", "receipt"})
        self.service = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 5001)
        before = self.snapshot()
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), response)
        self.assertEqual(self.cancel(), response)
        self.code("version_conflict", lambda: self.f.write(self.service, carrier=self.carrier))
        with self.assertRaises(PortfolioError) as missing:
            self.service.receipt(UID, SOURCE, OPERATION)
        self.assertEqual(missing.exception.status, 404)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.service.metadata(UID, SOURCE)["revision"], 0)

    def test_saved_wins_never_rolls_back_or_returns_ciphertext(self):
        saved = self.f.write(self.service, carrier=self.carrier)
        self.clock = 5001
        response = self.cancel()
        self.assertEqual(response["receipt"]["outcome"], "saved")
        self.assertNotIn("ciphertext", str(response))
        self.assertEqual(self.service.receipt(UID, SOURCE, OPERATION), saved)
        self.assertEqual(self.service.snapshot(UID, SOURCE)["carrier"], self.carrier)
        before = self.snapshot()
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), response)
        self.assertEqual(self.snapshot(), before)

    def test_root_still_cancels_when_device_certificates_expired_and_source_is_inactive(self):
        self.f.install(self.service, version=1, active=False)
        self.clock = 6000
        response = self.cancel()
        self.assertEqual(response["receipt"]["outcome"], "cancelled")
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), response)
        authority = self.store.transact(
            lambda unit: unit.get(document_path("portfolio_authorities", self.f.owner, SOURCE))
        )
        self.assertFalse(authority["active"])
        self.assertEqual(authority["version"], 2)

    def test_deleted_source_saved_outcome_does_not_expose_or_reactivate_history(self):
        self.f.write(self.service, carrier=self.carrier)
        self.f.mutate(self.service, action="delete")
        self.f.ack(self.service)
        metadata = self.service.metadata(UID, SOURCE)
        self.assertEqual(metadata["state"], "deleted")
        self.clock = 6000
        response = self.cancel()
        self.assertEqual(response["receipt"]["outcome"], "saved")
        self.assertNotIn("ciphertext", str(response))
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), response)
        self.assertEqual(self.service.metadata(UID, SOURCE), metadata)
        self.code("not_found", lambda: self.service.snapshot(UID, SOURCE, "snapshot_1"))
        self.code("not_found", lambda: self.service.receipt(UID, SOURCE, OPERATION))

    def test_global_operation_namespace_prevents_other_source_and_changed_packet_bypass(self):
        self.cancel()
        other = copy.copy(self.f)
        other.resource = copy.deepcopy(self.f.resource)
        other.source = other.resource["resourceId"] = "holdings_second"
        other.install(self.service)
        self.code("version_conflict", lambda: other.write(self.service, operation=OPERATION))
        self.code(
            "version_conflict",
            lambda: self.f.write(self.service, snapshot="changed_snapshot", operation=OPERATION),
        )
        self.code("not_found", lambda: self.service.upload_cancellation(UID, other.source, CANCEL))
        body, _ = other.cancellation(cancellation="synthetic_other_source_cancel_0001")
        self.code(
            "idempotency_conflict",
            lambda: self.service.cancel_upload(
                UID, other.source, body, "synthetic_other_source_cancel_0001"
            ),
        )
        self.assertEqual(self.service.metadata(UID, other.source)["revision"], 0)

    def test_wrong_owner_source_root_vault_epoch_and_full_ref_are_rejected(self):
        other = CancellationFixture(OTHER_UID)
        other.install(self.service)
        self.code(
            "invalid_signature",
            lambda: self.service.cancel_upload(OTHER_UID, SOURCE, self.body, CANCEL),
        )
        for overrides in [
            {"ownerSubject": other.owner},
            {"vaultId": "different_vault"},
            {"rootKeyId": other.root_id},
            {"rootEpoch": 2},
            {"rootEpoch": True},
            {"profile": "other"},
            {"registrySequence": 1},
        ]:
            body, _ = self.f.cancellation(**overrides)
            with self.assertRaises(ContractError):
                self.cancel(body)
        for target in [
            {"sourceEpoch": 2},
            {"sourceEpoch": True},
            {"resourceRef": {**self.f.resource, "incarnation": "other_incarnation"}},
            {"resourceRef": {**self.f.resource, "resourceId": "other_source"}},
            {"extra": None},
        ]:
            body, _ = self.f.cancellation(target=target)
            with self.assertRaises(ContractError):
                self.cancel(body)
        self.assertEqual(len(self.snapshot()), 2, "only the two authority documents exist")

    def test_device_signature_cannot_cancel_and_request_cannot_install_a_root(self):
        payload = strict_json_loads(b64url_decode(self.body["command"]["payload"]))
        self.code(
            "invalid_signature", lambda: self.cancel({**self.body, "command": self.f.sign(payload)})
        )
        with self.assertRaises(ContractError):
            self.cancel({**self.body, "rootJwk": self.f.root_public})
        missing = PortfolioService(SQLitePortfolioStore(self.path.with_name("empty.sqlite3")))
        with self.assertRaises(PortfolioError) as result:
            missing.cancel_upload(UID, SOURCE, self.body, CANCEL)
        self.assertEqual(result.exception.status, 503)

    def test_immutable_original_signature_is_returned_for_same_signing_input_variant(self):
        response = self.cancel()
        payload = strict_json_loads(b64url_decode(self.body["command"]["payload"]))
        changed = {**self.body, "command": self.f.sign(payload, "root")}
        self.assertNotEqual(changed["command"], self.body["command"])
        self.assertEqual(self.cancel(changed), response)
        payload["target"]["packetDigest"] = "a" * 64
        self.code(
            "idempotency_conflict",
            lambda: self.cancel({**self.body, "command": self.f.sign(payload, "root")}),
        )

    def test_quota_counts_cancel_ids_per_vault_and_retries_work_when_full(self):
        first = self.cancel()
        for index in range(1, 32):
            cancellation = f"synthetic_bounded_cancel_{index:04d}"
            body, _ = self.f.cancellation(
                cancellation=cancellation,
                operation=f"synthetic_bounded_upload_{index:04d}",
                snapshot=f"snapshot_{index}",
            )
            self.cancel(body, cancellation)
        before = self.snapshot()
        self.assertEqual(self.cancel(), first)
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), first)
        body, _ = self.f.cancellation(
            cancellation="synthetic_capacity_cancel_0033",
            operation="synthetic_capacity_upload_0033",
        )
        self.code("version_conflict", lambda: self.cancel(body, "synthetic_capacity_cancel_0033"))
        self.assertEqual(self.snapshot(), before)
        ledger = self.store.transact(lambda unit: unit.get(ledger_path(self.f.owner, self.f.vault)))
        self.assertEqual(len(ledger["records"]), 32)

    def test_new_upload_with_new_operation_is_compatible_after_a_targeted_cancel(self):
        self.cancel()
        operation = "synthetic_new_upload_after_cancel"
        saved = self.f.write(self.service, operation=operation)
        self.assertEqual(saved["revision"], 1)
        self.assertEqual(self.service.receipt(UID, SOURCE, operation), saved)

    def test_saved_bindings_mismatch_is_conflict_and_corrupt_association_is_unavailable(self):
        self.f.write(self.service, carrier=self.carrier)
        payload = strict_json_loads(b64url_decode(self.body["command"]["payload"]))
        payload["target"]["envelopeFingerprint"] = "0" * 64
        self.code(
            "idempotency_conflict",
            lambda: self.cancel({**self.body, "command": self.f.sign(payload, "root")}),
        )
        path = document_path("portfolio_snapshots", self.f.owner, SOURCE, "snapshot_1")
        snapshot = self.store.transact(lambda unit: unit.get(path))
        self.store.transact(lambda unit: unit.put(path, {**snapshot, "snapshotId": "corrupted"}))
        with self.assertRaises(StoreUnavailable):
            self.cancel()
        self.assertIsNone(
            self.store.transact(lambda unit: unit.get(ledger_path(self.f.owner, self.f.vault)))
        )

    def test_fence_and_ledger_tampering_fails_closed_without_changing_the_original(self):
        self.cancel()
        op_path = _operation_path(self.f.owner, self.f.vault, OPERATION)
        fence = self.store.transact(lambda unit: unit.get(op_path))
        path = ledger_path(self.f.owner, self.f.vault)
        original = self.store.transact(lambda unit: unit.get(path))
        for mutate in [
            lambda x: x["records"][CANCEL]["receipt"].update(outcome="saved"),
            lambda x: x["records"][CANCEL]["receipt"].update(target={}),
            lambda x: x["records"][CANCEL]["command"].update(signature="A" * 86),
            lambda x: x.update(extra=True),
        ]:
            corrupted = copy.deepcopy(original)
            mutate(corrupted)
            self.store.transact(lambda unit, value=corrupted: unit.put(path, value))
            for action in [
                lambda: self.service.upload_cancellation(UID, SOURCE, CANCEL),
                lambda: self.f.write(self.service, carrier=self.carrier),
                lambda: self.service.receipt(UID, SOURCE, OPERATION),
            ]:
                with self.assertRaises(StoreUnavailable):
                    action()
        self.store.transact(lambda unit: unit.put(path, original))
        self.store.transact(
            lambda unit: unit.put(op_path, {**fence, "commandFingerprint": "0" * 64})
        )
        with self.assertRaises(StoreUnavailable):
            self.service.upload_cancellation(UID, SOURCE, CANCEL)

    def test_saved_operation_internal_corruption_is_503_not_a_target_conflict(self):
        self.f.write(self.service, carrier=self.carrier)
        path = _operation_path(self.f.owner, self.f.vault, OPERATION)
        original = self.store.transact(lambda unit: unit.get(path))
        for changed in [
            {**original, "fingerprint": "0" * 64},
            {**original, "ownerSubject": "other_owner"},
            {
                **original,
                "receipt": {**original["receipt"], "stableOperationId": "other_operation_00001"},
            },
        ]:
            self.store.transact(lambda unit, value=changed: unit.put(path, value))
            with self.assertRaises(StoreUnavailable):
                self.cancel()
            self.assertIsNone(
                self.store.transact(lambda unit: unit.get(ledger_path(self.f.owner, self.f.vault)))
            )

    def test_saved_other_source_operation_cannot_be_claimed_or_cancelled_through_this_source(self):
        self.f.write(self.service, carrier=self.carrier)
        other = copy.copy(self.f)
        other.resource = {**self.f.resource, "resourceId": "holdings_other"}
        other.source = "holdings_other"
        other.install(self.service)
        body, _ = other.cancellation()
        self.code(
            "idempotency_conflict",
            lambda: self.service.cancel_upload(UID, other.source, body, CANCEL),
        )
        self.assertIsNone(
            self.store.transact(lambda unit: unit.get(ledger_path(self.f.owner, self.f.vault)))
        )
        self.assertEqual(self.service.snapshot(UID, SOURCE)["carrier"], self.carrier)

    def remove_record(self, path):
        self.store.transact(
            lambda unit: unit.connection.execute(
                "DELETE FROM portfolio_documents WHERE path = ?", (path,)
            )
        )

    def test_missing_cancelled_fence_cannot_resurrect_original_upload_from_the_ledger(self):
        self.cancel()
        self.remove_record(_operation_path(self.f.owner, self.f.vault, OPERATION))
        before = self.snapshot()
        for action in [
            lambda: self.f.write(self.service, carrier=self.carrier),
            lambda: self.service.receipt(UID, SOURCE, OPERATION),
            lambda: self.service.upload_cancellation(UID, SOURCE, CANCEL),
            self.cancel,
        ]:
            with self.assertRaises(StoreUnavailable):
                action()
            self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.service.metadata(UID, SOURCE)["revision"], 0)

    def test_ledger_cancelled_fence_replaced_by_legacy_shape_still_blocks_late_upload(self):
        self.cancel()
        path = _operation_path(self.f.owner, self.f.vault, OPERATION)
        legacy = {
            "ownerSubject": self.f.owner,
            "sourceId": SOURCE,
            "fingerprint": "0" * 64,
            "receipt": {},
        }
        self.store.transact(lambda unit: unit.put(path, legacy))
        for action in [
            lambda: self.f.write(self.service, carrier=self.carrier),
            lambda: self.service.receipt(UID, SOURCE, OPERATION),
        ]:
            with self.assertRaises(StoreUnavailable):
                action()
        self.assertEqual(self.store.transact(lambda unit: unit.get(path)), legacy)

    def test_saved_ledger_with_missing_operation_or_snapshot_fails_closed_on_all_upload_paths(self):
        self.f.write(self.service, carrier=self.carrier)
        self.cancel()
        op_path = _operation_path(self.f.owner, self.f.vault, OPERATION)
        original = self.store.transact(lambda unit: unit.get(op_path))
        paths = [op_path, document_path("portfolio_snapshots", self.f.owner, SOURCE, "snapshot_1")]
        for path in paths:
            self.remove_record(path)
            for action in [
                lambda: self.f.write(self.service, carrier=self.carrier),
                lambda: self.service.receipt(UID, SOURCE, OPERATION),
                lambda: self.service.upload_cancellation(UID, SOURCE, CANCEL),
            ]:
                with self.assertRaises(StoreUnavailable):
                    action()
            if path == op_path:
                self.store.transact(lambda unit, selected=path: unit.put(selected, original))

    def test_identical_target_alias_get_and_retry_keep_the_first_global_fence_immutable(self):
        first = self.cancel()
        path = _operation_path(self.f.owner, self.f.vault, OPERATION)
        fence = self.store.transact(lambda unit: unit.get(path))
        alias = "synthetic_alias_cancellation_0002"
        body, _ = self.f.cancellation(
            cancellation=alias, target=copy.deepcopy(first["receipt"]["target"])
        )
        self.clock = 1100
        response = self.cancel(body, alias)
        self.assertEqual(response["receipt"]["outcome"], "cancelled")
        self.assertEqual(response["receipt"]["target"], first["receipt"]["target"])
        self.assertEqual(response["receipt"]["acceptedAt"], 1100)
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, alias), response)
        self.assertEqual(self.service.upload_cancellation(UID, SOURCE, CANCEL), first)
        self.assertEqual(self.cancel(body, alias), response)
        self.assertEqual(self.store.transact(lambda unit: unit.get(path)), fence)
        self.code("version_conflict", lambda: self.f.write(self.service, carrier=self.carrier))
        changed, _ = self.f.cancellation(
            cancellation="synthetic_alias_cancellation_0003",
            target={**first["receipt"]["target"], "packetDigest": "f" * 64},
        )
        self.code(
            "idempotency_conflict",
            lambda: self.cancel(changed, "synthetic_alias_cancellation_0003"),
        )

    def test_alias_target_must_match_first_fence_even_when_its_root_signature_is_valid(self):
        first = self.cancel()
        alias = "synthetic_alias_cancellation_0002"
        body, _ = self.f.cancellation(
            cancellation=alias, target=copy.deepcopy(first["receipt"]["target"])
        )
        self.cancel(body, alias)
        path = ledger_path(self.f.owner, self.f.vault)
        ledger = self.store.transact(lambda unit: unit.get(path))
        payload = strict_json_loads(b64url_decode(body["command"]["payload"]))
        payload["target"]["packetDigest"] = "f" * 64
        response = ledger["records"][alias]
        response["command"] = self.f.sign(payload, "root")
        response["receipt"]["target"] = payload["target"]
        from folioview_shared.encrypted.crypto import signing_input_fingerprint

        response["receipt"]["commandFingerprint"] = signing_input_fingerprint(response["command"])
        self.store.transact(lambda unit: unit.put(path, ledger))
        for action in [
            lambda: self.service.upload_cancellation(UID, SOURCE, alias),
            lambda: self.service.upload_cancellation(UID, SOURCE, CANCEL),
            lambda: self.f.write(self.service, carrier=self.carrier),
            lambda: self.service.receipt(UID, SOURCE, OPERATION),
        ]:
            with self.assertRaises(StoreUnavailable):
                action()
