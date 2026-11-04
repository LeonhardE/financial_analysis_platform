"""Root-approved archive removal retains authority, receipts and independent recovery."""

import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fixtures import BOOT, OTHER_UID, UID
from vault_lifecycle_fixtures import LifecycleFixture, archive_digest

from app.catalogue import CatalogueService
from app.store import SQLiteHubStore, StoreUnavailable, document_path
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.errors import ContractError

DELETE = "synthetic_archive_delete_0001"


class ArchiveDeletionTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.path = Path(scratch.name) / "archive.sqlite3"
        self.store = SQLiteHubStore(self.path)
        self.now = 1000
        self.service = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.f = LifecycleFixture()
        self.before = self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)

    def state(self):
        return self.service.state(UID, self.f.vault)

    def delete(self, body=None, operation=DELETE):
        body = self.f.delete(self.state(), operation) if body is None else body
        return self.service.delete_archive(UID, self.f.vault, body, operation)

    def code(self, code, callback):
        with self.assertRaises(ContractError) as failure:
            callback()
        self.assertEqual(failure.exception.code, code)

    def test_removes_ciphertext_preserves_root_sources_and_never_allows_rebootstrap(self):
        before = self.vaults.current(UID)
        context = CatalogueService(self.vaults, None).context(UID)
        receipt = self.delete()
        after = self.vaults.current(UID)
        self.assertEqual(after, {**before, "vault": {**before["vault"], "archive": None}})
        self.assertEqual(CatalogueService(self.vaults, None).context(UID), context)
        self.assertEqual(self.state()["archiveDigest"], archive_digest(None))
        self.assertEqual(self.state()["archiveRevision"], 1)
        self.assertEqual(receipt["receipt"]["action"], "archive_delete")
        self.assertEqual(self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT), after)
        self.code(
            "version_conflict",
            lambda: self.vaults.bootstrap(UID, self.f.bootstrap(), "synthetic_other_bootstrap"),
        )
        with self.store.connect() as connection:
            rows = connection.execute("SELECT body FROM hub_documents").fetchall()
        stored = "\n".join(row[0] for row in rows).encode()
        archive = before["vault"]["archive"]
        for field in ("ciphertext", "credentialId", "prfSalt", "iv"):
            self.assertNotIn(archive[field].encode(), stored)

    def test_lost_response_restart_and_expired_exact_retry_return_one_original_receipt(self):
        body = self.f.delete(self.state())
        receipt = self.delete(body)
        restarted = VaultLifecycleService(SQLiteHubStore(self.path), clock=lambda: 9000)
        self.assertEqual(restarted.delete_archive(UID, self.f.vault, body, DELETE), receipt)
        self.assertEqual(restarted.receipt(UID, self.f.vault, DELETE), receipt)
        self.assertEqual(self.state()["lifecycleVersion"], 1)
        self.code("version_conflict", lambda: self.delete(operation="synthetic_second_delete"))
        changed = self.f.delete(self.state())
        self.code("idempotency_conflict", lambda: self.delete(changed))

    def test_owner_login_device_foreign_root_and_agent_cannot_approve_deletion(self):
        state = self.state()
        for signer in ("device_sig", "recovery_enc", "A1_sig", "A2_sig"):
            self.code(
                "invalid_signature", lambda s=signer: self.delete(self.f.delete(state, signer=s))
            )
        self.code("invalid_signature", lambda: self.delete(LifecycleFixture().delete(state)))
        self.code(
            "not_found",
            lambda: self.service.delete_archive(
                OTHER_UID, self.f.vault, self.f.delete(state), DELETE
            ),
        )
        self.assertEqual(self.vaults.current(UID), self.before)

    def test_signed_binding_window_and_cas_mismatches_leave_archive_untouched(self):
        state = self.state()
        for changes in (
            {"expectedArchiveDigest": "0" * 64},
            {"expectedArchiveRevision": 1},
            {"expectedLifecycleVersion": 1},
            {"expectedVaultVersion": 2},
            {"registrySequence": 2},
            {"checkpointDigest": "0" * 64},
            {"keyEpoch": 2},
            {"ownerSubject": "other_owner"},
            {"vaultId": "other_vault"},
            {"rootKeyId": LifecycleFixture().root_id},
            {"profile": "other_profile"},
            {"action": "archive_replace"},
            {"issuedAt": 1001},
            {"expiresAt": 1000},
            {"newArchiveDigest": archive_digest(None)},
            {"authorizationId": None},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.delete(self.f.delete(state, **changes))
            self.assertEqual(self.vaults.current(UID), self.before)

    def test_old_replacement_and_pending_recovery_cannot_resurrect_removed_archive(self):
        original = self.state()
        archive = self.f.archive(original)
        op = "synthetic_pre_delete_authorize"
        authorization = "synthetic_pre_delete_approval"
        self.service.authorize_recovery(
            UID,
            self.f.vault,
            self.f.authorize(original, archive, op, authorization=authorization),
            op,
        )
        old_state = self.state()
        old_replace = self.f.replace(
            old_state, archive=archive, mode="recovery", authorization=authorization
        )
        self.delete()
        self.assertIsNone(self.state()["pendingAuthorization"])
        with self.assertRaises(ContractError):
            self.service.replace_archive(
                UID, self.f.vault, old_replace, "synthetic_archive_replace_0001"
            )
        current = self.state()
        for mode in ("passkey_change", "rewrap", "recovery"):
            operation = "synthetic_invalid_restore_" + mode
            body = self.f.replace(
                current,
                operation,
                archive=archive,
                mode=mode,
                authorization=authorization if mode == "recovery" else None,
            )
            self.code(
                "key_authorization_required",
                lambda b=body, o=operation: self.service.replace_archive(UID, self.f.vault, b, o),
            )
        self.assertIsNone(self.state()["archive"])

    @patch("app.vault_lifecycle.MAX_LIFECYCLE_OPERATIONS", 3)
    def test_fresh_independent_recovery_restores_same_root_and_delete_replay_is_read_only(self):
        original = self.state()
        delete_body = self.f.delete(original)
        delete_receipt = self.delete(delete_body)
        archive = self.f.archive(original)
        state = self.state()
        op, approval = "synthetic_after_delete_authorize", "synthetic_after_delete_approval"
        self.service.authorize_recovery(
            UID, self.f.vault, self.f.authorize(state, archive, op, authorization=approval), op
        )
        state = self.state()
        operation = "synthetic_after_delete_restore"
        body = self.f.replace(
            state, operation, archive=archive, mode="recovery", authorization=approval
        )
        result = self.service.replace_archive(UID, self.f.vault, body, operation)
        self.assertEqual(self.state()["archive"], archive)
        self.assertEqual(self.state()["archiveRevision"], 2)
        self.assertEqual(self.delete(delete_body), delete_receipt)
        self.assertEqual(self.state()["archive"], archive)
        self.assertEqual(self.vaults.current(UID)["vault"]["rootKeyId"], self.f.root_id)
        self.assertEqual(self.service.receipt(UID, self.f.vault, operation), result)

    def test_saved_replace_replay_after_delete_never_writes_old_ciphertext(self):
        body = self.f.replace(self.state())
        operation = "synthetic_archive_replace_0001"
        receipt = self.service.replace_archive(UID, self.f.vault, body, operation)
        self.delete()
        self.assertEqual(self.service.replace_archive(UID, self.f.vault, body, operation), receipt)
        self.assertIsNone(self.vaults.current(UID)["vault"]["archive"])

    def test_concurrent_same_delete_is_exactly_once_and_competing_replace_has_one_winner(self):
        state = self.state()
        body = self.f.delete(state)
        with ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: self.delete(body), range(2)))
        self.assertEqual(receipts[0], receipts[1])
        self.assertEqual(self.state()["lifecycleVersion"], 1)
        # A replacement prepared before removal cannot restore the old state.
        with self.assertRaises(ContractError):
            self.service.replace_archive(
                UID, self.f.vault, self.f.replace(state), "synthetic_archive_replace_0001"
            )

    def test_unapproved_null_archive_and_missing_or_corrupt_proof_fail_closed(self):
        path = document_path("hub_vaults", self.f.owner)
        lifecycle_path = document_path("hub_vault_lifecycle", self.f.owner, self.f.vault)
        original_row = self.store.transact(lambda u: u.get(path))
        self.store.transact(lambda u: u.put(path, {**original_row, "archive": None}))
        with self.assertRaises(StoreUnavailable):
            self.vaults.current(UID)
        self.store.transact(lambda u: u.put(path, original_row))
        self.delete()
        proof = self.store.transact(lambda u: u.get(lifecycle_path))
        bad = copy.deepcopy(proof)
        bad["history"][0]["receipt"]["archiveRevision"] += 1
        self.store.transact(lambda u: u.put(lifecycle_path, bad))
        with self.assertRaises(StoreUnavailable):
            self.vaults.current(UID)
        with self.assertRaises(StoreUnavailable):
            CatalogueService(self.vaults, None).context(UID)
        self.store.transact(lambda u: u.put(lifecycle_path, proof))
        self.assertIsNone(self.vaults.current(UID)["vault"]["archive"])

    def test_delete_reserves_two_slots_for_fresh_recovery(self):
        with patch("app.vault_lifecycle.MAX_LIFECYCLE_OPERATIONS", 4):
            for index in (1, 2):
                state = self.state()
                operation = f"synthetic_capacity_replace_{index:04}"
                body = self.f.replace(state, operation, archive=self.f.archive(state, index))
                self.service.replace_archive(UID, self.f.vault, body, operation)
            before = self.state()
            self.code("version_conflict", self.delete)
            self.assertEqual(self.state(), before)
