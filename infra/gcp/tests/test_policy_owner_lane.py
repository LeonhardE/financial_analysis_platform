"""Policy opt-in accepts only public selected-domain inputs; no cloud access."""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("policy_owner_lane", ROOT / "infra/gcp/owner_lane.py")
lane = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lane)


class PolicyOwnerLaneTests(unittest.TestCase):
    def setUp(self):
        self.value = {
            "schemaVersion": 1,
            "target": "agent-policy",
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
                    "artifact_repository": "policy-images",
                    "runtime_account_id": "policy-runtime",
                    "build_account_id": "policy-build",
                    "operator_project_ids": ["demo-executor-alpha"],
                },
                "authority": None,
                "authority_enabled": False,
                "key_release_enabled": False,
                "public_invocation": False,
            },
        }

    def test_resources_contract_is_offline_and_keeps_exact_indexed_controller(self):
        value, directory, adopted = lane.contract(lane.canonical(self.value), ROOT)
        self.assertEqual(value["inputs"]["authority"], None)
        self.assertEqual(directory, ROOT / "infra/gcp/terraform/envs/prod/agent-policy")
        self.assertEqual(
            adopted["controllers"], ["module.agent_policy[0].terraform_data.configuration"]
        )
        self.assertIsNone(adopted["replacement"])
        self.assertEqual(len(lane.fingerprint(ROOT, directory, value)), 64)

    def test_foreign_project_ordinary_variable_map_and_unknown_gate_rejected(self):
        for mutate in [
            lambda x: x["inputs"]["deployment"].update(project_id="demo-foreign-alpha"),
            lambda x: x["inputs"].update(environment={"POLICY_ENABLED": "1"}),
            lambda x: x["inputs"].update(rootPrivateJwk={"d": "private"}),
            lambda x: x["inputs"].update(authority_enabled="false"),
            lambda x: x["inputs"]["deployment"].update(creation_image="image:latest"),
            lambda x: x["inputs"].update(stage="apply"),
        ]:
            value = copy.deepcopy(self.value)
            mutate(value)
            with self.assertRaises(ValueError):
                lane.contract(lane.canonical(value), ROOT)

    def test_private_jwk_and_wildcard_callback_are_rejected(self):
        schema = json.loads(
            (
                ROOT / "infra/gcp/terraform/envs/prod/agent-policy/owner-lane.consumer.json"
            ).read_text()
        )["inputs"]["properties"]["authority"]["properties"]
        key = {"kty": "EC", "crv": "P-256", "x": "A" * 43, "y": "A" * 43}
        lane.schema(key, schema["root_jwk"])
        with self.assertRaises(ValueError):
            lane.schema({**key, "d": "A" * 43}, schema["root_jwk"])
        for callback in ["https://chat.example/*", "https://chat.example/callback?code=secret"]:
            with self.assertRaises(ValueError):
                lane.schema([callback], schema["native_redirect_uris"])


if __name__ == "__main__":
    unittest.main()
