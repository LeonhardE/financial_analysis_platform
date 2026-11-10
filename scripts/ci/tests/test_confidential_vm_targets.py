"""Future VM fixtures exercise real registry/CI selection without registering resources."""

import copy
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import checks  # noqa: E402
import service_job  # noqa: E402
from service_targets import (  # noqa: E402
    RegistryError,
    load_registry,
    parse_registry_document,
    validate_registry_transition,
)
from test_service_targets import write_registry_fixture  # noqa: E402


class ConfidentialTargetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="repo003-vm-registry-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.document = write_registry_fixture(self.root, extra_vm=True)
        self.path = self.root / "scripts/service-targets.json"
        self.registry = load_registry(self.root)

    def save(self):
        self.path.write_text(json.dumps(self.document))
        return load_registry(self.root)

    def test_existing_runtime_defaults_and_vm_registration_are_immutable_and_dynamic(self):
        omitted_runtime = {
            **self.document,
            "targets": [
                {key: value for key, value in row.items() if key != "runtime"}
                for row in self.document["targets"]
            ],
        }
        self.assertTrue(
            all(
                t.runtime == "cloud_run"
                for t in parse_registry_document(json.dumps(omitted_runtime))
            )
        )
        vm = self.registry.target("synthetic-service")
        self.assertEqual(vm.runtime, "confidential_vm")
        self.assertIn(vm.id, self.registry.backend_ids)
        previous = parse_registry_document(
            json.dumps({**self.document, "targets": self.document["targets"][:-1]})
        )
        validate_registry_transition(previous, self.registry)
        selected = checks.select([vm.directory + "/app/main.py"], self.registry)
        self.assertEqual(selected.services, (vm.id,))
        self.assertEqual(checks.select([vm.cloudbuild], self.registry).services, (vm.id,))
        self.assertIn(vm.id, checks.select(["services/common/new.py"], self.registry).services)

    def test_vm_cannot_be_promoted_into_normal_existing_service_publication_or_mutate_runtime(self):
        previous = parse_registry_document(self.path.read_bytes())
        self.document["targets"][-1]["release_mode"] = "existing"
        with self.assertRaises(RegistryError):
            self.save()
        self.document["targets"][-1]["release_mode"] = "build_only"
        self.document["targets"][-1]["runtime"] = "cloud_run"
        with self.assertRaises(RegistryError):
            validate_registry_transition(previous, self.save())
        self.document["targets"][-1]["runtime"] = "confidential_vm"
        self.document["targets"][0]["runtime"] = "confidential_vm"
        self.document["targets"][0]["release_mode"] = "build_only"
        with self.assertRaises(RegistryError):
            validate_registry_transition(previous, self.save())

    def test_invalid_runtime_or_web_vm_and_missing_probe_fail(self):
        original = copy.deepcopy(self.document)
        for value in (None, True, "vm", "cloud-run", "confidential_vm;deploy"):
            self.document = copy.deepcopy(original)
            self.document["targets"][-1]["runtime"] = value
            with self.subTest(runtime=value), self.assertRaises(RegistryError):
                self.save()
        self.document = copy.deepcopy(original)
        next(t for t in self.document["targets"] if t["kind"] == "web")["runtime"] = (
            "confidential_vm"
        )
        with self.assertRaises(RegistryError):
            self.save()
        self.document = original
        (self.root / "services/synthetic-service/app/health_check.py").unlink()
        with self.assertRaises(RegistryError):
            self.save()

    def probe(self, output, **kwargs):
        with (
            patch.object(service_job, "ROOT", self.root),
            patch.object(
                service_job.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, stdout=output),
            ) as run,
            redirect_stdout(io.StringIO()),
        ):
            service_job.smoke_target("synthetic-service")
        return run

    def test_vm_offline_probe_cannot_claim_content_key_release_or_attestation(self):
        result = {
            "profile": "confidential_vm_offline_probe.v1",
            "status": "ok",
            "contentServiceEnabled": False,
            "keyReleaseAttempted": False,
            "attestationVerified": False,
        }
        run = self.probe(json.dumps(result))
        command = run.call_args.args[0]
        self.assertEqual(command[-3:], ["python", "folioview-backend:test", "app/health_check.py"])
        self.assertIn("none", command)
        self.assertIn("--read-only", command)
        self.assertIn("--cap-drop=ALL", command)
        self.assertIn("FOLIOVIEW_EXECUTION_MODE=offline_probe", command)
        for name in ("contentServiceEnabled", "keyReleaseAttempted", "attestationVerified"):
            for bad in (True, 0, None):
                with self.subTest(name=name, value=bad), self.assertRaises(RegistryError):
                    self.probe(json.dumps({**result, name: bad}))
        for value in (
            '{"status":"ok"}',
            json.dumps({**result, "secret": "field"}),
            "x" * 4097,
            json.dumps(result).replace('"status": "ok"', '"status":"bad","status":"ok"'),
        ):
            with self.assertRaises(RegistryError):
                self.probe(value)

    def test_existing_cloud_run_smoke_is_still_network_isolated_http_health(self):
        with (
            patch.object(service_job, "ROOT", self.root),
            patch.object(service_job.subprocess, "run") as run,
        ):
            service_job.smoke_target("user-service")
        self.assertEqual(run.call_count, 2)
        self.assertIn("service-smoke", run.call_args_list[0].args[0])
        self.assertIn("none", run.call_args_list[0].args[0])
        self.assertIn("http://127.0.0.1:8080/health", run.call_args_list[1].kwargs["input"])
        with (
            patch.object(service_job, "ROOT", self.root),
            patch.object(service_job.subprocess, "run") as run,
        ):
            with self.assertRaises(RegistryError):
                service_job.smoke_target("unknown-vm")
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
