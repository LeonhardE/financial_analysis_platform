"""Root-authorized opaque archive maintenance, recovery fences and original receipts."""

import copy
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fixtures import BOOT, OTHER_UID, SOURCE, UID
from vault_lifecycle_fixtures import LifecycleFixture, archive_digest

from app.store import SQLiteHubStore, StoreUnavailable, document_path
from app.vault_lifecycle import MAX_LIFECYCLE_OPERATIONS, VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json
from folioview_shared.identity import owner_key

REPLACE = "synthetic_archive_replace_0001"
AUTHORIZE = "synthetic_recovery_authorize_0001"
REVOKE = "synthetic_recovery_revoke_0001"
RECOVER = "synthetic_recovery_replace_0001"
AUTHORIZATION = "recovery_authorization_A"


class VaultLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "lifecycle.sqlite3"
        self.store = SQLiteHubStore(self.path)
        self.now = 1000
        self.service = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.f = LifecycleFixture()
        self.original = self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)

    def state(self):
        return self.service.state(UID, self.f.vault)

    def replace(self, body=None, operation=REPLACE):
        return self.service.replace_archive(
            UID,
            self.f.vault,
            self.f.replace(self.state(), operation) if body is None else body,
            operation,
        )

    def authorize(self, archive=None, *, operation=AUTHORIZE, authorization=AUTHORIZATION):
        state = self.state()
        archive = self.f.archive(state) if archive is None else archive
        body = self.f.authorize(state, archive, operation, authorization=authorization)
        return self.service.authorize_recovery(UID, self.f.vault, body, operation)

    def revoke(self, *, operation=REVOKE, authorization=AUTHORIZATION):
        return self.service.revoke_recovery(
            UID,
            self.f.vault,
            authorization,
            self.f.revoke(self.state(), authorization, operation),
            operation,
        )

    def code(self, expected, action):
        with self.assertRaises(ContractError) as caught:
            action()
        self.assertEqual(caught.exception.code, expected)

    def lifecycle_row(self):
        return self.store.transact(
            lambda u: u.get(document_path("hub_vault_lifecycle", owner_key(UID), self.f.vault))
        )

    def test_legacy_read_is_zero_without_creating_sidecar_or_changing_wire_shape(self):
        state = self.state()
        self.assertEqual(state["lifecycleVersion"], 0)
        self.assertEqual(state["archiveRevision"], 0)
        self.assertEqual(state["archiveDigest"], archive_digest(self.original["vault"]["archive"]))
        self.assertIsNone(state["pendingAuthorization"])
        self.assertEqual(state["history"], [])
        self.assertIsNone(self.lifecycle_row())
        self.assertEqual(self.vaults.current(UID), self.original)
        self.assertEqual(
            set(self.original["vault"]),
            {"vaultId", "rootJwk", "rootKeyId", "registryHistory", "archive", "version"},
        )

    def test_passkey_change_replaces_only_archive_and_restarts_with_same_receipt(self):
        body = self.f.replace(self.state())
        response = self.replace(body)
        current = self.vaults.current(UID)
        self.assertEqual(current["vault"]["archive"], body["archive"])
        self.assertEqual(current["vault"]["version"], self.original["vault"]["version"])
        for field in ("vaultId", "rootJwk", "rootKeyId", "registryHistory"):
            self.assertEqual(current["vault"][field], self.original["vault"][field])
        self.assertEqual(current["sources"], self.original["sources"])
        self.assertEqual(self.state()["archiveRevision"], 1)
        restarted = VaultLifecycleService(SQLiteHubStore(self.path), clock=lambda: self.now)
        self.assertEqual(restarted.receipt(UID, self.f.vault, REPLACE), response)
        self.assertEqual(restarted.replace_archive(UID, self.f.vault, body, REPLACE), response)
        self.assertNotIn("archive", response)
        history = canonical_json(self.lifecycle_row())
        self.assertNotIn(self.original["vault"]["archive"]["ciphertext"].encode(), history)
        self.assertNotIn(body["archive"]["ciphertext"].encode(), history)
        self.assertEqual(self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT), current)

    def test_rewrap_requires_same_credential_and_passkey_change_requires_new_material(self):
        body = self.f.replace(self.state(), mode="rewrap")
        self.replace(body)
        self.assertEqual(
            body["archive"]["credentialId"], self.original["vault"]["archive"]["credentialId"]
        )
        fresh = self.state()
        bad = self.f.replace(
            fresh,
            "synthetic_archive_wrong_mode_0001",
            mode="rewrap",
            archive=self.f.archive(fresh, 2),
        )
        with self.assertRaises(ContractError):
            self.replace(bad, "synthetic_archive_wrong_mode_0001")
        for field in ("credentialId", "prfSalt", "iv", "ciphertext"):
            archive = self.f.archive(fresh, 3)
            archive[field] = fresh["archive"][field]
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.replace(
                    self.f.replace(fresh, "synthetic_archive_reused_material", archive=archive),
                    "synthetic_archive_reused_material",
                )

    def test_owner_device_and_foreign_root_cannot_authorize_replacement(self):
        state = self.state()
        self.code("not_found", lambda: self.service.state(OTHER_UID, self.f.vault))
        body = self.f.replace(state)
        self.code(
            "not_found",
            lambda: self.service.replace_archive(OTHER_UID, self.f.vault, body, REPLACE),
        )
        for signer in ("device_sig", "A1_sig", "A2_sig", "recovery_enc"):
            with self.subTest(signer=signer):
                self.code(
                    "invalid_signature",
                    lambda signer=signer: self.replace(self.f.replace(state, signer=signer)),
                )
        other = LifecycleFixture()
        self.code("invalid_signature", lambda: self.replace(other.replace(state)))
        self.vaults.bootstrap(OTHER_UID, LifecycleFixture(OTHER_UID).bootstrap(), BOOT)
        with self.assertRaises(ContractError):
            self.service.replace_archive(OTHER_UID, self.f.vault, body, REPLACE)
        self.assertEqual(self.vaults.current(UID), self.original)

    def test_action_owner_root_profile_operation_and_target_digest_are_bound(self):
        state = self.state()
        for changes in (
            {"ownerSubject": owner_key(OTHER_UID)},
            {"vaultId": "other_vault"},
            {"rootKeyId": LifecycleFixture().root_id},
            {"profile": "folioview.other-control.v1"},
            {"newArchiveDigest": "0" * 64},
            {"mode": "reset_everything"},
            {"authorizationId": AUTHORIZATION},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.replace(self.f.replace(state, **changes))
        self.code(
            "idempotency_conflict",
            lambda: self.replace(self.f.replace(state, "synthetic_wrong_http_operation")),
        )
        value = self.f.replace(state)
        value["command"] = self.f.command(
            state, REPLACE, "recovery_revoke", authorizationId=AUTHORIZATION
        )
        with self.assertRaises(ContractError):
            self.replace(value)

    def test_private_or_unknown_plaintext_fields_and_noninteger_fences_are_refused(self):
        state = self.state()
        for changes in (
            {"privateKey": "synthetic-never-accepted"},
            {"expectedArchiveRevision": True},
            {"expectedLifecycleVersion": 0.5},
            {"expectedVaultVersion": False},
            {"registrySequence": True},
            {"keyEpoch": 1.5},
            {"issuedAt": False},
            {"expiresAt": 1200.5},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.replace(self.f.replace(state, **changes))
        for mutate in (
            lambda b: b.update(password="never-accepted"),
            lambda b: b["archive"].update(privateKey="never-accepted"),
            lambda b: b["archive"].update(ownerSubject=owner_key(OTHER_UID)),
            lambda b: b.update(command={}),
        ):
            value = self.f.replace(state)
            mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(ContractError):
                self.replace(value)
        self.assertIsNone(self.lifecycle_row())

    def test_validity_is_short_lived_and_not_a_google_only_reset(self):
        for times in (
            {"issuedAt": 1001},
            {"expiresAt": 1000},
            {"issuedAt": 600, "expiresAt": 1200},
            {"expiresAt": 1301},
        ):
            with self.subTest(times=times), self.assertRaises(ContractError):
                self.replace(self.f.replace(self.state(), **times))
        self.assertEqual(self.vaults.current(UID), self.original)

    def test_all_live_cas_and_registry_fences_are_required(self):
        state = self.state()
        for changes in (
            {"expectedLifecycleVersion": 1},
            {"expectedArchiveRevision": 1},
            {"expectedArchiveDigest": "0" * 64},
            {"expectedVaultVersion": 2},
            {"registrySequence": 2},
            {"checkpointDigest": "0" * 64},
            {"keyEpoch": 2},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.replace(self.f.replace(state, **changes))
        stale = self.f.replace(state)
        bundle = self.f.make_bundle(previous=self.f.registry)
        self.vaults.update_registry(
            UID,
            self.f.vault,
            {"contractVersion": CONTRACT_VERSION, "expectedVersion": 1, "registryBundle": bundle},
            "synthetic_lifecycle_registry_0001",
        )
        with self.assertRaises(ContractError):
            self.replace(stale)
        self.assertIsNone(self.lifecycle_row())

    def test_source_creation_fences_old_command_without_removing_source(self):
        stale = self.f.replace(self.state())
        source = self.vaults.create_source(
            UID,
            self.f.vault,
            SOURCE,
            self.f.control(),
            "synthetic_source_create_0001",
            self.f.kid("device_sig"),
        )
        self.code("version_conflict", lambda: self.replace(stale))
        self.replace(self.f.replace(self.state()))
        self.assertEqual(self.vaults.current(UID)["sources"], [source["source"]])
        self.assertEqual(
            self.vaults.authority(UID, SOURCE)["authority"]["resourceRef"],
            source["source"]["resourceRef"],
        )

    def test_exact_old_replay_after_expiry_and_later_change_never_restores_old_archive(self):
        body = self.f.replace(self.state())
        receipt = self.replace(body)
        fresh = self.state()
        later = self.f.replace(
            fresh, "synthetic_archive_replace_0002", archive=self.f.archive(fresh, 2)
        )
        self.replace(later, "synthetic_archive_replace_0002")
        latest = self.state()
        self.now = 1500
        self.assertEqual(self.replace(body), receipt)
        self.assertEqual(self.service.receipt(UID, self.f.vault, REPLACE), receipt)
        self.assertEqual(self.state()["archive"], latest["archive"])
        self.assertEqual(self.state()["lifecycleVersion"], 2)
        changed = self.f.replace(latest, REPLACE, archive=self.f.archive(latest, 3))
        self.code("idempotency_conflict", lambda: self.replace(changed))

    def test_signature_high_low_s_variant_has_original_operation_identity(self):
        body = self.f.replace(self.state())
        receipt = self.replace(body)
        variant = copy.deepcopy(body)
        raw = b64url_decode(variant["command"]["signature"])
        order = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
        s = int.from_bytes(raw[32:], "big")
        variant["command"]["signature"] = b64url_encode(raw[:32] + (order - s).to_bytes(32, "big"))
        self.assertNotEqual(body["command"]["signature"], variant["command"]["signature"])
        self.assertEqual(self.replace(variant), receipt)
        self.assertEqual(self.state()["lifecycleVersion"], 1)

    def test_recovery_authorization_then_replace_is_exact_target_and_single_use(self):
        state = self.state()
        archive = self.f.archive(state)
        authorization_receipt = self.authorize(archive)
        pending = self.state()["pendingAuthorization"]
        self.assertEqual(pending["authorizationId"], AUTHORIZATION)
        self.assertEqual(pending["status"], "active")
        body = self.f.replace(
            self.state(), RECOVER, archive=archive, mode="recovery", authorization=AUTHORIZATION
        )
        response = self.replace(body, RECOVER)
        self.assertEqual(response["receipt"]["archiveRevision"], 1)
        self.assertIsNone(self.state()["pendingAuthorization"])
        self.assertEqual(self.service.receipt(UID, self.f.vault, AUTHORIZE), authorization_receipt)
        with self.assertRaises(ContractError):
            self.replace(
                self.f.replace(
                    self.state(),
                    "synthetic_recovery_reuse_0001",
                    archive=self.f.archive(self.state(), 2),
                    mode="recovery",
                    authorization=AUTHORIZATION,
                ),
                "synthetic_recovery_reuse_0001",
            )
        self.assertEqual(self.replace(body, RECOVER), response)

    def test_recovery_requires_grant_and_cannot_change_its_target(self):
        state = self.state()
        archive = self.f.archive(state)
        with self.assertRaises(ContractError):
            self.replace(
                self.f.replace(
                    state, RECOVER, archive=archive, mode="recovery", authorization=AUTHORIZATION
                ),
                RECOVER,
            )
        self.authorize(archive)
        state = self.state()
        for target, authorization in (
            (self.f.archive(state, 2), AUTHORIZATION),
            (archive, "other_authorization"),
        ):
            with self.subTest(authorization=authorization), self.assertRaises(ContractError):
                self.replace(
                    self.f.replace(
                        state, RECOVER, archive=target, mode="recovery", authorization=authorization
                    ),
                    RECOVER,
                )
        self.assertEqual(self.state()["archiveRevision"], 0)

    def test_pending_recovery_requires_explicit_revocation_or_expiry_before_replacement(self):
        state = self.state()
        archive = self.f.archive(state)
        self.authorize(archive)
        with self.assertRaises(ContractError):
            self.authorize(
                archive,
                operation="synthetic_second_authorize_0001",
                authorization="authorization_B",
            )
        revoke_body = self.f.revoke(self.state(), AUTHORIZATION, REVOKE)
        revoked = self.service.revoke_recovery(
            UID, self.f.vault, AUTHORIZATION, revoke_body, REVOKE
        )
        self.assertIsNone(self.state()["pendingAuthorization"])
        self.assertEqual(
            self.service.revoke_recovery(UID, self.f.vault, AUTHORIZATION, revoke_body, REVOKE),
            revoked,
        )
        with self.assertRaises(ContractError):
            self.authorize(archive, operation="synthetic_reused_authorize_0001")
        self.authorize(
            archive, operation="synthetic_new_authorize_0001", authorization="authorization_B"
        )
        self.assertEqual(self.state()["pendingAuthorization"]["authorizationId"], "authorization_B")

    def test_expired_or_revoked_recovery_does_not_gain_write_permission(self):
        archive = self.f.archive(self.state())
        self.authorize(archive)
        self.now = 1200
        self.assertEqual(self.state()["pendingAuthorization"]["status"], "expired")
        body = self.f.replace(
            self.state(),
            RECOVER,
            archive=archive,
            mode="recovery",
            authorization=AUTHORIZATION,
            issuedAt=1200,
            expiresAt=1300,
        )
        with self.assertRaises(ContractError):
            self.replace(body, RECOVER)
        revoke_body = self.f.revoke(
            self.state(), AUTHORIZATION, REVOKE, issuedAt=1200, expiresAt=1300
        )
        self.service.revoke_recovery(UID, self.f.vault, AUTHORIZATION, revoke_body, REVOKE)
        self.assertIsNone(self.state()["pendingAuthorization"])

    def test_recovery_final_signature_cannot_outlive_grant_or_bypass_changed_registry(self):
        archive = self.f.archive(self.state())
        self.authorize(archive)
        with self.assertRaises(ContractError):
            self.replace(
                self.f.replace(
                    self.state(),
                    RECOVER,
                    archive=archive,
                    mode="recovery",
                    authorization=AUTHORIZATION,
                    expiresAt=1250,
                ),
                RECOVER,
            )

        bundle = self.f.make_bundle(previous=self.f.registry)
        self.vaults.update_registry(
            UID,
            self.f.vault,
            {"contractVersion": CONTRACT_VERSION, "expectedVersion": 1, "registryBundle": bundle},
            "synthetic_lifecycle_registry_0001",
        )
        self.assertEqual(self.state()["pendingAuthorization"]["status"], "stale")
        with self.assertRaises(ContractError):
            self.replace(
                self.f.replace(
                    self.state(),
                    RECOVER,
                    archive=archive,
                    mode="recovery",
                    authorization=AUTHORIZATION,
                ),
                RECOVER,
            )

    def test_expired_authorization_can_be_superseded_without_reviving_its_id(self):
        self.authorize()
        self.now = 1200
        state = self.state()
        archive = self.f.archive(state, 2)
        operation = "synthetic_expiry_replacement_authorize"
        body = self.f.authorize(
            state,
            archive,
            operation,
            authorization="authorization_after_expiry",
            issuedAt=1200,
            expiresAt=1300,
        )
        self.service.authorize_recovery(UID, self.f.vault, body, operation)
        self.assertEqual(
            self.state()["pendingAuthorization"]["authorizationId"], "authorization_after_expiry"
        )
        self.assertEqual(self.state()["pendingAuthorization"]["status"], "active")
        with self.assertRaises(ContractError):
            self.replace(
                self.f.replace(
                    self.state(),
                    RECOVER,
                    archive=archive,
                    mode="recovery",
                    authorization=AUTHORIZATION,
                    issuedAt=1200,
                    expiresAt=1300,
                ),
                RECOVER,
            )

    def test_any_archive_change_invalidates_pending_recovery_and_replay_does_not_rearm(self):
        state = self.state()
        archive = self.f.archive(state)
        auth_body = self.f.authorize(state, archive)
        auth_receipt = self.service.authorize_recovery(UID, self.f.vault, auth_body, AUTHORIZE)
        self.replace(self.f.replace(self.state(), archive=self.f.archive(self.state(), 2)))
        self.assertIsNone(self.state()["pendingAuthorization"])
        self.assertEqual(
            self.service.authorize_recovery(UID, self.f.vault, auth_body, AUTHORIZE), auth_receipt
        )
        self.assertIsNone(self.state()["pendingAuthorization"])

    def test_parallel_archive_changes_keep_one_complete_winner(self):
        state = self.state()
        bodies = [
            (
                self.f.replace(
                    state,
                    f"synthetic_parallel_archive_{i:04}",
                    archive=self.f.archive(state, i + 1),
                ),
                f"synthetic_parallel_archive_{i:04}",
            )
            for i in range(2)
        ]

        def attempt(pair):
            try:
                return self.replace(*pair)
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(attempt, bodies))
        self.assertEqual(outcomes.count("version_conflict"), 1)
        self.assertEqual(self.state()["archiveRevision"], 1)
        winner = next(value for value in outcomes if isinstance(value, dict))
        self.assertEqual(self.state()["archiveDigest"], winner["receipt"]["archiveDigest"])

    def test_recovery_owner_and_receipts_do_not_cross_user_boundaries(self):
        other = LifecycleFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.authorize()
        for action in (
            lambda: self.service.receipt(OTHER_UID, self.f.vault, AUTHORIZE),
            lambda: self.service.revoke_recovery(
                OTHER_UID, self.f.vault, AUTHORIZATION, self.f.revoke(self.state()), REVOKE
            ),
        ):
            with self.assertRaises(ContractError):
                action()
        self.assertEqual(self.service.state(OTHER_UID, other.vault)["lifecycleVersion"], 0)
        self.assertIsNotNone(self.state()["pendingAuthorization"])
        self.code(
            "not_found",
            lambda: self.service.receipt(UID, self.f.vault, "synthetic_unknown_operation"),
        )

    def test_tampered_persisted_history_cannot_become_authoritative(self):
        self.replace()
        saved = self.lifecycle_row()
        path = document_path("hub_vault_lifecycle", owner_key(UID), self.f.vault)
        for mutate in (
            lambda r: r.update(ownerSubject=owner_key(OTHER_UID)),
            lambda r: r.update(initialArchiveDigest="0" * 64),
            lambda r: r["history"][0]["receipt"].update(archiveRevision=2),
            lambda r: r["history"][0]["receipt"].update(acceptedAt=True),
            lambda r: r["history"][0]["command"].update(signature="eA"),
            lambda r: r["history"].append(copy.deepcopy(r["history"][0])),
        ):
            altered = copy.deepcopy(saved)
            mutate(altered)
            self.store.transact(lambda u, altered=altered: u.put(path, altered))
            with self.subTest(mutate=mutate), self.assertRaises(StoreUnavailable):
                self.state()
        self.store.transact(lambda u: u.put(path, saved))
        vault_path = document_path("hub_vaults", owner_key(UID))
        self.store.transact(
            lambda u: u.put(
                vault_path, {**u.get(vault_path), "archive": self.original["vault"]["archive"]}
            )
        )
        with self.assertRaises(StoreUnavailable):
            self.state()

    def test_capacity_is_bounded_while_exact_receipts_and_replay_remain_available(self):
        body = None
        original_receipt = None
        for index in range(MAX_LIFECYCLE_OPERATIONS):
            state = self.state()
            operation = f"synthetic_lifecycle_capacity_{index:04}"
            candidate = self.f.replace(state, operation, archive=self.f.archive(state, index + 1))
            response = self.replace(candidate, operation)
            if index == 0:
                body, original_receipt = candidate, response
        self.code(
            "version_conflict",
            lambda: self.replace(
                self.f.replace(self.state(), archive=self.f.archive(self.state(), 100))
            ),
        )
        self.assertEqual(self.replace(body, "synthetic_lifecycle_capacity_0000"), original_receipt)
        self.assertEqual(
            self.service.receipt(UID, self.f.vault, "synthetic_lifecycle_capacity_0000"),
            original_receipt,
        )
        self.assertEqual(len(self.state()["history"]), MAX_LIFECYCLE_OPERATIONS)

    def test_authorization_near_capacity_cannot_strand_an_unconsumable_grant(self):
        with patch("app.vault_lifecycle.MAX_LIFECYCLE_OPERATIONS", 3):
            for index in range(2):
                state = self.state()
                operation = f"synthetic_reserve_slot_replace_{index:04}"
                self.replace(
                    self.f.replace(state, operation, archive=self.f.archive(state, index + 1)),
                    operation,
                )
            state = self.state()
            self.code("version_conflict", lambda: self.authorize(self.f.archive(state, 3)))
            self.assertEqual(self.state()["lifecycleVersion"], 2)
            self.assertIsNone(self.state()["pendingAuthorization"])

    def test_authorization_reserves_final_slot_for_recovery_consumption(self):
        with patch("app.vault_lifecycle.MAX_LIFECYCLE_OPERATIONS", 3):
            self.replace()
            state = self.state()
            archive = self.f.archive(state, 2)
            self.authorize(archive)
            self.assertEqual(self.state()["lifecycleVersion"], 2)
            response = self.replace(
                self.f.replace(
                    self.state(),
                    RECOVER,
                    archive=archive,
                    mode="recovery",
                    authorization=AUTHORIZATION,
                ),
                RECOVER,
            )
            self.assertEqual(self.state()["lifecycleVersion"], 3)
            self.assertIsNone(self.state()["pendingAuthorization"])
            self.assertEqual(self.service.receipt(UID, self.f.vault, RECOVER), response)

    def test_authorization_reserves_final_slot_for_explicit_revocation(self):
        with patch("app.vault_lifecycle.MAX_LIFECYCLE_OPERATIONS", 3):
            self.replace()
            self.authorize(self.f.archive(self.state(), 2))
            response = self.revoke()
            self.assertEqual(self.state()["lifecycleVersion"], 3)
            self.assertIsNone(self.state()["pendingAuthorization"])
            self.assertEqual(self.service.receipt(UID, self.f.vault, REVOKE), response)

    def test_real_synthetic_aead_rewrap_preserves_root_without_backend_plaintext(self):
        old_secret, new_secret = bytes(range(32)), bytes(range(32, 64))
        value = {
            "canary": "synthetic-root-plaintext-must-stay-client-only",
            "rootPrivate": self.f.root.export(private_key=True, as_dict=True),
        }
        bootstrap = self.f.bootstrap()
        old_archive = bootstrap["archive"]
        old_context = {k: v for k, v in old_archive.items() if k not in {"iv", "ciphertext"}}
        old_iv = b"a" * 12
        old_archive.update(
            iv=b64url_encode(old_iv),
            ciphertext=b64url_encode(
                AESGCM(old_secret).encrypt(
                    old_iv, canonical_json(value), canonical_json(old_context)
                )
            ),
        )
        second_dir = Path(self.directory.name) / "real-aead.sqlite3"
        store = SQLiteHubStore(second_dir)
        vaults = VaultService(store, clock=lambda: 1000)
        service = VaultLifecycleService(store, clock=lambda: 1000)
        vaults.bootstrap(UID, bootstrap, BOOT)
        state = service.state(UID, self.f.vault)
        decoded = AESGCM(old_secret).decrypt(
            b64url_decode(old_archive["iv"]),
            b64url_decode(old_archive["ciphertext"]),
            canonical_json(old_context),
        )
        self.assertEqual(json.loads(decoded), value)
        archive = self.f.archive(state)
        context = {k: v for k, v in archive.items() if k not in {"iv", "ciphertext"}}
        iv = b"b" * 12
        archive.update(
            iv=b64url_encode(iv),
            ciphertext=b64url_encode(
                AESGCM(new_secret).encrypt(iv, decoded, canonical_json(context))
            ),
        )
        service.replace_archive(UID, self.f.vault, self.f.replace(state, archive=archive), REPLACE)
        saved = service.state(UID, self.f.vault)["archive"]
        plain = AESGCM(new_secret).decrypt(
            b64url_decode(saved["iv"]), b64url_decode(saved["ciphertext"]), canonical_json(context)
        )
        self.assertEqual(json.loads(plain), value)
        with self.assertRaises(InvalidTag):
            AESGCM(old_secret).decrypt(
                b64url_decode(saved["iv"]),
                b64url_decode(saved["ciphertext"]),
                canonical_json(context),
            )
        self.assertNotIn(value["canary"].encode(), second_dir.read_bytes())
        self.assertNotIn(value["rootPrivate"]["d"].encode(), second_dir.read_bytes())
