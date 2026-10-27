"""Offline digest/approval boundaries using a complete additional synthetic backend."""

import contextlib
import copy
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "first_provision", ROOT / "infra/gcp/first_provision.py"
)
first = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(first)

BUILD_ID = "12345678-1234-4234-8234-123456789abc"
TRIGGER_ID = "87654321-4321-4321-8321-cba987654321"
COMMIT = "a" * 40
PROJECT = "test-project"
REGION = "northamerica-northeast2"
SOURCE_URL = "https://github.com/synthetic/project.git"
REPOSITORY_RESOURCE = (
    f"projects/{PROJECT}/locations/{REGION}/connections/synthetic/repositories/project"
)
IMAGE_NAME = f"{REGION}-docker.pkg.dev/{PROJECT}/financial-analysis/synthetic-api"
DIGEST = "sha256:" + "b" * 64


def synthetic_registry(root):
    """Create no cloud resources; all future target files live in a temporary root."""
    data = json.loads((ROOT / "scripts/service-targets.json").read_text())
    data["targets"].append(
        {
            "id": "synthetic-service",
            "kind": "backend",
            "directory": "services/synthetic-service",
            "service": "synthetic-api",
            "cloudbuild": "infra/gcp/cloudbuild.synthetic.yaml",
            "release_mode": "build_only",
        }
    )

    def write(path, value="synthetic fixture\n"):
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(value)

    write("scripts/service-targets.json", json.dumps(data))
    write("services/common/pyproject.toml")
    write("services/common/tests/test_common.py", "import unittest\n")
    for target in data["targets"]:
        directory = target["directory"]
        write(directory + "/Dockerfile")
        write(target["cloudbuild"])
        if target["kind"] == "backend":
            for name in (
                "app/main.py",
                "requirements.txt",
                "requirements-dev.txt",
                "tests/test_app.py",
            ):
                write(directory + "/" + name)
        else:
            write(directory + "/package.json", "{}")
            write(directory + "/tests/app.test.cjs")
    return first.load_registry(root)


def captured_build():
    return {
        "id": BUILD_ID,
        "projectId": PROJECT,
        "status": "SUCCESS",
        "buildTriggerId": TRIGGER_ID,
        "substitutions": {
            "BRANCH_NAME": "main",
            "COMMIT_SHA": COMMIT,
            "_DEPLOY_SERVICE": "false",
            "_REGION": REGION,
            "_REPOSITORY": "financial-analysis",
        },
        "sourceProvenance": {"resolvedGitSource": {"url": SOURCE_URL, "revision": COMMIT}},
        "results": {"images": [{"name": IMAGE_NAME + ":" + BUILD_ID, "digest": DIGEST}]},
        "secretEnv": ["SyntheticPrivateMarkerNeverCopiedToReviewMaterial"],
    }


def captured_trigger():
    return {
        "id": TRIGGER_ID,
        "name": "build-synthetic-api",
        "filename": "infra/gcp/cloudbuild.synthetic.yaml",
        "substitutions": {"_DEPLOY_SERVICE": "false"},
        "repositoryEventConfig": {"repository": REPOSITORY_RESOURCE, "push": {"branch": "^main$"}},
    }


class FirstProvisionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="repo001-first-provision-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.registry = synthetic_registry(self.root)
        self.build, self.trigger = captured_build(), captured_trigger()
        self.trusted = dict(
            registry=self.registry,
            target_id="synthetic-service",
            project=PROJECT,
            region=REGION,
            artifact_repository="financial-analysis",
            repository_url=SOURCE_URL,
            commit=COMMIT,
            build_id=BUILD_ID,
        )

    def prepare(self, build=None, trigger=None, **changes):
        return first.prepare_request(
            self.build if build is None else build,
            self.trigger if trigger is None else trigger,
            **{**self.trusted, **changes},
        )

    def test_additional_backend_produces_digest_pinned_unapproved_review_material_only(self):
        self.assertEqual(len(self.registry.backends), len(first.load_registry(ROOT).backends) + 1)
        request = self.prepare()
        self.assertEqual(request["image"]["reference"], IMAGE_NAME + "@" + DIGEST)
        self.assertEqual(request["approval"], {"status": "not_requested"})
        self.assertEqual(request["execution"], "separate_reviewed_target_infrastructure_saved_plan")
        self.assertNotIn("SyntheticPrivateMarker", json.dumps(request))
        self.assertEqual(
            first.validate_request(request, self.build, self.trigger, **self.trusted), request
        )

    def test_existing_or_unregistered_targets_cannot_request_first_provision(self):
        for target in ("market-data-service", "missing-service"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.prepare(target_id=target)

    def test_only_successful_exact_main_build_and_project_are_accepted(self):
        mutations = [
            ("status", "WORKING"),
            ("status", "FAILURE"),
            ("id", TRIGGER_ID),
            ("projectId", "other-project"),
            ("buildTriggerId", BUILD_ID),
        ]
        for key, value in mutations:
            build = copy.deepcopy(self.build)
            build[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.prepare(build)
        for key, value in (
            ("BRANCH_NAME", "feature/untrusted"),
            ("COMMIT_SHA", "c" * 40),
            ("_DEPLOY_SERVICE", "true"),
            ("_REGION", "us-central1"),
            ("_REPOSITORY", "other-repository"),
        ):
            build = copy.deepcopy(self.build)
            build["substitutions"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.prepare(build)

    def test_trigger_id_name_registered_filename_and_build_only_mode_are_bound(self):
        for key, value in (
            ("id", BUILD_ID),
            ("name", "build-other-api"),
            ("filename", "infra/gcp/cloudbuild.other.yaml"),
            ("build", {"steps": []}),
            ("gitFileSource", {"path": "other.yaml"}),
        ):
            trigger = copy.deepcopy(self.trigger)
            trigger[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.prepare(trigger=trigger)
        for value in (None, {}, {"_DEPLOY_SERVICE": "true"}):
            trigger = copy.deepcopy(self.trigger)
            trigger["substitutions"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.prepare(trigger=trigger)

    def test_pull_request_tag_inverted_and_ambiguous_trigger_sources_are_rejected(self):
        for push in (
            {"branch": ".*"},
            {"branch": "^main$", "invertRegex": True},
            {"branch": "^main$", "invertRegex": "false"},
            {"tag": "v.*"},
        ):
            trigger = copy.deepcopy(self.trigger)
            trigger["repositoryEventConfig"]["push"] = push
            with self.subTest(push=push), self.assertRaises(ValueError):
                self.prepare(trigger=trigger)
        for key in ("sourceToBuild", "triggerTemplate", "github", "pubsubConfig", "webhookConfig"):
            trigger = copy.deepcopy(self.trigger)
            trigger[key] = {"source": "ambiguous"}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.prepare(trigger=trigger)

    def test_output_only_git_provenance_requires_exact_repository_revision_and_root(self):
        for source in (
            {"url": "https://github.com/other/project.git", "revision": COMMIT},
            {"url": SOURCE_URL, "revision": "c" * 40},
            {"url": SOURCE_URL, "revision": COMMIT, "dir": "other"},
            {"url": SOURCE_URL, "commitSha": COMMIT},
        ):
            build = copy.deepcopy(self.build)
            build["sourceProvenance"]["resolvedGitSource"] = source
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.prepare(build)
        for provenance in (
            {},
            {"resolvedRepoSource": {"commitSha": COMMIT}},
            {**self.build["sourceProvenance"], "resolvedUnknownSource": {"revision": COMMIT}},
        ):
            build = copy.deepcopy(self.build)
            build["sourceProvenance"] = provenance
            with self.subTest(provenance=provenance), self.assertRaises(ValueError):
                self.prepare(build)

    def test_connected_provenance_needs_explicit_resource_mapping_not_capture_self_trust(self):
        build = copy.deepcopy(self.build)
        build["sourceProvenance"] = {
            "resolvedConnectedRepository": {"repository": REPOSITORY_RESOURCE, "revision": COMMIT}
        }
        with self.assertRaises(ValueError):
            self.prepare(build)
        result = self.prepare(build, connected_repository=REPOSITORY_RESOURCE)
        self.assertEqual(result["source_provenance"]["repository_resource"], REPOSITORY_RESOURCE)
        for wrong in (
            REPOSITORY_RESOURCE.replace("/project", "/other"),
            REPOSITORY_RESOURCE.replace(REGION, "us-central1"),
        ):
            with self.subTest(resource=wrong), self.assertRaises(ValueError):
                self.prepare(build, connected_repository=wrong)

    def test_tag_digest_service_project_region_and_artifact_repository_are_exact(self):
        for name in (
            IMAGE_NAME.replace("synthetic-api", "market-api") + ":" + BUILD_ID,
            IMAGE_NAME.replace(PROJECT, "other-project") + ":" + BUILD_ID,
            IMAGE_NAME.replace(REGION, "us-central1") + ":" + BUILD_ID,
            IMAGE_NAME.replace("financial-analysis", "other") + ":" + BUILD_ID,
            IMAGE_NAME + ":latest",
            IMAGE_NAME + "@" + DIGEST,
        ):
            build = copy.deepcopy(self.build)
            build["results"]["images"][0]["name"] = name
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.prepare(build)
        for digest in (None, "", "sha256:" + "B" * 64, "sha512:" + "b" * 64, "sha256:" + "b" * 63):
            build = copy.deepcopy(self.build)
            build["results"]["images"][0]["digest"] = digest
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                self.prepare(build)

    def test_missing_duplicate_or_multiple_image_results_cannot_select_a_digest(self):
        for images in (
            None,
            [],
            self.build["results"]["images"] * 2,
            [*self.build["results"]["images"], {"name": "other-image", "digest": DIGEST}],
        ):
            build = copy.deepcopy(self.build)
            build["results"]["images"] = images
            with self.subTest(images=images), self.assertRaises(ValueError):
                self.prepare(build)

    def test_request_is_closed_exactly_recomputed_and_cannot_self_approve(self):
        request = self.prepare()
        for key, value in (
            ("target", "other-target"),
            ("commit", "c" * 40),
            ("schema_version", True),
            ("approval", {"status": "approved"}),
            ("approved", True),
            ("execution", "create-now"),
        ):
            changed = {**request, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                first.validate_request(changed, self.build, self.trigger, **self.trusted)
        changed = copy.deepcopy(request)
        changed["image"]["digest"] = "sha256:" + "c" * 64
        with self.assertRaises(ValueError):
            first.validate_request(changed, self.build, self.trigger, **self.trusted)

    def test_configuration_identifiers_and_non_https_repository_aliases_fail(self):
        for key, value in (
            ("project", "../escape"),
            ("region", "../escape"),
            ("artifact_repository", "bad/repository"),
            ("commit", "a" * 39),
            ("commit", "0" * 40),
            ("build_id", "not-a-build-id"),
            ("repository_url", "http://github.com/synthetic/project.git"),
            ("repository_url", "https://user:secret@github.com/synthetic/project.git"),
        ):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.prepare(**{key: value})

    def arguments(self, command, *extra):
        build, trigger = self.root / "build.json", self.root / "trigger.json"
        build.write_text(json.dumps(self.build))
        trigger.write_text(json.dumps(self.trigger))
        return [
            "first_provision",
            command,
            "--target=synthetic-service",
            "--project=" + PROJECT,
            "--region=" + REGION,
            "--artifact-repository=financial-analysis",
            "--repository-url=" + SOURCE_URL,
            "--commit=" + COMMIT,
            "--build-id=" + BUILD_ID,
            "--build-json=" + str(build),
            "--trigger-json=" + str(trigger),
            *extra,
        ]

    def test_cli_prepares_and_validates_local_material_without_network_or_subprocess(self):
        destination = self.root / "request.json"
        for arguments in (
            self.arguments("prepare", "--output=" + str(destination)),
            self.arguments("validate", "--request-json=" + str(destination)),
        ):
            with (
                patch.object(first, "ROOT", self.root),
                patch("sys.argv", arguments),
                patch("urllib.request.urlopen", side_effect=AssertionError("No network")),
                patch.object(
                    subprocess, "run", side_effect=AssertionError("No provisioning process")
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(first.main(), 0)
        self.assertEqual(
            json.loads(destination.read_text())["approval"], {"status": "not_requested"}
        )
        original = destination.read_bytes()
        with (
            patch.object(first, "ROOT", self.root),
            patch("sys.argv", self.arguments("prepare", "--output=" + str(destination))),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(first.main(), 1)
        self.assertEqual(destination.read_bytes(), original)

    def test_bounded_duplicate_json_and_fake_approval_fail_without_input_diagnostics(self):
        bad = self.root / "bad.json"
        for payload in (
            b'{"secret":"SyntheticSecret","secret":true}',
            b"{}" + b" " * first.MAX_METADATA_BYTES,
            b"NaN",
            b'"not an object"',
        ):
            bad.write_bytes(payload)
            with self.subTest(size=len(payload)), self.assertRaises(ValueError) as error:
                first._read_json(str(bad), first.MAX_METADATA_BYTES)
            self.assertNotIn("SyntheticSecret", str(error.exception))
        arguments = self.arguments("prepare", "--request-json=" + str(bad))
        with (
            patch.object(first, "ROOT", self.root),
            patch("sys.argv", arguments),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(first.main(), 1)


if __name__ == "__main__":
    unittest.main()
