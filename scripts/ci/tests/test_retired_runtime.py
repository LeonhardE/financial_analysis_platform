"""Historical VM metadata cannot become a runnable target or a Docker operation."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[2])]
import service_job  # noqa: E402
from service_targets import RegistryError, load_registry, parse_registry_document  # noqa: E402
from test_service_targets import write_registry_fixture  # noqa: E402


class RetiredRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.document = write_registry_fixture(self.root, extra_backend=True)
        self.document["targets"][-1]["runtime"] = "confidential_vm"
        self.path = self.root / "scripts/service-targets.json"
        self.path.write_text(json.dumps(self.document))

    def test_historical_build_only_metadata_is_readable_but_current_registration_is_refused(self):
        old = parse_registry_document(self.path.read_bytes())
        self.assertEqual(old[-1].runtime, "confidential_vm")
        self.assertEqual(old[-1].release_mode, "build_only")
        with self.assertRaises(RegistryError):
            load_registry(self.root)
        with (
            patch.object(service_job, "ROOT", self.root),
            patch.object(service_job.subprocess, "run") as run,
        ):
            with self.assertRaises(RegistryError):
                service_job.smoke_target("synthetic-service")
            run.assert_not_called()

    def test_only_nonexecutable_terminal_tombstone_is_accepted(self):
        self.document["targets"][-1]["release_mode"] = "retired"
        self.path.write_text(json.dumps(self.document))
        with self.assertRaises(RegistryError):
            load_registry(self.root)
        shutil.rmtree(self.root / "services/synthetic-service")
        (self.root / "infra/gcp/cloudbuild.synthetic.yaml").unlink()
        registry = load_registry(self.root)
        self.assertNotIn("synthetic-service", registry.backend_ids)
        self.assertFalse(registry.target("synthetic-service").source_present)

    def test_supported_cloud_run_health_remains_isolated_http(self):
        self.document["targets"][-1]["runtime"] = "cloud_run"
        self.path.write_text(json.dumps(self.document))
        with (
            patch.object(service_job, "ROOT", self.root),
            patch.object(service_job.subprocess, "run") as run,
        ):
            service_job.smoke_target("synthetic-service")
        self.assertEqual(run.call_count, 2)
        self.assertIn("none", run.call_args_list[0].args[0])
        self.assertIn("http://127.0.0.1:8080/health", run.call_args_list[1].kwargs["input"])
