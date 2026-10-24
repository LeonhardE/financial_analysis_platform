"""Conditional configuration writes must preserve releases and rollback routes."""

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).parents[1]))
import configure_cloud_run_service as config
import deploy_existing_service as release
import test_deploy_existing_service as deployment_tests
from test_deploy_existing_service import (
    BUILD,
    COMMIT,
    CREATED,
    IMAGE,
    RESOURCE,
    FakeAPI,
    existing_service,
    ready,
)


class ConfigAPI:
    def __init__(self):
        self.service = existing_service()
        self.service["uid"] = "test-service-uid"
        self.service["template"]["containers"][0]["resources"]["cpuIdle"] = True
        self.updates = []
        self.post_patch_reads = []
        self.conflict = None
        self.after_patch = None

    def request(self, method, resource, body=None):
        if method == "GET" and resource == RESOURCE:
            if self.updates and self.post_patch_reads:
                return copy.deepcopy(self.post_patch_reads.pop(0))
            return copy.deepcopy(self.service)
        if method != "PATCH" or resource != RESOURCE + "?updateMask=template,ingress,annotations":
            raise AssertionError("Unexpected configuration request")
        self.updates.append(copy.deepcopy(body))
        if self.conflict:
            callback, self.conflict = self.conflict, None
            callback(self.service)
            raise HTTPError(resource, 412, "etag conflict", {}, None)
        if body["etag"] != self.service["etag"]:
            raise AssertionError("Unconditional configuration write")
        self.service.update(
            {key: copy.deepcopy(body[key]) for key in ("template", "ingress", "annotations")}
        )
        self.service["generation"] = str(int(self.service["generation"]) + 1)
        self.service["etag"] += "-next"
        ready(self.service)
        self.service["trafficStatuses"] = [
            dict(
                entry,
                revision=(
                    self.service["template"]["revision"]
                    if entry.get("type") == "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
                    else entry.get("revision")
                ),
            )
            for entry in self.service["traffic"]
        ]
        if self.after_patch:
            self.after_patch(self.service)
        return {"name": "operation/unused"}


class ConfigurationTests(unittest.TestCase):
    def apply(self, api, desired=None, wait_seconds=30):
        desired = desired or {**config.configuration(api.service), "environment": {"MODE": "two"}}
        self.clock = 0

        def sleep(seconds):
            self.clock += seconds

        with (
            patch.object(config.time, "sleep", side_effect=sleep),
            patch.object(config.time, "monotonic", side_effect=lambda: self.clock),
        ):
            return config.configure(api, RESOURCE, "test-service-uid", desired, wait_seconds)

    def test_preserves_release_traffic_and_unowned_container_fields(self):
        api = ConfigAPI()
        api.service["template"]["containers"][0]["startupProbe"] = {"tcpSocket": {"port": 8080}}
        api.service["template"]["containers"][0]["ports"][0]["name"] = "h2c"
        api.service["annotations"].update(
            {release.BUILD_ANNOTATION: BUILD, release.TIME_ANNOTATION: CREATED}
        )
        before = copy.deepcopy(api.service)
        after = self.apply(api)
        self.assertEqual(after["traffic"], before["traffic"])
        self.assertEqual(
            after["template"]["containers"][0]["image"],
            before["template"]["containers"][0]["image"],
        )
        self.assertEqual(
            after["template"]["containers"][0]["startupProbe"],
            before["template"]["containers"][0]["startupProbe"],
        )
        self.assertEqual(after["annotations"][release.BUILD_ANNOTATION], BUILD)
        self.assertEqual(after["annotations"][release.TIME_ANNOTATION], CREATED)
        self.assertEqual(after["annotations"][release.CONFIG_BASE_BUILD_ANNOTATION], BUILD)
        self.assertEqual(
            after["annotations"][release.CONFIG_REVISION_ANNOTATION], after["template"]["revision"]
        )
        self.assertNotIn("traffic", api.updates[0])
        self.assertEqual(api.updates[0]["etag"], before["etag"])
        self.assertNotEqual(after["template"]["revision"], before["template"]["revision"])
        self.assertEqual(after["template"]["containers"][0]["ports"][0]["name"], "h2c")

    def test_old_get_after_patch_waits_without_duplicate_write(self):
        api = ConfigAPI()
        old = copy.deepcopy(api.service)
        old["terminalCondition"] = {"state": "CONDITION_FAILED"}
        api.after_patch = lambda _service: api.post_patch_reads.append(old)
        self.apply(api)
        self.assertEqual(len(api.updates), 1)

    def test_omitted_cpu_idle_is_repaired_to_request_billing(self):
        api = ConfigAPI()
        api.service["template"]["containers"][0]["resources"].pop("cpuIdle")
        desired = config.configuration(api.service)
        self.apply(api, desired)
        self.assertTrue(api.service["template"]["containers"][0]["resources"]["cpuIdle"])
        self.assertEqual(len(api.updates), 1)

    def test_release_winning_etag_is_preserved_on_retry(self):
        api = ConfigAPI()

        def winning_release(service):
            service["template"]["containers"][0]["image"] = "newer-image"
            service["template"]["revision"] = "market-api-cd-newer"
            service["annotations"][release.BUILD_ANNOTATION] = "newer-build"
            service["etag"] = "winning-release"

        api.conflict = winning_release
        after = self.apply(api)
        self.assertEqual(len(api.updates), 2)
        self.assertEqual(after["template"]["containers"][0]["image"], "newer-image")
        self.assertEqual(after["annotations"][release.CONFIG_BASE_BUILD_ANNOTATION], "newer-build")
        self.assertEqual(api.updates[1]["etag"], "winning-release")

    def test_rollback_winning_etag_stays_pinned(self):
        api = ConfigAPI()

        def rollback(service):
            service["traffic"] = [
                {
                    "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                    "revision": "old-b",
                    "percent": 100,
                }
            ]
            service["etag"] = "rollback-won"

        api.conflict = rollback
        after = self.apply(api)
        self.assertEqual(after["traffic"][0]["revision"], "old-b")
        self.assertEqual(after["trafficStatuses"][0]["revision"], "old-b")
        self.assertTrue(all("traffic" not in body for body in api.updates))

    def test_noop_does_not_create_revision(self):
        api = ConfigAPI()
        desired = config.configuration(api.service)
        self.apply(api, desired)
        self.assertEqual(api.updates, [])

    def test_missing_etag_and_replaced_service_fail_closed(self):
        for field in ("etag", "uid"):
            api = ConfigAPI()
            api.service.pop(field)
            with self.assertRaises(RuntimeError):
                self.apply(api)
            self.assertEqual(api.updates, [])

    def test_external_change_after_submission_is_not_overwritten(self):
        api = ConfigAPI()
        api.after_patch = lambda service: service["template"].update(timeout="999s")
        with self.assertRaisesRegex(RuntimeError, "changed after submission"):
            self.apply(api)
        self.assertEqual(len(api.updates), 1)

    def test_newer_release_after_config_can_complete_with_owned_settings(self):
        api = ConfigAPI()

        def newer(service):
            service["template"]["containers"][0]["image"] = "newest-image"
            service["template"]["revision"] = "market-api-cd-newest"
            ready(service)

        api.after_patch = newer
        after = self.apply(api)
        self.assertEqual(after["template"]["containers"][0]["image"], "newest-image")
        self.assertEqual(len(api.updates), 1)

    def test_failed_revision_and_unobserved_generation_never_report_success(self):
        for update in (
            {"terminalCondition": {"state": "CONDITION_FAILED"}},
            {"observedGeneration": "0"},
        ):
            api = ConfigAPI()
            api.after_patch = lambda service, update=update: service.update(update)
            with self.assertRaises((RuntimeError, TimeoutError)):
                self.apply(api, wait_seconds=9)
            self.assertEqual(len(api.updates), 1)

    def test_nonlocal_fixture_transport_rejected_without_network(self):
        for value in (
            "https://run.googleapis.com/v2/",
            "http://localhost:123/v2/",
            "http://127.0.0.1:123/other",
            "http://user@127.0.0.1:123/v2/",
        ):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                config.FixtureAPI(value)

    def test_input_cannot_include_release_fields(self):
        api = ConfigAPI()
        with self.assertRaisesRegex(RuntimeError, "Unexpected"):
            self.apply(api, {**config.configuration(api.service), "image": "unreviewed"})
        self.assertEqual(api.updates, [])


class ReleaseConfigurationRaceTests(unittest.TestCase):
    def test_long_service_revision_fits_api_limit_and_is_deterministic(self):
        service_id = "a" * 49
        revision = release.deployment_revision(service_id, BUILD)
        self.assertLessEqual(len(revision), 63)
        self.assertTrue(revision.startswith(service_id + "-cd-"))
        self.assertEqual(revision, release.deployment_revision(service_id, BUILD))
        self.assertNotEqual(revision, release.deployment_revision(service_id, "b" * 36))

    def test_attested_configuration_descendant_can_finish_release_polling(self):
        api = FakeAPI()

        def configuration_after_patch(current):
            revision = "market-api-cfg-12345678"
            current.service["template"]["revision"] = revision
            current.service["annotations"].update(
                {
                    release.CONFIG_REVISION_ANNOTATION: revision,
                    release.CONFIG_BASE_BUILD_ANNOTATION: BUILD,
                }
            )
            ready(current.service)

        api.on_patch = configuration_after_patch
        self.assertEqual(deployment_tests.DeploymentTests().deploy(api), "deployed")
        self.assertEqual(len(api.updates), 1)

    def test_wrong_config_attestation_cannot_finish_release(self):
        for wrong in ("build", "revision", "image"):
            api = FakeAPI()

            def invalid(current, wrong=wrong):
                revision = "market-api-cfg-12345678"
                current.service["template"]["revision"] = revision
                current.service["annotations"].update(
                    {
                        release.CONFIG_REVISION_ANNOTATION: revision,
                        release.CONFIG_BASE_BUILD_ANNOTATION: BUILD,
                    }
                )
                if wrong == "build":
                    current.service["annotations"][release.CONFIG_BASE_BUILD_ANNOTATION] = "other"
                elif wrong == "revision":
                    current.service["annotations"][release.CONFIG_REVISION_ANNOTATION] = "other"
                else:
                    current.service["template"]["containers"][0]["image"] = "other"
                ready(current.service)

            api.on_patch = invalid
            with self.subTest(wrong=wrong), self.assertRaisesRegex(RuntimeError, "changed outside"):
                deployment_tests.DeploymentTests().deploy(api)
            self.assertEqual(len(api.updates), 1)

    def test_new_release_removes_old_configuration_attestation(self):
        service = existing_service()
        service["annotations"].update(
            {release.CONFIG_REVISION_ANNOTATION: "old", release.CONFIG_BASE_BUILD_ANNOTATION: "old"}
        )
        body = release.deployment_body(service, IMAGE, BUILD, CREATED, COMMIT)
        self.assertNotIn(release.CONFIG_REVISION_ANNOTATION, body["annotations"])
        self.assertNotIn(release.CONFIG_BASE_BUILD_ANNOTATION, body["annotations"])
