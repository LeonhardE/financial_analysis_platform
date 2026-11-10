"""Executor opt-in accepts only public selected-domain inputs; no cloud access."""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "executor_owner_lane", ROOT / "infra/gcp/owner_lane.py"
)
lane = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lane)


class ExecutorOwnerLaneTests(unittest.TestCase):
    def setUp(self):
        self.value = {
            "schemaVersion": 1,
            "target": "agent-executor",
            "projectId": "demo-policy-alpha",
            "projectNumber": "111222333444",
            "region": "northamerica-northeast2",
            "repository": (
                "projects/demo-policy-alpha/locations/northamerica-northeast2/"
                "connections/owner/repositories/folio"
            ),
            "repositoryUrl": "https://github.com/example/folio.git",
            "inputs": {
                "stage": "resources",
                "deployment": {
                    "project_id": "demo-policy-alpha",
                    "region": "northamerica-northeast2",
                    "zone": "northamerica-northeast2-b",
                    "instance_name": "synthetic-executor",
                    "artifact_repository": "executor-images",
                    "runtime_account_id": "executor-runtime",
                    "creation_account_id": "executor-creation",
                    "build_account_id": "executor-build",
                    "subnet_cidr": "10.72.0.0/24",
                },
                "policy": {
                    "project_id": "demo-other-policy",
                    "runtime_service_account": (
                        "policy-runtime@demo-other-policy.iam.gserviceaccount.com"
                    ),
                },
                "launch": None,
                "instance_protection_enabled": True,
            },
        }

    def test_resources_contract_adopts_only_the_fixed_vm_slot(self):
        value, directory, adopted = lane.contract(lane.canonical(self.value), ROOT)
        self.assertEqual(value["inputs"]["launch"], None)
        self.assertEqual(directory, ROOT / "infra/gcp/terraform/envs/prod/agent-executor")
        self.assertEqual(adopted["controllers"], [])
        self.assertEqual(
            adopted["replacement"],
            {
                "instanceAddress": "google_compute_instance.executor[0]",
                "launchAddress": "terraform_data.launch[0]",
            },
        )
        self.assertEqual(len(lane.fingerprint(ROOT, directory, value)), 64)

    def test_foreign_project_ordinary_variable_map_and_unknown_gate_rejected(self):
        for mutate in [
            lambda x: x["inputs"]["deployment"].update(project_id="demo-foreign-alpha"),
            lambda x: x["inputs"].update(environment={"POLICY_ENABLED": "1"}),
            lambda x: x["inputs"].update(rootPrivateJwk={"d": "private"}),
            lambda x: x["inputs"].update(instance_protection_enabled="false"),
            lambda x: x["inputs"]["deployment"].update(metadata={"startup-script": "code"}),
            lambda x: x["inputs"].update(stage="apply"),
        ]:
            value = copy.deepcopy(self.value)
            mutate(value)
            with self.assertRaises(ValueError):
                lane.contract(lane.canonical(value), ROOT)

    def test_arbitrary_image_private_source_and_unsigned_environment_are_rejected(self):
        schema = json.loads(
            (
                ROOT / "infra/gcp/terraform/envs/prod/agent-executor/owner-lane.consumer.json"
            ).read_text()
        )["inputs"]["properties"]["launch"]
        launch = {
            "image": (
                "northamerica-northeast2-docker.pkg.dev/demo-executor-alpha/"
                "images/agent-executor-api@sha256:" + "a" * 64
            ),
            "confidential_space_image": (
                "projects/confidential-space-images/global/images/confidential-space-261001"
            ),
            "root_key_id": "A" * 43,
        }
        lane.schema(launch, schema)
        for extra in [
            {"image": "image:latest"},
            {"config_object": "https://attacker.example/private"},
            {"rootPrivateJwk": {"d": "private"}},
            {"environment": {"TOKEN": "secret"}},
        ]:
            with self.assertRaises(ValueError):
                lane.schema({**launch, **extra}, schema)


if __name__ == "__main__":
    unittest.main()
