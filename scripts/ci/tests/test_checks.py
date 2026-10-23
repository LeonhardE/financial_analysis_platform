"""Exercise target ownership, real Git comparisons, and the required CI gate."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from checks import FULL, SERVICES, Plan, changed_paths, detect, select, validate_gate  # noqa: E402


class SelectionTests(unittest.TestCase):
    def test_leaf_changes_select_only_their_owner(self):
        self.assertEqual(select(["apps/web/app/page.tsx"]), Plan(web=True))
        for service in SERVICES:
            with self.subTest(service=service):
                self.assertEqual(
                    select([f"services/{service}/app/main.py"]), Plan(services=(service,))
                )

    def test_service_dependencies_tests_and_images_keep_the_same_owner(self):
        for service in SERVICES:
            for file in (
                "requirements.txt",
                "requirements-dev.txt",
                "Dockerfile",
                "tests/test_x.py",
            ):
                with self.subTest(service=service, file=file):
                    self.assertEqual(
                        select([f"services/{service}/{file}"]), Plan(services=(service,))
                    )

    def test_shared_python_checks_all_backends_without_web(self):
        for path in (
            "services/common/folioview_shared/http.py",
            "services/common/pyproject.toml",
            "services/common/tests/test_http.py",
            "services/requirements-dev.txt",
        ):
            with self.subTest(path=path):
                self.assertEqual(select([path]), Plan(services=SERVICES))

    def test_shared_runner_also_selects_its_repository_lint_checks(self):
        self.assertEqual(select(["scripts/test_services.py"]), Plan(services=SERVICES, infra=True))

    def test_global_ruff_config_also_checks_repository_python(self):
        self.assertEqual(
            select(["services/market-data-service/pyproject.toml"]),
            Plan(services=SERVICES, infra=True),
        )

    def test_client_lockfile_and_repository_commands_have_different_impact(self):
        self.assertEqual(select(["package-lock.json"]), Plan(web=True))
        self.assertEqual(select(["package.json"]), FULL)

    def test_shared_docker_context_selects_every_image(self):
        self.assertEqual(select([".dockerignore"]), Plan(web=True, services=SERVICES))

    def test_ci_configuration_validates_itself_and_all_targets(self):
        for path in (".github/workflows/ci.yml", "scripts/ci/checks.py"):
            with self.subTest(path=path):
                self.assertEqual(select([path]), FULL)

    def test_per_target_build_config_keeps_only_its_owner_and_infra(self):
        cases = {
            "api": Plan(services=("market-data-service",), infra=True),
            "user": Plan(services=("user-service",), infra=True),
            "config": Plan(services=("config-service",), infra=True),
            "web": Plan(web=True, infra=True),
        }
        for suffix, expected in cases.items():
            with self.subTest(suffix=suffix):
                self.assertEqual(select([f"infra/gcp/cloudbuild.{suffix}.yaml"]), expected)

    def test_deployment_tooling_does_not_retest_unmodified_applications(self):
        self.assertEqual(select(["infra/gcp/deploy_existing_service.py"]), Plan(infra=True))

    def test_terraform_changes_select_offline_infrastructure_checks_without_applications(self):
        for path in (
            "infra/gcp/terraform/bootstrap/main.tf",
            "infra/gcp/terraform/bootstrap/.terraform.lock.hcl",
            "infra/gcp/terraform/envs/prod/foundation/backend.tf",
            "infra/gcp/terraform/bootstrap/tests/security.tftest.hcl",
            "infra/gcp/terraform_tools.py",
            "infra/gcp/terraform_pipeline.py",
            "infra/gcp/tests/test_terraform_tools.py",
            "infra/gcp/tests/test_terraform_pipeline.py",
            "infra/gcp/cloudbuild.terraform-plan.yaml",
            "infra/gcp/cloudbuild.terraform-apply.yaml",
        ):
            with self.subTest(path=path):
                self.assertEqual(select([path]), Plan(infra=True, terraform=True))

    def test_terraform_and_application_changes_are_combined_without_other_services(self):
        self.assertEqual(
            select(["infra/gcp/terraform/bootstrap/main.tf", "services/user-service/app/main.py"]),
            Plan(services=("user-service",), infra=True, terraform=True),
        )

    def test_documentation_and_format_configuration_need_only_repository_checks(self):
        for path in (
            "README.md",
            "AGENTS.md",
            "changelog/change.md",
            "apps/web/README.md",
            "services/user-service/docs/setup.md",
            "services/common/README.md",
            "services/future/docs/plan.md",
            "infra/gcp/README.md",
            "infra/gcp/terraform/README.md",
            ".prettierrc.json",
            ".gitignore",
        ):
            with self.subTest(path=path):
                self.assertEqual(select([path]), Plan())
        self.assertEqual(select([]), Plan())
        self.assertEqual(select(["local-docs/example.json"]), Plan())

    def test_unregistered_targets_and_executable_paths_are_conservative(self):
        for path in (
            "apps/mobile/index.ts",
            "services/research/app.py",
            "scripts/new.py",
            "new.json",
        ):
            with self.subTest(path=path):
                self.assertEqual(select([path]), FULL)

    def test_mixed_changes_are_a_stable_deduplicated_union(self):
        self.assertEqual(
            select(
                [
                    "services/config-service/app/main.py",
                    "apps/web/app/page.tsx",
                    "services/user-service/app/main.py",
                    "services/user-service/requirements.txt",
                    "changelog/change.md",
                ]
            ),
            Plan(web=True, services=("user-service", "config-service")),
        )


@contextmanager
def working_directory(directory):
    previous = Path.cwd()
    os.chdir(directory)
    try:
        yield
    finally:
        os.chdir(previous)


class GitComparisonTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "CI fixture")
        self.git("config", "user.email", "ci@example.invalid")
        self.write("README.md", "fixture\n")
        self.initial = self.commit()

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.root, check=True, capture_output=True, text=True
        ).stdout.strip()

    def write(self, path, value="fixture\n"):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value)

    def commit(self):
        self.git("add", ".")
        self.git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture")
        return self.git("rev-parse", "HEAD")

    def compare(self, name, event):
        with working_directory(self.root):
            return changed_paths(name, event)

    def test_rename_and_delete_keep_both_owners_and_unusual_names(self):
        old = "services/user-service/app/old.py"
        deleted = "services/config-service/app/deleted.py"
        new = "apps/web/renamed file\nwith newline.ts"
        self.write(old)
        self.write(deleted)
        base = self.commit()
        (self.root / deleted).unlink()
        destination = self.root / new
        destination.parent.mkdir(parents=True, exist_ok=True)
        (self.root / old).rename(destination)
        head = self.commit()
        paths = self.compare("push", {"before": base, "after": head})
        self.assertCountEqual(paths, [old, deleted, new])
        self.assertEqual(select(paths), Plan(web=True, services=("user-service", "config-service")))

    def test_stacked_pr_compares_against_its_feature_base_not_main(self):
        self.git("switch", "--quiet", "-c", "parent")
        self.write("services/market-data-service/app/main.py")
        parent = self.commit()
        self.git("switch", "--quiet", "-c", "child")
        self.write("apps/web/app/page.tsx")
        head = self.commit()
        event = {"pull_request": {"base": {"sha": parent}, "head": {"sha": head}}}
        self.assertEqual(select(self.compare("pull_request", event)), Plan(web=True))

    def test_pr_uses_merge_base_to_exclude_independent_base_updates(self):
        self.git("switch", "--quiet", "-c", "feature")
        self.write("apps/web/app/page.tsx")
        head = self.commit()
        self.git("switch", "--quiet", "main")
        self.write("services/config-service/app/main.py")
        base = self.commit()
        event = {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}
        self.assertEqual(select(self.compare("pull_request", event)), Plan(web=True))

    def test_push_checks_every_commit_not_just_the_last(self):
        self.write("services/user-service/app/main.py")
        self.commit()
        self.write("services/config-service/app/main.py")
        head = self.commit()
        paths = self.compare("push", {"before": self.initial, "after": head})
        self.assertEqual(select(paths), Plan(services=("user-service", "config-service")))

    def test_initial_missing_invalid_and_unavailable_commits_select_everything(self):
        cases = [
            ("push", {"before": "0" * 40, "after": self.initial}),
            ("push", {"before": self.initial, "after": "0" * 40}),
            ("push", {"before": "f" * 40, "after": self.initial}),
            ("push", {"before": "--output=bad", "after": self.initial}),
            ("push", {}),
            ("pull_request", {"pull_request": {}}),
            ("workflow_dispatch", {}),
        ]
        event_file = self.root / "event.json"
        with working_directory(self.root):
            for name, event in cases:
                with self.subTest(name=name, event=event):
                    event_file.write_text(json.dumps(event))
                    self.assertEqual(detect(name, str(event_file)), FULL)
            event_file.write_text("invalid json")
            self.assertEqual(detect("push", str(event_file)), FULL)
            self.assertEqual(detect("push", str(self.root / "missing.json")), FULL)

    def test_detect_reads_event_and_appends_actions_outputs(self):
        self.write("apps/web/app/page.tsx")
        head = self.commit()
        event_file, output = self.root / "event.json", self.root / "output"
        event_file.write_text(json.dumps({"before": self.initial, "after": head}))
        output.write_text("existing=value\n")
        script = Path(__file__).resolve().parents[1] / "checks.py"
        result = subprocess.run(
            [sys.executable, str(script), "detect"],
            cwd=self.root,
            env={
                **os.environ,
                "GITHUB_EVENT_NAME": "push",
                "GITHUB_EVENT_PATH": str(event_file),
                "GITHUB_OUTPUT": str(output),
            },
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIn("Compared 1 changed paths", result.stdout)
        self.assertEqual(
            output.read_text(),
            "existing=value\nweb=true\nbackend=false\nservices=[]\ninfra=false\nterraform=false\n",
        )


class GateTests(unittest.TestCase):
    def needs(self, plan=None):
        plan = plan or Plan()
        return {
            "changes": {"result": "success", "outputs": plan.outputs()},
            "repository": {"result": "success"},
            "web": {"result": "success" if plan.web else "skipped"},
            "backend": {"result": "success" if plan.services else "skipped"},
            "terraform": {"result": "success" if plan.terraform else "skipped"},
        }

    def test_documentation_web_backend_and_full_success_are_accepted(self):
        for plan in (
            Plan(),
            Plan(web=True),
            Plan(services=("user-service",)),
            Plan(infra=True, terraform=True),
            FULL,
        ):
            with self.subTest(plan=plan):
                validate_gate(self.needs(plan))

    def test_selected_jobs_cannot_fail_cancel_or_skip(self):
        for job in ("changes", "repository", "web", "backend", "terraform"):
            for result in ("failure", "cancelled", "skipped", None):
                with self.subTest(job=job, result=result):
                    needs = self.needs(FULL)
                    needs[job]["result"] = result
                    with self.assertRaises(ValueError):
                        validate_gate(needs)

    def test_unselected_job_cannot_hide_failure_or_unexpected_execution(self):
        for job in ("web", "backend", "terraform"):
            for result in ("failure", "cancelled", "success"):
                with self.subTest(job=job, result=result):
                    needs = self.needs()
                    needs[job]["result"] = result
                    with self.assertRaises(ValueError):
                        validate_gate(needs)

    def test_missing_jobs_and_missing_or_invalid_outputs_fail_closed(self):
        cases = [None, [], {}]
        for job in ("changes", "repository", "web", "backend", "terraform"):
            needs = self.needs()
            del needs[job]
            cases.append(needs)
        for field in ("web", "backend", "services", "infra", "terraform"):
            needs = self.needs()
            del needs["changes"]["outputs"][field]
            cases.append(needs)
        for value in (None, {}, "true", ["unknown"], ["user-service", "user-service"], [123]):
            needs = self.needs()
            needs["changes"]["outputs"]["services"] = json.dumps(value)
            cases.append(needs)
        for field in ("web", "backend", "infra", "terraform"):
            needs = self.needs()
            needs["changes"]["outputs"][field] = "maybe"
            cases.append(needs)
        for needs in cases:
            with self.subTest(needs=needs), self.assertRaises(ValueError):
                validate_gate(needs)

    def test_backend_flag_must_agree_with_services(self):
        for plan in (Plan(), Plan(services=("user-service",))):
            needs = self.needs(plan)
            outputs = needs["changes"]["outputs"]
            outputs["backend"] = "false" if plan.services else "true"
            with self.assertRaises(ValueError):
                validate_gate(needs)

    def test_terraform_flag_requires_repository_infrastructure_validation(self):
        needs = self.needs(Plan(infra=True, terraform=True))
        needs["changes"]["outputs"]["infra"] = "false"
        with self.assertRaises(ValueError):
            validate_gate(needs)

    def test_gate_command_returns_failure_for_invalid_dependency_json(self):
        import checks

        for value in ("{broken", "null", "{}"):
            with self.subTest(value=value):
                with (
                    patch.dict(os.environ, {"NEEDS_JSON": value}),
                    patch.object(sys, "argv", ["checks.py", "gate"]),
                ):
                    self.assertEqual(checks.main(), 1)
        needs = deepcopy(self.needs(FULL))
        with (
            patch.dict(os.environ, {"NEEDS_JSON": json.dumps(needs)}),
            patch.object(sys, "argv", ["checks.py", "gate"]),
        ):
            self.assertEqual(checks.main(), 0)


if __name__ == "__main__":
    unittest.main()
