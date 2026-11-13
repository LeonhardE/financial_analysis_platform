"""Real signed lifecycle races and retention cleanup, entirely synthetic/local."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import test_task_center_store as center_tests
from fixtures import OTHER_UID, UID
from test_oauth import TASK

from app.persistent_execution import run_path
from app.store import document_path
from app.task_lifecycle_service import TaskLifecycleService
from folioview_shared.encrypted.errors import ContractError


class TaskLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.fx = center_tests.TaskCenterStoreTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.f = self.fx.f
        self.owner = TaskLifecycleService(self.fx.store, clock=lambda: self.fx.fx.now)
        self.fx.owner = self.owner

    def lifecycle(self, action):
        receipt = self.fx.control(action)
        self.fx.definition = receipt["definition"]
        return receipt

    def test_trash_hides_all_actor_history_and_legacy_task_links_restore_is_inert(self):
        one = self.fx.submit(self.fx.begin())
        pending = self.fx.begin("pending_lifecycle_base_trigger_001")
        self.fx.use(self.fx.second)
        self.fx.submit(self.fx.begin())
        self.lifecycle("trash")
        self.assertEqual(self.fx.p.tasks.list(UID)["items"], [])
        self.assertEqual(self.fx.history.owner_list(UID, self.f.vault)["items"], [])
        for read in [
            lambda: self.fx.p.tasks.get(UID, TASK),
            lambda: self.fx.history.owner_get(UID, self.f.vault, one["resultId"]),
            lambda: self.owner.results(UID, self.f.vault, TASK, {"limit": 20, "cursor": None}),
            lambda: self.fx.submit(pending),
            lambda: self.fx.begin("late_lifecycle_base_trigger_001"),
        ]:
            with self.assertRaises(ContractError):
                read()
        self.assertTrue(self.owner.trash(UID, self.f.vault)["items"][0]["canRestore"])
        self.lifecycle("restore")
        self.assertEqual(
            len(
                self.owner.results(UID, self.f.vault, TASK, {"limit": 20, "cursor": None})["items"]
            ),
            2,
        )
        self.assertEqual(
            self.fx.history.owner_get(UID, self.f.vault, one["resultId"])["receipt"], one
        )
        with self.assertRaises(ContractError):
            self.fx.begin()
        self.assertTrue(
            all(
                not a["plan"]["currentAssignment"]
                for a in self.owner.state(UID, self.f.vault, TASK)["assignments"]
            )
        )

    def test_original_command_retry_cannot_retrash_or_restore(self):
        original = self.lifecycle("trash")
        packet, op = self.fx.last_signed, self.fx.last_op
        self.lifecycle("restore")
        self.assertEqual(self.owner.command(UID, self.f.vault, TASK, packet, op), original)
        self.assertEqual(len(self.fx.p.tasks.list(UID)["items"]), 1)
        with self.assertRaises(ContractError):
            self.owner.command(OTHER_UID, self.f.vault, TASK, packet, op)

    @patch("folioview_shared.encrypted.task_center.TRASH_RETENTION_SECONDS", 10)
    def test_restore_deadline_and_bounded_idempotent_retention_without_new_jobs(self):
        saved = self.fx.submit(self.fx.begin())
        # Cleanup must not retire another task or Owner's copies.
        from app.tasks import _paths

        original = self.fx.store.transact(
            lambda u: u.get(_paths(self.f.owner, self.f.vault, TASK, 1))
        )
        foreign = {**original, "ownerSubject": "synthetic_foreign_owner"}
        foreign_path = _paths("synthetic_foreign_owner", self.f.vault, TASK, 1)
        other = {**original, "metadata": {**original["metadata"], "taskId": "another_task"}}
        other_path = _paths(self.f.owner, self.f.vault, "another_task", 1)
        self.fx.store.transact(lambda u: [u.put(foreign_path, foreign), u.put(other_path, other)])
        self.lifecycle("trash")
        self.fx.fx.now = self.fx.definition["purgeAfter"]
        with self.assertRaises(ContractError):
            self.lifecycle("restore")
        with self.assertRaises(ContractError):
            self.owner.maintenance(OTHER_UID, self.f.vault, TASK)
        for _ in range(100):
            progress = self.owner.maintenance(UID, self.f.vault, TASK)
            if progress["complete"]:
                break
        self.assertTrue(progress["complete"])
        self.assertEqual(self.fx.store.transact(lambda u: u.get(other_path)), other)
        self.assertEqual(self.fx.store.transact(lambda u: u.get(foreign_path)), foreign)
        self.assertEqual(progress, self.owner.maintenance(UID, self.f.vault, TASK))
        blob = self.fx.store.transact(
            lambda u: u.get(
                document_path(
                    "hub_persistent_result_content", self.f.owner, self.f.vault, saved["resultId"]
                )
            )
        )
        self.assertEqual(blob, {"retiredTaskContent": True})
        # The independently encrypted shared source is retained for other tasks.
        with self.assertRaises(ContractError):
            self.fx.history.owner_get(UID, self.f.vault, saved["resultId"])
        self.lifecycle("purge")
        self.assertFalse(self.owner.trash(UID, self.f.vault)["items"][0]["canRestore"])

    def test_begin_trash_race_cannot_leave_a_usable_run(self):
        def begin():
            try:
                return self.fx.begin()
            except ContractError:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            pending = pool.submit(begin)
            self.lifecycle("trash")
            run = pending.result()
        if run is not None:
            self.assertIsNotNone(
                self.fx.store.transact(
                    lambda u: u.get(run_path(self.f.owner, self.f.vault, run["manifest"]["runId"]))
                )
            )
            with self.assertRaises(ContractError):
                self.fx.submit(run)
        self.assertEqual(self.fx.p.tasks.list(UID)["items"], [])
