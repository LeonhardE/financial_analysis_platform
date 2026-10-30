"""Synthetic root renewal: strict scope, expiry, replay and historical key retention."""

import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fixtures import BOOT, OTHER_UID, UID
from jwcrypto import jwe, jwk
from key_renewal_fixtures import PROFILE, RENEW, KeyRenewalFixture
from vault_lifecycle_fixtures import archive_digest

from app.key_renewals import MAX_CERTIFICATE_SECONDS, VaultKeyRenewalService
from app.store import SQLiteHubStore, StoreUnavailable
from app.vault_lifecycle import VaultLifecycleService
from app.vaults import VaultService
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.identity import owner_key


def decoded(command):
    return strict_json_loads(b64url_decode(command["payload"]))


class KeyRenewalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="hub-key-renewal-")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "synthetic.sqlite3"
        self.store = SQLiteHubStore(self.path)
        self.now = 1000
        self.service = VaultKeyRenewalService(self.store, clock=lambda: self.now)
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.lifecycle = VaultLifecycleService(self.store, clock=lambda: self.now)
        self.f = KeyRenewalFixture()
        self.before = self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)

    def state(self):
        return self.lifecycle.state(UID, self.f.vault)

    def body(self, **kwargs):
        return self.f.renewal(self.state(), now=self.now, **kwargs)

    def renew(self, body=None, operation=RENEW):
        return self.service.renew(
            UID, self.f.vault, self.body() if body is None else body, operation
        )

    def code(self, code, action):
        with self.assertRaises(ContractError) as caught:
            action()
        self.assertEqual(caught.exception.code, code)

    def assert_unchanged(self):
        self.assertEqual(self.vaults.current(UID), self.before)
        self.assertEqual(self.state()["lifecycleVersion"], 0)

    def resign(self, body, **changes):
        p = decoded(body["command"])
        p.update(changes)
        body["command"] = self.f.sign(p, "root")
        return body

    def rebind(self, body):
        ap = decoded(body["archiveCommand"])
        ap["newArchiveDigest"] = archive_digest(body["archive"])
        body["archiveCommand"] = self.f.sign(ap, "root")
        return self.resign(
            body,
            newArchiveDigest=ap["newArchiveDigest"],
            archiveCommandFingerprint=signing_input_fingerprint(body["archiveCommand"]),
            newCheckpointDigest=archive_digest(decoded(body["registryBundle"]["checkpoint"])),
        )

    def mutate_certificate(self, body, kid, **changes):
        bundle = body["registryBundle"]
        descriptions = []
        for entry in bundle["entries"]:
            cert = decoded(entry["certificate"])
            if cert["keyId"] == kid:
                cert.update(changes)
                entry["certificate"] = self.f.sign(cert, "root")
            descriptions.append(
                {
                    "certificateId": cert["certificateId"],
                    "payloadDigest": archive_digest(cert),
                    "active": entry["active"],
                }
            )
        cp = decoded(bundle["checkpoint"])
        cp["entriesDigest"] = archive_digest(sorted(descriptions, key=lambda x: x["certificateId"]))
        bundle["checkpoint"] = self.f.sign(cp, "root")
        return self.rebind(body)

    def test_state_is_read_only_bounded_public_status_and_root_has_no_expiry(self):
        self.now = 6000
        state = self.service.state(UID, self.f.vault)
        self.assertEqual(state["profile"], PROFILE)
        self.assertIsNone(state["rootAnchorExpiresAt"])
        self.assertEqual({c["status"] for c in state["certificates"]}, {"expired"})
        self.assertNotIn("archive", state)
        self.assertFalse(state["pendingRecoveryAuthorization"])
        self.assertEqual(self.state()["history"], [])
        self.assert_unchanged()

    def test_all_expired_owner_certificates_can_be_renewed_by_pinned_root(self):
        self.now = 6000
        body = self.body()
        result = self.renew(body)
        current = self.vaults.current(UID)["vault"]
        self.assertEqual(current["rootKeyId"], self.before["vault"]["rootKeyId"])
        self.assertEqual(current["version"], 2)
        self.assertEqual(current["archive"], body["archive"])
        self.assertEqual(result["receipt"]["registrySequence"], 2)
        self.assertEqual(result["receipt"]["keyEpoch"], 1)
        self.assertEqual(self.state()["history"][0]["receipt"]["action"], "archive_replace")
        states = self.service.state(UID, self.f.vault)["certificates"]
        self.assertEqual([c["status"] for c in states].count("active"), 3)
        self.assertEqual([c["status"] for c in states].count("revoked"), 3)
        self.assertEqual(
            VaultKeyRenewalService(SQLiteHubStore(self.path), clock=lambda: self.now).receipt(
                UID, self.f.vault, RENEW
            ),
            result,
        )

    def test_only_recovery_or_a_complete_device_pair_can_renew(self):
        for roles in [("device_sig",), ("device_enc",), ("recovery_enc", "device_sig")]:
            with self.subTest(roles=roles), self.assertRaises(ContractError):
                self.renew(self.body(roles=roles))
        body = self.body(roles=("recovery_enc",))
        result = self.renew(body)
        self.assertEqual(len(result["receipt"]["renewals"]), 1)
        self.assertEqual(
            self.vaults.current(UID)["vault"]["registryHistory"][0],
            self.before["vault"]["registryHistory"][0],
        )

    def test_device_pair_preserves_recovery_and_does_not_raise_global_epoch(self):
        body = self.body(roles=("device_sig", "device_enc"))
        self.renew(body)
        state = self.service.state(UID, self.f.vault)
        rec = [c for c in state["certificates"] if c["role"] == "recovery_enc"]
        self.assertEqual(rec[0]["keyId"], self.f.kid("recovery_enc"))
        self.assertEqual(rec[0]["status"], "active")
        self.assertEqual(state["keyEpoch"], 1)

    def test_owner_google_or_operational_signers_cannot_replace_root_approval(self):
        self.code("not_found", lambda: self.service.state(OTHER_UID, self.f.vault))
        self.code(
            "not_found", lambda: self.service.renew(OTHER_UID, self.f.vault, self.body(), RENEW)
        )
        for signer in ["device_sig", "A1_sig", "A2_sig", "recovery_enc"]:
            with self.subTest(signer=signer):
                self.code(
                    "invalid_signature", lambda signer=signer: self.renew(self.body(signer=signer))
                )
        for change in [{"command": {}}, {"archiveCommand": {}}]:
            with self.assertRaises(ContractError):
                self.renew({**self.body(), **change})
        self.assert_unchanged()

    def test_closed_payloads_fields_and_safe_integer_fences(self):
        for changes in [
            {"profile": "other"},
            {"action": "reset"},
            {"ownerSubject": owner_key(OTHER_UID)},
            {"vaultId": "foreign"},
            {"rootKeyId": "a" * 43},
            {"expectedVaultVersion": True},
            {"registrySequence": False},
            {"keyEpoch": 1.5},
            {"issuedAt": False},
            {"expiresAt": 1200.5},
            {"privateKey": "never-accepted"},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.renew(self.resign(self.body(), **changes))
        for role in [[], {}, None, True, "agent_sig"]:
            body = self.body()
            p = decoded(body["command"])
            p["renewals"][0]["role"] = role
            body["command"] = self.f.sign(p, "root")
            with self.subTest(role=role), self.assertRaises(ContractError):
                self.renew(body)
        body = self.body()
        body["privateKey"] = "never-accepted"
        with self.assertRaises(ContractError):
            self.renew(body)
        self.assert_unchanged()

    def test_every_old_cas_and_new_digest_and_archive_command_is_bound(self):
        for field, value in [
            ("expectedVaultVersion", 2),
            ("registrySequence", 2),
            ("checkpointDigest", "f" * 64),
            ("keyEpoch", 2),
            ("expectedLifecycleVersion", 1),
            ("expectedArchiveRevision", 1),
            ("expectedArchiveDigest", "f" * 64),
            ("newArchiveDigest", "f" * 64),
            ("newCheckpointDigest", "f" * 64),
            ("archiveCommandFingerprint", "f" * 64),
        ]:
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.renew(self.resign(self.body(), **{field: value}))
        body = self.body()
        ap = decoded(body["archiveCommand"])
        ap["mode"] = "passkey_change"
        body["archiveCommand"] = self.f.sign(ap, "root")
        self.resign(
            body, archiveCommandFingerprint=signing_input_fingerprint(body["archiveCommand"])
        )
        with self.assertRaises(ContractError):
            self.renew(body)
        self.assert_unchanged()

    def test_a_renewal_cannot_change_passkey_or_reuse_opaque_ciphertext(self):
        for field, value in [
            ("credentialId", b64url_encode(b"another-credential")),
            ("prfSalt", b64url_encode(b"p" * 32)),
            ("iv", self.before["vault"]["archive"]["iv"]),
            ("ciphertext", self.before["vault"]["archive"]["ciphertext"]),
        ]:
            body = self.body()
            body["archive"][field] = value
            self.rebind(body)
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.renew(body)
        self.assert_unchanged()

    def test_immutable_existing_certificate_and_unrelated_entry_changes_are_refused(self):
        body = self.body()
        self.mutate_certificate(body, self.f.kid("recovery_enc"), expiresAt=9000)
        with self.assertRaises(ContractError):
            self.renew(body)
        body = self.body()
        body["registryBundle"]["entries"].pop()
        self.rebind(body)
        with self.assertRaises(ContractError):
            self.renew(body)
        body = self.body()
        cp = decoded(body["registryBundle"]["checkpoint"])
        cp["keyEpoch"] = 2
        body["registryBundle"]["checkpoint"] = self.f.sign(cp, "root")
        self.rebind(body)
        with self.assertRaises(ContractError):
            self.renew(body)
        self.assert_unchanged()

    def test_new_certificates_have_same_scope_fresh_usable_and_bounded_longer_lifetime(self):
        for changes in [
            {"principalId": "another-principal"},
            {"expiresAt": 5000},
            {"expiresAt": 1000 + MAX_CERTIFICATE_SECONDS + 1},
            {"notBefore": 699},
            {"notBefore": 1001},
            {"capabilities": ["object_write"]},
        ]:
            body = self.body()
            target = next(
                t for t in decoded(body["command"])["renewals"] if t["role"] == "device_sig"
            )
            self.mutate_certificate(body, target["newKeyId"], **changes)
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.renew(body)
        self.assert_unchanged()

    def test_short_window_and_final_clock_fence_prevent_expiry_during_crypto(self):
        for changes in [
            {"issuedAt": 1001},
            {"expiresAt": 1000},
            {"issuedAt": 800, "expiresAt": 1200},
            {"expiresAt": 1301},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.renew(self.resign(self.body(), **changes))
        service = VaultKeyRenewalService(self.store, clock=iter([1000, 1200]).__next__)
        self.code(
            "key_authorization_required",
            lambda: service.renew(UID, self.f.vault, self.body(), RENEW),
        )
        self.assert_unchanged()

    def test_replay_after_new_generation_and_expiry_returns_original_not_current(self):
        first = self.body()
        one = self.renew(first)
        self.f.adopt(first)
        second = self.body(operation=RENEW + "_2", index=2)
        two = self.renew(second, RENEW + "_2")
        current = self.vaults.current(UID)
        self.now = 2000
        self.assertEqual(self.renew(first), one)
        self.assertEqual(self.service.receipt(UID, self.f.vault, RENEW), one)
        self.assertNotEqual(one, two)
        self.assertEqual(self.vaults.current(UID), current)
        self.assertEqual(self.state()["archiveRevision"], 2)
        self.code(
            "idempotency_conflict",
            lambda: self.renew(self.resign(copy.deepcopy(first), expiresAt=1201)),
        )

    def test_equivalent_signature_bytes_do_not_create_a_second_operation(self):
        body = self.body()
        result = self.renew(body)
        n = int("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16)
        for command in [body["command"], body["archiveCommand"]]:
            raw = b64url_decode(command["signature"])
            s = int.from_bytes(raw[32:], "big")
            command["signature"] = b64url_encode(raw[:32] + (n - s).to_bytes(32, "big"))
        self.assertEqual(self.renew(body), result)
        self.assertEqual(self.state()["archiveRevision"], 1)

    def test_lifecycle_operation_identifier_cannot_be_reused_for_a_new_renewal(self):
        replacement = self.f.replace(self.state(), operation=RENEW)
        self.lifecycle.replace_archive(UID, self.f.vault, replacement, RENEW)
        before_vault = self.vaults.current(UID)
        before_lifecycle = self.state()
        self.code("idempotency_conflict", lambda: self.renew(self.body()))
        self.assertEqual(self.vaults.current(UID), before_vault)
        self.assertEqual(self.state(), before_lifecycle)
        self.code("not_found", lambda: self.service.receipt(UID, self.f.vault, RENEW))

    def test_corrupt_operation_proof_receipt_or_archive_link_fails_closed(self):
        body = self.body()
        self.renew(body)
        path = self.service._path(owner_key(UID), RENEW)
        saved = self.store.transact(lambda u: u.get(path))
        for change in [
            lambda r: r["receipt"].update(vaultVersion=99),
            lambda r: r["receipt"].update(acceptedAt=True),
            lambda r: r.update(privateKey="no"),
            lambda r: r["archiveCommand"].update(signature="no"),
        ]:
            mutated = copy.deepcopy(saved)
            change(mutated)
            self.store.transact(lambda u, mutated=mutated: u.put(path, mutated))
            with self.subTest(change=change), self.assertRaises(StoreUnavailable):
                self.service.receipt(UID, self.f.vault, RENEW)
        self.store.transact(lambda u: u.put(path, saved))
        self.assertEqual(
            self.service.receipt(UID, self.f.vault, RENEW)["receipt"]["archiveRevision"], 1
        )

    def test_sqlite_parallel_candidates_have_only_one_winner(self):
        one = self.body()
        two = self.body(operation=RENEW + "_other", index=2)

        def run(pair):
            try:
                return self.renew(*pair)["receipt"]["archiveDigest"]
            except ContractError as e:
                return e.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, [(one, RENEW), (two, RENEW + "_other")]))
        self.assertEqual(results.count("version_conflict"), 1)
        self.assertEqual(self.state()["lifecycleVersion"], 1)

    def test_opaque_keyring_can_preserve_old_reader_material_without_server_plaintext(self):
        body = self.body()
        canary = b"SYNTHETIC_PRIVATE_RENEWAL_HISTORY"

        def encrypted(public):
            message = jwe.JWE(canary, protected={"alg": "ECDH-ES+A256KW", "enc": "A256GCM"})
            message.add_recipient(jwk.JWK(**public))
            return message.serialize()

        old_key = self.f.keys["recovery_enc"]
        new_key = self.f.keys["renewed_recovery_enc_1"]
        old_cipher = encrypted(self.f.public(old_key))
        new_cipher = encrypted(self.f.public(new_key))
        # This is a synthetic test keyring, not the current Web Master's exact-five-field format.
        keyring = {
            "profile": "synthetic-retained-keyring-test-only",
            "current": new_key.export(private_key=True, as_dict=True),
            "historical": [old_key.export(private_key=True, as_dict=True)],
        }
        wrapping = b"w" * 32
        iv = b64url_decode(body["archive"]["iv"])
        context = {k: v for k, v in body["archive"].items() if k not in {"iv", "ciphertext"}}
        body["archive"]["ciphertext"] = b64url_encode(
            AESGCM(wrapping).encrypt(iv, canonical_json(keyring), canonical_json(context))
        )
        self.rebind(body)
        self.renew(body)
        archived = self.vaults.current(UID)["vault"]["archive"]
        restored = strict_json_loads(
            AESGCM(wrapping).decrypt(
                b64url_decode(archived["iv"]),
                b64url_decode(archived["ciphertext"]),
                canonical_json(context),
            )
        )
        for raw, key in [
            (old_cipher, restored["historical"][0]),
            (new_cipher, restored["current"]),
        ]:
            message = jwe.JWE()
            message.deserialize(raw)
            message.decrypt(jwk.JWK(**key))
            self.assertEqual(message.payload, canary)
        with closing(self.store.connect()) as db:
            stored = b"".join(
                raw.encode() for (raw,) in db.execute("SELECT body FROM hub_documents")
            )
        self.assertNotIn(canary, stored)
        self.assertNotIn(b'"d":', stored)

    def test_capacity_is_not_pruned_and_original_receipt_remains_readable(self):
        body = self.body()
        receipt = self.renew(body)
        with patch("app.key_renewals.MAX_HISTORY", 2):
            self.assertEqual(self.renew(body), receipt)
            self.assertEqual(self.service.receipt(UID, self.f.vault, RENEW), receipt)
            self.f.adopt(body)
            self.code(
                "version_conflict",
                lambda: self.renew(self.body(operation=RENEW + "_2", index=2), RENEW + "_2"),
            )
        self.assertEqual(self.state()["archiveRevision"], 1)

    def test_invalid_internal_clock_fails_as_storage_unavailable(self):
        for value in [True, -1, float("nan"), float("inf"), -float("inf")]:
            with self.subTest(value=value), self.assertRaises(StoreUnavailable):
                VaultKeyRenewalService(self.store, clock=lambda value=value: value).state(
                    UID, self.f.vault
                )
