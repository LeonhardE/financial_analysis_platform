"""Durable source fences, historical ACKs and transactional writer ordering."""

import copy
import json
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fixtures import OTHER_UID, UID

from app.fences import (
    MAX_FENCE_MUTATIONS,
    FenceService,
    fence_path,
    receipt_path,
    require_current_bindings,
)
from app.store import SQLiteHubStore, StoreUnavailable, document_path
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.identity import owner_key

OWNER = owner_key(UID)
OTHER_OWNER = owner_key(OTHER_UID)
REF = {
    "kind": "holdings",
    "sourceService": "portfolio",
    "resourceId": "synthetic_holdings_source",
    "incarnation": "synthetic_incarnation_one",
}


def mutation(number=1, **changes):
    return {
        "contractVersion": CONTRACT_VERSION,
        "ownerSubject": OWNER,
        "mutationId": f"synthetic_source_mutation_{number:04}",
        "ref": copy.deepcopy(REF),
        "expectedSourceEpoch": number,
        "newSourceEpoch": number + 1,
        "reason": "account_scope_changed",
        **changes,
    }


class FenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "hub.sqlite3"
        self.store = SQLiteHubStore(self.path)
        self.now = 1000
        self.service = FenceService(self.store, clock=lambda: self.now)

    def invalidate(self, value):
        return self.service.invalidate(value, source_service="portfolio")

    def fails(self, code, action):
        with self.assertRaises(ContractError) as error:
            action()
        self.assertEqual(error.exception.code, code)

    def row(self, path):
        return self.store.transact(lambda unit: unit.get(path))

    def binding(self, epoch=1, ref=None):
        return [{"ref": copy.deepcopy(ref or REF), "sourceEpoch": epoch}]

    def guarded_write(self, epoch=1, *, owner=OWNER, ref=None):
        path = document_path("hub_operations", owner, "synthetic_writer_probe")

        def write(unit):
            require_current_bindings(unit, owner, self.binding(epoch, ref))
            unit.put(path, {"sourceEpoch": epoch})

        self.store.transact(write)
        return self.row(path)

    def test_first_fence_and_exact_historical_ack_survive_restart_and_later_mutations(self):
        value = mutation()
        ack = self.invalidate(value)
        self.assertEqual(
            ack,
            {
                "contractVersion": CONTRACT_VERSION,
                "mutationId": value["mutationId"],
                "ref": REF,
                "acknowledgedSourceEpoch": 2,
                "acknowledgedAt": "1970-01-01T00:16:40Z",
            },
        )
        self.now = 2000
        later = self.invalidate(mutation(2))
        self.assertEqual(later["acknowledgedSourceEpoch"], 3)
        self.service = FenceService(SQLiteHubStore(self.path), clock=lambda: 9000)
        self.assertEqual(self.invalidate(dict(reversed(list(value.items())))), ack)
        self.assertEqual(self.row(fence_path(OWNER, REF))["sourceEpoch"], 3)
        self.assertEqual(
            self.row(receipt_path(OWNER, "portfolio", value["mutationId"]))["ack"], ack
        )

    def test_mutation_id_binds_full_owner_namespace_reference_epochs_and_reason(self):
        self.invalidate(mutation())
        changes = [
            {"ref": {**REF, "resourceId": "different_source"}},
            {"ref": {**REF, "incarnation": "different_incarnation"}},
            {"expectedSourceEpoch": 2, "newSourceEpoch": 3},
            {"reason": "disconnected"},
        ]
        for changed in changes:
            with self.subTest(fields=sorted(changed)):
                self.fails(
                    "idempotency_conflict",
                    lambda changed=changed: self.invalidate(mutation(**changed)),
                )
        # Owner namespaces are separate, using the already-derived hash exactly
        # once. The source callback has invalidate-only authority across owners.
        other = self.invalidate(mutation(ownerSubject=OTHER_OWNER))
        self.assertEqual(other["acknowledgedSourceEpoch"], 2)
        self.assertEqual(self.row(fence_path(OTHER_OWNER, REF))["ownerSubject"], OTHER_OWNER)

    def test_unknown_resource_has_only_initial_epoch_one_and_does_not_accept_jumps(self):
        for expected, new in ((0, 1), (2, 3), (1, 3), (4, 3)):
            with self.subTest(expected=expected):
                code = "version_conflict" if (expected, new) == (2, 3) else "malformed_request"
                self.fails(
                    code,
                    lambda expected=expected, new=new: self.invalidate(
                        mutation(expectedSourceEpoch=expected, newSourceEpoch=new)
                    ),
                )
        self.assertIsNone(self.row(fence_path(OWNER, REF)))
        self.invalidate(mutation())
        self.fails(
            "version_conflict",
            lambda: self.invalidate(mutation(mutationId="synthetic_other_mutation")),
        )

    def test_terminal_source_cannot_reactivate_and_new_incarnation_is_independent(self):
        first = self.invalidate(mutation(reason="disconnected"))
        self.fails("version_conflict", lambda: self.invalidate(mutation(2)))
        self.fails("version_conflict", lambda: self.guarded_write(2))
        self.invalidate(mutation(2, reason="deleted"))
        self.fails("version_conflict", lambda: self.invalidate(mutation(3)))
        self.fails("version_conflict", lambda: self.guarded_write(3))
        new_ref = {**REF, "incarnation": "synthetic_incarnation_two"}
        self.assertEqual(self.guarded_write(1, ref=new_ref), {"sourceEpoch": 1})
        self.invalidate(mutation(mutationId="synthetic_recreated_mutation", ref=new_ref))
        self.assertEqual(self.row(fence_path(OWNER, REF))["state"], "deleted")
        self.assertEqual(self.row(fence_path(OWNER, new_ref))["sourceEpoch"], 2)
        self.assertEqual(self.invalidate(mutation(reason="disconnected")), first)

    def test_schema_and_namespace_fail_closed_before_storage(self):
        cases = [
            {**mutation(), "unexpected": "synthetic-private-marker"},
            {**mutation(), "contractVersion": "v1"},
            mutation(ownerSubject=UID),
            mutation(ownerSubject=OWNER.upper()),
            mutation(expectedSourceEpoch=True),
            mutation(expectedSourceEpoch=1.0),
            mutation(newSourceEpoch=2.0),
            mutation(newSourceEpoch=9_007_199_254_740_992),
            mutation(mutationId="../operation"),
            mutation(ref={**REF, "incarnation": "../generation"}),
            mutation(ref={**REF, "owner": OWNER}),
            mutation(reason="reactivate"),
            mutation(reason=[]),
        ]
        for value in cases:
            with self.subTest(fields=list(value)):
                self.fails("malformed_request", lambda value=value: self.invalidate(value))
        other_namespace = {**REF, "kind": "watchlist", "sourceService": "user"}
        self.fails("insufficient_scope", lambda: self.invalidate(mutation(ref=other_namespace)))
        self.fails(
            "insufficient_scope",
            lambda: self.service.invalidate(mutation(), source_service="user"),
        )
        self.assertIsNone(self.row(fence_path(OWNER, REF)))

    def test_budget_retains_exact_receipts_and_reserves_disconnect_delete_slots(self):
        for number in range(1, MAX_FENCE_MUTATIONS - 1):
            self.invalidate(mutation(number))
        self.fails("version_conflict", lambda: self.invalidate(mutation(MAX_FENCE_MUTATIONS - 1)))
        self.invalidate(mutation(MAX_FENCE_MUTATIONS - 1, reason="disconnected"))
        self.invalidate(mutation(MAX_FENCE_MUTATIONS, reason="deleted"))
        self.assertEqual(self.row(fence_path(OWNER, REF))["mutationCount"], MAX_FENCE_MUTATIONS)
        self.assertEqual(self.invalidate(mutation())["acknowledgedSourceEpoch"], 2)

    def test_same_epoch_concurrent_mutations_accept_one_and_exact_duplicate_both_match(self):
        barrier = threading.Barrier(2)

        def apply(value):
            barrier.wait(timeout=5)
            try:
                return self.invalidate(value)
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    apply, [mutation(), mutation(mutationId="synthetic_competing_mutation_0001")]
                )
            )
        self.assertEqual(sum(type(result) is dict for result in results), 1)
        self.assertIn("version_conflict", results)
        winner = next(result for result in results if type(result) is dict)
        request = mutation(mutationId=winner["mutationId"])
        barrier = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as pool:
            duplicates = list(pool.map(apply, [request, request]))
        self.assertEqual(duplicates, [winner, winner])

    def test_source_precheck_before_fence_does_not_authorize_a_late_writer(self):
        # Synthetic fresh source check sees active epoch 1, outside the Hub
        # transaction. A completed fence before its writer must invalidate it.
        prechecked, allow_write = threading.Event(), threading.Event()

        def writer():
            prechecked.set()
            if not allow_write.wait(timeout=5):
                raise AssertionError("Writer barrier timed out")
            return self.guarded_write(1)

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(writer)
            self.assertTrue(prechecked.wait(timeout=5))
            self.invalidate(mutation())
            allow_write.set()
            with self.assertRaises(ContractError) as failure:
                future.result(timeout=5)
            self.assertEqual(failure.exception.code, "version_conflict")
        self.assertIsNone(
            self.row(document_path("hub_operations", OWNER, "synthetic_writer_probe"))
        )

    def test_writer_committed_before_fence_orders_before_ack_and_stays_historical(self):
        read_fence, allow_commit, attempting = (
            threading.Event(),
            threading.Event(),
            threading.Event(),
        )
        path = document_path("hub_operations", OWNER, "synthetic_writer_probe")

        def write(unit):
            require_current_bindings(unit, OWNER, self.binding())
            read_fence.set()
            if not allow_commit.wait(timeout=5):
                raise AssertionError("Commit barrier timed out")
            unit.put(path, {"sourceEpoch": 1})

        def fence():
            attempting.set()
            return self.invalidate(mutation())

        with ThreadPoolExecutor(max_workers=2) as pool:
            writer = pool.submit(self.store.transact, write)
            self.assertTrue(read_fence.wait(timeout=5))
            invalidator = pool.submit(fence)
            self.assertTrue(attempting.wait(timeout=5))
            self.assertFalse(invalidator.done())
            allow_commit.set()
            writer.result(timeout=5)
            self.assertEqual(invalidator.result(timeout=5)["acknowledgedSourceEpoch"], 2)
        self.assertEqual(self.row(path), {"sourceEpoch": 1})
        self.fails("version_conflict", lambda: self.guarded_write(1))
        self.assertEqual(self.guarded_write(2), {"sourceEpoch": 2})

    def test_fence_and_ack_failure_rolls_back_together_and_retry_needs_no_source_session(self):
        original = self.store.transact

        def fail_second(callback):
            def wrapped(unit):
                put = unit.put

                def failing(path, value):
                    if path.startswith("hub_fence_mutations/"):
                        raise sqlite3.OperationalError("synthetic database failure")
                    put(path, value)

                unit.put = failing
                return callback(unit)

            return original(wrapped)

        self.store.transact = fail_second
        with self.assertRaises(sqlite3.OperationalError):
            self.invalidate(mutation())
        self.store.transact = original
        self.assertIsNone(self.row(fence_path(OWNER, REF)))
        self.assertIsNone(self.row(receipt_path(OWNER, "portfolio", mutation()["mutationId"])))
        first = self.invalidate(mutation())
        # Simulate ACK loss / source crash before finalize: nothing at Hub is
        # repeated beyond the exact persistent ACK, including after restart.
        restarted = FenceService(SQLiteHubStore(self.path), clock=lambda: 9999)
        self.assertEqual(restarted.invalidate(mutation(), source_service="portfolio"), first)

    def test_guard_validates_bindings_owner_and_fails_closed_on_corrupt_persistent_rows(self):
        for bindings in (self.binding(True), self.binding(1.0), self.binding() * 2, None):
            self.fails(
                "malformed_request",
                lambda bindings=bindings: self.store.transact(
                    lambda unit: require_current_bindings(unit, OWNER, bindings)
                ),
            )
        self.store.transact(lambda unit: require_current_bindings(unit, OWNER, []))
        self.invalidate(mutation())
        self.assertEqual(self.guarded_write(1, owner=OTHER_OWNER), {"sourceEpoch": 1})
        row = self.row(fence_path(OWNER, REF))
        self.store.transact(
            lambda unit: unit.put(fence_path(OWNER, REF), {**row, "sourceEpoch": 1})
        )
        with self.assertRaises(StoreUnavailable):
            self.guarded_write(1)

    def test_corrupt_receipt_never_mints_an_alternate_ack(self):
        self.invalidate(mutation())
        path = receipt_path(OWNER, "portfolio", mutation()["mutationId"])
        saved = self.row(path)
        for changed in (
            {**saved, "fingerprint": "incorrect"},
            {**saved, "ack": {**saved["ack"], "acknowledgedAt": "not-a-timestampZ"}},
            {**saved, "ack": {**saved["ack"], "acknowledgedSourceEpoch": 3}},
        ):
            self.store.transact(lambda unit, changed=changed: unit.put(path, changed))
            with self.assertRaises(StoreUnavailable):
                self.invalidate(mutation())
        self.assertNotIn(UID, json.dumps(saved))

    def test_bad_clock_rolls_back_without_persistent_metadata(self):
        for now in (True, float("inf"), float("nan"), -1, 253402300800):
            self.service.clock = lambda now=now: now
            with self.assertRaises(StoreUnavailable):
                self.invalidate(mutation())
        self.assertIsNone(self.row(fence_path(OWNER, REF)))
