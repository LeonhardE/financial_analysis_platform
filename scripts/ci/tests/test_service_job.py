"""Registry-driven job execution and exact Actions matrix evidence, without networking."""

import copy
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service_job  # noqa: E402
from test_service_targets import write_registry_fixture  # noqa: E402


def child(identifier, service="synthetic-service"):
    return {
        "id": identifier,
        "name": f"Service checks ({service})",
        "status": "completed",
        "conclusion": "success",
        "steps": [
            {"name": name, "status": "completed", "conclusion": "success"}
            for name in service_job.REQUIRED_STEPS
        ],
    }


class MatrixEvidenceTests(unittest.TestCase):
    def verify(self, jobs, *, selected=("synthetic-service",), fetch=None, **kwargs):
        page = {"total_count": len(jobs), "jobs": jobs}
        return service_job.verify_backend_jobs(
            selected,
            repository="owner/repo",
            run_id="123",
            attempt="2",
            fetch=fetch or (lambda path: page),
            **kwargs,
        )

    def test_exact_selected_children_and_critical_steps_succeed(self):
        jobs = [
            child(1),
            child(2, "user-service"),
            {"id": 3, "name": "Quality checks", "status": "in_progress"},
        ]
        self.verify(jobs, selected=("synthetic-service", "user-service"))
        fetch = unittest.mock.Mock(side_effect=AssertionError("Unexpected HTTP request"))
        service_job.verify_backend_jobs((), fetch=fetch)
        fetch.assert_not_called()

    def test_missing_duplicate_and_unselected_children_fail_closed(self):
        for jobs in (
            [],
            [child(1), child(2)],
            [child(1, "wrong-service")],
            [child(1), child(2, "extra-service")],
        ):
            with self.subTest(jobs=jobs), self.assertRaises(service_job.MatrixEvidenceError):
                self.verify(jobs)
        for selected in (("synthetic-service", "synthetic-service"), (["bad"],)):
            with self.assertRaises(service_job.MatrixEvidenceError):
                self.verify([child(1)], selected=selected)

    def test_failed_cancelled_skipped_and_incomplete_child_or_step_cannot_pass(self):
        for value in ("failure", "cancelled", "skipped", None):
            job = child(1)
            job["conclusion"] = value
            with self.subTest(value=value), self.assertRaises(service_job.MatrixEvidenceError):
                self.verify([job])
            for index in range(3):
                job = child(1)
                job["steps"][index]["conclusion"] = value
                with self.assertRaises(service_job.MatrixEvidenceError):
                    self.verify([job])
        job = child(1)
        job["status"] = "in_progress"
        with self.assertRaises(service_job.MatrixEvidenceError):
            self.verify([job])
        for mutation in ("missing", "duplicate", "incomplete"):
            job = child(1)
            if mutation == "missing":
                job["steps"].pop()
            elif mutation == "duplicate":
                job["steps"].append(copy.deepcopy(job["steps"][0]))
            else:
                job["steps"][0]["status"] = "in_progress"
            with self.assertRaises(service_job.MatrixEvidenceError):
                self.verify([job])

    def test_paginated_current_attempt_evidence_is_complete_and_bounded(self):
        first = [{"id": number, "name": f"Other job {number}"} for number in range(1, 101)]
        paths = []

        def fetch(path):
            paths.append(path)
            return {"total_count": 101, "jobs": first if len(paths) == 1 else [child(101)]}

        self.verify([], fetch=fetch)
        self.assertEqual(len(paths), 2)
        self.assertTrue(paths[0].endswith("/actions/runs/123/attempts/2/jobs?per_page=100&page=1"))
        self.assertTrue(paths[1].endswith("page=2"))
        for invalid in (
            {"total_count": 1001, "jobs": [child(1)]},
            {"total_count": True, "jobs": [child(1)]},
            {"total_count": 2, "jobs": [child(1), child(1)]},
            {"total_count": 1, "jobs": [None]},
        ):
            with self.assertRaises(service_job.MatrixEvidenceError):
                self.verify([], fetch=lambda path, invalid=invalid: invalid)
        calls = iter([{"total_count": 101, "jobs": first}, {"total_count": 101, "jobs": []}])
        with self.assertRaises(service_job.MatrixEvidenceError):
            self.verify([], fetch=lambda path: next(calls))

    def test_api_context_and_transport_failures_never_leak_credentials(self):
        for field, value in (
            ("repository", "../owner/repo"),
            ("run_id", "123/other"),
            ("attempt", "0"),
        ):
            values = {"repository": "owner/repo", "run_id": "123", "attempt": "1", field: value}
            with self.assertRaises(service_job.MatrixEvidenceError):
                service_job.verify_backend_jobs(
                    ("synthetic-service",), fetch=lambda path: {}, **values
                )

        def failing(path):
            raise RuntimeError("private-token-secret")

        with self.assertRaises(service_job.MatrixEvidenceError) as error:
            self.verify([], fetch=failing)
        self.assertNotIn("private-token-secret", str(error.exception))


class RegisteredJobTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        write_registry_fixture(self.root, extra_backend=True)
        self.patch_root = patch.object(service_job, "ROOT", self.root)
        self.patch_root.start()
        self.addCleanup(self.patch_root.stop)

    def test_metadata_comes_from_registration_and_preserves_output_protocol(self):
        output = self.root / "outputs"
        output.write_text("existing=value\n")
        with patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}):
            service_job.write_metadata("synthetic-service")
        self.assertEqual(
            output.read_text(),
            (
                "existing=value\ndirectory=services/synthetic-service\n"
                "dockerfile=services/synthetic-service/Dockerfile\n"
                "requirements_dev=services/synthetic-service/requirements-dev.txt\n"
                "ruff_config=\ntests=services/synthetic-service/tests\n"
            ),
        )

    def test_optional_service_lint_config_is_not_required_or_silently_skipped(self):
        for has_config in (False, True):
            if has_config:
                (self.root / "services/synthetic-service/pyproject.toml").write_text(
                    "[tool.ruff]\n"
                )
            with patch.object(service_job.subprocess, "run") as run:
                service_job.check_target("synthetic-service")
            self.assertEqual(run.call_count, 5 if has_config else 3)
            self.assertEqual(
                run.call_args.args[0][-4:],
                ["--service", "common", "--service", "synthetic-service"],
            )
            self.assertTrue(all(call.kwargs["check"] for call in run.call_args_list))

    def test_workflow_uses_registered_metadata_and_required_current_attempt_gate(self):
        workflow = (Path(__file__).resolve().parents[3] / ".github/workflows/ci.yml").read_text()
        self.assertIn('service_job.py metadata "$SERVICE"', workflow)
        self.assertIn('service_job.py check "$SERVICE"', workflow)
        self.assertIn('docker build --file "$DOCKERFILE"', workflow)
        self.assertIn("--network none", workflow)
        self.assertIn("checks.py gate --verify-matrix", workflow)
        self.assertIn("actions: read", workflow)


if __name__ == "__main__":
    unittest.main()
