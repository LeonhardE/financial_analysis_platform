"""Actual signatures, existing SQLite transactions, Owner isolation and alias races."""

import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fixtures import BOOT, OTHER_UID, SOURCE, UID, VaultFixture

from app.fences import fence_path
from app.private_display_names import PrivateDisplayNameService, name_path
from app.store import SQLiteHubStore, StoreUnavailable, document_path
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.private_display_names import (
    DISPLAY_NAME_PROFILE,
    decrypt_display_name,
    encrypt_display_name,
)


class DisplayNameStoreTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLiteHubStore(Path(directory.name) / "names.sqlite")
        self.f, self.now, self.serial = VaultFixture(), 1000, 0
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.source = self.vaults.create_source(
            UID,
            self.f.vault,
            SOURCE,
            self.f.control(),
            "synthetic_source_create_0001",
            self.f.kid("device_sig"),
        )["source"]
        self.ref = self.source["resourceRef"]
        self.service = PrivateDisplayNameService(self.store, clock=lambda: self.now)

    def packet(self, *, state=None, ref=None, name="Synthetic account", **changes):
        self.serial += 1
        c = {
            "contractVersion": CONTRACT_VERSION,
            "profile": DISPLAY_NAME_PROFILE,
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "rootKeyId": self.f.root_id,
            "ref": ref or self.ref,
            "purpose": "owner_display_name",
            "revision": (state["revision"] if state else 0) + 1,
            "stableOperationId": f"synthetic_display_name_{self.serial:04d}",
            "recipientKeyId": self.f.kid("recovery_enc"),
        }
        p = {
            **c,
            "artifactType": "private_display_name_update",
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": self.now,
            "expectedRevision": state["revision"] if state else 0,
            "previousFingerprint": state["operationFingerprint"] if state else None,
            "envelope": encrypt_display_name(
                name, self.f.public(self.f.keys["recovery_enc"]), context=c
            ),
            **changes,
        }
        return self.f.sign(p), p["stableOperationId"]

    def write(self, packet):
        return self.service.write(UID, self.f.vault, SOURCE, *packet)

    def test_legacy_absence_and_named_read_do_not_mutate_vault_source_or_root_history(self):
        before = self.vaults.current(UID)
        self.assertEqual(self.service.listing(UID, self.f.vault)["items"], [])
        self.assertIsNone(self.service.read(UID, self.f.vault, SOURCE)["item"])
        packet = self.packet()
        saved = self.write(packet)
        self.assertEqual(saved, self.service.read(UID, self.f.vault, SOURCE))
        self.assertEqual([saved["item"]], self.service.listing(UID, self.f.vault)["items"])
        self.assertEqual(before, self.vaults.current(UID))
        _, p = _signed_parts(saved["item"]["command"])
        self.assertEqual(
            decrypt_display_name(p["envelope"], self.f.keys["recovery_enc"], context=p),
            "Synthetic account",
        )

    def test_unknown_commit_replay_returns_original_after_later_rename_and_signer_expiry(self):
        packet = self.packet()
        one = self.write(packet)
        two = self.write(self.packet(state=one["item"]["state"], name="Second synthetic name"))
        self.now = 6000
        self.assertEqual(self.write(packet), one)
        self.assertEqual(self.service.read(UID, self.f.vault, SOURCE, packet[1]), one)
        self.assertEqual(self.service.read(UID, self.f.vault, SOURCE), two)
        changed = self.packet(state=two["item"]["state"])
        with self.assertRaises(ContractError):
            self.write(changed)
        _, p = _signed_parts(packet[0])
        forged = self.f.sign({**p, "issuedAt": 1001})
        with self.assertRaises(ContractError) as error:
            self.write((forged, packet[1]))
        self.assertEqual(error.exception.code, "idempotency_conflict")

    def test_parallel_renames_have_one_cas_winner_and_no_partial_receipt(self):
        packets = [self.packet(name="First"), self.packet(name="Second")]

        def apply(packet):
            try:
                return self.write(packet)
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(apply, packets))
        self.assertEqual(sum(r == "version_conflict" for r in results), 1)
        for packet, result in zip(packets, results, strict=True):
            if result == "version_conflict":
                with self.assertRaises(ContractError):
                    self.service.read(UID, self.f.vault, SOURCE, packet[1])
            else:
                self.assertEqual(result, self.service.read(UID, self.f.vault, SOURCE, packet[1]))

    def test_owner_vault_source_ref_and_operation_selectors_cannot_cross_scope(self):
        packet = self.packet()
        self.write(packet)
        for call in [
            lambda: self.service.read(OTHER_UID, self.f.vault, SOURCE),
            lambda: self.service.listing(OTHER_UID, self.f.vault),
            lambda: self.service.read(UID, "other_vault", SOURCE),
            lambda: self.service.read(UID, self.f.vault, "other_source"),
            lambda: self.service.write(OTHER_UID, self.f.vault, SOURCE, *packet),
            lambda: self.service.write(UID, self.f.vault, "other_source", *packet),
            lambda: self.service.write(UID, self.f.vault, SOURCE, packet[0], packet[1] + "_other"),
        ]:
            with self.assertRaises(ContractError):
                call()
        foreign = {**self.ref, "incarnation": "other_incarnation"}
        with self.assertRaises(ContractError):
            self.write(self.packet(ref=foreign))

    def test_delete_hides_name_and_fences_new_writes_but_retains_owner_original_receipt(self):
        packet = self.packet()
        original = self.write(packet)

        def delete(unit):
            unit.put(
                fence_path(self.f.owner, self.ref),
                {
                    "ownerSubject": self.f.owner,
                    "ref": self.ref,
                    "sourceEpoch": 2,
                    "state": "deleted",
                    "mutationCount": 1,
                    "lastMutationId": "synthetic_source_delete_0001",
                },
            )

        self.store.transact(delete)
        self.assertEqual(self.service.listing(UID, self.f.vault)["items"], [])
        with self.assertRaises(ContractError):
            self.service.read(UID, self.f.vault, SOURCE)
        with self.assertRaises(ContractError):
            self.write(self.packet(state=original["item"]["state"]))
        self.assertEqual(self.service.read(UID, self.f.vault, SOURCE, packet[1]), original)
        self.assertEqual(self.write(packet), original)

    def test_recreated_incarnation_cannot_inherit_name_or_receipt(self):
        packet = self.packet()
        self.write(packet)

        def recreate(unit):
            path = document_path("hub_vaults", self.f.owner)
            row = unit.get(path)
            row["sources"][0]["resourceRef"]["incarnation"] = "recreated_incarnation"
            unit.put(path, row)

        self.store.transact(recreate)
        self.assertIsNone(self.service.read(UID, self.f.vault, SOURCE)["item"])
        with self.assertRaises(ContractError):
            self.service.read(UID, self.f.vault, SOURCE, packet[1])
        with self.assertRaises(ContractError):
            self.write(packet)

    def test_corrupt_saved_alias_is_unavailable_and_never_becomes_plaintext_or_a_new_revision(self):
        original = self.write(self.packet())["item"]
        path = name_path(self.f.owner, self.f.vault, self.f.root_id, self.ref)
        for mutate in [
            lambda r: r["state"].update(revision=10),
            lambda r: r["state"].update(ownerSubject="foreign_owner"),
            lambda r: r.update(displayName="plaintext"),
            lambda r: r["state"].update(operationFingerprint="a" * 64),
        ]:
            bad = copy.deepcopy(original)
            mutate(bad)
            self.store.transact(lambda u, value=bad: u.put(path, value))
            with self.assertRaises(StoreUnavailable):
                self.service.read(UID, self.f.vault, SOURCE)
            with self.assertRaises(StoreUnavailable):
                self.service.listing(UID, self.f.vault)
        self.store.transact(lambda u: u.put(path, original))

    def test_registry_cache_only_reuses_static_signatures_and_never_caches_current_fences(self):
        self.write(self.packet())
        with patch(
            "app.vaults.verify_registry",
            wraps=__import__("app.vaults", fromlist=["x"]).verify_registry,
        ) as verify:
            for _ in range(3):
                self.service.listing(UID, self.f.vault)
            self.assertEqual(verify.call_count, 0)
            bundle = self.f.make_bundle(previous=self.f.registry)
            self.vaults.update_registry(
                UID,
                self.f.vault,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "expectedVersion": 2,
                    "registryBundle": bundle,
                },
                "synthetic_registry_update_0001",
            )
            verify.reset_mock()
            self.service.listing(UID, self.f.vault)
            self.assertEqual(verify.call_count, 2)
        self.assertLessEqual(len(self.service.registry_cache), 4)

    def test_listing_batches_names_and_fences_without_producer_or_individual_reads(
        self,
    ):
        self.write(self.packet())
        from app.store import SQLiteTransaction

        calls = []
        original = SQLiteTransaction.get_many

        def batch(unit, paths, **options):
            calls.append(list(paths))
            return original(unit, paths, **options)

        with patch.object(SQLiteTransaction, "get_many", batch):
            self.service.listing(UID, self.f.vault)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(calls[0]), 2)
