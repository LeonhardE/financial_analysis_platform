"""Actual Firestore SDK owner reads, batched metadata and state/revision races."""

import unittest

import test_inbox as domain
import test_result_firestore as fixtures
from fixtures import UID

from app.inbox import InboxService
from app.store import StoreUnavailable, document_path
from folioview_shared.encrypted.errors import ContractError


class InboxFirestoreTests(unittest.TestCase):
    command = domain.InboxTests.command
    state = domain.InboxTests.state
    new_result = domain.InboxTests.new_result
    revise = domain.InboxTests.revise
    advance_registry = domain.InboxTests.advance_registry

    def setUp(self):
        self.case = fixtures.ResultFirestoreTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.base = self.case.case
        self.receipt, _ = self.case.submit()
        self.result_id, self.run_id = self.case.result_id, self.case.run_id
        self.inbox = InboxService(self.base.store, clock=lambda: self.base.now)
        self.base.rpc.calls.clear()

    def test_metadata_scan_batches_heads_accepts_reordered_stream_and_missing_head_fails(self):
        self.new_result("sdk_two")
        self.new_result("sdk_three")
        self.base.rpc.calls.clear()
        original = self.base.rpc.batch_get_documents

        def reverse(**kwargs):
            return iter(reversed(list(original(**kwargs))))

        self.base.rpc.batch_get_documents = reverse
        page = self.inbox.list(UID, limit=1)
        self.assertIsNotNone(page["nextCursor"])
        requested = [
            kwargs["request"]["documents"] for name, kwargs in self.base.rpc.calls if name == "get"
        ]
        batches = [names for names in requested if len(names) > 1]
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(batches[0]), 3)
        self.assertTrue(all("/hub_results/" in name for name in batches[0]))
        self.assertFalse(
            any(
                "/hub_result_revisions/" in name or "/hub_runs/" in name
                for names in requested
                for name in names
            )
        )
        self.assertEqual(
            {
                w.update.name.split("/documents/")[1].split("/")[0]
                for batch in self.base.batches()
                for w in batch
            },
            {"hub_inbox_cursors"},
        )
        history = self.inbox.history(UID, self.result_id, limit=1)
        self.assertNotIn("signedObject", str(history))
        masks = [
            kwargs["request"].get("mask", {})
            for name, kwargs in self.base.rpc.calls
            if name == "get" and kwargs["request"].get("mask")
        ]
        self.assertEqual(len(masks), 1)
        self.assertEqual(
            set(masks[0].field_paths), {"ownerSubject", "resultId", "revision", "receipt"}
        )
        victim = self.base.client.document(
            document_path("hub_results", self.base.fix.owner, self.result_id)
        )._document_path
        self.base.rpc.documents.pop(victim)
        with self.assertRaises(StoreUnavailable):
            self.inbox.counts(UID)

    def test_state_and_original_ack_are_one_atomic_batch_and_survive_restart(self):
        packet = self.command(starred=True)
        ack = self.state(packet)
        batches = self.base.batches()
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(batches[0]), 2)
        self.assertEqual(
            {w.update.name.split("/documents/")[1].split("/")[0] for w in batches[0]},
            {"hub_results", "hub_result_state_operations"},
        )
        restarted = InboxService(self.base.store, clock=lambda: self.base.now)
        self.assertEqual(
            restarted.state(
                UID, self.result_id, packet, domain.OP, self.base.fix.kid("device_sig")
            ),
            ack,
        )
        self.assertEqual(restarted.get(UID, self.result_id)["metadata"], ack)
        self.assertEqual(
            self.case.results.receipt(self.case.token, self.run_id, fixtures.result_fixtures.OP),
            self.receipt,
        )

    def test_same_operation_commit_collision_recovers_winner_without_double_state_bump(self):
        packet = self.command()
        winner = []
        self.base.inject(lambda: winner.append(self.state(packet)))
        ack = self.state(packet)
        self.assertEqual(ack, winner[0])
        self.assertEqual(ack["stateVersion"], 1)
        operations = self.base.store.transact(
            lambda u: u.get(
                document_path(
                    "hub_result_state_operations",
                    self.base.fix.owner,
                    self.base.fix.vault,
                    self.result_id,
                )
            )
        )
        self.assertEqual(len(operations["operations"]), 1)

    def test_competing_state_operations_retry_cas_without_lost_star_or_read(self):
        winner_op, loser_op = domain.OP + "winner", domain.OP + "loser"
        winner = self.command(operation=winner_op, starred=True)
        loser = self.command(operation=loser_op, read=True)
        accepted = []
        self.base.inject(lambda: accepted.append(self.state(winner, operation=winner_op)))
        with self.assertRaises(ContractError) as caught:
            self.state(loser, operation=loser_op)
        self.assertEqual(caught.exception.code, "version_conflict")
        latest = self.inbox.get(UID, self.result_id)["metadata"]
        self.assertEqual(latest, accepted[0])
        self.assertTrue(latest["starred"])
        self.assertFalse(latest["read"])

    def test_content_revision_and_state_share_head_conflicts_in_both_commit_orders(self):
        state_packet = self.command(read=True)
        self.base.inject(lambda: self.revise(2))
        with self.assertRaises(ContractError) as caught:
            self.state(state_packet)
        self.assertEqual(caught.exception.code, "version_conflict")
        latest = self.inbox.get(UID, self.result_id)["metadata"]
        self.assertEqual(
            (latest["revision"], latest["stateVersion"], latest["read"]), (2, 1, False)
        )
        operation = domain.OP + "before_revision"
        state_packet = self.command(operation=operation, expected=1, starred=True)
        self.base.inject(lambda: self.state(state_packet, operation=operation))
        self.revise(3)
        latest = self.inbox.get(UID, self.result_id)["metadata"]
        self.assertEqual(
            (latest["revision"], latest["stateVersion"], latest["read"], latest["starred"]),
            (3, 3, False, True),
        )
        self.assertEqual(latest["receivedAt"], self.receipt["receivedAt"])

    def test_current_device_revocation_during_control_write_retries_and_refuses(self):
        packet = self.command()
        self.base.inject(lambda: self.advance_registry(revoked=("device_sig",)))
        with self.assertRaises(ContractError):
            self.state(packet)
        self.assertFalse(self.inbox.get(UID, self.result_id)["metadata"]["read"])
        self.assertFalse(
            any("/hub_result_state_operations/" in name for name in self.base.rpc.documents)
        )
