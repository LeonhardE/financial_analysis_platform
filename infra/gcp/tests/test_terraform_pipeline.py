"""Test the saved-plan trust boundary without Terraform, credentials, or cloud calls."""

import copy
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

SPEC = importlib.util.spec_from_file_location(
    "terraform_pipeline", Path(__file__).parents[1] / "terraform_pipeline.py"
)
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)

PLAN = "12345678-1234-4234-8234-123456789abc"
APPLY = "87654321-4321-4321-8321-cba987654321"
PLAN_TRIGGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
APPLY_TRIGGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
COMMIT = "a" * 40
NOW = datetime(2026, 10, 23, 12, tzinfo=UTC)
PROJECT = "financial-analysis-512202"
REPOSITORY = (
    f"projects/{PROJECT}/locations/northamerica-northeast2/"
    "connections/financial-analysis-github/repositories/financial-analysis"
)
REPOSITORY_URL = "https://github.com/LeonhardE/financial_analysis_platform.git"
POLICY = {
    "schema_version": 1,
    "project_id": "financial-analysis-512202",
    "project_number": "630815932903",
    "region": "northamerica-northeast2",
    "terraform_version": "1.16.7",
    "state_bucket": "financial-analysis-512202-tfstate",
    "plan_bucket": "financial-analysis-512202-tfplans",
    "max_plan_age_seconds": 21600,
    "repository_url": REPOSITORY_URL,
    "targets": {
        "repo": {
            "directory": "infra/gcp/terraform/envs/prod/repo",
            "state_prefix": "prod/repo",
            "plan_trigger": "terraform-plan-repo",
            "apply_trigger": "terraform-apply-repo",
            "plan_service_account": f"fa-infra-plan@{PROJECT}.iam.gserviceaccount.com",
            "apply_service_account": f"fa-infra-apply@{PROJECT}.iam.gserviceaccount.com",
        }
    },
}


def account(mode):
    email = POLICY["targets"]["repo"][f"{mode}_service_account"]
    return f"projects/{POLICY['project_id']}/serviceAccounts/{email}"


class FakeAPI:
    def __init__(self):
        self.generation = "5"
        self.objects = {}
        self.downloads = []
        self.uploads = []
        self.reads = []
        self.builds = {}
        self.triggers = {}
        for mode, identifier, trigger in (
            ("plan", PLAN, PLAN_TRIGGER),
            ("apply", APPLY, APPLY_TRIGGER),
        ):
            self.builds[identifier] = {
                "id": identifier,
                "projectId": POLICY["project_id"],
                "status": "WORKING",
                "serviceAccount": account(mode),
                "buildTriggerId": trigger,
                "substitutions": {
                    "COMMIT_SHA": COMMIT,
                    "BRANCH_NAME": "main",
                    "_TARGET": "repo",
                    "_PLAN_BUILD_ID": PLAN if mode == "apply" else "",
                },
                "approval": {"result": {"decision": "APPROVED"}},
                "sourceProvenance": {
                    "resolvedConnectedRepository": {"repository": REPOSITORY, "revision": COMMIT}
                },
            }
            self.triggers[trigger] = {
                "name": f"terraform-{mode}-repo",
                "serviceAccount": account(mode),
                "filename": pipeline.CONFIG_FILES[mode],
                "approvalConfig": {"approvalRequired": mode == "apply"},
                "repositoryEventConfig": {
                    "repository": REPOSITORY,
                    "push": {"branch": "^main$"},
                },
            }
            if mode == "apply":
                self.triggers[trigger]["gitFileSource"] = {
                    "path": self.triggers[trigger].pop("filename"),
                    "repository": REPOSITORY,
                    "revision": "refs/heads/main",
                }
                self.triggers[trigger]["sourceToBuild"] = {
                    "repository": REPOSITORY,
                    "ref": "refs/heads/main",
                }

    def build(self, identifier):
        self.reads.append(("build", identifier))
        return copy.deepcopy(self.builds[identifier])

    def trigger(self, identifier):
        self.reads.append(("trigger", identifier))
        return copy.deepcopy(self.triggers[identifier])

    def state_generation(self, bucket, name):
        assert bucket == POLICY["state_bucket"]
        assert name == "prod/repo/default.tfstate"
        return self.generation

    def object_metadata(self, bucket, name):
        assert bucket == POLICY["plan_bucket"]
        return {"generation": self.objects[name][0]}

    def download(self, bucket, name, generation):
        assert bucket == POLICY["plan_bucket"]
        self.downloads.append((name, generation))
        actual, data = self.objects[name]
        assert actual == generation, "Download must pin the immutable object generation"
        return data

    def upload(self, bucket, name, data):
        assert bucket == POLICY["plan_bucket"]
        if name in self.objects:
            raise HTTPError("private-object", 412, "Object already exists", {}, None)
        generation = str(100 + len(self.objects))
        self.objects[name] = (generation, data)
        self.uploads.append(name)
        return {"generation": generation, "sha256": pipeline.hashlib.sha256(data).hexdigest()}

    def edit_manifest(self, **changes):
        key = f"plans/repo/{PLAN}/manifest.json"
        generation, data = self.objects[key]
        manifest = json.loads(data)
        manifest.update(changes)
        self.objects[key] = (generation, json.dumps(manifest).encode())


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.directory = self.root / POLICY["targets"]["repo"]["directory"]
        self.directory.mkdir(parents=True)
        self.write(pipeline.POLICY, json.dumps(POLICY))
        self.write("infra/gcp/terraform_pipeline.py", "# trusted runner\n")
        self.write("infra/gcp/terraform_tools.py", "# verified toolchain\n")
        self.write("infra/gcp/terraform/toolchain.json", '{"terraform_version":"1.16.7"}')
        for name in pipeline.CONFIG_FILES.values():
            self.write(name, "steps: []\n")
        self.write(str(self.directory.relative_to(self.root) / "main.tf"), "terraform {}\n")
        (self.directory / ".terraform.lock.hcl").write_text("# locked\n")
        self.api = FakeAPI()
        self.calls = []
        self.plan_actions = ["create"]
        self.version = POLICY["terraform_version"]
        self.after_plan = lambda: None
        self.output = io.StringIO()
        self.patcher = patch.object(pipeline, "command", side_effect=self.command)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def command(self, args, directory, allowed=(0,)):
        self.assertEqual(directory, self.directory)
        self.calls.append((args, allowed))
        if args[1] == "version":
            return json.dumps({"terraform_version": self.version}).encode()
        if args[1] == "plan":
            output = next(arg[5:] for arg in args if arg.startswith("-out="))
            Path(output).write_bytes(b"binary plan with a secret")
            self.after_plan()
        if args[1:3] == ["show", "-json"]:
            return json.dumps(
                {
                    "terraform_version": self.version,
                    "resource_changes": [
                        {
                            "address": "terraform_data.foundation",
                            "change": {
                                "actions": self.plan_actions,
                                "after": {"secret": "private"},
                            },
                        }
                    ],
                }
            ).encode()
        if args[1:3] == ["show", "-no-color"]:
            return b"private human-readable plan (sensitive value)"
        if args[1] == "apply":
            self.assertEqual(Path(args[-1]).read_bytes(), b"binary plan with a secret")
        return b""

    def run_pipeline(self, mode="plan", **kwargs):
        arguments = dict(
            mode=mode,
            target="repo",
            identifier=PLAN if mode == "plan" else APPLY,
            commit=COMMIT,
            branch="main",
            plan_build_id=PLAN if mode == "apply" else None,
            root=self.root,
            api=self.api,
            now=NOW,
        )
        arguments.update(kwargs)
        with redirect_stdout(self.output):
            return pipeline.run(**arguments)

    def saved_plan(self):
        self.run_pipeline()
        self.api.builds[PLAN]["status"] = "SUCCESS"
        self.calls.clear()

    def test_plan_uploads_immutable_artifacts_before_manifest_and_only_logs_actions(self):
        self.run_pipeline()
        self.assertEqual(
            self.api.uploads,
            [
                f"plans/repo/{PLAN}/{name}"
                for name in ("terraform.tfplan", "plan.txt", "manifest.json")
            ],
        )
        self.assertIn("terraform_data.foundation: create", self.output.getvalue())
        self.assertNotIn("a secret", self.output.getvalue())
        self.assertNotIn("sensitive value", self.output.getvalue())
        plan_call = next(call for call in self.calls if call[0][1] == "plan")
        self.assertEqual(plan_call[1], (0, 2))
        self.assertIn("-lock-timeout=60s", plan_call[0])

    def test_apply_uses_saved_binary_only_and_checks_both_artifact_generations(self):
        self.saved_plan()
        self.run_pipeline("apply")
        operations = [call[0][1] for call in self.calls]
        self.assertEqual(operations, ["version", "init", "validate", "apply"])
        self.assertEqual(len(self.api.downloads), 3)
        apply = self.calls[-1][0]
        self.assertIn("-lock-timeout=60s", apply)
        self.assertNotIn("-auto-approve", apply)
        init = next(call[0] for call in self.calls if call[0][1] == "init")
        self.assertIn("-lockfile=readonly", init)
        self.assertIn("-backend-config=prefix=prod/repo", init)

    def test_invalid_input_stops_before_cloud_and_terraform(self):
        for arguments in (
            {"target": "bootstrap"},
            {"branch": "feature/untrusted"},
            {"commit": "a" * 7},
            {"identifier": "../../another-build"},
            {"plan_build_id": PLAN},
        ):
            with self.subTest(arguments=arguments), self.assertRaises(RuntimeError):
                self.run_pipeline(**arguments)
        self.assertEqual(self.api.reads, [])
        self.assertEqual(self.calls, [])

    def test_registered_directory_cannot_escape_production_roots(self):
        for directory in ("../../elsewhere", "infra/gcp/terraform/bootstrap", "/tmp"):
            policy = copy.deepcopy(POLICY)
            policy["targets"]["repo"]["directory"] = directory
            self.write(pipeline.POLICY, json.dumps(policy))
            with self.subTest(directory=directory), self.assertRaises(RuntimeError):
                self.run_pipeline()
        self.assertEqual(self.api.reads, [])

    def test_tfvars_and_symlinks_are_rejected(self):
        for name in ("terraform.tfvars", "production.auto.tfvars", "production.tfvars.json"):
            path = self.directory / name
            path.write_text("override = true")
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "Ad-hoc"):
                self.run_pipeline()
            path.unlink()
        link = self.directory / "linked.tf"
        link.symlink_to(self.directory / "main.tf")
        with self.assertRaisesRegex(RuntimeError, "symlinks"):
            self.run_pipeline()

    def test_hash_covers_root_modules_policy_toolchain_and_pipeline_files(self):
        module = "infra/gcp/terraform/modules/example/main.tf"
        self.write(module, "# module")
        before = pipeline.configuration_hash(self.root, self.directory)
        for name in (
            module,
            "infra/gcp/terraform_pipeline.py",
            "infra/gcp/terraform_tools.py",
            "infra/gcp/terraform/toolchain.json",
            pipeline.POLICY,
            *pipeline.CONFIG_FILES.values(),
        ):
            path = self.root / name
            original = path.read_text()
            path.write_text(original + "\n# changed")
            with self.subTest(name=name):
                self.assertNotEqual(before, pipeline.configuration_hash(self.root, self.directory))
            path.write_text(original)

    def test_provider_lock_is_required(self):
        (self.directory / ".terraform.lock.hcl").unlink()
        with self.assertRaisesRegex(RuntimeError, "lock file"):
            self.run_pipeline()

    def test_wrong_terraform_binary_version_stops_before_cloud_calls(self):
        self.version = "1.15.0"
        with self.assertRaisesRegex(RuntimeError, "version"):
            self.run_pipeline()
        self.assertEqual(self.api.reads, [])

    def test_own_build_identity_source_and_status_are_verified(self):
        changes = (
            {"id": APPLY},
            {"projectId": "other-project"},
            {"status": "CANCELLED"},
            {"substitutions": {"COMMIT_SHA": "b" * 40, "BRANCH_NAME": "main"}},
            {"substitutions": {"COMMIT_SHA": COMMIT, "BRANCH_NAME": "feature"}},
            {"serviceAccount": account("apply")},
        )
        original = copy.deepcopy(self.api.builds[PLAN])
        for change in changes:
            self.api.builds[PLAN] = {**copy.deepcopy(original), **change}
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.run_pipeline()
        self.assertEqual(self.api.uploads, [])
        self.assertTrue(all(call[0][1] == "version" for call in self.calls))

    def test_trigger_name_account_and_config_are_verified(self):
        changes = (
            {"name": "manually-submitted"},
            {"serviceAccount": account("apply")},
            {"filename": "unreviewed.yaml"},
            {"filename": None},
            {"gitFileSource": {"path": "conflicting.yaml"}},
        )
        original = copy.deepcopy(self.api.triggers[PLAN_TRIGGER])
        for change in changes:
            self.api.triggers[PLAN_TRIGGER] = {**copy.deepcopy(original), **change}
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.run_pipeline()

    def test_apply_manual_trigger_accepts_git_file_source_path(self):
        self.saved_plan()
        trigger = self.api.triggers[APPLY_TRIGGER]
        self.assertNotIn("filename", trigger)
        self.assertEqual(trigger["gitFileSource"]["path"], pipeline.CONFIG_FILES["apply"])
        self.run_pipeline("apply")

    def git_source(self, identifier, revision=COMMIT):
        source = {"url": REPOSITORY_URL, "revision": revision}
        build = self.api.builds[identifier]
        build["source"] = {"gitSource": copy.deepcopy(source)}
        build["sourceProvenance"] = {"resolvedGitSource": source}

    def test_captured_github_trigger_payload_can_publish_a_plan(self):
        # Shape and revision from the first real terraform-plan-repo build.
        revision = "d2184e68fedccfafeace891f869c75ca6499f767"
        self.git_source(PLAN, revision)
        self.api.builds[PLAN]["substitutions"]["COMMIT_SHA"] = revision
        self.run_pipeline(commit=revision)
        self.assertIn(f"plans/repo/{PLAN}/manifest.json", self.api.uploads)
        self.assertEqual(self.api.reads, [("build", PLAN), ("trigger", PLAN_TRIGGER)])

    def test_plan_producer_and_apply_accept_independent_supported_provenance_formats(self):
        for git_plan, git_apply in ((True, True), (True, False), (False, True)):
            with self.subTest(git_plan=git_plan, git_apply=git_apply):
                self.api = FakeAPI()
                self.calls.clear()
                if git_plan:
                    self.git_source(PLAN)
                if git_apply:
                    self.git_source(APPLY)
                self.saved_plan()
                self.run_pipeline("apply")
                self.assertEqual(self.calls[-1][0][1], "apply")

    def test_git_provenance_requires_exact_trusted_url_commit_and_root_directory(self):
        self.git_source(PLAN)
        valid = copy.deepcopy(self.api.builds[PLAN]["sourceProvenance"]["resolvedGitSource"])
        invalid = [
            {},
            {"revision": COMMIT},
            {"url": REPOSITORY_URL},
            {**valid, "revision": "b" * 40},
            {**valid, "revision": "refs/heads/main"},
            {**valid, "dir": "another-directory"},
            {**valid, "url": None},
        ]
        invalid.extend(
            {**valid, "url": url}
            for url in (
                REPOSITORY_URL + "-other",
                REPOSITORY_URL.replace("github.com", "github.example"),
                REPOSITORY_URL.replace("https://", "http://"),
                REPOSITORY_URL.replace("https://", "https://token@"),
                REPOSITORY_URL + "?override=1",
                REPOSITORY_URL + "#main",
            )
        )
        for source in invalid:
            self.api.builds[PLAN]["sourceProvenance"] = {"resolvedGitSource": source}
            with self.subTest(source=source), self.assertRaisesRegex(RuntimeError, "provenance"):
                self.run_pipeline()
        self.assertEqual(self.api.uploads, [])
        self.assertTrue(all(call[0][1] == "version" for call in self.calls))

    def test_request_source_cannot_replace_missing_malformed_or_mixed_output_provenance(self):
        self.git_source(PLAN)
        git_source = copy.deepcopy(self.api.builds[PLAN]["sourceProvenance"])
        connected = {"resolvedConnectedRepository": {"repository": REPOSITORY, "revision": COMMIT}}
        invalid = (
            {},
            None,
            [],
            {"resolvedGitSource": "not-an-object"},
            {"resolvedGitSource": None},
            {"resolvedRepoSource": {"repoName": REPOSITORY_URL, "commitSha": COMMIT}},
            {**git_source, **connected},
            {**git_source, "resolvedStorageSource": {"bucket": "untrusted"}},
            {**connected, "resolvedRepoSource": {"commitSha": COMMIT}},
        )
        for provenance in invalid:
            self.api.builds[PLAN]["sourceProvenance"] = provenance
            with (
                self.subTest(provenance=provenance),
                self.assertRaisesRegex(RuntimeError, "provenance"),
            ):
                self.run_pipeline()
        self.assertEqual(self.api.uploads, [])
        self.assertTrue(all(call[0][1] == "version" for call in self.calls))

    def test_git_provenance_without_a_committed_trusted_url_is_rejected(self):
        self.git_source(PLAN)
        policy = copy.deepcopy(POLICY)
        del policy["repository_url"]
        self.write(pipeline.POLICY, json.dumps(policy))
        with self.assertRaisesRegex(RuntimeError, "provenance"):
            self.run_pipeline()
        self.assertEqual(self.api.uploads, [])

    def test_apply_reverifies_git_provenance_of_the_successful_plan_producer(self):
        self.git_source(PLAN)
        self.saved_plan()
        original = copy.deepcopy(self.api.builds[PLAN]["sourceProvenance"])
        for field, value in (("url", REPOSITORY_URL + "-other"), ("revision", "b" * 40)):
            self.api.builds[PLAN]["sourceProvenance"] = copy.deepcopy(original)
            self.api.builds[PLAN]["sourceProvenance"]["resolvedGitSource"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "provenance"):
                self.run_pipeline("apply")
        self.assertEqual(self.api.downloads, [])
        self.assertFalse(any(call[0][1] == "apply" for call in self.calls))

    def test_caller_supplied_labels_cannot_substitute_for_output_only_source_provenance(self):
        original = copy.deepcopy(self.api.builds[PLAN]["sourceProvenance"])
        for value in (
            {},
            {"resolvedConnectedRepository": {"repository": REPOSITORY, "revision": "b" * 40}},
            {
                "resolvedConnectedRepository": {
                    "repository": REPOSITORY + "-other",
                    "revision": COMMIT,
                }
            },
            {
                "resolvedConnectedRepository": {
                    "repository": REPOSITORY,
                    "revision": COMMIT,
                    "dir": "unreviewed-subdirectory",
                }
            },
            {**original, "resolvedGitSource": {"revision": COMMIT}},
        ):
            self.api.builds[PLAN]["sourceProvenance"] = value
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "provenance"):
                self.run_pipeline()
        self.assertEqual(self.api.uploads, [])

    def test_repository_project_number_normalizes_to_registered_project_identity(self):
        resolved = self.api.builds[PLAN]["sourceProvenance"]["resolvedConnectedRepository"]
        resolved["repository"] = REPOSITORY.replace(PROJECT, POLICY["project_number"])
        self.run_pipeline()

    def test_trigger_source_selection_must_use_the_same_project_and_main_branch(self):
        original = copy.deepcopy(self.api.triggers[PLAN_TRIGGER])
        for change in (
            {"push": {"branch": ".*"}, "repository": REPOSITORY},
            {"push": {"branch": "^main$", "invertRegex": True}, "repository": REPOSITORY},
            {"push": {"branch": "^main$"}, "repository": REPOSITORY.replace(PROJECT, "other")},
        ):
            self.api.triggers[PLAN_TRIGGER]["repositoryEventConfig"] = change
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.run_pipeline()
        self.api.triggers[PLAN_TRIGGER] = original
        self.saved_plan()
        trigger = self.api.triggers[APPLY_TRIGGER]
        for field in ("sourceToBuild", "gitFileSource"):
            original = copy.deepcopy(trigger[field])
            trigger[field] = {**original, "repository": REPOSITORY + "-other"}
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.run_pipeline("apply")
            trigger[field] = original

    def test_canonical_account_project_number_is_accepted_but_other_identity_is_not(self):
        for prefix in (POLICY["project_number"], "-"):
            self.api.builds[PLAN]["serviceAccount"] = account("plan").replace(
                POLICY["project_id"] + "/", prefix + "/", 1
            )
            with self.subTest(prefix=prefix):
                pipeline.verify_build(
                    self.api, POLICY, POLICY["targets"]["repo"], "plan", PLAN, COMMIT, target="repo"
                )
        for value in (
            account("plan").replace("projects/financial-analysis-512202/", "projects/other/"),
            "arbitrary-prefix/" + POLICY["targets"]["repo"]["plan_service_account"],
            account("apply"),
        ):
            self.api.builds[PLAN]["serviceAccount"] = value
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "service account"):
                pipeline.verify_build(
                    self.api, POLICY, POLICY["targets"]["repo"], "plan", PLAN, COMMIT, target="repo"
                )

    def test_first_backend_initialization_can_create_an_empty_state_before_plan(self):
        self.api.generation = "0"
        original = self.command

        def initialize(arguments, *args, **kwargs):
            if arguments[1] == "init":
                self.api.generation = "1"
            return original(arguments, *args, **kwargs)

        with patch.object(pipeline, "command", side_effect=initialize):
            self.run_pipeline()
        manifest = json.loads(self.api.objects[f"plans/repo/{PLAN}/manifest.json"][1])
        self.assertEqual(manifest["state_generation"], "1")

    def test_apply_requires_native_approval_and_approval_required_trigger(self):
        self.saved_plan()
        original = copy.deepcopy(self.api.builds[APPLY]["approval"])
        for approval in ({}, {"result": {"decision": "REJECTED"}}, {"state": "APPROVED"}):
            self.api.builds[APPLY]["approval"] = approval
            with self.subTest(approval=approval), self.assertRaisesRegex(RuntimeError, "approval"):
                self.run_pipeline("apply")
        self.api.builds[APPLY]["approval"] = original
        self.api.triggers[APPLY_TRIGGER]["approvalConfig"]["approvalRequired"] = False
        with self.assertRaisesRegex(RuntimeError, "approval"):
            self.run_pipeline("apply")
        self.assertFalse(any(call[0][1] == "apply" for call in self.calls))

    def test_approval_metadata_binds_the_exact_target_and_plan_build(self):
        self.saved_plan()
        for identifier, field, value in (
            (APPLY, "_PLAN_BUILD_ID", APPLY),
            (APPLY, "_TARGET", "market"),
            (PLAN, "_TARGET", "market"),
        ):
            substitutions = self.api.builds[identifier]["substitutions"]
            original = substitutions[field]
            substitutions[field] = value
            with self.subTest(identifier=identifier, field=field), self.assertRaises(RuntimeError):
                self.run_pipeline("apply")
            substitutions[field] = original
        self.assertFalse(any(call[0][1] == "apply" for call in self.calls))

    def test_failed_cancelled_and_pending_plan_producers_cannot_apply(self):
        self.saved_plan()
        for status in ("FAILURE", "CANCELLED", "WORKING", "QUEUED"):
            self.api.builds[PLAN]["status"] = status
            with self.subTest(status=status), self.assertRaisesRegex(RuntimeError, "status"):
                self.run_pipeline("apply")

    def test_manifest_target_source_state_and_version_are_bound(self):
        self.saved_plan()
        key = f"plans/repo/{PLAN}/manifest.json"
        original = self.api.objects[key]
        for change in (
            {"schema_version": 2},
            {"project_id": "another-project"},
            {"target": "market"},
            {"commit": "b" * 40},
            {"producer_build_id": APPLY},
            {"terraform_version": "1.15.0"},
            {"configuration_sha256": "0" * 64},
            {"state_generation": "4"},
        ):
            self.api.objects[key] = original
            self.api.edit_manifest(**change)
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "reviewed plan"):
                self.run_pipeline("apply")

    def test_configuration_changes_after_review_require_new_plan(self):
        self.saved_plan()
        (self.directory / "main.tf").write_text("# changed after planning")
        with self.assertRaisesRegex(RuntimeError, "reviewed plan"):
            self.run_pipeline("apply")

    def test_expired_and_future_dated_plans_cannot_apply(self):
        self.saved_plan()
        for moment in (NOW + timedelta(seconds=21601), NOW - timedelta(seconds=1)):
            with self.subTest(moment=moment), self.assertRaisesRegex(RuntimeError, "stale"):
                self.run_pipeline("apply", now=moment)

    def test_changed_state_during_plan_prevents_publishing_a_manifest(self):
        self.after_plan = lambda: setattr(self.api, "generation", "6")
        with self.assertRaisesRegex(RuntimeError, "State changed"):
            self.run_pipeline()
        self.assertEqual(self.api.uploads, [])

    def test_changed_state_since_plan_blocks_apply(self):
        self.saved_plan()
        self.api.generation = "6"
        with self.assertRaisesRegex(RuntimeError, "current state"):
            self.run_pipeline("apply")

    def test_changed_state_during_init_blocks_apply(self):
        self.saved_plan()
        original = self.command

        def init_race(arguments, *args, **kwargs):
            if arguments[1] == "init":
                self.api.generation = "6"
            return original(arguments, *args, **kwargs)

        with patch.object(pipeline, "command", side_effect=init_race):
            with self.assertRaisesRegex(RuntimeError, "State changed"):
                self.run_pipeline("apply")
        self.assertFalse(any(call[0][1] == "apply" for call in self.calls))

    def test_tampered_binary_or_review_text_is_detected(self):
        self.saved_plan()
        for name in ("terraform.tfplan", "plan.txt"):
            key = f"plans/repo/{PLAN}/{name}"
            original = self.api.objects[key]
            self.api.objects[key] = (original[0], b"tampered")
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "digest"):
                self.run_pipeline("apply")
            self.api.objects[key] = original
        self.assertFalse(any(call[0][1] == "apply" for call in self.calls))

    def test_delete_and_replacement_plans_are_not_published(self):
        for actions in (["delete"], ["delete", "create"], ["create", "delete"], ["unknown"]):
            self.plan_actions = actions
            with self.subTest(actions=actions), self.assertRaises(RuntimeError):
                self.run_pipeline()
        self.assertEqual(self.api.uploads, [])

    def test_no_op_plan_is_reviewable(self):
        self.plan_actions = ["no-op"]
        self.run_pipeline()
        self.assertIn("No resource changes.", self.output.getvalue())

    def test_retry_cannot_overwrite_a_published_plan(self):
        self.run_pipeline()
        with self.assertRaises(HTTPError) as caught:
            self.run_pipeline()
        self.assertEqual(caught.exception.code, 412)
        self.assertEqual(len(self.api.uploads), 3)

    def test_command_failure_and_cancellation_publish_nothing(self):
        original = self.command

        def failure(arguments, *args, **kwargs):
            if arguments[1] == "plan":
                raise RuntimeError("Terraform plan failed; output withheld.")
            return original(arguments, *args, **kwargs)

        with patch.object(pipeline, "command", side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, "withheld"):
                self.run_pipeline()
        self.assertEqual(self.api.uploads, [])

    def fail_apply(self, arguments, *args, **kwargs):
        if arguments[1] == "apply":
            (self.directory / "errored.tfstate").write_bytes(b"private recovery state")
            raise pipeline.TerraformCommandError("apply", b"private diagnostic secret")
        return self.command(arguments, *args, **kwargs)

    def test_failed_apply_preserves_private_diagnostics_and_state_before_ephemeral_exit(self):
        self.saved_plan()
        with patch.object(pipeline, "command", side_effect=self.fail_apply):
            with self.assertRaisesRegex(pipeline.TerraformCommandError, "withheld"):
                self.run_pipeline("apply")
        prefix = f"recovery/repo/{APPLY}/"
        self.assertEqual(
            self.api.objects[prefix + "diagnostics.txt"][1], b"private diagnostic secret"
        )
        self.assertEqual(self.api.objects[prefix + "errored.tfstate"][1], b"private recovery state")
        self.assertIn("Private recovery artifacts", self.output.getvalue())
        self.assertNotIn("private diagnostic secret", self.output.getvalue())
        self.assertNotIn("private recovery state", self.output.getvalue())

    def test_recovery_upload_failure_does_not_claim_success_and_still_attempts_state_capture(self):
        self.saved_plan()
        original = self.api.upload

        def partial_failure(bucket, name, data):
            if name.endswith("diagnostics.txt"):
                raise HTTPError("private-object", 403, "denied", {}, None)
            return original(bucket, name, data)

        with (
            patch.object(pipeline, "command", side_effect=self.fail_apply),
            patch.object(self.api, "upload", side_effect=partial_failure),
        ):
            with self.assertRaisesRegex(RuntimeError, "recovery capture was incomplete"):
                self.run_pipeline("apply")
        self.assertIn(f"recovery/repo/{APPLY}/errored.tfstate", self.api.objects)
        self.assertNotIn("Private recovery artifacts", self.output.getvalue())

    def test_recovery_state_symlink_is_not_read_or_uploaded(self):
        self.saved_plan()
        path = self.directory / "errored.tfstate"
        outside = self.root / "unrelated-secret"
        outside.write_text("do not read")

        def symlink_failure(arguments, *args, **kwargs):
            if arguments[1] == "apply":
                path.symlink_to(outside)
                raise pipeline.TerraformCommandError("apply", b"private diagnostic")
            return self.command(arguments, *args, **kwargs)

        with patch.object(pipeline, "command", side_effect=symlink_failure):
            with self.assertRaisesRegex(RuntimeError, "recovery capture was incomplete"):
                self.run_pipeline("apply")
        self.assertNotIn(f"recovery/repo/{APPLY}/errored.tfstate", self.api.objects)


class TransportTests(unittest.TestCase):
    def test_upload_is_create_only_and_encodes_object_path(self):
        api = object.__new__(pipeline.GoogleAPI)
        with patch.object(api, "request", return_value=b'{"generation":"123"}') as request:
            api.upload("private-bucket", "plans/repo/uuid/terraform.tfplan", b"secret")
        url = request.call_args.args[0]
        self.assertIn("ifGenerationMatch=0", url)
        self.assertIn("name=plans%2Frepo%2Fuuid%2Fterraform.tfplan", url)

    def test_only_missing_state_maps_to_empty_state_generation(self):
        api = object.__new__(pipeline.GoogleAPI)
        for status in (404, 403, 429, 500):
            with patch.object(
                api, "object_metadata", side_effect=HTTPError("object", status, "failed", {}, None)
            ):
                if status == 404:
                    self.assertEqual(api.state_generation("bucket", "default.tfstate"), "0")
                else:
                    with self.assertRaises(HTTPError):
                        api.state_generation("bucket", "default.tfstate")

    def test_command_strips_environment_overrides_and_does_not_leak_failure_output(self):
        result = subprocess.CompletedProcess(["terraform", "plan"], 130, b"secret", b"secret")
        with (
            patch.dict(
                "os.environ",
                {
                    "TF_CLI_ARGS_plan": "-lock=false",
                    "TF_VAR_secret": "secret",
                    "TF_WORKSPACE": "bad",
                },
            ),
            patch.object(pipeline.subprocess, "run", return_value=result) as run,
        ):
            with self.assertRaisesRegex(RuntimeError, "output withheld") as error:
                pipeline.command(["terraform", "plan"], Path("/tmp"))
        self.assertNotIn("secret", str(error.exception))
        env = run.call_args.kwargs["env"]
        self.assertNotIn("TF_CLI_ARGS_plan", env)
        self.assertNotIn("TF_VAR_secret", env)
        self.assertNotIn("TF_WORKSPACE", env)
        self.assertEqual(env["TF_IN_AUTOMATION"], "1")
        self.assertEqual(env["TF_CLI_CONFIG_FILE"], "/dev/null")


if __name__ == "__main__":
    unittest.main()
