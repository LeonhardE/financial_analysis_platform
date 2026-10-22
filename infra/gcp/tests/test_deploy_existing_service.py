"""Exercise release ordering and runtime configuration preservation without cloud calls."""

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
IMAGE = f"northamerica-northeast2-docker.pkg.dev/test-project/financial-analysis/market-api:{BUILD}"
CREATED = "2026-10-21T10:00:00.123456789Z"
COMMIT = "a" * 40


def existing_service():
    return {
        "name": RESOURCE,
        "etag": "version-1",
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
        "traffic": [{"revision": "market-api-previous", "percent": 100}],
        "ingress": "INGRESS_TRAFFIC_ALL",
        "invokerIamDisabled": False,
        "scaling": {"maxInstanceCount": 2},
        "terminalCondition": {"state": "CONDITION_SUCCEEDED"},
    }


class FakeAPI:
    def __init__(self):
        self.service = existing_service()
        self.updates = []
        self.conflict = None

    def request(self, method, resource, body=None):
        if method == "GET":
            return copy.deepcopy(self.service)
        self.updates.append(copy.deepcopy(body))
        if self.conflict:
            conflict = self.conflict
            self.conflict = None
            conflict(self.service)
            raise HTTPError(resource, 409, "etag conflict", {}, None)
        for key in ("template", "annotations", "traffic"):
            self.service[key] = copy.deepcopy(body[key])
        self.service["etag"] = "version-2"
        return {"done": True}


class DeploymentTests(unittest.TestCase):
    def deploy(self, api):
        with patch.object(deploy_script.time, "sleep"):
            return deploy_script.deploy(api, RESOURCE, IMAGE, BUILD, CREATED, COMMIT)

    def test_preserves_current_runtime_settings_and_moves_traffic_to_latest(self):
        api = FakeAPI()
        before = copy.deepcopy(api.service)
        self.assertEqual(self.deploy(api), "deployed")
        payload = api.updates[0]
        expected_template = copy.deepcopy(before["template"])
        expected_template["containers"][0]["image"] = IMAGE
        expected_template["revision"] = f"market-api-cd-{BUILD}"
        self.assertEqual(payload["template"], expected_template)
        self.assertEqual(payload["etag"], "version-1")
        self.assertEqual(payload["annotations"]["custom.example/owner"], "test")
        self.assertEqual(
            payload["traffic"],
            [
                {
                    "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
                    "percent": 100,
                }
            ],
        )
        for field in ("ingress", "invokerIamDisabled", "scaling"):
            self.assertNotIn(field, payload)
        self.assertNotIn("iam", payload)

    def test_late_earlier_build_cannot_replace_newer_accepted_build(self):
        api = FakeAPI()
        api.service["annotations"][deploy_script.TIME_ANNOTATION] = "2026-10-21T11:00:00Z"
        self.assertEqual(self.deploy(api), "superseded")
        self.assertEqual(api.updates, [])

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
        self.assertEqual(api.updates[-1]["etag"], "console-version")
        self.assertIn(
            {"name": "NEW_SETTING", "value": "yes"},
            api.service["template"]["containers"][0]["env"],
        )

    def test_failed_operation_is_reported(self):
        class FailedAPI(FakeAPI):
            def request(self, method, resource, body=None):
                if method == "PATCH":
                    return {
                        "done": True,
                        "error": {"message": "revision startup failed"},
                    }
                return super().request(method, resource, body)

        with self.assertRaisesRegex(RuntimeError, "revision startup failed"):
            self.deploy(FailedAPI())

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
