"""Offline profile binding/output tests without credentials or cloud resources."""

import copy
import hashlib
import importlib.util
import json
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

DIRECTORY = Path(__file__).resolve().parents[1]
ROOT = DIRECTORY.parents[1]
SPEC = importlib.util.spec_from_file_location(
    "deployment_profile", DIRECTORY / "deployment_profile.py"
)
profile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(profile)
SPEC = importlib.util.spec_from_file_location(
    "profile_pipeline", DIRECTORY / "terraform_pipeline.py"
)
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)


def example():
    return json.loads((DIRECTORY / "deployment-profiles/example.profile.json").read_text())


def adopted():
    value = example()
    old, old_number, old_region = (
        value["project"]["id"],
        value["project"]["number"],
        value["region"],
    )
    project, number, region = "demo-folio-beta", "222333444555", "europe-west3"
    value = json.loads(
        json.dumps(value)
        .replace(old, project)
        .replace(old_number, number)
        .replace(old_region, region)
        .replace("demo-alpha", "demo-beta")
    )
    value["mode"] = "adoption"
    value["bootstrapStages"]["portfolio"] = "service"
    value["source"]["repositoryResource"] = value["source"]["repositoryResource"].replace(
        project, number
    )
    identifier = 1
    for name, target in value["targets"].items():
        target["lifecycle"] = "adopt"
        target["enabled"] = name in {"repo", "market", "user", "config", "web"}
        anchors = {}
        for field in profile.ADOPTION_FIELDS:
            anchors[field] = (
                None
                if name == "repo" and field in {"serviceUid", "buildTriggerId"}
                else str(UUID(int=identifier))
            )
            identifier += 1
        target["adoption"] = anchors
        if name != "repo":
            target["image"] = (
                f"{region}-docker.pkg.dev/{project}/{value['artifactRepository']}/"
                f"{profile.TARGET_SERVICES[name]}@sha256:" + "1" * 64
            )
    value["targets"]["agent-hub"].update(lifecycle="create", adoption=None)
    # Browser keys are public config, but no complete key-shaped literal is committed.
    value["firebase"] = {
        "enabled": True,
        "apiKey": "AIza" + "A" * 35,
        "authDomain": project + ".firebaseapp.com",
        "appId": f"1:{number}:web:" + "b" * 24,
    }
    return value


class ProfileTests(unittest.TestCase):
    def test_two_independent_profiles_render_without_any_original_environment(self):
        first, second = example(), adopted()
        for value in (first, second):
            rendered = profile.render(value)
            encoded = json.dumps(rendered)
            self.assertNotIn("financial-analysis-512202", encoded)
            self.assertNotIn("630815932903", encoded)
            self.assertNotIn("LeonhardE", encoded)
            self.assertEqual(
                rendered["pipeline.candidate.json"]["project_id"], value["project"]["id"]
            )
            self.assertEqual(rendered["pipeline.candidate.json"]["region"], value["region"])
            self.assertEqual(rendered["manifest.json"]["approval"], "not_requested")
            self.assertFalse(rendered["manifest.json"]["productionActivation"])
            self.assertTrue(
                all(
                    name.endswith(".candidate.json") or name == "manifest.json" for name in rendered
                )
            )
        self.assertNotEqual(
            profile.render(first)["manifest.json"]["profileSha256"],
            profile.render(second)["manifest.json"]["profileSha256"],
        )

    def test_rendered_policy_passes_the_real_existing_policy_validator(self):
        value = adopted()
        policy = profile.render(value)["pipeline.candidate.json"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            file = root / pipeline.POLICY
            file.parent.mkdir(parents=True)
            file.write_text(json.dumps(policy))
            for target in policy["targets"].values():
                (root / target["directory"]).mkdir(parents=True)
            for name, target in policy["targets"].items():
                if target["enabled"]:
                    actual_policy, selected, directory = pipeline.registry(root, name)
                    self.assertEqual(actual_policy, policy)
                    self.assertEqual(selected, target)
                    self.assertEqual(directory, root / target["directory"])
                else:
                    with self.assertRaisesRegex(RuntimeError, "disabled"):
                        pipeline.registry(root, name)

    def test_bootstrap_and_web_outputs_match_existing_consumers_without_activation(self):
        value = adopted()
        artifacts = profile.render(value)
        bootstrap = artifacts["bootstrap-inputs.candidate.json"]
        variables = set()
        for file in (DIRECTORY / "terraform/bootstrap").glob("*.tf"):
            import re

            variables.update(re.findall(r'^variable "([^"]+)"', file.read_text(), re.M))
        # Target-specific administrator overrides stay outside the ordinary closed
        # compiler: it cannot silently activate Hub public IAM, change its
        # runtime, or enable Portfolio image deployment before target review.
        target_admin_overrides = {
            "agent_hub_runtime_account_id",
            "agent_hub_public_connector_enabled",
            "portfolio_image_deployment_enabled",
        }
        self.assertEqual(set(bootstrap), variables - target_admin_overrides)
        self.assertTrue(target_admin_overrides.isdisjoint(bootstrap))
        self.assertEqual(bootstrap["portfolio_provisioning_stage"], "service")
        self.assertEqual(bootstrap["agent_hub_provisioning_stage"], "none")
        self.assertEqual(bootstrap["repository_id"], value["source"]["repositoryResource"])
        import re

        keys = set(
            re.findall(r"^  (_[A-Z_]+):", (DIRECTORY / "cloudbuild.web.yaml").read_text(), re.M)
        )
        self.assertEqual(set(artifacts["web-substitutions.candidate.json"]), keys)
        self.assertEqual(
            artifacts["web-substitutions.candidate.json"]["_FIREBASE_PROJECT_ID"],
            value["project"]["id"],
        )
        self.assertEqual(
            artifacts["backends.candidate.json"]["portfolio"],
            {
                "bucket": value["project"]["id"] + "-tfstate-portfolio",
                "prefix": "prod/portfolio",
            },
        )

    def test_fresh_install_has_no_adoption_or_implicit_activation(self):
        value = example()
        self.assertTrue(all(not item["enabled"] for item in value["targets"].values()))
        self.assertTrue(all(item["adoption"] is None for item in value["targets"].values()))
        for mutate in (
            lambda x: x["targets"]["market"].update(enabled=True),
            lambda x: x["targets"]["market"].update(lifecycle="adopt"),
            lambda x: x["bootstrapStages"].update(portfolio="service"),
            lambda x: x.pop("bootstrapStages"),
        ):
            candidate = copy.deepcopy(value)
            mutate(candidate)
            with self.subTest(candidate=candidate["mode"]):
                with self.assertRaises(profile.ProfileError):
                    profile.validate_profile(candidate)

    def test_project_region_source_image_state_and_firebase_mixups_reject(self):
        mutations = [
            lambda x: x["state"].update(stateBucket="different-project-tfstate"),
            lambda x: x["bootstrapStages"].update(portfolio="none"),
            lambda x: x["bootstrapStages"].update(portfolio="execution"),
            lambda x: x["bootstrapStages"].update(**{"agent-hub": "service"}),
            lambda x: x["targets"]["user"].update(
                runtimeAccountId=x["targets"]["market"]["runtimeAccountId"]
            ),
            lambda x: x["source"].update(repositoryUrl="https://github.com/../repository.git"),
            lambda x: x["source"].update(
                repositoryResource=x["source"]["repositoryResource"].replace(
                    "connections/demo-github/", "connections/../"
                )
            ),
            lambda x: x["source"].update(
                repositoryResource=x["source"]["repositoryResource"].replace(
                    x["region"], "us-east1"
                )
            ),
            lambda x: x["source"].update(
                repositoryResource=x["source"]["repositoryResource"].replace(
                    x["project"]["number"], "999999999999"
                )
            ),
            lambda x: x["source"].update(
                repositoryUrl="https://password@github.com/owner/repository.git"
            ),
            lambda x: x["targets"]["market"].update(
                image=x["targets"]["market"]["image"].replace(
                    x["project"]["id"], "different-project"
                )
            ),
            lambda x: x["targets"]["market"].update(
                image=x["targets"]["market"]["image"].split("@")[0] + ":latest"
            ),
            lambda x: x["targets"]["market"].update(
                origin=x["targets"]["market"]["origin"].replace(
                    x["project"]["number"], "999999999999"
                )
            ),
            lambda x: x["targets"]["market"].update(origin="https://user:password@example.invalid"),
            lambda x: x["targets"]["market"].update(origin="https://example.invalid/?token=value"),
            lambda x: x["firebase"].update(appId="1:999999999999:web:" + "b" * 24),
            lambda x: x["firebase"].update(authDomain="different-project.firebaseapp.com"),
            lambda x: x["targets"]["user"]["adoption"].update(
                serviceUid=x["targets"]["market"]["adoption"]["serviceUid"]
            ),
            lambda x: x["targets"]["user"]["adoption"].update(serviceUid="not-a-uuid"),
        ]
        for index, mutate in enumerate(mutations):
            value = adopted()
            mutate(value)
            with self.subTest(index=index):
                with self.assertRaises(profile.ProfileError):
                    profile.validate_profile(value)

    def test_duplicate_unknown_secret_and_oversized_fields_are_fixed_failures(self):
        for mutate in (
            lambda x: x.update(privateKey="private sentinel"),
            lambda x: x["firebase"].update(clientSecret="secret sentinel"),
            lambda x: x["targets"]["market"].update(environment={"PASSWORD": "sentinel"}),
            lambda x: x["state"].update(credentials="sentinel"),
            lambda x: x.update(schemaVersion=True),
        ):
            value = example()
            mutate(value)
            with self.assertRaises(profile.ProfileError) as caught:
                profile.parse_profile(json.dumps(value).encode())
            self.assertNotIn("sentinel", str(caught.exception))
        raw = (
            json.dumps(example())
            .replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1')
            .encode()
        )
        for data in [
            raw,
            b'{"schemaVersion":NaN}',
            b"\xff",
            b" " * (profile.MAX_PROFILE_BYTES + 1),
        ]:
            with self.assertRaises(profile.ProfileError):
                profile.parse_profile(data)

    def test_manifests_bind_selected_profile_source_target_and_exact_file_bytes(self):
        value = adopted()
        artifacts = profile.render(value)
        manifest = artifacts["manifest.json"]
        self.assertEqual(manifest["profileSha256"], profile.digest(profile.validate_profile(value)))
        self.assertEqual(manifest["sourceSha256"], profile.digest(value["source"]))
        changed = copy.deepcopy(value)
        changed["source"]["repositoryUrl"] = "https://github.com/example/changed.git"
        other = profile.render(changed)["manifest.json"]
        self.assertNotEqual(manifest["sourceSha256"], other["sourceSha256"])
        self.assertTrue(
            all(
                manifest["targetSha256"][name] != other["targetSha256"][name]
                for name in profile.TARGET_SERVICES
            )
        )
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary).resolve() / "candidates"
            profile.write_candidates(artifacts, destination)
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o700)
            for name in artifacts:
                self.assertEqual(stat.S_IMODE((destination / name).stat().st_mode), 0o600)
            for name, expected in manifest["filesSha256"].items():
                self.assertEqual(
                    hashlib.sha256((destination / name).read_bytes()).hexdigest(), expected
                )

    def test_existing_or_symlink_output_never_overwrites_selected_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            target = root / "existing"
            target.mkdir()
            marker = target / "pipeline.candidate.json"
            marker.write_text("preserve")
            for path in [target, root / "link"]:
                if path.name == "link":
                    path.symlink_to(target, target_is_directory=True)
                with self.assertRaises(profile.ProfileError):
                    profile.write_candidates(profile.render(example()), path)
            self.assertEqual(marker.read_text(), "preserve")

    def test_cli_has_no_values_or_cloud_side_effects_and_never_changes_committed_policy(self):
        before = (DIRECTORY / "terraform/pipeline.json").read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            input_file = root / "operator.profile.local.json"
            value = adopted()
            input_file.write_text(json.dumps(value))
            result = subprocess.run(
                [
                    sys.executable,
                    str(DIRECTORY / "deployment_profile.py"),
                    "render",
                    "--profile",
                    str(input_file),
                    "--output-dir",
                    str(root / "output"),
                ],
                text=True,
                capture_output=True,
                timeout=20,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout)
            self.assertEqual(summary["approval"], "not_requested")
            self.assertNotIn(value["firebase"]["apiKey"], result.stdout)
            self.assertNotIn(value["project"]["id"], result.stdout)
            self.assertEqual(
                set(summary["filesSha256"]), set(profile.render(value)) - {"manifest.json"}
            )
            input_file.write_text('{"password":"do-not-echo"}')
            failure = subprocess.run(
                [
                    sys.executable,
                    str(DIRECTORY / "deployment_profile.py"),
                    "validate",
                    "--profile",
                    str(input_file),
                ],
                capture_output=True,
                text=True,
                timeout=20,
            )
            self.assertEqual(failure.returncode, 1)
            self.assertNotIn("do-not-echo", failure.stderr + failure.stdout)
            self.assertFalse((root / "output/terraform.tfvars.json").exists())
        self.assertEqual((DIRECTORY / "terraform/pipeline.json").read_bytes(), before)
        with patch("socket.socket.connect", side_effect=AssertionError("Network access")):
            self.assertEqual(
                profile.render(example())["manifest.json"]["approval"], "not_requested"
            )

    def test_documented_schema_and_registered_targets_agree(self):
        schema = json.loads((DIRECTORY / "deployment-profiles/profile.schema.json").read_text())
        self.assertEqual(set(schema["properties"]), profile.TOP_FIELDS)
        self.assertEqual(set(schema["$defs"]["target"]["properties"]), profile.TARGET_FIELDS)
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(
            set(schema["properties"]["targets"]["properties"]), set(profile.TARGET_SERVICES)
        )
        registry = json.loads((ROOT / "scripts/service-targets.json").read_text())
        self.assertEqual(
            {item["service"] for item in registry["targets"]},
            set(profile.TARGET_SERVICES.values()) - {None},
        )


if __name__ == "__main__":
    unittest.main()
