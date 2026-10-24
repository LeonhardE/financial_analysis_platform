"""Fail-closed safety and observed ownership proofs for the opt-in live verifier."""

import argparse
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError

SPEC = importlib.util.spec_from_file_location(
    "release_ownership_live", Path(__file__).parents[1] / "verify_release_ownership.py"
)
LIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LIVE)
PROJECT = "financial-analysis-512202"
REGION = "northamerica-northeast2"
NAME = "fv-compat-012345abcdef"
RESOURCE = f"projects/{PROJECT}/locations/{REGION}/services/{NAME}"
EMAIL = f"{NAME}@{PROJECT}.iam.gserviceaccount.com"
ACCOUNT = f"projects/{PROJECT}/serviceAccounts/{EMAIL}"
IMAGES = [
    f"{REGION}-docker.pkg.dev/{PROJECT}/financial-analysis/market-api@sha256:{v * 64}"
    for v in "abc"
]
LATEST = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
PINNED = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION"
SCOPED_PLAN = [
    {
        "address": LIVE.CONTROLLER,
        "actions": ["delete", "create"],
        "environment_changed": True,
        "release_fields_captured": False,
    }
]


def arguments(**overrides):
    values = {
        "live": True,
        "project": PROJECT,
        "region": REGION,
        "repository": "financial-analysis",
        "image_package": "market-api",
        "terraform": "/verified/terraform",
        "image_a": IMAGES[0],
        "image_b": IMAGES[1],
        "image_c": IMAGES[2],
    }
    return argparse.Namespace(**(values | overrides))


def service(image=IMAGES[0], stage="a", revision="initial", traffic_revision=None, build="build-a"):
    target = traffic_revision or revision
    return {
        "name": RESOURCE,
        "uid": "owned-uid",
        "etag": "owned-etag",
        "generation": "3",
        "observedGeneration": "3",
        "reconciling": False,
        "ingress": "INGRESS_TRAFFIC_INTERNAL_ONLY",
        "template": {
            "revision": revision,
            "serviceAccount": EMAIL,
            "scaling": {"minInstanceCount": 0, "maxInstanceCount": 1},
            "containers": [
                {
                    "image": image,
                    "env": [
                        {"name": name, "value": value}
                        for name, value in LIVE.environment(f"ownership-stage-{stage}").items()
                    ],
                    "resources": {"cpuIdle": True},
                }
            ],
        },
        "annotations": {
            LIVE.RELEASE.BUILD_ANNOTATION: build,
            LIVE.RELEASE.TIME_ANNOTATION: "2026-10-23T22:00:00Z",
            LIVE.RELEASE.COMMIT_ANNOTATION: "f" * 40,
            "private-annotation": "never-publish",
        },
        "latestReadyRevision": f"projects/630815932903/locations/{REGION}/revisions/{revision}",
        "terminalCondition": {"state": "CONDITION_SUCCEEDED"},
        "traffic": [
            {"type": PINNED, "revision": target, "percent": 100}
            if traffic_revision
            else {"type": LATEST, "percent": 100}
        ],
        "trafficStatuses": [{"type": PINNED, "revision": target, "percent": 100}],
    }


class PreflightTests(unittest.TestCase):
    def test_explicit_project_region_and_live_opt_in_checked_before_any_api(self):
        for overrides in ({"live": False}, {"project": "other-project"}, {"region": "us-central1"}):
            api = Mock()
            with self.subTest(overrides=overrides), self.assertRaises(RuntimeError):
                LIVE.verify(arguments(**overrides), api)
            api.request.assert_not_called()
            api.iam.assert_not_called()
            api.credentials.assert_not_called()

    def test_invalid_cli_stops_before_cloud_access(self):
        api = Mock()
        with self.assertRaises(argparse.ArgumentTypeError):
            LIVE.verify(arguments(terraform="/missing/terraform"), api)
        api.request.assert_not_called()
        api.iam.assert_not_called()

    def test_wrong_cli_version_stops_before_image_discovery(self):
        api = Mock()
        with (
            patch.object(LIVE, "terraform_binary", return_value="/verified/tf"),
            patch.object(
                LIVE.subprocess, "check_output", return_value='{"terraform_version":"0.0.0"}'
            ),
            self.assertRaisesRegex(RuntimeError, "pinned Terraform"),
        ):
            LIVE.verify(arguments(), api)
        api.request.assert_not_called()
        api.iam.assert_not_called()

    def test_fixture_is_private_bounded_and_uses_mock_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            LIVE.fixture(Path(temporary), arguments(), NAME, IMAGES[0], "private-stage")
            config = json.loads((Path(temporary) / "main.tf.json").read_text())
        fixture = config["module"]["service"]
        self.assertEqual(fixture["min_instances"], 0)
        self.assertEqual(fixture["max_instances"], 1)
        self.assertEqual(fixture["ingress"], "INGRESS_TRAFFIC_INTERNAL_ONLY")
        self.assertFalse(fixture["allow_unauthenticated"])
        self.assertEqual(fixture["runtime_service_account"], EMAIL)
        self.assertEqual(fixture["environment"]["MARKET_DATA_SOURCE"], "mock")
        self.assertEqual(fixture["environment"]["MARKET_CACHE_BACKEND"], "sqlite")
        self.assertNotIn("invoker_service_accounts", fixture)

    def test_source_hashes_identify_uncommitted_execution_without_private_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name in LIVE.SOURCE_FILES:
                target = directory / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(f"executed source {name}")
            with (
                patch.object(LIVE, "ROOT", directory),
                patch.object(
                    LIVE.subprocess,
                    "run",
                    return_value=SimpleNamespace(returncode=0, stdout="f" * 40 + "\n"),
                ),
            ):
                first = LIVE.source_provenance()
                (directory / "configure_cloud_run_service.py").write_text("changed source")
                second = LIVE.source_provenance()
            self.assertEqual(first["git_head"], "f" * 40)
            self.assertNotIn(str(directory), json.dumps(first))
            self.assertNotEqual(first["files_sha256"], second["files_sha256"])
            self.assertEqual(len(first["files_sha256"]), 4)
            with (
                patch.object(LIVE, "ROOT", directory),
                patch.object(LIVE.subprocess, "run", side_effect=FileNotFoundError),
            ):
                self.assertIsNone(LIVE.source_provenance()["git_head"])


class PlanTests(unittest.TestCase):
    def plan(self, address, actions, before=None, after=None):
        return {
            "resource_changes": [
                {
                    "address": address,
                    "mode": "managed",
                    "change": {"actions": actions, "before": before, "after": after},
                }
            ]
        }

    def test_native_service_must_remain_noop(self):
        self.assertEqual(LIVE.summarize_plan(self.plan(LIVE.ADDRESS, ["no-op"])), [])
        for actions in (["create"], ["update"], ["delete", "create"], ["delete"]):
            with (
                self.subTest(actions=actions),
                self.assertRaisesRegex(RuntimeError, "Native service"),
            ):
                LIVE.summarize_plan(self.plan(LIVE.ADDRESS, actions))

    def test_controller_replacement_is_allowed_without_exporting_environment_values(self):
        before = {"input": {"environment": {"STAGE": "private-before"}}}
        after = {"input": {"environment": {"STAGE": "private-after"}}}
        summary = LIVE.summarize_plan(
            self.plan(LIVE.CONTROLLER, ["delete", "create"], before, after)
        )
        self.assertEqual(summary, SCOPED_PLAN)
        self.assertNotIn("private", json.dumps(summary))

    def test_controller_cannot_capture_release_fields_or_change_unexpectedly(self):
        for key in ("image", "revision", "traffic", "annotations"):
            before = {"input": {"environment": {"STAGE": "a"}, key: "captured-release-value"}}
            after = {"input": {"environment": {"STAGE": "b"}}}
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "release-owned"):
                LIVE.summarize_plan(self.plan(LIVE.CONTROLLER, ["update"], before, after))
        with self.assertRaisesRegex(RuntimeError, "environment configuration"):
            LIVE.summarize_plan(
                self.plan(LIVE.CONTROLLER, ["update"], {"input": {}}, {"input": {}})
            )
        with self.assertRaisesRegex(RuntimeError, "Unexpected managed resource"):
            LIVE.summarize_plan(self.plan("module.production.database", ["no-op"]))

    def test_readonly_data_refresh_does_not_count_as_service_mutation(self):
        plan = self.plan("data.google_cloud_run_v2_service.configured", ["read"])
        plan["resource_changes"][0]["mode"] = "data"
        self.assertEqual(LIVE.summarize_plan(plan), [])


class ObservationTests(unittest.TestCase):
    def test_configuration_proof_rejects_wrong_image_environment_or_not_ready(self):
        expected = LIVE.environment("ownership-stage-a")
        self.assertTrue(LIVE.ready_with_configuration(service(), IMAGES[0], expected))
        for mutate in (
            lambda value: value["template"]["containers"][0].update(image=IMAGES[1]),
            lambda value: value["template"]["containers"][0]["env"].pop(),
            lambda value: value.update(reconciling=True),
            lambda value: value.update(observedGeneration="2"),
            lambda value: value["terminalCondition"].update(state="CONDITION_FAILED"),
        ):
            value = service()
            mutate(value)
            with self.subTest(mutate=mutate):
                self.assertFalse(LIVE.ready_with_configuration(value, IMAGES[0], expected))

    def test_release_proof_requires_its_exact_revision_marker_and_full_traffic(self):
        build = "00000000-0000-0000-0000-000000000001"
        revision = LIVE.RELEASE.deployment_revision(NAME, build)
        observed = service(IMAGES[1], revision=revision, build=build)
        with (
            patch.object(LIVE.uuid, "uuid4", return_value=build),
            patch.object(LIVE.RELEASE, "deploy", return_value="deployed"),
            patch.object(LIVE.LEGACY, "wait_service", return_value=observed),
        ):
            self.assertEqual(LIVE.release(Mock(), RESOURCE, IMAGES[1]), observed)
            observed["trafficStatuses"][0]["percent"] = 99
            with self.assertRaisesRegex(RuntimeError, "100% traffic"):
                LIVE.release(Mock(), RESOURCE, IMAGES[1])
        with (
            patch.object(LIVE.RELEASE, "deploy", return_value="superseded"),
            self.assertRaisesRegex(RuntimeError, "not deployed"),
        ):
            LIVE.release(Mock(), RESOURCE, IMAGES[1])

    def test_traffic_requires_complete_exact_observed_revision(self):
        value = service(revision="new", traffic_revision="old")
        self.assertTrue(LIVE.traffic_at(value, "old"))
        self.assertTrue(LIVE.traffic_at(value, "old", desired=True))
        self.assertFalse(LIVE.latest_traffic(value))
        self.assertTrue(LIVE.traffic_at(value, "projects/1/locations/x/revisions/old"))
        for traffic in (
            [],
            [{"revision": "old", "percent": 99}],
            [{"revision": "new", "percent": 100}],
            [{"revision": "old", "percent": 80}, {"revision": "new", "percent": 20}],
        ):
            value["trafficStatuses"] = traffic
            with self.subTest(traffic=traffic):
                self.assertFalse(LIVE.traffic_at(value, "old"))

    def test_snapshot_explicitly_excludes_environment_identity_and_unrelated_annotations(self):
        value = LIVE.snapshot(service())
        text = json.dumps(value)
        for forbidden in (
            "ownership-stage",
            "STAGE",
            "owned-uid",
            "owned-etag",
            "never-publish",
            EMAIL,
        ):
            self.assertNotIn(forbidden, text)
        self.assertEqual(value["deployment_build"], "build-a")

    def test_no_proof_may_be_omitted_and_cleanup_errors_fail_closed(self):
        report = {"checks": dict.fromkeys(LIVE.REQUIRED_CHECKS, True), "cleanup_errors": []}
        self.assertEqual(LIVE.classify_evidence(report), "PASS")
        for key in LIVE.REQUIRED_CHECKS:
            missing = copy.deepcopy(report)
            missing["checks"].pop(key)
            with self.subTest(key=key):
                self.assertEqual(LIVE.classify_evidence(missing), "ERROR")
        for key, value in (("error", "failed"), ("cleanup_errors", ["not deleted"])):
            self.assertEqual(LIVE.classify_evidence(report | {key: value}), "ERROR")

    def test_public_report_filters_unexpected_fields_at_every_evidence_level(self):
        value = LIVE.snapshot(service()) | {"environment": {"SECRET": "private-payload"}}
        value["traffic"][0]["private-key"] = "private-payload"
        report = {
            "verified_at": "2026-10-23T00:00:00Z",
            "status": "PASS",
            "images": IMAGES,
            "service": RESOURCE,
            "checks": dict.fromkeys(LIVE.REQUIRED_CHECKS, True),
            "evidence": {
                "baseline": value,
                "plan_before_b": [SCOPED_PLAN[0] | {"raw_plan": "private-payload"}],
                "unknown-proof": {"secret": "private-payload"},
            },
            "production_before": {"template": "private-payload"},
            "error": "private-payload",
            "cleanup_errors": ["private-payload"],
        }
        public = LIVE.public_report(report)
        self.assertNotIn("private-payload", json.dumps(public))
        self.assertNotIn("unknown-proof", public["evidence"])
        self.assertTrue(public["execution_error"])
        self.assertEqual(public["cleanup_error_count"], 1)

    def test_independent_cleanup_get_only_accepts_404(self):
        call = Mock(side_effect=HTTPError("url", 404, "gone", {}, None))
        self.assertTrue(LIVE.deleted(call, RESOURCE))
        denied = Mock(side_effect=HTTPError("url", 403, "forbidden", {}, None))
        with self.assertRaises(HTTPError):
            LIVE.deleted(denied, RESOURCE)

    def test_production_fingerprint_includes_runtime_config_without_exporting_values(self):
        api = Mock()
        api.request.return_value = service()
        result = LIVE.production_fingerprints(api, arguments())
        self.assertEqual(set(result), set(LIVE.PRODUCTION))
        self.assertNotIn("ownership-stage", json.dumps(result))
        api.request.return_value = service(stage="b")
        changed = LIVE.production_fingerprints(api, arguments())
        self.assertNotEqual(result, changed)
        self.assertTrue(all(call.args[0] == "GET" for call in api.request.call_args_list))

    def test_state_recovery_requires_exact_managed_address(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "state.json"
            output.write_text(
                json.dumps(
                    {
                        "values": {
                            "root_module": {
                                "resources": [{"address": "foreign", "values": {"uid": "wrong"}}],
                                "child_modules": [
                                    {
                                        "resources": [
                                            {"address": LIVE.ADDRESS, "values": {"uid": "right"}}
                                        ]
                                    }
                                ],
                            }
                        }
                    }
                )
            )
            tf = Mock()
            tf.run.return_value = (0, output)
            self.assertEqual(LIVE.recover_state_uid(tf), "right")


class SequenceTests(unittest.TestCase):
    def exercise(self, *, bad_stale_image=False, changed_production=False, broken_cleanup=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        (directory / "configure_cloud_run_service.py").touch()
        baseline = service()
        b = service(IMAGES[1], "a", "release-b", build="build-b")
        configured_b = service(IMAGES[1], "b", f"{NAME}-cfg-aaaaaaaa", build="build-b")
        if bad_stale_image:
            configured_b["template"]["containers"][0]["image"] = IMAGES[0]
        c = service(IMAGES[2], "b", "release-c", build="build-c")
        rollback = service(IMAGES[2], "b", "release-c", "release-b", build="build-c")
        configured_rollback = service(
            IMAGES[2], "c", f"{NAME}-cfg-bbbbbbbb", "release-b", build="build-c"
        )
        next_release = service(IMAGES[1], "c", "release-next", build="build-next")
        tf = Mock()
        (directory / "log").write_text(
            json.dumps(
                {
                    "values": {
                        "root_module": {
                            "resources": [{"address": LIVE.ADDRESS, "values": {"uid": "owned-uid"}}]
                        }
                    }
                }
            )
        )
        tf.run.return_value = (0, directory / "log")
        tf.plan.side_effect = [[], SCOPED_PLAN, SCOPED_PLAN, [], SCOPED_PLAN, [], []]
        api = Mock()
        api.iam.return_value = {"uniqueId": "1234"}
        api.request.return_value = c
        fingerprints = {name: {"fingerprint": "before"} for name in LIVE.PRODUCTION}
        after = (
            {name: {"fingerprint": "changed"} for name in LIVE.PRODUCTION}
            if changed_production
            else fingerprints
        )
        with (
            patch.object(LIVE, "ROOT", directory),
            patch.object(LIVE, "terraform_binary", return_value="/verified/tf"),
            patch.object(
                LIVE.subprocess, "check_output", return_value='{"terraform_version":"1.16.7"}'
            ),
            patch.object(LIVE, "copy_fixture"),
            patch.object(
                LIVE, "source_provenance", return_value={"git_head": None, "files_sha256": {}}
            ),
            patch.object(LIVE.tempfile, "mkdtemp", return_value=str(directory)),
            patch.object(
                LIVE.uuid,
                "uuid4",
                side_effect=[
                    SimpleNamespace(hex=value)
                    for value in ("012345abcdef", "stage-a", "stage-b", "stage-c")
                ],
            ),
            patch.object(LIVE, "Terraform", return_value=tf),
            patch.object(LIVE, "production_fingerprints", side_effect=[fingerprints, after]),
            patch.object(LIVE.LEGACY, "absent"),
            patch.object(
                LIVE.LEGACY,
                "wait_service",
                side_effect=[baseline, configured_b, rollback, configured_rollback],
            ),
            patch.object(LIVE, "release", side_effect=[b, c, next_release]) as publish,
            patch.object(
                LIVE.LEGACY, "cleanup", return_value=["cleanup failed"] if broken_cleanup else []
            ) as cleanup,
            patch.object(LIVE, "deleted", return_value=not broken_cleanup),
            patch.object(LIVE, "progress"),
        ):
            result = LIVE.verify(arguments(), api)
        report = json.loads((directory / "report.json").read_text())
        public = json.loads((directory / "public-report.json").read_text())
        return result, report, public, api, tf, cleanup, publish

    def test_complete_sequence_uses_both_saved_plans_and_cleans_up_by_recorded_identity(self):
        result, report, public, api, tf, cleanup, publish = self.exercise()
        self.assertEqual(result, 0, report.get("error"))
        self.assertEqual(report["status"], "PASS")
        self.assertTrue(all(report["checks"][key] for key in LIVE.REQUIRED_CHECKS))
        saved = [call.args for call in tf.run.call_args_list if call.args[0] == "apply"]
        self.assertIn(("apply", "-input=false", "before-b.tfplan"), saved)
        self.assertIn(("apply", "-input=false", "before-rollback.tfplan"), saved)
        self.assertEqual(
            [call.args[2] for call in publish.call_args_list], [IMAGES[1], IMAGES[2], IMAGES[1]]
        )
        cleanup.assert_called_once_with(api, RESOURCE, "owned-uid", ACCOUNT, "1234")
        self.assertNotIn("ownership-stage", json.dumps(public))
        patches = [call for call in api.request.call_args_list if call.args[0] == "PATCH"]
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0].args[2]["traffic"][0]["revision"], "release-b")

    def test_image_regression_stops_sequence_but_still_deletes_resources(self):
        result, report, _, _, _, cleanup, publish = self.exercise(bad_stale_image=True)
        self.assertEqual(result, 1)
        self.assertEqual(report["status"], "ERROR")
        self.assertFalse(report["checks"]["saved_apply_preserved_b_and_environment"])
        self.assertEqual(publish.call_count, 1)
        cleanup.assert_called_once()
        self.assertTrue(report["checks"]["production_unchanged"])

    def test_production_drift_or_cleanup_failure_prevents_pass(self):
        for overrides in ({"changed_production": True}, {"broken_cleanup": True}):
            with self.subTest(overrides=overrides):
                result, report, _, _, _, _, _ = self.exercise(**overrides)
                self.assertEqual(result, 1)
                self.assertEqual(report["status"], "ERROR")


if __name__ == "__main__":
    unittest.main()
