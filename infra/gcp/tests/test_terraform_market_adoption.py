"""Market adoption boundaries and its first guarded configuration reconciliation.

Cloud snapshots below are synthetic. These tests exercise the same controller
and saved-plan policy used in production without cloud credentials or writes.
"""

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "infra/gcp"))
sys.path.insert(0, str(ROOT / "scripts/ci"))

import configure_cloud_run_service as configuration  # noqa: E402
import deploy_existing_service as release  # noqa: E402
import terraform_pipeline as pipeline  # noqa: E402
import verify_market_adoption as adoption  # noqa: E402
from checks import Plan, select  # noqa: E402
from test_configure_cloud_run_service import ConfigAPI  # noqa: E402
from test_deploy_existing_service import RESOURCE  # noqa: E402


class MarketExecutionBoundaryTests(unittest.TestCase):
    def test_reviewed_targets_are_active_with_market_state_and_controller_isolated(self):
        policy, selected, directory = pipeline.registry(ROOT, "market")
        self.assertEqual(
            {name for name, target in policy["targets"].items() if target["enabled"]},
            {"repo", "market", "user"},
        )
        self.assertEqual(directory, ROOT / "infra/gcp/terraform/envs/prod/market")
        self.assertEqual(selected["state_bucket"], f"{policy['project_id']}-tfstate-market")
        self.assertEqual(selected["state_prefix"], "prod/market")
        self.assertNotEqual(selected["state_bucket"], policy["targets"]["repo"]["state_bucket"])
        self.assertEqual(
            selected["configuration_controllers"], ["module.market.terraform_data.configuration"]
        )
        for name in ("config", "web"):
            with self.subTest(target=name), self.assertRaises(RuntimeError):
                pipeline.registry(ROOT, name)

    def test_market_infrastructure_does_not_build_unmodified_applications(self):
        self.assertEqual(
            select(
                [
                    "infra/gcp/terraform/envs/prod/market/main.tf",
                    "infra/gcp/terraform/envs/prod/market/imports.tf",
                    "infra/gcp/terraform/bootstrap/market.tf",
                    "infra/gcp/terraform/pipeline.json",
                ]
            ),
            Plan(infra=True, terraform=True),
        )

    def test_import_metadata_does_not_authorize_native_resource_replacement(self):
        policy, selected, directory = pipeline.registry(ROOT, "market")
        native = {
            "address": "module.market.google_cloud_run_v2_service.service",
            "mode": "managed",
            "type": "google_cloud_run_v2_service",
            "change": {
                "actions": ["no-op"],
                "importing": {"id": RESOURCE},
            },
        }
        plan = {
            "terraform_version": policy["terraform_version"],
            "resource_changes": [
                native,
                {
                    "address": "module.market.terraform_data.configuration",
                    "mode": "managed",
                    "type": "terraform_data",
                    "change": {"actions": ["create"]},
                },
            ],
        }
        summary = pipeline.plan_summary(
            plan, policy["terraform_version"], selected, directory, ROOT
        )
        self.assertEqual(summary, "module.market.terraform_data.configuration: create")
        for actions in (["delete"], ["delete", "create"], ["create", "delete"]):
            native["change"]["actions"] = actions
            with self.subTest(actions=actions), self.assertRaises(RuntimeError):
                pipeline.plan_summary(plan, policy["terraform_version"], selected, directory, ROOT)


class MarketFirstReconciliationTests(unittest.TestCase):
    def api(self, *, pinned):
        api = ConfigAPI()
        api.service["invokerIamDisabled"] = True
        api.service["scaling"] = {"maxInstanceCount": 2}
        api.service["template"].update(
            maxInstanceRequestConcurrency=80,
            scaling={"minInstanceCount": 0, "maxInstanceCount": 12},
        )
        container = api.service["template"]["containers"][0]
        container.update(
            image="example.invalid/market-api@sha256:" + "a" * 64,
            startupProbe={"tcpSocket": {"port": 8080}, "failureThreshold": 3},
        )
        container["resources"].update(
            limits={"cpu": "1000m", "memory": "512Mi"}, startupCpuBoost=True
        )
        container["ports"][0]["name"] = "http1"
        api.service["annotations"].update(
            {
                release.BUILD_ANNOTATION: "existing-release-build",
                release.TIME_ANNOTATION: "2026-10-23T12:00:00Z",
                release.COMMIT_ANNOTATION: "a" * 40,
            }
        )
        api.service["traffic"] = [
            {
                "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                "revision": "rollback-b",
                "percent": 100,
            }
            if pinned
            else {"type": "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", "percent": 100}
        ]
        return api

    def reconcile(self, api):
        desired = configuration.configuration(api.service)
        elapsed = 0

        def sleep(seconds):
            nonlocal elapsed
            elapsed += seconds

        with (
            patch.object(configuration.time, "sleep", side_effect=sleep),
            patch.object(configuration.time, "monotonic", side_effect=lambda: elapsed),
        ):
            return configuration.configure(api, RESOURCE, "test-service-uid", desired, 30)

    def test_cpu_normalization_preserves_public_access_live_release_and_rollback(self):
        for pinned in (False, True):
            with self.subTest(pinned_rollback=pinned):
                api = self.api(pinned=pinned)
                before = copy.deepcopy(api.service)
                after = self.reconcile(api)

                self.assertEqual(len(api.updates), 1)
                body = api.updates[0]
                self.assertEqual(body["etag"], before["etag"])
                self.assertEqual(after["uid"], before["uid"])
                self.assertTrue(after["invokerIamDisabled"])
                self.assertNotIn("invokerIamDisabled", body)
                self.assertNotIn("traffic", body)
                self.assertEqual(after["traffic"], before["traffic"])
                self.assertEqual(after["scaling"], before["scaling"])
                self.assertEqual(
                    after["template"]["containers"][0]["image"],
                    before["template"]["containers"][0]["image"],
                )
                self.assertEqual(
                    after["template"]["containers"][0]["resources"]["limits"]["cpu"], "1"
                )
                self.assertNotEqual(after["template"]["revision"], before["template"]["revision"])
                for name in (
                    release.BUILD_ANNOTATION,
                    release.TIME_ANNOTATION,
                    release.COMMIT_ANNOTATION,
                ):
                    self.assertEqual(after["annotations"][name], before["annotations"][name])
                for name in ("startupProbe", "ports"):
                    self.assertEqual(
                        after["template"]["containers"][0][name],
                        before["template"]["containers"][0][name],
                    )
                if pinned:
                    self.assertEqual(after["trafficStatuses"][0]["revision"], "rollback-b")

                # Once the one-time normalization has settled, an identical
                # controller run is read-only and creates no further revision.
                self.reconcile(api)
                self.assertEqual(len(api.updates), 1)

    def test_same_name_with_different_uid_cannot_receive_the_initial_patch(self):
        api = self.api(pinned=False)
        api.service["uid"] = "replacement-service-uid"
        with self.assertRaisesRegex(RuntimeError, "identity changed"):
            self.reconcile(api)
        self.assertEqual(api.updates, [])


class ReadOnlyAdoptionVerifierTests(unittest.TestCase):
    def test_known_resource_address_cannot_import_a_different_existing_object(self):
        cases = (
            (
                adoption.market_review,
                "module.market.google_cloud_run_v2_service.service",
                adoption.SERVICE.replace("market-api", "user-api"),
            ),
            (
                adoption.bootstrap_review,
                "module.market_image_release.google_cloudbuild_trigger.this",
                f"{adoption.BASE}/triggers/different-existing-trigger",
            ),
        )
        for review, address, wrong_id in cases:
            plan = {
                "resource_changes": [
                    {
                        "address": address,
                        "mode": "managed",
                        "change": {"actions": ["no-op"], "importing": {"id": wrong_id}},
                    }
                ]
            }
            with (
                self.subTest(review=review.__name__),
                self.assertRaisesRegex(RuntimeError, "Import ID differs"),
            ):
                review(plan)

    def test_existing_google_objects_cannot_be_created_updated_replaced_or_deleted(self):
        for review, address in (
            (adoption.market_review, "module.market.google_cloud_run_v2_service.service"),
            (
                adoption.bootstrap_review,
                "module.market_image_release.google_cloudbuild_trigger.this",
            ),
        ):
            for actions in (["create"], ["update"], ["delete", "create"], ["delete"]):
                plan = {
                    "resource_changes": [
                        {
                            "address": address,
                            "mode": "managed",
                            "change": {"actions": actions, "before": None},
                        }
                    ]
                }
                with (
                    self.subTest(review=review.__name__, actions=actions),
                    self.assertRaises(RuntimeError),
                ):
                    review(plan)

    def test_mutating_terraform_commands_stop_before_authentication_or_process_start(self):
        cloud = Mock()
        runner = adoption.Terraform("/unused/terraform", cloud, Path("/unused/evidence"))
        with patch.object(adoption.subprocess, "run") as process:
            for command in ("apply", "import"):
                with (
                    self.subTest(command=command),
                    self.assertRaisesRegex(RuntimeError, "Only read-only Terraform commands"),
                ):
                    runner.run(command, [], Path("/unused/root"), "forbidden")
            cloud.token.assert_not_called()
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
