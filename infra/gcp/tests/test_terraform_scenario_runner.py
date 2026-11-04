"""Independent fixture scenarios run concurrently without losing failures or report order."""

import importlib.util
import threading
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "terraform/compatibility/scenario_runner.py"
SPEC = importlib.util.spec_from_file_location("terraform_scenario_runner", SCRIPT)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class ScenarioRunnerTests(unittest.TestCase):
    def test_concurrency_preserves_every_result_and_input_order(self):
        barrier = threading.Barrier(2, timeout=5)

        def case(number):
            barrier.wait()
            return number

        self.assertEqual(RUNNER.run_scenarios([lambda: case(1), lambda: case(2)], 2), [1, 2])

    def test_one_scenario_failure_fails_the_report(self):
        def fail():
            raise AssertionError("scenario failed")

        with self.assertRaisesRegex(AssertionError, "scenario failed"):
            RUNNER.run_scenarios([lambda: "passed", fail], 2)

    def test_invalid_concurrency_is_rejected(self):
        for jobs in (0, 9, True, "2"):
            with self.assertRaises(ValueError):
                RUNNER.run_scenarios([], jobs)
