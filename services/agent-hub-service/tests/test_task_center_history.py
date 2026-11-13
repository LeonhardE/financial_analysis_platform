"""Legacy single-executor reports remain attributable without a current executor."""

import unittest

import test_persistent_results as results
import test_task_center_store as centers
from fixtures import UID
from test_oauth import TASK

from app.task_center_results import TaskCenterResultService


class TaskCenterHistoryTests(unittest.TestCase):
    control = centers.TaskCenterStoreTests.control

    def test_enrollment_pages_original_legacy_history_without_granting_new_execution(self):
        self.fxcase = results.PersistentResultTests()
        self.fxcase.setUp()
        self.addCleanup(self.fxcase.doCleanups)
        self.f, self.fx = self.fxcase.f, self.fxcase.fx
        receipt = self.fxcase.submit()
        self.owner = TaskCenterResultService(self.fx.store, clock=lambda: self.fx.now)
        self.serial = 0
        self.definition = self.control("set_rules")["definition"]
        state = self.owner.state(UID, self.f.vault, TASK)
        self.assertEqual(state["assignments"], [])
        page = self.owner.results(UID, self.f.vault, TASK, {"limit": 1, "cursor": None})
        self.assertEqual(page["items"][0]["metadata"]["resultId"], receipt["resultId"])
        self.assertIsNone(page["items"][0]["attribution"])
        self.assertEqual(page["items"][0]["triggerKind"], "legacy_unknown")
        self.assertIsNone(page["total"])
        following = self.owner.results(
            UID, self.f.vault, TASK, {"limit": 1, "cursor": page["nextCursor"]}
        )
        self.assertEqual(following["items"], [])
        self.assertIsNone(following["nextCursor"])
        self.assertEqual(
            self.fxcase.history.owner_get(UID, self.f.vault, receipt["resultId"])["receipt"],
            receipt,
        )
