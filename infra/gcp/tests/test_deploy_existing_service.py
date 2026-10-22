"""Exercise least-privilege service polling and guarded rollouts without cloud calls."""

import copy
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

SPEC = importlib.util.spec_from_file_location(
    "deploy_existing_service", Path(__file__).parents[1] / "deploy_existing_service.py"
)
deploy_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy_script)

RESOURCE = "projects/test-project/locations/northamerica-northeast2/services/market-api"
BUILD = "d6e82c68-e0fe-4c10-a996-4d60241773eb"
REVISION = f"market-api-cd-{BUILD}"
IMAGE = f"northamerica-northeast2-docker.pkg.dev/test-project/financial-analysis/market-api:{BUILD}"
CREATED = "2026-10-21T10:00:00.123456789Z"
COMMIT = "a" * 40


def existing_service():
    return {
        "name": RESOURCE,
        "etag": "version-1",
        "generation": "7",
        "observedGeneration": "7",
        "reconciling": False,
        "annotations": {"custom.example/owner": "test"},
        "template": {
            "revision": "market-api-previous",
            "serviceAccount": "fa-api-runtime@test-project.iam.gserviceaccount.com",
            "scaling": {"minInstanceCount": 0, "maxInstanceCount": 2},
            "timeout": "300s",
            "containers": [
                {
                    "image": "previous-image",
                    "env": [{"name": "MARKET_CACHE_BACKEND", "value": "firestore"}],
                    "resources": {"limits": {"cpu": "1", "memory": "512Mi"}},
                    "ports": [{"containerPort": 8080}],
                }
            ],
        },
        "latestCreatedRevision": "market-api-previous",
        "latestReadyRevision": "market-api-previous",
        "traffic": [{"revision": "market-api-previous", "percent": 100}],
        "trafficStatuses": [{"revision": "market-api-previous", "percent": 100}],
        "ingress": "INGRESS_TRAFFIC_ALL",
        "invokerIamDisabled": False,
        "scaling": {"maxInstanceCount": 2},
        "terminalCondition": {"state": "CONDITION_SUCCEEDED"},
    }


def ready(service, *, full_names=False):
    revision = service["template"]["revision"]
    if full_names:
        revision = f"{RESOURCE}/revisions/{revision}"
    service.update(
        reconciling=False,
        observedGeneration=service["generation"],
        terminalCondition={"state": "CONDITION_SUCCEEDED"},
        latestCreatedRevision=revision,
        latestReadyRevision=revision,
        trafficStatuses=[{"revision": revision, "percent": 100}],
    )


class FakeAPI:
    """Only the exact service is readable; operation resources are not authorized.

    A permissive GET fake previously hid production's run.operations.get 403.
    Unknown/non-service reads must fail this test immediately, even when the
    operation's name exists and the PATCH was accepted asynchronously.
    """

    def __init__(self):
        self.service = existing_service()
        self.updates = []
        self.reads = []
        self.conflict = None
        self.on_patch = None
        self.on_sleep = None
        self.post_patch_reads = []
        self.operation = {
            "name": "projects/test-project/locations/northamerica-northeast2/operations/o1"
        }

    def request(self, method, resource, body=None):
        if method == "GET":
            if resource != RESOURCE:
                raise AssertionError(f"Forbidden or unknown non-service GET: {resource}")
            self.reads.append(resource)
            if len(self.reads) > 500:
                raise AssertionError("Service polling is not bounded")
            if self.updates and self.post_patch_reads:
                return copy.deepcopy(self.post_patch_reads.pop(0))
            return copy.deepcopy(self.service)
        if method != "PATCH" or resource != f"{RESOURCE}?updateMask=template,annotations,traffic":
            raise AssertionError(f"Unexpected API request: {method} {resource}")
        self.updates.append(copy.deepcopy(body))
        if self.conflict:
            conflict = self.conflict
            self.conflict = None
            conflict(self.service)
            raise HTTPError(resource, 409, "etag conflict", {}, None)
        for key in ("template", "annotations", "traffic"):
            self.service[key] = copy.deepcopy(body[key])
        self.service["etag"] = f"version-{len(self.updates) + 1}"
        self.service["generation"] = str(int(self.service["generation"]) + 1)
        ready(self.service)
        if self.on_patch:
            self.on_patch(self)
        return copy.deepcopy(self.operation)


class DeploymentTests(unittest.TestCase):
    def deploy(self, api, *, wait_seconds=600):
        self.clock = 0.0
        self.sleeps = []

        def sleep(seconds):
            self.sleeps.append(seconds)
            self.clock += seconds
            if api.on_sleep:
                api.on_sleep(api)

        with (
            patch.object(deploy_script.time, "sleep", side_effect=sleep),
            patch.object(deploy_script.time, "monotonic", side_effect=lambda: self.clock),
        ):
            return deploy_script.deploy(
                api, RESOURCE, IMAGE, BUILD, CREATED, COMMIT, wait_seconds=wait_seconds
            )

    def test_preserves_runtime_settings_and_polls_service_after_async_patch(self):
        api = FakeAPI()
        before = copy.deepcopy(api.service)
        self.assertEqual(self.deploy(api), "deployed")
        self.assertEqual(len(api.updates), 1)
        self.assertGreaterEqual(len(api.reads), 2)
        self.assertTrue(all(resource == RESOURCE for resource in api.reads))
        payload = api.updates[0]
        expected_template = copy.deepcopy(before["template"])
        expected_template["containers"][0]["image"] = IMAGE
        expected_template["revision"] = REVISION
        self.assertEqual(payload["template"], expected_template)
        self.assertEqual(payload["etag"], "version-1")
        self.assertEqual(payload["annotations"]["custom.example/owner"], "test")
        self.assertEqual(
            payload["traffic"],
            [{"type": "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", "percent": 100}],
        )
        for field in (
            "ingress",
            "invokerIamDisabled",
            "scaling",
            "generation",
            "trafficStatuses",
        ):
            self.assertNotIn(field, payload)
        self.assertNotIn("iam", payload)

    def test_operation_lookup_is_forbidden_while_service_eventually_becomes_ready(self):
        api = FakeAPI()
        api.on_patch = lambda current: current.service.update(reconciling=True)
        api.on_sleep = lambda current: ready(current.service)
        self.assertEqual(self.deploy(api), "deployed")
        self.assertTrue(self.sleeps)
        self.assertTrue(all(resource == RESOURCE for resource in api.reads))
        self.assertEqual(len(api.updates), 1)

    def test_ready_revision_names_allow_full_resource_and_zero_percent_tagged_traffic(
        self,
    ):
        api = FakeAPI()

        def completed(current):
            ready(current.service, full_names=True)
            current.service["trafficStatuses"].append(
                {"revision": "market-api-previous", "percent": 0, "tag": "old-preview"}
            )

        api.on_patch = completed
        self.assertEqual(self.deploy(api), "deployed")
        self.assertEqual(len(api.updates), 1)

    def test_stale_success_from_previous_generation_or_revision_cannot_confirm_this_build(
        self,
    ):
        changes = (
            {"observedGeneration": "7"},
            {"generation": "", "observedGeneration": ""},
            {"generation": None, "observedGeneration": None},
            {"latestCreatedRevision": "market-api-previous"},
            {"latestReadyRevision": "market-api-previous"},
            {"latestReadyRevision": ""},
            {"trafficStatuses": [{"revision": "market-api-previous", "percent": 100}]},
            {"trafficStatuses": [{"revision": REVISION, "percent": 99}]},
            {
                "trafficStatuses": [
                    {"revision": REVISION, "percent": 99},
                    {"revision": "market-api-previous", "percent": 1},
                ]
            },
            {"trafficStatuses": []},
        )
        for stale_fields in changes:
            with self.subTest(fields=stale_fields):
                api = FakeAPI()

                def stale_once(current, stale_fields=stale_fields):
                    stale = copy.deepcopy(current.service)
                    stale.update(stale_fields)
                    current.post_patch_reads = [stale]

                api.on_patch = stale_once
                self.assertEqual(self.deploy(api), "deployed")
                self.assertTrue(self.sleeps, "Previous success was accepted without a later read")
                self.assertGreaterEqual(len(api.reads), 3)
                self.assertEqual(len(api.updates), 1)

    def test_missing_generation_or_observed_generation_cannot_confirm_readiness(self):
        for missing in ("generation", "observedGeneration"):
            with self.subTest(field=missing):
                api = FakeAPI()

                def stale_once(current, missing=missing):
                    stale = copy.deepcopy(current.service)
                    stale.pop(missing)
                    current.post_patch_reads = [stale]

                api.on_patch = stale_once
                self.assertEqual(self.deploy(api), "deployed")
                self.assertTrue(self.sleeps)

    def test_owned_failed_revision_is_reported_even_with_old_observed_generation(self):
        for reconciling in (False, True):
            with self.subTest(reconciling=reconciling):
                api = FakeAPI()
                api.on_patch = lambda current, reconciling=reconciling: current.service.update(
                    reconciling=reconciling,
                    observedGeneration="7",
                    terminalCondition={
                        "state": "CONDITION_FAILED",
                        "message": "Container failed its readiness probe",
                    },
                )
                if reconciling:
                    # This terminal condition can still describe an old failure.
                    with self.assertRaises(TimeoutError):
                        self.deploy(api, wait_seconds=9)
                    self.assertGreaterEqual(self.clock, 9)
                else:
                    with self.assertRaisesRegex(
                        RuntimeError, "Container failed its readiness probe"
                    ):
                        self.deploy(api)
                    self.assertLessEqual(self.clock, 3)
                self.assertEqual(len(api.updates), 1)

    def test_pending_states_keep_polling_until_bounded_600_second_timeout(self):
        for state in (
            "CONDITION_PENDING",
            "CONDITION_RECONCILING",
            "CONDITION_STATE_UNSPECIFIED",
        ):
            with self.subTest(state=state):
                api = FakeAPI()
                api.on_patch = lambda current, state=state: current.service.update(
                    reconciling=False,
                    terminalCondition={"state": state},
                )
                with self.assertRaises(TimeoutError):
                    self.deploy(api)
                self.assertGreaterEqual(self.clock, 600)
                self.assertLessEqual(self.clock, 603)
                self.assertEqual(len(api.updates), 1)
                self.assertLessEqual(len(api.reads), 202)

    def test_reconciling_service_with_previous_success_waits_until_timeout(self):
        api = FakeAPI()
        api.on_patch = lambda current: current.service.update(reconciling=True)
        with self.assertRaises(TimeoutError):
            self.deploy(api, wait_seconds=9)
        self.assertGreaterEqual(self.clock, 9)
        self.assertEqual(len(api.updates), 1)

    def test_settled_manual_template_change_fails_without_overwriting_console_settings(
        self,
    ):
        api = FakeAPI()

        def manual_change(current):
            current.service["template"]["revision"] = "market-api-console-edit"
            current.service["template"]["containers"][0]["image"] = "manual-image"
            current.service["template"]["containers"][0]["env"].append(
                {"name": "CONSOLE_SETTING", "value": "keep"}
            )
            current.service["generation"] = "9"
            ready(current.service)

        api.on_patch = manual_change
        with self.assertRaises(RuntimeError):
            self.deploy(api)
        self.assertEqual(len(api.updates), 1)
        self.assertEqual(api.service["template"]["containers"][0]["image"], "manual-image")
        self.assertIn(
            {"name": "CONSOLE_SETTING", "value": "keep"},
            api.service["template"]["containers"][0]["env"],
        )

    def test_settled_console_traffic_rollback_cannot_pass_with_stale_success_status(
        self,
    ):
        api = FakeAPI()

        def traffic_rollback(current):
            # The desired Console traffic changed while observed fields still
            # describe our just-ready revision. Never report this as deployed.
            current.service["traffic"] = [
                {
                    "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                    "revision": "market-api-previous",
                    "percent": 100,
                }
            ]
            current.service["generation"] = "9"
            current.service["observedGeneration"] = "9"

        api.on_patch = traffic_rollback
        with self.assertRaises(TimeoutError):
            self.deploy(api, wait_seconds=9)
        self.assertGreaterEqual(self.clock, 9)
        self.assertEqual(len(api.updates), 1)
        self.assertEqual(api.service["traffic"][0]["revision"], "market-api-previous")

    def test_stale_get_after_accepted_patch_cannot_issue_a_second_patch(self):
        api = FakeAPI()
        old_snapshot = copy.deepcopy(api.service)
        api.on_patch = lambda current: current.post_patch_reads.extend([old_snapshot, old_snapshot])
        self.assertEqual(self.deploy(api), "deployed")
        self.assertEqual(len(api.updates), 1)
        self.assertGreaterEqual(len(api.reads), 4)
        self.assertGreaterEqual(len(self.sleeps), 2)

    def test_direct_service_get_403_is_not_swallowed_or_retried_as_operation_permission(
        self,
    ):
        class DeniedAPI(FakeAPI):
            def request(self, method, resource, body=None):
                if method == "GET" and resource == RESOURCE:
                    raise HTTPError(resource, 403, "run.services.get denied", {}, None)
                return super().request(method, resource, body)

        api = DeniedAPI()
        with self.assertRaises(HTTPError) as failed:
            self.deploy(api)
        self.assertEqual(failed.exception.code, 403)
        self.assertEqual(api.updates, [])
        self.assertEqual(self.sleeps, [])

    def test_service_poll_get_403_after_patch_is_not_swallowed(self):
        class PollDeniedAPI(FakeAPI):
            def request(self, method, resource, body=None):
                if method == "GET" and resource == RESOURCE and self.updates:
                    raise HTTPError(resource, 403, "run.services.get denied", {}, None)
                return super().request(method, resource, body)

        api = PollDeniedAPI()
        with self.assertRaises(HTTPError) as failed:
            self.deploy(api)
        self.assertEqual(failed.exception.code, 403)
        self.assertEqual(len(api.updates), 1)

    def test_direct_patch_403_is_not_swallowed_or_retried(self):
        class PatchDeniedAPI(FakeAPI):
            def request(self, method, resource, body=None):
                if method == "PATCH":
                    self.updates.append(copy.deepcopy(body))
                    raise HTTPError(resource, 403, "run.services.update denied", {}, None)
                return super().request(method, resource, body)

        api = PatchDeniedAPI()
        with self.assertRaises(HTTPError) as failed:
            self.deploy(api)
        self.assertEqual(failed.exception.code, 403)
        self.assertEqual(len(api.updates), 1)
        self.assertEqual(self.sleeps, [])

    def test_late_earlier_build_cannot_replace_newer_accepted_build(self):
        api = FakeAPI()
        api.service["annotations"][deploy_script.TIME_ANNOTATION] = "2026-10-21T11:00:00Z"
        self.assertEqual(self.deploy(api), "superseded")
        self.assertEqual(api.updates, [])

    def test_inflight_newer_build_supersedes_without_being_overwritten(self):
        api = FakeAPI()
        api.on_patch = lambda current: current.service.update(reconciling=True)

        def newer_release(current):
            current.service["annotations"][deploy_script.TIME_ANNOTATION] = "2026-10-21T11:00:00Z"
            current.service["annotations"][deploy_script.BUILD_ANNOTATION] = "newer-build"
            current.service["template"]["revision"] = "market-api-newer"
            current.service["template"]["containers"][0]["image"] = "newer-build-image"
            current.service["generation"] = "9"
            ready(current.service)

        api.on_sleep = newer_release
        self.assertEqual(self.deploy(api), "superseded")
        self.assertEqual(len(api.updates), 1)
        self.assertEqual(api.service["template"]["containers"][0]["image"], "newer-build-image")

    def test_etag_conflict_rechecks_newer_release_before_retry(self):
        api = FakeAPI()

        def newer_release(service):
            service["annotations"][deploy_script.TIME_ANNOTATION] = "2026-10-21T11:00:00Z"
            service["template"]["containers"][0]["image"] = "newer-build-image"

        api.conflict = newer_release
        self.assertEqual(self.deploy(api), "superseded")
        self.assertEqual(len(api.updates), 1)
        self.assertEqual(api.service["template"]["containers"][0]["image"], "newer-build-image")

    def test_etag_conflict_preserves_console_configuration_changes(self):
        api = FakeAPI()

        def console_change(service):
            service["etag"] = "console-version"
            service["template"]["containers"][0]["env"].append(
                {"name": "NEW_SETTING", "value": "yes"}
            )

        api.conflict = console_change
        self.assertEqual(self.deploy(api), "deployed")
        self.assertEqual(len(api.updates), 2)
        self.assertEqual(api.updates[-1]["etag"], "console-version")
        self.assertIn(
            {"name": "NEW_SETTING", "value": "yes"},
            api.service["template"]["containers"][0]["env"],
        )

    def test_error_returned_in_initial_patch_response_is_reported(self):
        api = FakeAPI()
        api.operation = {"done": True, "error": {"message": "revision startup failed"}}
        with self.assertRaisesRegex(RuntimeError, "revision startup failed"):
            self.deploy(api)
        self.assertEqual(len(api.updates), 1)

    def test_missing_etag_fails_closed(self):
        api = FakeAPI()
        del api.service["etag"]
        with self.assertRaisesRegex(RuntimeError, "etag"):
            self.deploy(api)
        self.assertEqual(api.updates, [])

    def test_timestamp_preserves_nanosecond_order(self):
        self.assertLess(
            deploy_script.timestamp(CREATED),
            deploy_script.timestamp("2026-10-21T10:00:00.123456790Z"),
        )
        self.assertEqual(
            deploy_script.timestamp("2026-10-21T10:00:00.123Z"),
            deploy_script.timestamp("2026-10-21T10:00:00.123000000Z"),
        )

    def test_non_main_source_is_rejected_without_cloud_calls(self):
        args = [
            "deploy",
            "--project=test-project",
            "--region=northamerica-northeast2",
            "--build-region=northamerica-northeast2",
            "--service=market-api",
            f"--image={IMAGE}",
            f"--build-id={BUILD}",
            f"--commit={COMMIT}",
            "--branch=feature/untrusted",
        ]
        with patch("sys.argv", args), patch.object(deploy_script, "gcloud") as cloud:
            with self.assertRaisesRegex(RuntimeError, "main-branch"):
                deploy_script.main()
            cloud.assert_not_called()


if __name__ == "__main__":
    unittest.main()
