"""Unknown archive deletions require signed CAS withdrawal, never time/404 inference."""

import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fixtures import BOOT, OTHER_UID, UID
from vault_lifecycle_fixtures import LifecycleFixture

from app.store import SQLiteHubStore, StoreUnavailable, document_path
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.errors import ContractError

DELETE = "synthetic_archive_delete_0001"
WITHDRAW = "synthetic_deletion_withdraw_0001"


class DeletionWithdrawalTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.path = Path(scratch.name) / "hub.sqlite3"
        self.store = SQLiteHubStore(self.path)
        self.now = 1000
        self.service = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.f = LifecycleFixture()
        self.before = self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.deletion = self.f.delete(self.state(), DELETE)

    def state(self):
        return self.service.state(UID, self.f.vault)

    def check(self, body=None):
        return self.service.check_deletion(UID, self.f.vault, body or self.deletion)

    def withdraw(self, body=None, operation=WITHDRAW):
        return self.service.withdraw_deletion(
            UID,
            self.f.vault,
            body or self.f.withdraw(self.state(), self.deletion, operation),
            operation,
        )

    def code(self, code, callback):
        with self.assertRaises(ContractError) as failure:
            callback()
        self.assertEqual(failure.exception.code, code)

    def test_check_is_read_only_and_expiry_alone_never_proves_withdrawal(self):
        before = self.state()
        self.assertEqual(self.check()["outcome"], "unresolved")
        self.now = 9000
        self.assertEqual(self.check()["outcome"], "unresolved")
        self.assertIsNone(self.check()["receipt"])
        self.assertEqual(self.state(), before)
        self.assertEqual(self.vaults.current(UID), self.before)

    def test_withdrawal_after_expiry_keeps_archive_and_original_late_delete_cannot_win(self):
        self.now = 9000
        body = self.f.withdraw(self.state(), self.deletion, issuedAt=9000, expiresAt=9200)
        receipt = self.withdraw(body)
        current = self.state()
        self.assertEqual(current["archiveRevision"], 0)
        self.assertEqual(current["lifecycleVersion"], 1)
        self.assertEqual(self.vaults.current(UID), self.before)
        result = self.check()
        self.assertEqual(result["outcome"], "withdrawn")
        self.assertEqual(result["receipt"], receipt["receipt"])
        # Even resetting the synthetic clock into the old command's window cannot
        # let a rolling old request defeat the signed lifecycle CAS.
        self.now = 1000
        with self.assertRaises(ContractError):
            self.service.delete_archive(UID, self.f.vault, self.deletion, DELETE)
        self.assertEqual(self.vaults.current(UID), self.before)

    def test_expired_exact_withdrawal_replay_recovers_receipt_without_more_capacity(self):
        body = self.f.withdraw(self.state(), self.deletion)
        with patch("app.vault_lifecycle.MAX_LIFECYCLE_OPERATIONS", 1):
            receipt = self.withdraw(body)
            restarted = VaultLifecycleService(SQLiteHubStore(self.path), clock=lambda: 9000)
            self.assertEqual(
                restarted.withdraw_deletion(UID, self.f.vault, body, WITHDRAW), receipt
            )
            self.assertEqual(restarted.receipt(UID, self.f.vault, WITHDRAW), receipt)
            self.assertEqual(self.state()["lifecycleVersion"], 1)

    def test_deleted_winner_cannot_be_undone_and_check_returns_original_deletion(self):
        body = self.f.withdraw(self.state(), self.deletion)
        receipt = self.service.delete_archive(UID, self.f.vault, self.deletion, DELETE)
        self.code("version_conflict", lambda: self.withdraw(body))
        result = self.check()
        self.assertEqual(result["outcome"], "deleted")
        self.assertEqual(result["receipt"], receipt["receipt"])
        self.assertIsNone(self.state()["archive"])

    def test_signed_later_archive_is_superseded_not_deleted_or_withdrawn(self):
        before = self.state()
        body = self.f.replace(before)
        self.service.replace_archive(UID, self.f.vault, body, "synthetic_archive_replace_0001")
        self.assertEqual(self.check()["outcome"], "superseded")
        self.assertIsNone(self.check()["receipt"])
        with self.assertRaises(ContractError):
            self.service.delete_archive(UID, self.f.vault, self.deletion, DELETE)
        self.assertEqual(self.state()["archive"], body["archive"])

    def test_future_counter_is_not_falsely_reported_as_superseded(self):
        state = self.state()
        for field in (
            "expectedVaultVersion",
            "expectedLifecycleVersion",
            "expectedArchiveRevision",
            "registrySequence",
            "keyEpoch",
        ):
            body = self.f.delete(
                state,
                **{
                    field: state.get(
                        {
                            "expectedVaultVersion": "vaultVersion",
                            "expectedLifecycleVersion": "lifecycleVersion",
                            "expectedArchiveRevision": "archiveRevision",
                        }.get(field, field)
                    )
                    + 1
                },
            )
            self.code("version_conflict", lambda b=body: self.check(b))

    def test_owner_device_and_foreign_root_cannot_withdraw_or_probe_private_status(self):
        state = self.state()
        for signer in ("device_sig", "recovery_enc", "A1_sig"):
            self.code(
                "invalid_signature",
                lambda s=signer: self.withdraw(self.f.withdraw(state, self.deletion, signer=s)),
            )
        self.code("invalid_signature", lambda: self.check(LifecycleFixture().delete(state)))
        self.code(
            "not_found", lambda: self.service.check_deletion(OTHER_UID, self.f.vault, self.deletion)
        )
        self.code(
            "not_found",
            lambda: self.service.withdraw_deletion(
                OTHER_UID, self.f.vault, self.f.withdraw(state, self.deletion), WITHDRAW
            ),
        )
        self.assertEqual(self.vaults.current(UID), self.before)

    def test_target_fingerprint_and_original_command_are_bound(self):
        body = self.f.withdraw(self.state(), self.deletion)
        for field, value in (
            ("deletionCommand", LifecycleFixture().delete(self.state())["command"]),
            ("deletionCommand", self.f.replace(self.state())["command"]),
        ):
            changed = copy.deepcopy(body)
            changed[field] = value
            with self.assertRaises(ContractError):
                self.withdraw(changed)
        self.assertEqual(self.check()["outcome"], "unresolved")

    def test_duplicate_withdrawal_and_operation_id_reuse_do_not_mutate_again(self):
        receipt = self.withdraw()
        self.code(
            "version_conflict", lambda: self.withdraw(operation="synthetic_second_withdrawal")
        )
        self.assertEqual(self.state()["lifecycleVersion"], 1)
        self.code("idempotency_conflict", lambda: self.withdraw())
        self.assertEqual(self.service.receipt(UID, self.f.vault, WITHDRAW), receipt)
        fresh_same_id = self.f.delete(self.state(), DELETE)
        with self.assertRaises(ContractError):
            self.service.delete_archive(UID, self.f.vault, fresh_same_id, DELETE)

    def test_concurrent_delete_and_withdrawal_have_exactly_one_winner(self):
        body = self.f.withdraw(self.state(), self.deletion)

        def run(callback):
            try:
                return callback()
            except ContractError:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    run,
                    [
                        lambda: self.service.delete_archive(
                            UID, self.f.vault, self.deletion, DELETE
                        ),
                        lambda: self.withdraw(body),
                    ],
                )
            )
        self.assertEqual(sum(result is not None for result in results), 1)
        self.assertEqual(self.state()["lifecycleVersion"], 1)
        self.assertIn(self.check()["outcome"], ("deleted", "withdrawn"))

    def test_corrupt_withdrawal_receipt_never_becomes_a_status_proof(self):
        self.withdraw()
        path = document_path("hub_vault_lifecycle", self.f.owner, self.f.vault)
        row = self.store.transact(lambda u: u.get(path))
        row["history"][0]["receipt"]["archiveDigest"] = "0" * 64
        self.store.transact(lambda u: u.put(path, row))
        with self.assertRaises(StoreUnavailable):
            self.check()
