"""Real SDK snapshot reuse, isolation, stream refusal and fresh conflict retries."""

import copy
import unittest
from unittest.mock import patch

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1.types import Value
from test_firestore_store import MemoryRpc

from app.store import FirestoreHubStore, FirestoreTransaction, StoreUnavailable, document_path


class TransactionReadReuseTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        self.a = self.seed("a", {"nested": {"active": True}})
        self.b = self.seed("b", {"nested": {"active": False}})

    def seed(self, name, value):
        path = document_path("hub_tasks", name)
        self.rpc.documents[self.client.document(path)._document_path] = copy.deepcopy(value)
        return path

    def reads(self):
        return [kw["request"]["documents"] for kind, kw in self.rpc.calls if kind == "get"]

    def test_full_batch_and_single_reads_share_snapshot_but_not_mutable_values(self):
        missing = document_path("hub_tasks", "missing")

        def read(unit):
            first = unit.get(self.a)
            first["nested"]["active"] = False
            rows = unit.get_many([self.a, self.b, missing])
            self.assertTrue(rows[self.a]["nested"]["active"])
            rows[self.a]["nested"]["active"] = False
            self.assertTrue(unit.get(self.a)["nested"]["active"])
            self.assertFalse(unit.get(self.b)["nested"]["active"])
            self.assertIsNone(unit.get(missing))
            self.assertEqual(unit.get_many([missing]), {missing: None})

        self.store.transact(read)
        self.assertEqual([len(batch) for batch in self.reads()], [1, 2])
        self.store.transact(lambda unit: unit.get(self.a))
        self.assertEqual(len(self.reads()), 3)

    def test_projection_order_is_coalesced_without_becoming_a_full_document(self):
        fields = ["ownerSubject", "resultId", "revision", "receipt"]
        path = self.seed("projection", {**dict.fromkeys(fields, "synthetic"), "opaque": "kept"})

        def read(unit):
            projected = unit.get_many([path], field_paths=fields)[path]
            self.assertNotIn("opaque", projected)
            projected["receipt"] = "changed"
            self.assertEqual(
                unit.get_many([path], field_paths=list(reversed(fields)))[path]["receipt"],
                "synthetic",
            )
            self.assertEqual(unit.get(path)["opaque"], "kept")
            self.assertEqual(unit.get_many([path])[path]["opaque"], "kept")

        self.store.transact(read)
        self.assertEqual(len(self.reads()), 2)
        self.rpc.calls.clear()
        self.store.transact(
            lambda unit: (unit.get(path), unit.get_many([path], field_paths=fields))
        )
        self.assertEqual(len(self.reads()), 2)

    def test_conflict_attempt_and_next_request_reread_current_revocation(self):
        seen = []
        name = self.client.document(self.a)._document_path
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.rpc.documents[name]["nested"].update(active=False)

        def read(unit):
            seen.append(unit.get(self.a)["nested"]["active"])
            self.assertEqual(unit.get_many([self.a])[self.a]["nested"]["active"], seen[-1])

        self.store.transact(read)
        self.assertEqual(seen, [True, False])
        self.assertEqual(len(self.reads()), 2)
        self.rpc.documents[name]["nested"]["active"] = True
        self.assertTrue(self.store.transact(lambda unit: unit.get(self.a))["nested"]["active"])
        self.assertEqual(len(self.reads()), 3)

    def test_pending_writes_do_not_replace_the_attempt_snapshot(self):
        def write(unit):
            self.assertTrue(unit.get(self.a)["nested"]["active"])
            unit.put(self.a, {"nested": {"active": False}})
            self.assertTrue(unit.get(self.a)["nested"]["active"])
            self.assertTrue(unit.get_many([self.a])[self.a]["nested"]["active"])

        self.store.transact(write)
        self.assertEqual(len(self.reads()), 1)
        self.assertFalse(self.store.transact(lambda unit: unit.get(self.a))["nested"]["active"])

    def test_incomplete_duplicate_or_malformed_stream_is_not_partially_remembered(self):
        original = self.rpc.batch_get_documents
        for mode in ("incomplete", "duplicate", "malformed", "unexpected"):
            with self.subTest(mode=mode):
                self.rpc.calls.clear()

                def broken(mode=mode, **kwargs):
                    rows = list(original(**kwargs))
                    if mode == "incomplete":
                        return iter(rows[:1])
                    if mode == "duplicate":
                        return iter([rows[0], rows[0]])
                    if mode == "unexpected":
                        rows[-1].found.name = self.client.document(
                            document_path("hub_tasks", "unrequested")
                        )._document_path
                    else:
                        # Bad storage type is rejected before any cache admission.
                        rows[-1].found.fields["invalid"] = Value(bytes_value=b"not json")
                    return iter(rows)

                def read(unit, mode=mode):
                    self.rpc.batch_get_documents = broken
                    try:
                        # The SDK itself rejects an unexpected document name.
                        expected = ValueError if mode == "unexpected" else StoreUnavailable
                        with self.assertRaises(expected):
                            unit.get_many([self.a, self.b])
                    finally:
                        self.rpc.batch_get_documents = original
                    unit.get_many([self.a, self.b])

                self.store.transact(read)
                self.assertEqual([len(batch) for batch in self.reads()], [2, 2])

    def test_entries_and_bytes_are_bounded_without_skipping_uncached_reads(self):
        paths = [self.seed(f"entry-{i}", {"value": i}) for i in range(129)]

        def entries(unit):
            unit.get_many(paths)
            self.assertEqual(len(unit._reads), 128)
            unit.get(paths[-1])

        self.store.transact(entries)
        self.assertEqual([len(batch) for batch in self.reads()], [128, 1, 1])
        self.rpc.calls.clear()
        paths = [self.seed(f"large-{i}", {"opaque": "a" * 700000}) for i in range(13)]

        def bytes_limit(unit):
            unit.get_many(paths)
            self.assertLessEqual(unit._read_bytes, 8 * 1024 * 1024)
            self.assertLess(len(unit._reads), len(paths))
            unit.get(paths[-1])

        self.store.transact(bytes_limit)
        self.assertEqual([len(batch) for batch in self.reads()], [13, 1])

    def test_actual_provider_state_is_identical_with_adapter_memoization_enabled_or_disabled(self):
        from test_provider_slot_store import ProviderConnectionTests

        from folioview_shared.encrypted.jsonutil import strict_json_loads

        fixture = ProviderConnectionTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        packet, operation = fixture.packet()
        fixture.apply(packet, operation)
        connection = fixture.store.connect()
        try:
            for path, body in connection.execute("SELECT path, body FROM hub_documents"):
                self.rpc.documents[self.client.document(path)._document_path] = strict_json_loads(
                    body
                )
        finally:
            connection.close()
        fixture.service.store = self.store
        self.rpc.calls.clear()
        with patch.object(FirestoreTransaction, "_remember", lambda *args: None):
            before = fixture.state()
        previous_reads = len(self.reads())
        self.rpc.calls.clear()
        after = fixture.state()
        self.assertEqual(after, before)
        self.assertEqual(len(self.reads()), previous_reads)
        self.assertEqual(
            len(self.reads()), 3
        )  # Explicit provider-state batches now own this bound.
        documents = [name for batch in self.reads() for name in batch]
        self.assertEqual(len(documents), len(set(documents)))

    def test_identical_signature_history_is_verified_once_but_rows_and_time_stay_checked(self):
        from fixtures import BOOT, UID, VaultFixture

        from app.vaults import VaultService, _current, verify_registry
        from folioview_shared.encrypted.errors import ContractError

        fixture = VaultFixture()
        service = VaultService(self.store, clock=lambda: 1000)
        service.bootstrap(UID, fixture.bootstrap(), BOOT)
        with patch("app.vaults.verify_registry", wraps=verify_registry) as verify:

            def read(unit):
                first = _current(unit, fixture.owner, 1000)
                self.assertIs(_current(unit, fixture.owner, 1000)[1], first[1])
                with self.assertRaises(ContractError):
                    _current(unit, fixture.owner, 0)
                # Signature reuse does not bypass independent row validation.
                row = first[0]
                row["operationCount"] = 0
                from app.vaults import _verify_row

                with self.assertRaises(StoreUnavailable):
                    _verify_row(
                        row,
                        fixture.owner,
                        1000,
                        unit=unit,
                        registry_cache=unit.registry_history_cache,
                    )
                row = copy.deepcopy(first[0])
                row["operationCount"] = 1
                row["registryHistory"][0]["checkpoint"]["signature"] = "A" * 86
                with self.assertRaises(ContractError):
                    _verify_row(
                        row,
                        fixture.owner,
                        1000,
                        unit=unit,
                        registry_cache=unit.registry_history_cache,
                    )

            self.store.transact(read)
            self.assertEqual(verify.call_count, 2)  # valid history plus tampered history
            self.store.transact(lambda unit: _current(unit, fixture.owner, 1000))
            self.assertEqual(verify.call_count, 3)
