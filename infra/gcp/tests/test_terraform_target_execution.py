"""Adversarial boundaries for independent Terraform target execution.

These tests use local files and Cloud Build/Storage fixtures only. They do not
create service roots, resources, or credentials in the actual repository/cloud.
"""

import copy
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "target_pipeline_fixtures", Path(__file__).with_name("test_terraform_pipeline.py")
)
fixtures = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixtures)
pipeline = fixtures.pipeline


class TargetFixture:
    def setUp(self):
        # Compose the fixture rather than inheriting its TestCase: each existing
        # trust-boundary test should execute once in discovery, not twice.
        self.fixture = fixtures.PipelineTests("test_no_op_plan_is_reviewable")
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.root = self.fixture.root
        self.policy = copy.deepcopy(fixtures.POLICY)
        self.policy["schema_version"] = 2
        repo = self.policy["targets"]["repo"]
        repo.update(
            enabled=True,
            state_bucket=self.policy["state_bucket"],
            configuration_controllers=[],
        )
        self.policy["targets"]["market"] = self.target("market")
        self.module = self.root / "infra/gcp/terraform/modules/cloud-run-service"
        self.module.mkdir(parents=True, exist_ok=True)
        (self.module / "main.tf").write_text("# approved shared configuration controller\n")
        self.save_policy()

    def target(self, name, *, enabled=True):
        return {
            "enabled": enabled,
            "directory": f"infra/gcp/terraform/envs/prod/{name}",
            "state_bucket": f"{self.policy['project_id']}-tfstate-{name}",
            "state_prefix": f"prod/{name}",
            "plan_trigger": f"terraform-plan-{name}",
            "apply_trigger": f"terraform-apply-{name}",
            "plan_service_account": (
                f"fa-infra-{name}-plan@{self.policy['project_id']}.iam.gserviceaccount.com"
            ),
            "apply_service_account": (
                f"fa-infra-{name}-apply@{self.policy['project_id']}.iam.gserviceaccount.com"
            ),
            "configuration_controllers": [],
        }

    def save_policy(self):
        self.fixture.write(pipeline.POLICY, json.dumps(self.policy))
        for selected in self.policy["targets"].values():
            if selected.get("enabled") is True:
                path = self.root / selected["directory"]
                if path.is_relative_to(self.root) and ".." not in path.parts:
                    path.mkdir(parents=True, exist_ok=True)
                    (path / "main.tf").write_text("terraform {}\n")
                    (path / ".terraform.lock.hcl").write_text("# locked\n")

    def activate_market(self):
        self.selected = self.policy["targets"]["market"]
        self.directory = self.root / self.selected["directory"]
        self.fixture.directory = self.directory
        for mode, identifier, trigger_id in (
            ("plan", fixtures.PLAN, fixtures.PLAN_TRIGGER),
            ("apply", fixtures.APPLY, fixtures.APPLY_TRIGGER),
        ):
            account = (
                f"projects/{self.policy['project_id']}/serviceAccounts/"
                + self.selected[f"{mode}_service_account"]
            )
            build = self.fixture.api.builds[identifier]
            build["serviceAccount"] = account
            build["substitutions"]["_TARGET"] = "market"
            trigger = self.fixture.api.triggers[trigger_id]
            trigger["serviceAccount"] = account
            trigger["name"] = self.selected[f"{mode}_trigger"]
            trigger.setdefault("substitutions", {})["_TARGET"] = "market"

        def state_generation(bucket, name):
            self.assertEqual(bucket, self.selected["state_bucket"])
            self.assertEqual(name, "prod/market/default.tfstate")
            return self.fixture.api.generation

        self.fixture.api.state_generation = state_generation

    def run_target(self, mode="plan", **kwargs):
        return self.fixture.run_pipeline(mode, target="market", **kwargs)

    def save_plan(self):
        self.run_target()
        self.fixture.api.builds[fixtures.PLAN]["status"] = "SUCCESS"
        self.fixture.calls.clear()

    def edit_manifest(self, **changes):
        key = f"plans/market/{fixtures.PLAN}/manifest.json"
        generation, data = self.fixture.api.objects[key]
        manifest = json.loads(data)
        manifest.update(changes)
        self.fixture.api.objects[key] = (generation, json.dumps(manifest).encode())

    def approved_plan(self):
        return {
            "terraform_version": self.policy["terraform_version"],
            "configuration": {
                "root_module": {
                    "module_calls": {"service": {"source": "../../../modules/cloud-run-service"}}
                }
            },
            "resource_changes": [
                {
                    "address": "module.service.terraform_data.configuration",
                    "mode": "managed",
                    "type": "terraform_data",
                    "name": "configuration",
                    "provider_name": "terraform.io/builtin/terraform",
                    "change": {"actions": ["delete", "create"]},
                }
            ],
        }

    def summarize(self, plan):
        selected = self.policy["targets"]["market"]
        return pipeline.plan_summary(
            plan,
            self.policy["terraform_version"],
            selected=selected,
            directory=self.root / selected["directory"],
            root=self.root,
        )


class RegistryIsolationTests(TargetFixture, unittest.TestCase):
    def test_service_target_selects_its_own_backend_and_repo_keeps_original_backend(self):
        _, market, directory = pipeline.registry(self.root, "market")
        _, repo, _ = pipeline.registry(self.root, "repo")
        self.assertEqual(directory, self.root / market["directory"])
        self.assertEqual(market["state_bucket"], f"{fixtures.PROJECT}-tfstate-market")
        self.assertEqual(repo["state_bucket"], self.policy["state_bucket"])
        self.assertNotEqual(repo["state_bucket"], market["state_bucket"])

    def test_disabled_target_does_not_require_a_provisioned_directory_but_cannot_execute(self):
        self.policy["targets"]["user"] = self.target("user", enabled=False)
        self.save_policy()
        self.assertFalse((self.root / self.policy["targets"]["user"]["directory"]).exists())
        pipeline.registry(self.root, "repo")
        with self.assertRaises(RuntimeError):
            pipeline.registry(self.root, "user")
        self.assertEqual(self.fixture.api.reads, [])

    def test_invalid_schema_and_missing_or_nonboolean_enablement_are_rejected(self):
        original = copy.deepcopy(self.policy)
        for value in (1, 3, "2", None):
            self.policy = copy.deepcopy(original)
            self.policy["schema_version"] = value
            self.save_policy()
            with self.subTest(schema=value), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")
        for value in (None, "true", 1):
            self.policy = copy.deepcopy(original)
            if value is None:
                self.policy["targets"]["market"].pop("enabled")
            else:
                self.policy["targets"]["market"]["enabled"] = value
            self.save_policy()
            with self.subTest(enabled=value), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")

    def test_unselected_malformed_target_cannot_hide_behind_a_valid_repo_selection(self):
        original = copy.deepcopy(self.policy)
        for value in (None, [], "market"):
            self.policy = copy.deepcopy(original)
            self.policy["targets"]["user"] = value
            self.fixture.write(pipeline.POLICY, json.dumps(self.policy))
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")

    def test_target_root_symlink_cannot_alias_a_different_directory(self):
        directory = self.root / self.policy["targets"]["market"]["directory"]
        for child in directory.iterdir():
            child.unlink()
        directory.rmdir()
        elsewhere = self.root / "outside-production-roots"
        elsewhere.mkdir()
        directory.symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            pipeline.registry(self.root, "market")

    def test_target_slug_cannot_escape_paths_or_overflow_service_account_budget(self):
        original = copy.deepcopy(self.policy)
        for name in ("../market", "Market", "market/user", "market_1", "a" * 16):
            self.policy = copy.deepcopy(original)
            self.policy["targets"][name] = self.target(name, enabled=False)
            self.save_policy()
            with self.subTest(target=name), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")

    def test_global_registry_rejects_collisions_even_in_an_unselected_disabled_target(self):
        original = copy.deepcopy(self.policy)
        for field in (
            "directory",
            "state_prefix",
            "state_bucket",
            "plan_service_account",
            "apply_service_account",
            "plan_trigger",
            "apply_trigger",
        ):
            self.policy = copy.deepcopy(original)
            user = self.target("user", enabled=False)
            user[field] = self.policy["targets"]["market"][field]
            self.policy["targets"]["user"] = user
            self.save_policy()
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")

    def test_plan_and_apply_cannot_share_an_identity_or_trigger_within_one_target(self):
        original = copy.deepcopy(self.policy)
        for field, other in (
            ("apply_service_account", "plan_service_account"),
            ("apply_trigger", "plan_trigger"),
        ):
            self.policy = copy.deepcopy(original)
            market = self.policy["targets"]["market"]
            market[field] = market[other]
            self.save_policy()
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")

    def test_target_cannot_alias_another_root_even_with_a_distinct_backend(self):
        original = copy.deepcopy(self.policy)
        for value in (
            "infra/gcp/terraform/envs/prod/repo",
            "infra/gcp/terraform/envs/prod/market/child",
            "infra/gcp/terraform/envs/prod/market/../repo",
            "/tmp/market",
        ):
            self.policy = copy.deepcopy(original)
            self.policy["targets"]["market"]["directory"] = value
            self.save_policy()
            with self.subTest(directory=value), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")

    def test_controller_registry_cannot_expand_to_arbitrary_or_multiple_replacements(self):
        original = copy.deepcopy(self.policy)
        for controllers in (
            "module.service.terraform_data.configuration",
            ["terraform_data.configuration"],
            ["module.service.google_cloud_run_v2_service.service"],
            ["module.service[0].terraform_data.configuration"],
            ["module.outer.module.service.terraform_data.configuration"],
            [
                "module.first.terraform_data.configuration",
                "module.second.terraform_data.configuration",
            ],
        ):
            self.policy = copy.deepcopy(original)
            self.policy["targets"]["market"]["configuration_controllers"] = controllers
            self.save_policy()
            with self.subTest(controllers=controllers), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")
        self.policy = copy.deepcopy(original)
        self.policy["targets"]["repo"]["configuration_controllers"] = [
            "module.service.terraform_data.configuration"
        ]
        self.save_policy()
        with self.assertRaises(RuntimeError):
            pipeline.registry(self.root, "repo")

    def test_nonrepo_target_cannot_use_shared_bucket_or_noncanonical_prefix(self):
        original = copy.deepcopy(self.policy)
        for change in (
            {"state_bucket": self.policy["state_bucket"]},
            {"state_prefix": "prod/market/child"},
            {"state_prefix": "prod/repo"},
            {"state_bucket": f"{fixtures.PROJECT}-tfstate-user"},
        ):
            self.policy = copy.deepcopy(original)
            self.policy["targets"]["market"].update(change)
            self.save_policy()
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                pipeline.registry(self.root, "repo")


class ControllerReplacementTests(TargetFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.policy["targets"]["market"]["configuration_controllers"] = [
            "module.service.terraform_data.configuration"
        ]
        self.save_policy()

    def test_reviewed_shared_controller_replacement_is_allowed_and_logs_only_actions(self):
        plan = self.approved_plan()
        plan["resource_changes"][0]["change"]["after"] = {"input": {"secret": "do not log"}}
        summary = self.summarize(plan)
        self.assertIn("module.service.terraform_data.configuration:", summary)
        self.assertNotIn("do not log", summary)

    def test_controller_allowlist_does_not_authorize_delete_or_create_before_delete(self):
        for actions in (["delete"], ["create", "delete"], ["delete", "read", "create"]):
            plan = self.approved_plan()
            plan["resource_changes"][0]["change"]["actions"] = actions
            with self.subTest(actions=actions), self.assertRaises(RuntimeError):
                self.summarize(plan)

    def test_native_resource_replacements_remain_blocked_alongside_approved_controller(self):
        plan = self.approved_plan()
        plan["resource_changes"].append(
            {
                "address": "module.service.google_cloud_run_v2_service.service",
                "mode": "managed",
                "type": "google_cloud_run_v2_service",
                "name": "service",
                "provider_name": "registry.terraform.io/hashicorp/google",
                "change": {"actions": ["delete", "create"]},
            }
        )
        with self.assertRaises(RuntimeError):
            self.summarize(plan)

    def test_similar_controller_names_and_nonbuiltin_provider_cannot_use_the_exception(self):
        for field, value in (
            ("address", "module.service.terraform_data.other"),
            ("address", "module.service[0].terraform_data.configuration"),
            ("address", "module.other.terraform_data.configuration"),
            ("type", "google_cloud_run_v2_service"),
            ("name", "service"),
            ("provider_name", "registry.terraform.io/hashicorp/terraform"),
            ("mode", "data"),
        ):
            plan = self.approved_plan()
            plan["resource_changes"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(RuntimeError):
                self.summarize(plan)

    def test_address_is_not_trusted_without_a_registered_controller(self):
        self.policy["targets"]["market"]["configuration_controllers"] = []
        with self.assertRaises(RuntimeError):
            self.summarize(self.approved_plan())

    def test_module_source_must_resolve_to_the_reviewed_shared_module(self):
        for source in (
            "../../../modules/unreviewed-controller",
            "../../../modules/cloud-run-service-other",
            "git::https://example.com/cloud-run-service.git",
            "hashicorp/cloud-run/google",
            "../../../modules/cloud-run-service/../../elsewhere",
        ):
            plan = self.approved_plan()
            plan["configuration"]["root_module"]["module_calls"]["service"]["source"] = source
            with self.subTest(source=source), self.assertRaises(RuntimeError):
                self.summarize(plan)

    def test_module_source_cannot_be_missing_or_replaced_by_a_nested_module(self):
        for configuration in (
            {},
            {"root_module": {}},
            {"root_module": {"module_calls": {"different": {"source": str(self.module)}}}},
            {"root_module": {"module_calls": {"service": {}}}},
        ):
            plan = self.approved_plan()
            plan["configuration"] = configuration
            with self.subTest(configuration=configuration), self.assertRaises(RuntimeError):
                self.summarize(plan)


class TargetExecutionTests(TargetFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.activate_market()

    def test_service_plan_and_apply_use_only_its_own_backend_and_artifact_prefix(self):
        self.save_plan()
        manifest = json.loads(
            self.fixture.api.objects[f"plans/market/{fixtures.PLAN}/manifest.json"][1]
        )
        self.assertEqual(manifest["schema_version"], 2)
        self.assertEqual(manifest["state_bucket"], self.selected["state_bucket"])
        self.assertEqual(manifest["state_prefix"], "prod/market")
        self.run_target("apply")
        init = next(call[0] for call in self.fixture.calls if call[0][1] == "init")
        self.assertIn(f"-backend-config=bucket={self.selected['state_bucket']}", init)
        self.assertIn("-backend-config=prefix=prod/market", init)
        self.assertTrue(all(name.startswith("plans/market/") for name in self.fixture.api.uploads))
        self.assertEqual(self.fixture.calls[-1][0][1], "apply")

    def test_unrelated_target_configuration_change_does_not_invalidate_selected_plan(self):
        self.save_plan()
        repo = self.root / self.policy["targets"]["repo"]["directory"] / "main.tf"
        repo.write_text("# independently reviewed repo configuration changed\n")
        self.run_target("apply")
        self.assertEqual(self.fixture.calls[-1][0][1], "apply")

    def test_changed_shared_controller_requires_a_new_selected_target_plan(self):
        self.save_plan()
        (self.module / "main.tf").write_text("# different controller behavior\n")
        with self.assertRaises(RuntimeError):
            self.run_target("apply")
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))
        self.assertFalse(any(call[0][1] == "init" for call in self.fixture.calls))

    def test_cross_target_state_metadata_requires_a_new_reviewed_plan(self):
        self.save_plan()
        key = f"plans/market/{fixtures.PLAN}/manifest.json"
        original = self.fixture.api.objects[key]
        for change in (
            {"state_bucket": self.policy["state_bucket"]},
            {"state_prefix": "prod/repo"},
            {"state_bucket": f"{fixtures.PROJECT}-tfstate-user"},
            {"schema_version": 1},
        ):
            self.fixture.api.objects[key] = original
            self.edit_manifest(**change)
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                self.run_target("apply")
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))
        self.assertFalse(any(call[0][1] == "init" for call in self.fixture.calls))

    def test_correct_caller_target_does_not_authorize_a_different_plan_producer(self):
        self.save_plan()
        build = self.fixture.api.builds[fixtures.PLAN]
        build["substitutions"]["_TARGET"] = "user"
        with self.assertRaises(RuntimeError):
            self.run_target("apply")
        self.assertEqual(self.fixture.api.downloads, [])
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))

    def test_correct_substitution_cannot_reuse_another_targets_execution_identity(self):
        for mode, identifier in (("plan", fixtures.PLAN), ("apply", fixtures.APPLY)):
            if mode == "apply":
                self.save_plan()
            build = self.fixture.api.builds[identifier]
            old = build["serviceAccount"]
            user = self.target("user")
            build["serviceAccount"] = (
                f"projects/{fixtures.PROJECT}/serviceAccounts/{user[f'{mode}_service_account']}"
            )
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                self.run_target(mode)
            build["serviceAccount"] = old
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))

    def test_apply_rechecks_saved_plan_safety_after_immutable_digest_verification(self):
        self.save_plan()
        self.fixture.plan_actions = ["delete", "create"]
        with self.assertRaises(RuntimeError):
            self.run_target("apply")
        self.assertEqual(len(self.fixture.api.downloads), 3)
        self.assertTrue(any(call[0][1:3] == ["show", "-json"] for call in self.fixture.calls))
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))

    def register_controller(self):
        address = "module.service.terraform_data.configuration"
        self.selected["configuration_controllers"] = [address]
        self.save_policy()
        return address

    def test_explicit_repair_produces_and_applies_only_the_registered_controller_plan(self):
        controller = self.register_controller()
        self.fixture.api.builds[fixtures.PLAN]["substitutions"]["_REPAIR_CONTROLLER"] = controller

        def controller_plan(arguments, directory, allowed=(0,)):
            if arguments[1:3] == ["show", "-json"]:
                self.fixture.calls.append((arguments, allowed))
                return json.dumps(self.approved_plan()).encode()
            return self.fixture.command(arguments, directory, allowed)

        with patch.object(pipeline, "command", side_effect=controller_plan):
            self.run_target(repair_controller=controller)
            plan_call = next(call[0] for call in self.fixture.calls if call[0][1] == "plan")
            self.assertEqual(
                [argument for argument in plan_call if argument.startswith("-replace=")],
                [f"-replace={controller}"],
            )
            manifest = json.loads(
                self.fixture.api.objects[f"plans/market/{fixtures.PLAN}/manifest.json"][1]
            )
            self.assertEqual(manifest["repair_controller"], controller)
            self.fixture.api.builds[fixtures.PLAN]["status"] = "SUCCESS"
            self.fixture.calls.clear()
            self.run_target("apply")
        self.assertEqual(self.fixture.calls[-1][0][1], "apply")
        self.assertFalse(any(call[0][1] == "plan" for call in self.fixture.calls))

    def test_repair_request_cannot_target_native_resources_or_other_controllers(self):
        self.register_controller()
        for address in (
            "module.service.google_cloud_run_v2_service.service",
            "module.other.terraform_data.configuration",
            "module.service.terraform_data.configuration -destroy",
        ):
            with self.subTest(address=address), self.assertRaises(RuntimeError):
                self.run_target(repair_controller=address)
        self.assertEqual(self.fixture.api.reads, [])
        self.assertEqual(self.fixture.calls, [])

    def test_build_repair_request_must_equal_the_runner_request(self):
        controller = self.register_controller()
        self.fixture.api.builds[fixtures.PLAN]["substitutions"]["_REPAIR_CONTROLLER"] = controller
        with self.assertRaises(RuntimeError):
            self.run_target()
        self.assertFalse(any(call[0][1] == "init" for call in self.fixture.calls))
        self.assertEqual(self.fixture.api.uploads, [])

    def test_apply_cannot_introduce_a_new_repair_request_after_review(self):
        controller = self.register_controller()
        self.save_plan()
        self.fixture.api.reads.clear()
        with self.assertRaises(RuntimeError):
            self.run_target("apply", repair_controller=controller)
        self.assertEqual(self.fixture.api.reads, [])
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))

    def test_manifest_repair_request_is_bound_to_the_successful_producer(self):
        controller = self.register_controller()
        self.save_plan()
        self.edit_manifest(repair_controller=controller)
        with self.assertRaises(RuntimeError):
            self.run_target("apply")
        self.assertFalse(any(call[0][1] == "init" for call in self.fixture.calls))
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))

    def test_service_apply_approves_no_other_trigger_even_with_valid_native_approval(self):
        self.save_plan()
        self.fixture.api.triggers[fixtures.APPLY_TRIGGER]["name"] = "terraform-apply-user"
        with self.assertRaises(RuntimeError):
            self.run_target("apply")
        self.assertEqual(self.fixture.api.downloads, [])
        self.assertFalse(any(call[0][1] == "apply" for call in self.fixture.calls))


if __name__ == "__main__":
    unittest.main()
