"""Adversarial saved-plan boundary tests without credentials, Terraform or cloud calls."""

import copy
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "owner_lane", Path(__file__).parents[1] / "owner_lane.py"
)
lane = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lane)
PLAN = "12345678-1234-4234-8234-123456789abc"
APPLY = "87654321-4321-4321-8321-cba987654321"
PROJECT = "demo-owner-alpha"
TARGET = "synthetic-worker"
COMMIT = "a" * 40
NOW = datetime(2026, 11, 10, 12, tzinfo=UTC)


class API:
    def __init__(self, contract):
        self.objects, self.records, self.triggers = {}, {}, {}
        self.generation = "5"
        for mode, identifier in [("plan", PLAN), ("apply", APPLY)]:
            substitutions = {
                "COMMIT_SHA": COMMIT,
                "BRANCH_NAME": "main",
                "_TARGET": TARGET,
                "_OWNER_LANE": lane.canonical(contract).decode(),
                "_OWNER_LANE_SHA256": lane.digest(contract),
            }
            account = (
                f"projects/{PROJECT}/serviceAccounts/"
                f"fv-owner-{mode}@{PROJECT}.iam.gserviceaccount.com"
            )
            self.records[identifier] = {
                "id": identifier,
                "projectId": PROJECT,
                "status": "WORKING",
                "serviceAccount": account,
                "buildTriggerId": identifier,
                "substitutions": substitutions,
                "approval": {"result": {"decision": "APPROVED"}},
                "sourceProvenance": {
                    "resolvedConnectedRepository": {
                        "repository": contract["repository"],
                        "revision": COMMIT,
                    }
                },
            }
            trigger = {
                "id": identifier,
                "name": f"owner-{mode}-{TARGET}",
                "serviceAccount": account,
                "substitutions": copy.deepcopy(substitutions),
            }
            if mode == "plan":
                trigger.update(
                    filename=lane.CONFIGS[mode],
                    repositoryEventConfig={
                        "repository": contract["repository"],
                        "push": {"branch": "^main$"},
                    },
                )
            else:
                substitutions["_PLAN_BUILD_ID"] = PLAN
                trigger.update(
                    sourceToBuild={"repository": contract["repository"], "ref": "refs/heads/main"},
                    gitFileSource={
                        "repository": contract["repository"],
                        "revision": "refs/heads/main",
                        "path": lane.CONFIGS[mode],
                    },
                    approvalConfig={"approvalRequired": True},
                )
            self.triggers[identifier] = trigger

    def build(self, identifier):
        return copy.deepcopy(self.records[identifier])

    def trigger(self, identifier):
        return copy.deepcopy(self.triggers[identifier])

    def state_generation(self, bucket, name):
        assert bucket == PROJECT + "-owner-tfstate"
        assert name == "prod/" + TARGET + "/default.tfstate"
        return self.generation

    def upload(self, bucket, name, data):
        assert bucket == PROJECT + "-owner-tfplans" and name not in self.objects
        self.objects[name] = ("100", data)
        return {"generation": "100", "sha256": lane.hashlib.sha256(data).hexdigest()}

    def object_metadata(self, bucket, name):
        return {"generation": self.objects[name][0]}

    def download(self, bucket, name, generation):
        assert bucket == PROJECT + "-owner-tfplans"
        actual, data = self.objects[name]
        assert actual == generation
        return data


class OwnerLaneTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.directory = self.root / f"infra/gcp/terraform/envs/prod/{TARGET}"
        self.directory.mkdir(parents=True)
        self.consumer = {
            "schemaVersion": 1,
            "target": TARGET,
            "controllers": [],
            "replacement": None,
            "inputs": {
                "type": "object",
                "properties": {
                    "stage": {"type": "string", "max": 16, "enum": ["none", "resources"]},
                    "deployment": {
                        "type": "object",
                        "properties": {
                            "project_id": {"type": "string", "max": 30},
                            "region": {"type": "string", "max": 64},
                        },
                    },
                },
            },
        }
        (self.directory / "owner-lane.consumer.json").write_bytes(lane.canonical(self.consumer))
        (self.directory / ".terraform.lock.hcl").write_text("# pinned\n")
        (self.directory / "main.tf").write_text("terraform {}\n")
        for name in [
            "infra/gcp/owner_lane.py",
            "infra/gcp/terraform_pipeline.py",
            "infra/gcp/deployment_profile.py",
            "infra/gcp/terraform_tools.py",
            *lane.CONFIGS.values(),
        ]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# trusted source\n")
        (self.root / "infra/gcp/terraform/modules").mkdir()
        (self.root / "infra/gcp/terraform/toolchain.json").write_text(
            '{"terraform_version":"1.16.7"}'
        )
        self.contract = {
            "schemaVersion": 1,
            "target": TARGET,
            "projectId": PROJECT,
            "projectNumber": "111222333444",
            "region": "northamerica-northeast2",
            "repository": (
                f"projects/{PROJECT}/locations/northamerica-northeast2/"
                "connections/owner/repositories/folio"
            ),
            "repositoryUrl": "https://github.com/example/folio.git",
            "inputs": {
                "stage": "resources",
                "deployment": {"project_id": PROJECT, "region": "northamerica-northeast2"},
            },
        }
        self.api = API(self.contract)
        self.calls = []
        self.actions = ["create"]
        self.after_plan = lambda: None
        self.after_download = lambda: None
        self.output = io.StringIO()
        patcher = patch.object(lane.common, "command", side_effect=self.command)
        patcher.start()
        self.addCleanup(patcher.stop)

    def command(self, args, directory, allowed=(0,)):
        self.assertEqual(directory, self.directory)
        self.calls.append(args)
        if args[1] == "version":
            return b'{"terraform_version":"1.16.7"}'
        if args[1] == "plan":
            Path(next(x[5:] for x in args if x.startswith("-out="))).write_bytes(b"private binary")
            self.after_plan()
        if args[1:3] == ["show", "-json"]:
            return json.dumps(
                {
                    "terraform_version": "1.16.7",
                    "resource_changes": [
                        {"address": "google_example.worker", "change": {"actions": self.actions}}
                    ],
                }
            ).encode()
        return b"private text"

    def run_phase(self, mode, **changes):
        with redirect_stdout(self.output):
            return lane.run(
                mode,
                TARGET,
                APPLY if mode == "apply" else PLAN,
                COMMIT,
                "main",
                PROJECT,
                "northamerica-northeast2",
                plan_id=PLAN if mode == "apply" else None,
                root=self.root,
                api=self.api,
                now=changes.pop("now", NOW),
                **changes,
            )

    def prepare(self):
        self.run_phase("plan")
        self.api.records[PLAN]["status"] = "SUCCESS"

    def test_exact_saved_plan_applies_without_replanning(self):
        self.prepare()
        self.run_phase("apply")
        self.assertEqual(sum(x[1] == "plan" for x in self.calls), 1)
        self.assertEqual(sum(x[1] == "apply" for x in self.calls), 1)
        self.assertNotIn("private binary", self.output.getvalue())
        self.assertNotIn("private text", self.output.getvalue())

    def test_contract_cannot_supply_unknown_private_or_cross_project_input(self):
        for mutate in [
            lambda x: x["inputs"].update(rootPrivateJwk={"d": "private"}),
            lambda x: x["inputs"]["deployment"].update(project_id="another-project"),
            lambda x: x.update(stateBucket="foreign"),
            lambda x: x.update(schemaVersion=True),
        ]:
            with self.subTest(mutate=mutate):
                value = copy.deepcopy(self.contract)
                mutate(value)
                with self.assertRaises(ValueError):
                    lane.contract(lane.canonical(value), self.root)

    def test_duplicate_json_and_noncanonical_contract_are_refused(self):
        for raw in [b'{"a":1,"a":2}', json.dumps(self.contract, indent=2).encode(), b'{"a":NaN}']:
            with self.assertRaises(ValueError):
                value = lane.parse(raw)
                lane.contract(lane.canonical(value) if b"NaN" in raw else raw, self.root)

    def test_missing_source_adoption_precedes_credentials(self):
        (self.directory / "owner-lane.consumer.json").unlink()
        with patch.object(lane.common, "GoogleAPI") as credentials:
            with self.assertRaises(ValueError):
                self.run_phase("plan")
            credentials.assert_not_called()

    def test_overridden_contract_and_identity_fail_before_terraform(self):
        mutations = [
            lambda: self.api.records[PLAN]["substitutions"].update(_OWNER_LANE_SHA256="0" * 64),
            lambda: self.api.records[PLAN].update(
                serviceAccount=f"projects/{PROJECT}/serviceAccounts/ordinary@{PROJECT}.iam.gserviceaccount.com"
            ),
            lambda: self.api.triggers[PLAN].update(disabled=True),
        ]
        for mutate in mutations:
            self.api = API(self.contract)
            mutate()
            with self.assertRaises(ValueError):
                self.run_phase("plan")
            self.assertFalse(self.calls)

    def test_wrong_output_provenance_not_repaired_by_requested_source(self):
        for field, value in [
            ("revision", "b" * 40),
            ("repository", self.contract["repository"] + "-wrong"),
            ("dir", "subdirectory"),
        ]:
            self.api = API(self.contract)
            self.api.records[PLAN]["sourceProvenance"]["resolvedConnectedRepository"][field] = value
            self.api.records[PLAN]["source"] = {
                "repository": self.contract["repository"],
                "revision": COMMIT,
            }
            with self.assertRaises(ValueError):
                self.run_phase("plan")
            self.assertFalse(self.calls)

    def test_native_approval_and_successful_producer_required(self):
        self.prepare()
        self.api.records[APPLY]["approval"]["result"]["decision"] = "PENDING"
        with self.assertRaises(ValueError):
            self.run_phase("apply")
        self.api.records[APPLY]["approval"]["result"]["decision"] = "APPROVED"
        self.api.records[PLAN]["status"] = "FAILURE"
        with self.assertRaises(ValueError):
            self.run_phase("apply")
        self.assertFalse(any(x[1] == "apply" for x in self.calls))

    def test_stale_future_or_changed_state_refuses_apply(self):
        self.prepare()
        for moment in [NOW + timedelta(hours=7), NOW - timedelta(seconds=1)]:
            with self.assertRaises(ValueError):
                self.run_phase("apply", now=moment)
        self.api.generation = "6"
        with self.assertRaises(ValueError):
            self.run_phase("apply")
        self.assertFalse(any(x[1] == "apply" for x in self.calls))

    def test_changed_source_or_artifact_refuses_apply(self):
        self.prepare()
        path = self.directory / "main.tf"
        path.write_text("changed")
        with self.assertRaises(ValueError):
            self.run_phase("apply")
        path.write_text("terraform {}\n")
        name = f"plans/{TARGET}/{PLAN}/terraform.tfplan"
        self.api.objects[name] = ("100", b"tampered")
        with self.assertRaises(ValueError):
            self.run_phase("apply")

    def test_destroy_and_vm_replacement_are_not_an_escape_hatch(self):
        for actions in [["delete"], ["delete", "create"], ["create", "delete"]]:
            self.actions = actions
            with self.assertRaises(ValueError):
                self.run_phase("plan")
            self.assertFalse(self.api.objects)

    def test_raced_state_prevents_plan_publication(self):
        self.after_plan = lambda: setattr(self.api, "generation", "6")
        with self.assertRaises(ValueError):
            self.run_phase("plan")
        self.assertFalse(self.api.objects)

    def test_replacement_review_binds_actual_generation_before_init(self):
        self.consumer["replacement"] = {
            "instanceAddress": "google_compute_instance.executor[0]",
            "launchAddress": "terraform_data.launch[0]",
        }
        self.consumer["inputs"]["properties"]["instance_protection_enabled"] = {"type": "boolean"}
        (self.directory / "owner-lane.consumer.json").write_bytes(lane.canonical(self.consumer))
        self.contract["inputs"]["instance_protection_enabled"] = False
        self.contract["replacementReview"] = {
            "expectedInstanceId": "123456789",
            "stateGeneration": "6",
        }
        self.api = API(self.contract)
        with self.assertRaises(ValueError):
            self.run_phase("plan")
        self.assertFalse(any(x[1] in {"init", "plan", "apply"} for x in self.calls))

    def test_downloaded_binary_is_rechecked_for_destruction(self):
        self.prepare()
        self.actions = ["delete", "create"]
        with self.assertRaises(ValueError):
            self.run_phase("apply")
        self.assertFalse(any(x[1] == "apply" for x in self.calls))


if __name__ == "__main__":
    unittest.main()
