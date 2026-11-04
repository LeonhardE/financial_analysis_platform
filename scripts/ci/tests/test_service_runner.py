"""Verify suite selection and process isolation without executing application tests."""

import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from test_service_targets import write_registry_fixture

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
            patch.object(RUNNER, "run_parallel", return_value=True) as parallel,
            redirect_stdout(io.StringIO()),
        ):
            status = RUNNER.main()
        self.parallel_calls = parallel.call_args_list
        return status, run.call_args_list

    def assert_suites(self, calls, suites):
        self.assertEqual(len(calls), len(suites))
        for call, suite in zip(calls, suites, strict=True):
            directory = RUNNER.ROOT / "services" / suite
            self.assertEqual(
                call.args[0],
                [sys.executable, "-c", RUNNER.CHILD_RUNNER, str(directory / "tests")],
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
        self.assert_suites(calls, tuple(s for s in RUNNER.SERVICES if s != "agent-hub-service"))
        self.assertEqual(len(self.parallel_calls), 1)
        self.assertEqual(self.parallel_calls[0].args[0], RUNNER.ROOT / "services/agent-hub-service")
        self.assertEqual(self.parallel_calls[0].args[2], 4)

    def test_explicit_one_worker_reproduces_serial_execution_for_every_suite(self):
        status, calls = self.run_suites(["--jobs", "1"])
        self.assertEqual(status, 0)
        self.assert_suites(calls, RUNNER.SERVICES)
        self.assertEqual(self.parallel_calls, [])

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

    def test_parallel_failure_is_preserved_after_a_later_serial_success(self):
        with (
            patch.object(
                sys,
                "argv",
                [str(SCRIPT), "--service", "agent-hub-service", "--service", "user-service"],
            ),
            patch.object(RUNNER, "run_parallel", return_value=False),
            patch.object(RUNNER.subprocess, "run", return_value=SimpleNamespace(returncode=0)),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(RUNNER.main(), 1)

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

    def test_new_registered_backend_is_a_default_and_explicit_isolated_suite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_registry_fixture(root, extra_backend=True)
            with patch.object(RUNNER, "ROOT", root):
                status, calls = self.run_suites(
                    results=[SimpleNamespace(returncode=0)] * (len(RUNNER.SERVICES) + 1)
                )
                self.assertEqual(status, 0)
                self.assert_suites(
                    calls,
                    (
                        *(s for s in RUNNER.SERVICES if s != "agent-hub-service"),
                        "synthetic-service",
                    ),
                )
                status, calls = self.run_suites(["--service", "synthetic-service"])
                self.assertEqual(status, 0)
                self.assert_suites(calls, ("synthetic-service",))

    def test_invalid_registry_fails_before_any_suite_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_registry_fixture(root)
            (root / "scripts/service-targets.json").write_text("{broken")
            with patch.object(RUNNER, "ROOT", root), redirect_stderr(io.StringIO()):
                status, calls = self.run_suites()
            self.assertEqual(status, 1)
            self.assertEqual(calls, [])

    def test_actual_child_discovery_rejects_empty_and_failing_suites(self):
        import subprocess

        with tempfile.TemporaryDirectory() as directory:
            tests = Path(directory) / "tests"
            tests.mkdir()
            source = tests / "test_example.py"
            for contents, expected, message in (
                ("# Empty test module\n", 1, "Refusing an empty service test suite"),
                (
                    "import unittest\nclass Case(unittest.TestCase):\n"
                    " def test_it(self): self.skipTest('placeholder')\n",
                    1,
                    "Refusing an entirely skipped service test suite",
                ),
                (
                    "import unittest\nclass Case(unittest.TestCase):\n"
                    " def test_it(self): self.fail('failure')\n",
                    1,
                    "FAILED",
                ),
                (
                    "import unittest\nclass Case(unittest.TestCase):\n"
                    " def test_it(self): self.assertTrue(True)\n",
                    0,
                    "OK",
                ),
            ):
                source.write_text(contents)
                result = subprocess.run(
                    [sys.executable, "-B", "-c", RUNNER.CHILD_RUNNER, str(tests)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, expected)
                self.assertIn(message, result.stderr)


class ParallelRunnerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        (self.directory / "tests").mkdir()

    def source(self, name, body):
        (self.directory / "tests" / name).write_text(body)

    def run_parallel(self, jobs=2):
        with redirect_stdout(io.StringIO()) as output, redirect_stderr(io.StringIO()):
            passed = RUNNER.run_parallel(self.directory, dict(os.environ), jobs)
        return passed, output.getvalue()

    def test_modules_run_in_distinct_processes_and_keep_class_fixtures_together(self):
        source = (
            "import os, unittest\nfrom pathlib import Path\n"
            "class Case(unittest.TestCase):\n"
            " @classmethod\n def setUpClass(cls):\n  cls.pid = os.getpid()\n"
            " def test_first(self):\n  self.assertEqual(self.pid, os.getpid())\n"
            " def test_second(self):\n"
            "  self.assertEqual(self.pid, os.getpid())\n"
            "  Path(__file__ + '.pid').write_text(str(self.pid))\n"
        )
        for name in ("test_first.py", "test_second.py"):
            self.source(name, source)
        passed, output = self.run_parallel()
        self.assertTrue(passed)
        self.assertIn("Verified 4 discovered tests", output)
        pids = [p.read_text() for p in (self.directory / "tests").glob("*.pid")]
        self.assertEqual(len(set(pids)), 2)

    def test_empty_all_skipped_failure_and_import_failure_cannot_pass(self):
        for body in (
            "# No tests\n",
            "import unittest\nclass Case(unittest.TestCase):\n"
            " def test_it(self): self.skipTest('x')\n",
            "import unittest\nclass Case(unittest.TestCase):\n def test_it(self): self.fail('x')\n",
            "raise RuntimeError('cannot import')\n",
        ):
            with self.subTest(body=body):
                self.source("test_example.py", body)
                self.assertFalse(self.run_parallel()[0])

    def test_missing_or_duplicated_shard_coverage_fails_even_with_zero_exit_codes(self):
        for assigned in (([], []), (["case"], ["case"])):

            def child(command, assigned=assigned, **_kwargs):
                index = int(command[-3])
                Path(command[-1]).write_text(
                    json.dumps(
                        {
                            "expected": ["case"],
                            "assigned": assigned[index],
                            "run": len(assigned[index]),
                            "skipped": 0,
                            "successful": True,
                        }
                    )
                )
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(RUNNER.subprocess, "run", side_effect=child):
                self.assertFalse(self.run_parallel()[0])


if __name__ == "__main__":
    unittest.main()
