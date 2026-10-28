"""Durable owner/ciphertext/authority/CAS behavior, using no external services."""

import copy
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fixtures import OPERATION, OTHER_UID, SOURCE, UID, HoldingsFixture

from app.holdings import PortfolioError, PortfolioService
from app.store import SQLitePortfolioStore, SQLiteTransaction, StoreUnavailable, document_path
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import decrypt_jwe
from folioview_shared.encrypted.envelope import parse_carrier
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, strict_json_loads
from folioview_shared.identity import owner_key


class HoldingsStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "portfolio.sqlite3"
        self.store = SQLitePortfolioStore(self.path)
        self.service = PortfolioService(self.store, clock=lambda: 1000)
        self.fixture = HoldingsFixture()
        self.fixture.install(self.service)

    def assert_code(self, code, action):
        with self.assertRaises(ContractError) as result:
            action()
        self.assertEqual(result.exception.code, code)

    def test_real_crypto_roundtrip_immutable_versions_and_original_receipt_survive_restart(self):
        carrier, context = self.fixture.message()
        first = self.fixture.write(self.service, carrier=carrier)
        second = self.fixture.write(
            self.service,
            snapshot="snapshot_2",
            revision=2,
            operation="synthetic_operation_000002",
        )
        restarted = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 1001)
        self.assertEqual(first, self.fixture.write(restarted, carrier=carrier))
        self.assertEqual(second, restarted.snapshot(UID, SOURCE)["receipt"])
        stored = restarted.snapshot(UID, SOURCE, "snapshot_1")
        self.assertEqual(stored["carrier"], carrier)
        self.assertIn("keyProofs", stored)
        self.assertEqual(first, restarted.receipt(UID, SOURCE, OPERATION))
        verified = parse_carrier(carrier, contract_header=CONTRACT_VERSION)
        message = strict_json_loads(b64url_decode(verified["signedObject"]["payload"]))
        private = decrypt_jwe(message["jwe"], self.fixture.keys["device_enc"], context=context)
        self.assertEqual(private["objectId"], "snapshot_1")
        self.assertNotIn("Synthetic account", self.path.read_bytes().decode(errors="ignore"))
        self.assertNotIn("Synthetic asset", json.dumps(stored))

    def test_owner_from_verified_uid_not_carrier_or_resource_identifier(self):
        self.fixture.write(self.service)
        other = HoldingsFixture(OTHER_UID)
        other.install(self.service)
        self.assertEqual(self.service.metadata(OTHER_UID, SOURCE)["revision"], 0)
        with self.assertRaises(PortfolioError) as result:
            self.service.snapshot(OTHER_UID, SOURCE, "snapshot_1")
        self.assertEqual(result.exception.status, 404)
        carrier, _ = self.fixture.message()
        self.assert_code(
            "recipient_binding_mismatch", lambda: other.write(self.service, carrier=carrier)
        )
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.service.commit(
                UID,
                SOURCE,
                "swapped_path",
                expected_revision=0,
                writer_key_id=self.fixture.kid("device_sig"),
                operation_id=OPERATION,
                carrier=carrier,
                contract_header=CONTRACT_VERSION,
            ),
        )

    def test_same_operation_changed_ciphertext_or_binding_conflicts(self):
        carrier, _ = self.fixture.message()
        first = self.fixture.write(self.service, carrier=carrier)
        self.assert_code("idempotency_conflict", lambda: self.fixture.write(self.service))
        self.assert_code(
            "idempotency_conflict",
            lambda: self.fixture.write(self.service, snapshot="different_snapshot"),
        )
        self.assertEqual(first, self.service.snapshot(UID, SOURCE)["receipt"])

    def test_stale_expected_revision_and_snapshot_id_reuse_never_overwrite(self):
        first = self.fixture.write(self.service)
        self.assert_code(
            "version_conflict",
            lambda: self.fixture.write(
                self.service, snapshot="stale", operation="synthetic_operation_stale"
            ),
        )
        self.assert_code(
            "idempotency_conflict",
            lambda: self.fixture.write(
                self.service, revision=2, operation="synthetic_operation_reuse"
            ),
        )
        self.assertEqual(first, self.service.snapshot(UID, SOURCE)["receipt"])

    def test_competing_writers_commit_one_complete_snapshot_and_receipt(self):
        def write(number):
            try:
                return self.fixture.write(
                    self.service,
                    snapshot=f"snapshot_{number}",
                    operation=f"synthetic_operation_{number:06}",
                )
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(write, (1, 2)))
        self.assertEqual(sum(isinstance(value, dict) for value in results), 1)
        self.assertIn("version_conflict", results)
        with sqlite3.connect(self.path) as connection:
            for collection in ("portfolio_snapshots", "portfolio_operations", "portfolio_heads"):
                self.assertEqual(
                    connection.execute(
                        "SELECT COUNT(*) FROM portfolio_documents WHERE path LIKE ?",
                        (collection + "/%",),
                    ).fetchone()[0],
                    1,
                )

    def test_partial_write_failure_rolls_back_snapshot_receipt_and_head(self):
        original = SQLiteTransaction.put

        def fail(unit, path, value):
            if path.startswith("portfolio_operations/"):
                raise RuntimeError("synthetic storage failure")
            return original(unit, path, value)

        with patch.object(SQLiteTransaction, "put", new=fail):
            with self.assertRaises(RuntimeError):
                self.fixture.write(self.service)
        self.assertEqual(self.service.metadata(UID, SOURCE)["revision"], 0)
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM portfolio_documents "
                    "WHERE path LIKE 'portfolio_snapshots/%'"
                ).fetchone()[0],
                0,
            )

    def test_lock_fences_replay_reads_and_receipt_recovery(self):
        carrier, _ = self.fixture.message()
        self.fixture.write(self.service, carrier=carrier)
        self.fixture.install(self.service, version=1, active=False)
        for action in (
            lambda: self.fixture.write(self.service, carrier=carrier),
            lambda: self.service.snapshot(UID, SOURCE),
            lambda: self.service.receipt(UID, SOURCE, OPERATION),
        ):
            with self.subTest(action=action), self.assertRaises(PortfolioError) as result:
                action()
            self.assertEqual(result.exception.status, 403)

    def test_source_epoch_fences_old_snapshots_and_wrong_epoch_writes(self):
        carrier, _ = self.fixture.message()
        self.fixture.write(self.service, carrier=carrier)
        self.fixture.install(self.service, version=1, epoch=2)
        self.assert_code(
            "recipient_binding_mismatch", lambda: self.fixture.write(self.service, carrier=carrier)
        )
        with self.assertRaises(PortfolioError):
            self.service.snapshot(UID, SOURCE)

    def test_root_or_registry_rollback_is_rejected_without_changing_replica(self):
        next_bundle = self.fixture.make_bundle(previous=self.fixture.registry)
        self.fixture.install(self.service, version=1, bundle=next_bundle)
        self.assert_code(
            "rollback_detected",
            lambda: self.fixture.install(self.service, version=2, bundle=self.fixture.bundle),
        )
        other = HoldingsFixture()
        self.assert_code(
            "recipient_binding_mismatch", lambda: other.install(self.service, version=2)
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["authorityVersion"], 2)

    def test_revoked_writer_cannot_replay_but_owner_can_read_retained_history(self):
        carrier, _ = self.fixture.message()
        self.fixture.write(self.service, carrier=carrier)
        self.fixture.add_key("new_device_sig", "device_sig", "new_device")
        next_bundle = self.fixture.make_bundle(
            previous=self.fixture.registry, revoked=("device_sig",)
        )
        self.fixture.install(self.service, version=1, bundle=next_bundle, writer="new_device_sig")
        self.assert_code(
            "key_authorization_required", lambda: self.fixture.write(self.service, carrier=carrier)
        )
        self.assertEqual(self.service.snapshot(UID, SOURCE)["carrier"], carrier)

    def test_authority_updates_use_cas_and_failed_update_is_atomic(self):
        self.assert_code(
            "version_conflict", lambda: self.fixture.install(self.service, version=99, active=False)
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["authorityVersion"], 1)

    def test_missing_projection_never_trusts_self_supplied_envelope(self):
        with self.assertRaises(PortfolioError) as result:
            self.service.metadata("synthetic_unprovisioned", SOURCE)
        self.assertEqual(result.exception.status, 503)

    def test_corrupt_stored_authority_is_not_overwritten_or_returned(self):
        path = document_path("portfolio_authorities", owner_key(UID), SOURCE)
        with sqlite3.connect(self.path) as connection:
            connection.execute("UPDATE portfolio_documents SET body=? WHERE path=?", ("{}", path))
        with self.assertRaises(StoreUnavailable):
            self.service.metadata(UID, SOURCE)
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT body FROM portfolio_documents WHERE path=?", (path,)
                ).fetchone()[0],
                "{}",
            )

    def test_plaintext_tampered_signature_or_agent_recipients_are_not_accepted(self):
        self.assert_code(
            "unsupported_contract",
            lambda: self.fixture.write(self.service, carrier={"csv": "symbol,quantity\\nSYN,1"}),
        )
        carrier, _ = self.fixture.message()
        broken = copy.deepcopy(carrier)
        broken["signedObject"]["signature"] = "A" * 86
        self.assert_code(
            "invalid_signature", lambda: self.fixture.write(self.service, carrier=broken)
        )
        context = self.fixture.context("holdings_snapshot", readers=("A1_enc",))
        context["objectId"] = "snapshot_1"
        with_agent = self.fixture.carrier(context)
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.fixture.write(self.service, carrier=with_agent),
        )
