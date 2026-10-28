"""Exercise real projection parsing and the saved-plan runner with synthetic APIs."""

import copy
import io
import json
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import test_deployment_profile as profiles
import test_terraform_pipeline as legacy

profile = profiles.profile
pipeline = legacy.pipeline


class ProjectionTests(unittest.TestCase):
    def test_all_adopted_targets_roundtrip_and_only_consume_their_typed_fields(self):
        full = profiles.adopted()
        for target, selected in full["targets"].items():
            if selected["lifecycle"] != "adopt":
                continue
            with self.subTest(target=target):
                value = profile.compile_target(full, target)
                encoded = profile.canonical(value)
                self.assertLessEqual(len(encoded), 4000)
                self.assertEqual(profile.parse_target(encoded), value)
                expected = (
                    {"project_id"}
                    if target == "repo"
                    else {
                        "project_id",
                        "region",
                        "artifact_repository",
                        "runtime_account_id",
                        "creation_image",
                        "existing_service_uid",
                    }
                )
                if target in {"market", "config", "portfolio", "user"}:
                    expected.add("web_origin")
                if target == "user":
                    expected.add("market_origin")
                self.assertEqual(set(value["inputs"]), expected)
                self.assertEqual(profile.terraform_inputs(value), {"deployment": value["inputs"]})
                self.assertEqual("build" in value, target == "web")
        with self.assertRaises(profile.ProfileError):
            profile.compile_target(full, "agent-hub")
        with self.assertRaises(profile.ProfileError):
            profile.compile_target(profiles.example(), "repo")

    def test_unrelated_target_changes_do_not_change_selected_projection(self):
        full = profiles.adopted()
        before = profile.compile_target(full, "market")
        full["targets"]["user"]["image"] = full["targets"]["user"]["image"][:-64] + "2" * 64
        self.assertEqual(profile.compile_target(full, "market"), before)
        self.assertNotIn("profileSha256", before)
        full["targets"]["web"]["origin"] = "https://web.example.invalid"
        self.assertNotEqual(profile.compile_target(full, "market"), before)

    def test_parser_rejects_noncanonical_duplicate_unknown_secret_and_oversized_inputs(self):
        value = profile.compile_target(profiles.adopted(), "market")
        canonical = profile.canonical(value)
        cases = [canonical + b"\n", json.dumps(value).encode(), b"\xff", b"x" * 4001]
        cases.append(b'{"schemaVersion":1,' + canonical[1:])
        for changed in (
            {**value, "token": "synthetic"},
            {**value, "schemaVersion": True},
            {**value, "inputs": {**value["inputs"], "environment": {}}},
            {**value, "inputs": {**value["inputs"], "project_id": "other-project"}},
            {**value, "inputs": {**value["inputs"], "existing_service_uid": legacy.PLAN}},
            {**value, "inputs": {**value["inputs"], "creation_image": "registry/image:latest"}},
        ):
            cases.append(profile.canonical(changed))
        for data in cases:
            with self.subTest(data_length=len(data)), self.assertRaises(profile.ProfileError):
                profile.parse_target(data)

    def test_cross_project_source_origin_runtime_and_duplicate_anchors_fail(self):
        value = profile.compile_target(profiles.adopted(), "user")
        mutations = [
            (
                "source",
                "repositoryResource",
                value["source"]["repositoryResource"].replace("222333444555", "999888777666"),
            ),
            ("source", "repositoryUrl", "https://token@github.com/owner/repository.git"),
            ("inputs", "web_origin", "https://market-web-999888777666.europe-west3.run.app"),
            ("inputs", "runtime_account_id", "admin@other-project.iam.gserviceaccount.com"),
            ("adoption", "planTriggerId", value["adoption"]["applyTriggerId"]),
        ]
        for group, field, changed in mutations:
            candidate = copy.deepcopy(value)
            candidate[group][field] = changed
            with self.subTest(field=field), self.assertRaises(profile.ProfileError):
                profile.parse_target(profile.canonical(candidate))

    def test_web_build_is_closed_public_configuration_bound_to_the_instance(self):
        value = profile.compile_target(profiles.adopted(), "web")
        for field, changed in (
            ("_FIREBASE_PROJECT_ID", "other-project"),
            ("_FIREBASE_APP_ID", "1:999888777666:web:" + "b" * 24),
            ("_REGION", "us-east1"),
            ("_API_BASE_URL", "https://market-api-999888777666.europe-west3.run.app"),
            ("_BACKEND_TOKEN", "synthetic"),
        ):
            candidate = copy.deepcopy(value)
            candidate["build"][field] = changed
            with self.subTest(field=field), self.assertRaises(profile.ProfileError):
                profile.parse_target(profile.canonical(candidate))

    def test_partial_web_adoption_keeps_missing_optional_apis_and_anonymous_firebase_valid(self):
        full = profiles.adopted()
        for target in ("user", "config"):
            full["targets"][target].update(
                enabled=False, lifecycle="create", adoption=None, origin=None, image=None
            )
        for anonymous in (False, True):
            if anonymous:
                full["firebase"] = {
                    "enabled": False,
                    "apiKey": "",
                    "authDomain": "",
                    "appId": "",
                }
            instance = profile.compile_target(full, "web")
            self.assertEqual(instance["build"]["_USER_API_BASE_URL"], "")
            self.assertEqual(instance["build"]["_CONFIG_API_BASE_URL"], "")
            self.assertEqual(profile.parse_target(profile.canonical(instance)), instance)
            rendered = profile.render(full)
            self.assertEqual(instance["build"], rendered["web-substitutions.candidate.json"])
            if anonymous:
                self.assertEqual(instance["build"]["_FIREBASE_PROJECT_ID"], "")
            with tempfile.TemporaryDirectory() as name:
                source = Path(name) / "partial.profile.json"
                source.write_bytes(profile.canonical(full))
                subprocess.run(
                    [
                        sys.executable,
                        str(profiles.DIRECTORY / "deployment_profile.py"),
                        "validate",
                        "--profile",
                        str(source),
                    ],
                    capture_output=True,
                    check=True,
                )

    def test_compile_cli_writes_four_private_files_and_only_prints_hashes(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            source, output = root / "profile.json", root / "review"
            value = profiles.adopted()
            source.write_bytes(profile.canonical(value))
            result = subprocess.run(
                [
                    sys.executable,
                    str(profiles.DIRECTORY / "deployment_profile.py"),
                    "compile",
                    "--profile",
                    str(source),
                    "--target",
                    "market",
                    "--output-dir",
                    str(output),
                ],
                capture_output=True,
                check=True,
            )
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
            self.assertEqual(
                set(p.name for p in output.iterdir()),
                {
                    "deployment-config.candidate.json",
                    "terraform-inputs.candidate.json",
                    "trigger-substitutions.candidate.json",
                    "manifest.json",
                },
            )
            for path in output.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            substitutions = json.loads(
                (output / "trigger-substitutions.candidate.json").read_bytes()
            )
            parsed = profile.parse_target(substitutions["_DEPLOYMENT_CONFIG"].encode())
            self.assertEqual(substitutions["_DEPLOYMENT_SHA256"], profile.digest(parsed))
            self.assertNotIn(value["project"]["id"].encode(), result.stdout + result.stderr)
            manifest = json.loads(result.stdout)
            self.assertFalse(manifest["productionActivation"])
            self.assertEqual(manifest["approval"], "not_requested")
            for file, digest in manifest["filesSha256"].items():
                self.assertEqual(
                    profile.hashlib.sha256((output / file).read_bytes()).hexdigest(), digest
                )

    def test_bootstrap_map_contains_only_explicit_adoption_projections(self):
        full = profiles.adopted()
        result = profile.render(full)["bootstrap-inputs.candidate.json"]["deployment_configs"]
        self.assertNotIn("agent-hub", result)
        self.assertIn("portfolio", result)
        for target, data in result.items():
            self.assertEqual(
                profile.parse_target(data.encode()), profile.compile_target(full, target)
            )
        self.assertEqual(
            profile.render(profiles.example())["bootstrap-inputs.candidate.json"][
                "deployment_configs"
            ],
            {},
        )


class InstanceAPI(legacy.FakeAPI):
    def __init__(self, instance):
        super().__init__()
        self.instance = instance
        project, target = instance["project"]["id"], instance["target"]
        self.state_bucket = f"{project}-tfstate" + ("" if target == "repo" else "-" + target)
        self.plan_bucket = instance["project"]["id"] + "-tfplans"
        for mode, identifier, old in (
            ("plan", legacy.PLAN, legacy.PLAN_TRIGGER),
            ("apply", legacy.APPLY, legacy.APPLY_TRIGGER),
        ):
            trigger_id = instance["adoption"][mode + "TriggerId"]
            build = self.builds[identifier]
            trigger = self.triggers.pop(old)
            self.triggers[trigger_id] = trigger
            build.update(projectId=instance["project"]["id"], buildTriggerId=trigger_id)
            build["serviceAccount"] = trigger["serviceAccount"] = (
                f"projects/{instance['project']['id']}/serviceAccounts/"
                + ("fa-infra" if target == "repo" else "fa-infra-" + target)
                + f"-{mode}@{project}.iam.gserviceaccount.com"
            )
            trigger.update(id=trigger_id, name=f"terraform-{mode}-{instance['target']}")
            build["substitutions"]["_TARGET"] = trigger["substitutions"]["_TARGET"] = instance[
                "target"
            ]
            for container in (build, trigger):
                container["substitutions"].update(
                    _DEPLOYMENT_CONFIG=profile.canonical(instance).decode(),
                    _DEPLOYMENT_SHA256=profile.digest(instance),
                )
            repository = instance["source"]["repositoryResource"]
            build["sourceProvenance"]["resolvedConnectedRepository"]["repository"] = repository
            trigger["repositoryEventConfig"]["repository"] = repository
            if mode == "apply":
                trigger["sourceToBuild"]["repository"] = repository
                trigger["gitFileSource"]["repository"] = repository

    def state_generation(self, bucket, name):
        assert bucket == self.state_bucket
        assert name == f"prod/{self.instance['target']}/default.tfstate"
        return self.generation

    def object_metadata(self, bucket, name):
        assert bucket == self.plan_bucket
        return {"generation": self.objects[name][0]}

    def download(self, bucket, name, generation):
        assert bucket == self.plan_bucket
        self.downloads.append((name, generation))
        actual, data = self.objects[name]
        assert actual == generation
        return data

    def upload(self, bucket, name, data):
        assert bucket == self.plan_bucket
        if name in self.objects:
            raise HTTPError("private-object", 412, "Already exists", {}, None)
        generation = str(100 + len(self.objects))
        self.objects[name] = generation, data
        self.uploads.append(name)
        return {"generation": generation, "sha256": profile.hashlib.sha256(data).hexdigest()}


class InstancePipelineTests(unittest.TestCase):
    def setUp(self):
        self.fixture = legacy.PipelineTests("test_no_op_plan_is_reviewable")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root, self.directory = self.fixture.root, self.fixture.directory
        self.instance = profile.compile_target(profiles.adopted(), "repo")
        self.catalog = {
            "schema_version": 2,
            "targets": {
                "repo": {
                    "enabled": True,
                    "directory": "infra/gcp/terraform/envs/prod/repo",
                    "configuration_controllers": [],
                    "deployment_source": "trigger-v1",
                }
            },
        }
        self.write_catalog()
        self.api = InstanceAPI(self.instance)
        self.variable_files = []
        self.output = io.StringIO()
        patcher = patch.object(pipeline, "command", side_effect=self.command)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write_catalog(self):
        self.fixture.write(pipeline.POLICY, json.dumps(self.catalog))

    def command(self, args, directory, allowed=(0,)):
        for argument in args:
            if argument.startswith("-var-file="):
                path = Path(argument.split("=", 1)[1])
                self.assertEqual(args[1], "plan")
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
                self.variable_files.append((path, json.loads(path.read_bytes())))
        return self.fixture.command(args, directory, allowed)

    def run_pipeline(self, mode="plan", **changes):
        arguments = dict(
            mode=mode,
            target="repo",
            identifier=legacy.PLAN if mode == "plan" else legacy.APPLY,
            commit=legacy.COMMIT,
            branch="main",
            plan_build_id=legacy.PLAN if mode == "apply" else None,
            root=self.root,
            api=self.api,
            now=legacy.NOW,
            project=self.instance["project"]["id"],
            region=self.instance["region"],
        )
        arguments.update(changes)
        with redirect_stdout(self.output):
            return pipeline.run(**arguments)

    def saved_plan(self):
        self.run_pipeline()
        self.api.builds[legacy.PLAN]["status"] = "SUCCESS"
        self.fixture.calls.clear()

    def test_plan_and_apply_bind_instance_and_use_only_one_private_plan_varfile(self):
        self.saved_plan()
        self.assertEqual(self.variable_files[0][1], profile.terraform_inputs(self.instance))
        self.assertFalse(self.variable_files[0][0].exists())
        manifest = json.loads(self.api.objects[f"plans/repo/{legacy.PLAN}/manifest.json"][1])
        for name, value in pipeline.instance_manifest(self.instance).items():
            self.assertEqual(manifest[name], value)
        self.run_pipeline("apply")
        self.assertEqual(len(self.variable_files), 1)
        self.assertNotIn("plan", [arguments[1] for arguments, _ in self.fixture.calls])
        self.assertNotIn(self.instance["source"]["repositoryResource"], self.output.getvalue())

    def test_preflight_needs_no_instance_cloud_or_terraform(self):
        with (
            patch.object(pipeline, "ROOT", self.root),
            patch.object(pipeline, "GoogleAPI", side_effect=AssertionError("cloud")),
            patch.object(pipeline, "command", side_effect=AssertionError("terraform")),
            patch.object(sys, "argv", ["pipeline", "check-registry"]),
            redirect_stdout(self.output),
        ):
            pipeline.main()

    def test_instance_market_coexists_with_unchanged_legacy_repo_and_separate_state(self):
        self.instance = profile.compile_target(profiles.adopted(), "market")
        self.api = InstanceAPI(self.instance)
        self.catalog = copy.deepcopy(legacy.POLICY)
        self.catalog["targets"]["market"] = {
            "enabled": True,
            "deployment_source": "trigger-v1",
            "directory": "infra/gcp/terraform/envs/prod/market",
            "configuration_controllers": ["module.market.terraform_data.configuration"],
        }
        self.directory = self.fixture.directory = self.root / "infra/gcp/terraform/envs/prod/market"
        self.directory.mkdir()
        (self.directory / "main.tf").write_text("terraform {}\n")
        (self.directory / ".terraform.lock.hcl").write_text("# locked\n")
        self.write_catalog()
        original = pipeline.registry(self.root, "repo")[1]
        self.run_pipeline(target="market")
        self.api.builds[legacy.PLAN]["status"] = "SUCCESS"
        self.run_pipeline("apply", target="market")
        self.assertEqual(len(self.variable_files), 1)
        self.assertEqual(self.variable_files[0][1], profile.terraform_inputs(self.instance))
        self.assertEqual(pipeline.registry(self.root, "repo")[1], original)
        self.assertNotEqual(self.api.state_bucket, original["state_bucket"])

    def test_number_id_repository_aliases_work_but_disabled_targets_never_activate(self):
        number, project = self.instance["project"]["number"], self.instance["project"]["id"]
        for trigger in self.api.triggers.values():
            for key in ("repositoryEventConfig", "sourceToBuild", "gitFileSource"):
                if key in trigger:
                    trigger[key]["repository"] = trigger[key]["repository"].replace(number, project)
        for build in self.api.builds.values():
            resolved = build["sourceProvenance"]["resolvedConnectedRepository"]
            resolved["repository"] = resolved["repository"].replace(number, project)
        self.run_pipeline()
        self.catalog["targets"]["repo"]["enabled"] = False
        self.write_catalog()
        self.api.reads.clear()
        self.fixture.calls.clear()
        with self.assertRaisesRegex(RuntimeError, "disabled"):
            self.run_pipeline()
        self.assertFalse(self.api.reads)
        self.assertFalse(self.fixture.calls)

    def test_locators_required_and_never_select_a_different_instance(self):
        for changes in [
            dict(project=None),
            dict(region=None),
            dict(project="other-project"),
            dict(region="us-east1"),
        ]:
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                self.run_pipeline(**changes)
        self.assertFalse(self.api.uploads)
        self.assertNotIn("init", [arguments[1] for arguments, _ in self.fixture.calls])

    def test_missing_invalid_or_overridden_build_and_trigger_pins_fail_closed(self):
        original = self.api
        for container_name in ("build", "trigger"):
            for key in ("_DEPLOYMENT_CONFIG", "_DEPLOYMENT_SHA256"):
                for value in (None, "", "changed"):
                    self.api = InstanceAPI(self.instance)
                    container = (
                        self.api.builds[legacy.PLAN]
                        if container_name == "build"
                        else self.api.triggers[self.instance["adoption"]["planTriggerId"]]
                    )
                    if value is None:
                        container["substitutions"].pop(key)
                    else:
                        container["substitutions"][key] = value
                    with self.subTest(container=container_name, key=key, value=value):
                        with self.assertRaises((RuntimeError, ValueError)):
                            self.run_pipeline()
                        self.assertFalse(self.api.uploads)
        self.api = original
        self.assertNotIn("init", [arguments[1] for arguments, _ in self.fixture.calls])

    def test_actual_trigger_uuid_and_exact_repository_are_not_self_authorizing(self):
        trigger_id = self.instance["adoption"]["planTriggerId"]
        self.api.triggers[trigger_id]["id"] = legacy.PLAN_TRIGGER
        with self.assertRaisesRegex(RuntimeError, "trigger identity"):
            self.run_pipeline()
        self.api = InstanceAPI(self.instance)
        other = self.instance["source"]["repositoryResource"] + "-other"
        self.api.triggers[trigger_id]["repositoryEventConfig"]["repository"] = other
        self.api.builds[legacy.PLAN]["sourceProvenance"]["resolvedConnectedRepository"][
            "repository"
        ] = other
        with self.assertRaisesRegex(RuntimeError, "instance repository"):
            self.run_pipeline()

    def test_manifest_extra_context_is_checked_even_when_fingerprint_is_unchanged(self):
        self.saved_plan()
        for key in ("instance_id", "deployment_sha256", "deployment_inputs_sha256"):
            original = copy.deepcopy(self.api.objects)
            self.api.edit_manifest(**{key: "changed"})
            with (
                self.subTest(key=key),
                self.assertRaisesRegex(RuntimeError, "different deployment"),
            ):
                self.run_pipeline("apply")
            self.api.objects = original
        self.assertNotIn("apply", [arguments[1] for arguments, _ in self.fixture.calls])

    def test_changed_configuration_after_plan_and_changed_producer_pins_cannot_apply(self):
        self.saved_plan()
        self.api.builds[legacy.PLAN]["substitutions"]["_DEPLOYMENT_SHA256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "overridden"):
            self.run_pipeline("apply")
        for container in list(self.api.builds.values()) + list(self.api.triggers.values()):
            changed = {**self.instance, "instanceId": "different-instance"}
            container["substitutions"].update(
                _DEPLOYMENT_CONFIG=profile.canonical(changed).decode(),
                _DEPLOYMENT_SHA256=profile.digest(changed),
            )
        with self.assertRaisesRegex(RuntimeError, "reviewed plan does not match"):
            self.run_pipeline("apply")

    def test_stale_static_instance_values_and_unknown_source_do_not_downgrade(self):
        entry = self.catalog["targets"]["repo"]
        entry["state_bucket"] = "other-project-tfstate"
        self.write_catalog()
        with self.assertRaisesRegex(RuntimeError, "deployment instance"):
            self.run_pipeline()
        entry.pop("state_bucket")
        self.catalog["targets"]["market"] = {
            "enabled": False,
            "directory": "infra/gcp/terraform/envs/prod/market",
            "configuration_controllers": [],
            "deployment_source": "trigger-v1",
            "apply_service_account": "stale@other-project.iam.gserviceaccount.com",
        }
        self.write_catalog()
        with self.assertRaisesRegex(RuntimeError, "deployment instance"):
            pipeline.registry(self.root, "repo")
        self.catalog["targets"].pop("market")
        entry["deployment_source"] = "unsupported"
        self.write_catalog()
        with self.assertRaisesRegex(RuntimeError, "Unsupported deployment source"):
            self.run_pipeline()

    def test_tfvars_symlinks_and_unapproved_apply_remain_forbidden(self):
        path = self.directory / "operator.auto.tfvars.json"
        path.write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "Ad-hoc"):
            self.run_pipeline()
        path.unlink()
        path = self.directory / "alias.tf"
        path.symlink_to(self.directory / "main.tf")
        with self.assertRaisesRegex(RuntimeError, "symlinks"):
            self.run_pipeline()
        path.unlink()
        self.saved_plan()
        self.api.builds[legacy.APPLY]["approval"]["result"]["decision"] = "REJECTED"
        with self.assertRaisesRegex(RuntimeError, "native Cloud Build approval"):
            self.run_pipeline("apply")


if __name__ == "__main__":
    unittest.main()
