"""Verify suite selection and process isolation without executing application tests."""

import importlib.util
import io
import os
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "test_services.py"
SPEC = importlib.util.spec_from_file_location("service_runner", SCRIPT)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class ServiceRunnerTests(unittest.TestCase):
    def run_suites(self, arguments=(), results=None):
        results = results or [SimpleNamespace(returncode=0)] * len(RUNNER.SERVICES)
        with (
            patch.object(sys, "argv", [str(SCRIPT), *arguments]),
            patch.object(RUNNER.subprocess, "run", side_effect=results) as run,
            redirect_stdout(io.StringIO()),
        ):
            status = RUNNER.main()
        return status, run.call_args_list

    def assert_suites(self, calls, suites):
        self.assertEqual(len(calls), len(suites))
        for call, suite in zip(calls, suites, strict=True):
            directory = RUNNER.ROOT / "services" / suite
            self.assertEqual(
                call.args[0],
                [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            )
            self.assertEqual(call.kwargs["cwd"], directory)
            self.assertEqual(
                call.kwargs["env"]["PYTHONPATH"],
                os.pathsep.join((str(RUNNER.ROOT / "services" / "common"), str(directory))),
            )
            self.assertIs(call.kwargs["check"], False)

    def test_default_runs_every_suite_in_its_own_process(self):
        status, calls = self.run_suites()
        self.assertEqual(status, 0)
        self.assert_suites(
            calls, ("common", "market-data-service", "user-service", "config-service")
        )

    def test_explicit_shared_and_user_selection_never_runs_other_services(self):
        status, calls = self.run_suites(
            ["--service", "common", "--service", "user-service", "--service", "common"]
        )
        self.assertEqual(status, 0)
        self.assert_suites(calls, ("common", "user-service"))

    def test_failure_is_preserved_after_a_later_success(self):
        status, calls = self.run_suites(
            ["--service", "common", "--service", "user-service"],
            [SimpleNamespace(returncode=1), SimpleNamespace(returncode=0)],
        )
        self.assertEqual(status, 1)
        self.assert_suites(calls, ("common", "user-service"))

    def test_unknown_service_is_rejected_before_starting_any_process(self):
        with (
            patch.object(sys, "argv", [str(SCRIPT), "--service", "unregistered"]),
            patch.object(RUNNER.subprocess, "run") as run,
            redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as exit_result,
        ):
            RUNNER.main()
        self.assertEqual(exit_result.exception.code, 2)
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
