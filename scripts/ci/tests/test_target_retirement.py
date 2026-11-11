"""Explicit retirement preserves identity and permits independent source removal."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[2])]
import checks  # noqa: E402
import service_job  # noqa: E402
from service_targets import (  # noqa: E402
    RegistryError,
    load_registry,
    parse_registry_document,
    validate_registry_transition,
)
from test_service_targets import write_registry_fixture  # noqa: E402


class TargetRetirementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.document = write_registry_fixture(self.root, extra_backend=True)
        self.path = self.root / "scripts/service-targets.json"
        self.previous = parse_registry_document(self.path.read_bytes())
        self.document["targets"][-1]["release_mode"] = "retired"
        self.path.write_text(json.dumps(self.document))

    def test_retired_source_is_still_fully_checked_until_complete_removal(self):
        registry = load_registry(self.root)
        validate_registry_transition(self.previous, registry)
        self.assertIn("synthetic-service", registry.backend_ids)
        (self.root / "services/synthetic-service/Dockerfile").unlink()
        with self.assertRaises(RegistryError):
            load_registry(self.root)

    def test_complete_target_only_removal_leaves_a_terminal_metadata_record(self):
        directory = self.root / "services/synthetic-service"
        shutil.rmtree(directory)
        (self.root / "infra/gcp/cloudbuild.synthetic.yaml").unlink()
        registry = load_registry(self.root)
        validate_registry_transition(self.previous, registry)
        self.assertFalse(registry.target("synthetic-service").source_present)
        self.assertNotIn("synthetic-service", registry.backend_ids)
        self.assertNotIn("infra/gcp/cloudbuild.synthetic.yaml", registry.cloudbuild_targets)
        plan = checks.select(["services/synthetic-service/app/main.py"], registry)
        self.assertNotIn("synthetic-service", plan.services)
        with (
            patch.object(service_job, "ROOT", self.root),
            patch.object(service_job.subprocess, "run") as run,
        ):
            with self.assertRaises(RegistryError):
                service_job.smoke_target("synthetic-service")
            run.assert_not_called()
        directory.mkdir()
        (directory / "README.md").write_text("Retired; see archived design.\n")
        self.assertFalse(load_registry(self.root).target("synthetic-service").source_present)

    def test_retired_identity_cannot_be_erased_reactivated_or_replaced(self):
        registry = load_registry(self.root)
        previous = parse_registry_document(self.path.read_bytes())
        self.document["targets"][-1]["release_mode"] = "build_only"
        self.path.write_text(json.dumps(self.document))
        with self.assertRaises(RegistryError):
            validate_registry_transition(previous, load_registry(self.root))
        self.document["targets"] = self.document["targets"][:-1]
        self.path.write_text(json.dumps(self.document))
        shutil.rmtree(self.root / "services/synthetic-service")
        with self.assertRaises(RegistryError):
            validate_registry_transition(previous, load_registry(self.root))
        self.assertTrue(registry.target("synthetic-service").source_present)

    def test_existing_five_services_and_web_cannot_be_retired_by_this_path(self):
        self.document["targets"][0]["release_mode"] = "retired"
        self.path.write_text(json.dumps(self.document))
        with self.assertRaises(RegistryError):
            validate_registry_transition(self.previous, load_registry(self.root))

    def test_retired_release_is_rejected_before_any_cloud_access(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "infra/gcp"))
        import deploy_existing_service as deploy

        registry = load_registry(self.root)
        args = [
            "release",
            "--project",
            "synthetic-project",
            "--region",
            "us-east1",
            "--build-region",
            "us-east1",
            "--service",
            "synthetic-api",
            "--image",
            "registry/synthetic-api:build",
            "--build-id",
            "synthetic-build",
            "--commit",
            "a" * 40,
            "--branch",
            "main",
            "--deploy-enabled",
            "false",
        ]
        with (
            patch.object(deploy, "load_registry", return_value=registry),
            patch.object(sys, "argv", args),
            patch.object(deploy.subprocess, "run") as run,
        ):
            with self.assertRaisesRegex(RuntimeError, "Retired targets"):
                deploy.main()
            run.assert_not_called()
