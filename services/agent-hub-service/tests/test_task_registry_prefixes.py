"""Exact attempt-local historical authority, real JOSE/SDK and legacy fallback."""

import copy
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

import test_task_packet_batches as packets
from fixtures import VaultFixture

from app import registry_reads, tasks, vaults
from app.registry_reads import RegistryPrefixCache
from app.store import StoreUnavailable, document_path
from app.tasks import _paths, _response
from app.vaults import _current, _verify_row
from folioview_shared.encrypted.constants import MAX_SAFE_INTEGER
from folioview_shared.encrypted.crypto import _signed_parts
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads


class TaskRegistryPrefixTests(unittest.TestCase):
    reads = packets.TaskPacketBatchTests.reads
    query = packets.TaskPacketBatchTests.query

    def setUp(self):
        packets.TaskPacketBatchTests.setUp(self)
        self.f.service.store = self.f.store
        self.f.advance_registry()
        self.f.advance_registry()
        self.expected = []
        for task_id in self.ids:
            operation = "synthetic_prefix_update_" + task_id
            result = self.f.save(
                self.f.fixture.body(task=task_id, version=2, operation=operation),
                operation=operation,
                mode="update",
                task=task_id,
            )
            self.expected.append(result[0])
        self.vault_path = document_path("hub_vaults", self.owner)
        self.copy_sqlite()
        self.f.service.store = self.store
        self.rpc.calls.clear()

    def copy_sqlite(self):
        connection = self.f.store.connect()
        try:
            self.rpc.documents = {
                self.client.document(path)._document_path: strict_json_loads(body)
                for path, body in connection.execute("SELECT path, body FROM hub_documents")
            }
        finally:
            connection.close()

    def test_one_two_four_packets_verify_current_history_once_and_keep_all_carrier_checks(self):
        for count in (1, 2, 4):
            with (
                self.subTest(count=count),
                patch("app.vaults.verify_registry", wraps=vaults.verify_registry) as current,
                patch("app.tasks.verify_registry", wraps=tasks.verify_registry) as historical,
                patch("app.tasks._selection", wraps=tasks._selection) as selection,
                patch("app.tasks.verify_carrier", wraps=tasks.verify_carrier) as carriers,
            ):
                self.rpc.calls.clear()
                value = self.query(self.ids[:count])
                self.assertEqual([row["packet"] for row in value["items"]], self.expected[:count])
                self.assertEqual(current.call_count, 3)
                self.assertEqual(historical.call_count, 0)
                self.assertEqual(selection.call_count, count)
                self.assertEqual(carriers.call_count, count)
                self.assertEqual([len(group) for group in self.reads()], [1, 2, count, count])
                self.assertTrue(
                    all(
                        not kw["request"]["writes"]
                        for kind, kw in self.rpc.calls
                        if kind == "commit"
                    )
                )

    def test_sqlite_and_disabled_or_legacy_cache_return_exact_same_dto(self):
        expected = self.query()
        self.f.service.store = self.f.store
        self.assertEqual(self.query(), expected)
        self.f.service.store = self.store
        for mode in ("full_entries", "full_bytes", "legacy", "polluted"):
            with self.subTest(mode=mode):
                original = self.store.transact

                def transact(action, mode=mode, original=original):
                    def read(unit):
                        if mode == "legacy":
                            del unit.registry_prefix_cache
                        elif mode == "polluted":
                            unit.registry_prefix_cache = {"forged": self.f.fixture.registry}
                        return action(unit)

                    return original(read)

                with (
                    patch.object(self.store, "transact", side_effect=transact),
                    patch.object(
                        registry_reads, "MAX_PREFIX_HISTORIES", 0 if mode == "full_entries" else 8
                    ),
                    patch.object(
                        registry_reads,
                        "MAX_PREFIX_BYTES",
                        0 if mode == "full_bytes" else 8 * 1024 * 1024,
                    ),
                    patch("app.tasks.verify_registry", wraps=tasks.verify_registry) as historical,
                ):
                    self.assertEqual(self.query(), expected)
                    self.assertEqual(historical.call_count, 12)

    def test_old_writer_revocation_does_not_replace_historical_authority_with_latest(self):
        self.f.fixture.add_key("replacement_sig", "device_sig", "replacement_device")
        self.f.fixture.add_key("replacement_enc", "device_enc", "replacement_device")
        self.f.advance_registry(revoked=("device_sig",))
        self.copy_sqlite()
        with (
            patch("app.vaults.verify_registry", wraps=vaults.verify_registry) as current,
            patch("app.tasks.verify_registry", wraps=tasks.verify_registry) as historical,
        ):
            value = self.query()
        self.assertEqual([row["packet"] for row in value["items"]], self.expected)
        self.assertEqual(current.call_count, 4)
        self.assertEqual(historical.call_count, 0)

    def test_conflict_and_next_request_validate_fresh_current_history_and_lifecycle(self):
        name = self.client.document(self.vault_path)._document_path
        self.f.fixture.add_key("replacement_sig", "device_sig", "replacement_device")
        self.f.fixture.add_key("replacement_enc", "device_enc", "replacement_device")
        self.f.advance_registry(revoked=("device_sig",))
        next_row = self.f.store.transact(lambda unit: unit.get(self.vault_path))
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.rpc.documents.update({name: copy.deepcopy(next_row)})
        with patch("app.vaults.verify_registry", wraps=vaults.verify_registry) as current:
            self.assertEqual([row["packet"] for row in self.query()["items"]], self.expected)
            self.assertEqual(current.call_count, 7)
            self.query()
            self.assertEqual(current.call_count, 11)
        # A second request cannot inherit a validated prior attempt's lifecycle.
        from app.task_lifecycle import lifecycle_path

        path = self.client.document(lifecycle_path(self.owner, self.vault))._document_path
        self.rpc.documents[path] = {"version": 1, "tasks": {self.ids[0]: "trashed"}}
        self.assertEqual(self.query()["items"][0]["status"], "not_found")

    def test_failure_in_late_bundle_or_current_row_publishes_no_prefix(self):
        def read(unit):
            row = unit.get(self.vault_path)
            for mode in ("signature", "rollback", "source"):
                changed = copy.deepcopy(row)
                if mode == "signature":
                    changed["registryHistory"][-1]["checkpoint"]["signature"] = "A" * 86
                elif mode == "rollback":
                    changed["registryHistory"][-1] = copy.deepcopy(changed["registryHistory"][0])
                else:
                    changed["sources"] = [{"resourceRef": {}, "sourceEpoch": 1}]
                with self.subTest(mode=mode), self.assertRaises((ContractError, StoreUnavailable)):
                    _verify_row(
                        changed,
                        self.owner,
                        1000,
                        unit=unit,
                        registry_cache=unit.registry_history_cache,
                    )
                self.assertIsNone(unit.registry_prefix_cache.get(self.owner, changed, 0, 1000))
                self.assertFalse(unit.registry_history_cache)
            _current(unit, self.owner, 1000)
            self.assertEqual(
                unit.registry_prefix_cache.get(self.owner, row, 2, 1000).registry_sequence, 3
            )

        self.store.transact(read)

    def test_full_root_history_owner_and_vault_bytes_are_bound_and_values_are_immutable(self):
        def read(unit):
            row, _ = _current(unit, self.owner, 1000)
            cache = unit.registry_prefix_cache
            registry = cache.get(self.owner, row, 2, 1000)
            self.assertEqual(registry.registry_sequence, 3)
            with self.assertRaises(TypeError):
                registry.certificates[self.f.fixture.kid("device_sig")]["role"] = "root_sig"
            changed = copy.deepcopy(row)
            changed["rootJwk"]["extra"] = "same-thumbprint-different-bytes"
            self.assertIsNone(cache.get(self.owner, changed, 2, 1000))
            changed = copy.deepcopy(row)
            changed["registryHistory"][-1]["entries"][0]["active"] = False
            self.assertIsNone(cache.get(self.owner, changed, 2, 1000))
            changed = copy.deepcopy(row)
            changed["vaultId"] = "foreign_vault"
            self.assertIsNone(cache.get(self.owner, changed, 2, 1000))
            self.assertIsNone(cache.get("foreign_owner", row, 2, 1000))
            changed = copy.deepcopy(row)
            changed["ownerSubject"] = "foreign_owner"
            self.assertIsNone(cache.get(self.owner, changed, 2, 1000))
            with self.assertRaises(TypeError):
                RegistryPrefixCache({"forged": registry})
            with self.assertRaises(AttributeError):
                cache.entries = {"forged": registry}

        self.store.transact(read)

    def test_cached_prefix_keeps_strict_clock_checkpoint_and_certificate_time_bounds(self):
        def read(unit):
            row, _ = _current(unit, self.owner, 1000)
            for now in (True, 1.0, -1, MAX_SAFE_INTEGER + 1):
                with self.subTest(now=now), self.assertRaises(ContractError):
                    unit.registry_prefix_cache.get(self.owner, row, 0, now)
                with self.assertRaises(ContractError):
                    _verify_row(
                        row, self.owner, now, unit=unit, registry_cache=unit.registry_history_cache
                    )
            with self.assertRaises(ContractError):
                unit.registry_prefix_cache.get(self.owner, row, 2, 501)

        self.store.transact(read)
        for now in (99, 501, 5000):
            with self.subTest(written_at=now):
                original = copy.deepcopy(self.rpc.documents)
                stamp = datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z")
                index = self.client.document(
                    document_path("hub_task_indexes", self.owner, self.vault)
                )._document_path
                self.rpc.documents[index]["tasks"][self.ids[0]].update(
                    createdAt=stamp, updatedAt=stamp
                )
                for version in (None, 2):
                    path = self.client.document(
                        _paths(self.owner, self.vault, self.ids[0], version)
                    )._document_path
                    self.rpc.documents[path]["metadata"].update(createdAt=stamp, updatedAt=stamp)
                try:
                    with self.assertRaises(StoreUnavailable):
                        self.query(self.ids[:1])
                finally:
                    self.rpc.documents = original

    def test_changed_suffix_and_wrong_root_still_fail_before_historical_packet_return(self):
        root = VaultFixture()
        original = copy.deepcopy(self.rpc.documents)
        name = self.client.document(self.vault_path)._document_path
        for mode in ("suffix", "root"):
            with self.subTest(mode=mode):
                changed = self.rpc.documents[name]
                if mode == "suffix":
                    changed["registryHistory"][-1]["entries"][0]["certificate"]["signature"] = (
                        "A" * 86
                    )
                else:
                    changed.update(rootJwk=root.root_public, rootKeyId=root.root_id)
                    changed["archive"]["rootKeyId"] = root.root_id
                try:
                    with self.assertRaises((ContractError, StoreUnavailable)):
                        self.query()
                finally:
                    self.rpc.documents = copy.deepcopy(original)

    def test_legacy_fallback_rejects_the_same_corrupt_packet_after_valid_current_history(self):
        path = self.client.document(_paths(self.owner, self.vault, self.ids[0], 2))._document_path
        self.rpc.documents[path]["keyProofs"]["checkpoint"]["signature"] = "A" * 86
        for capacity in (8, 0):
            with (
                self.subTest(capacity=capacity),
                patch.object(registry_reads, "MAX_PREFIX_HISTORIES", capacity),
            ):
                with self.assertRaises(StoreUnavailable):
                    self.query()

    def test_eight_exact_histories_fill_the_cache_and_ninth_uses_full_validation(self):
        def read(unit):
            row = unit.get(self.vault_path)
            variants = []
            for _ in range(9):
                variant = copy.deepcopy(row)
                payload = _signed_parts(variant["registryHistory"][0]["checkpoint"])[1]
                variant["registryHistory"][0]["checkpoint"] = self.f.fixture.sign(payload, "root")
                _verify_row(
                    variant, self.owner, 1000, unit=unit, registry_cache=unit.registry_history_cache
                )
                variants.append(variant)
            self.assertTrue(
                all(
                    unit.registry_prefix_cache.get(self.owner, value, 2, 1000) is not None
                    for value in variants[:8]
                )
            )
            self.assertIsNone(unit.registry_prefix_cache.get(self.owner, variants[8], 2, 1000))
            with patch("app.tasks.verify_registry", wraps=tasks.verify_registry) as historical:
                self.assertEqual(
                    _response(unit, self.owner, variants[8], self.ids[0], 2), self.expected[0]
                )
                self.assertEqual(historical.call_count, 3)

        self.store.transact(read)

    def test_exact_encoded_byte_capacity_preserves_first_history_and_validates_misses(self):
        def read(unit):
            row = unit.get(self.vault_path)
            size = len(canonical_json(row["rootJwk"])) + len(canonical_json(row["registryHistory"]))
            changed = copy.deepcopy(row)
            payload = _signed_parts(changed["registryHistory"][0]["checkpoint"])[1]
            changed["registryHistory"][0]["checkpoint"] = self.f.fixture.sign(payload, "root")
            with patch.object(registry_reads, "MAX_PREFIX_BYTES", size):
                _verify_row(
                    row, self.owner, 1000, unit=unit, registry_cache=unit.registry_history_cache
                )
                _verify_row(
                    changed, self.owner, 1000, unit=unit, registry_cache=unit.registry_history_cache
                )
            self.assertIsNotNone(unit.registry_prefix_cache.get(self.owner, row, 2, 1000))
            self.assertIsNone(unit.registry_prefix_cache.get(self.owner, changed, 2, 1000))
            with patch("app.tasks.verify_registry", wraps=tasks.verify_registry) as historical:
                self.assertEqual(
                    _response(unit, self.owner, changed, self.ids[0], 2), self.expected[0]
                )
                self.assertEqual(historical.call_count, 3)

        self.store.transact(read)
