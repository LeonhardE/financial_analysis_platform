"""Pinned, offline INF-007 configuration foundation; no cloud consumers are activated."""

import copy
import hashlib
import json
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_deployment_profile as profiles
import test_web_owner_configuration as web

profile = profiles.profile


def selected(*, enabled=True):
    value = web.owner_profile(hub=True)
    value.update(
        schemaVersion=3,
        userHubTrust={
            "enabled": enabled,
            "hubSubject": "123456789012345678901" if enabled else None,
        },
    )
    return value


def compiled(value=None):
    value = selected() if value is None else value
    artifacts = profile.compile_user_hub_trust_artifacts(value)
    return (
        profile.compile_target(value, "user"),
        profile.compile_target(value, "agent-hub")
        if value.get("userHubTrust", {}).get("enabled")
        else None,
        artifacts["user-hub-trust.candidate.json"],
        artifacts["manifest.json"],
    )


class UserHubTrustConfigurationTests(unittest.TestCase):
    def test_legacy_profiles_and_explicit_disabled_v3_remain_default_denied(self):
        for value in (profiles.adopted(), web.owner_profile(), selected(enabled=False)):
            with self.subTest(version=value["schemaVersion"]):
                instance, hub, document, _ = compiled(value)
                self.assertIsNone(hub)
                self.assertIsNone(document["hubSubject"])
                self.assertIsNone(document["hubDeploymentSha256"])
                self.assertEqual(
                    set(document["environment"]), profile.USER_HUB_TRUST_ENVIRONMENT_FIELDS
                )
                self.assertTrue(all(item == "" for item in document["environment"].values()))
                self.assertEqual(
                    profile.parse_user_hub_trust(
                        profile.canonical(document),
                        instance=instance,
                        expected_sha256=profile.digest(document),
                    ),
                    document,
                )

    def test_enabled_document_pins_single_explicit_subject_and_derives_identity_and_audiences(self):
        value = selected()
        instance, hub, document, manifest = compiled(value)
        self.assertEqual(
            document["environment"],
            {
                "USER_SERVICE_AUDIENCE": "https://user-api-222333444555.europe-west3.run.app",
                "USER_DELEGATION_AUDIENCE": "https://user-api-222333444555.europe-west3.run.app/internal/v2",
                "USER_DELEGATION_ISSUER": "https://agent-hub-api-222333444555.europe-west3.run.app",
                "USER_TRUSTED_HUB_CALLERS": json.dumps(
                    {
                        "123456789012345678901": hub["inputs"]["runtime_account_id"]
                        + "@demo-folio-beta.iam.gserviceaccount.com",
                    },
                    separators=(",", ":"),
                ),
            },
        )
        self.assertEqual(document["userDeploymentSha256"], profile.digest(instance))
        self.assertEqual(document["hubDeploymentSha256"], profile.digest(hub))
        self.assertEqual(manifest["trustConfigurationSha256"], profile.digest(document))
        self.assertEqual(manifest["approval"], "not_requested")
        self.assertFalse(manifest["productionActivation"])
        self.assertNotIn("JWKS", json.dumps(document))
        self.assertEqual(
            profile.parse_user_hub_trust(
                profile.canonical(document),
                instance=instance,
                hub_instance=hub,
                expected_sha256=profile.digest(document),
            ),
            document,
        )

    def test_new_trust_is_never_consumed_by_existing_target_compilation_or_rendering(self):
        enabled = selected()
        disabled = copy.deepcopy(enabled)
        disabled["userHubTrust"] = {"enabled": False, "hubSubject": None}
        older = copy.deepcopy(disabled)
        older["schemaVersion"] = 2
        older.pop("userHubTrust")
        for target in profile.TARGET_SERVICES:
            reference = profile.compile_artifacts(older, target)
            self.assertEqual(reference, profile.compile_artifacts(disabled, target))
            self.assertEqual(reference, profile.compile_artifacts(enabled, target))
        reference = profile.render(older)
        for value in (disabled, enabled):
            rendered = profile.render(value)
            for name in set(reference) - {"manifest.json"}:
                self.assertEqual(reference[name], rendered[name], name)
            self.assertEqual(
                reference["manifest.json"]["filesSha256"], rendered["manifest.json"]["filesSha256"]
            )
        for value in (older, disabled, enabled):
            self.assertEqual(
                profile.compile_web_owner_artifacts(value)["web-owner-server.candidate.json"],
                profile.compile_web_owner_artifacts(older)["web-owner-server.candidate.json"],
            )

    def test_existing_v1_v2_projection_goldens_are_unchanged(self):
        value = web.stable_legacy_profile()
        golden = json.loads(
            (profiles.DIRECTORY / "tests/fixtures/web-owner-legacy-projections.json").read_text()
        )
        for version in (1, 2):
            newer = copy.deepcopy(value)
            if version == 2:
                newer.update(schemaVersion=2, webOwnerApis={"portfolio": False, "agentHub": False})
            for target, expected in golden.items():
                instance = profile.compile_target(newer, target)
                self.assertEqual(profile.digest(instance), expected["projectionSha256"])
                self.assertEqual(
                    profile.digest(profile.terraform_inputs(instance)),
                    expected["terraformInputsSha256"],
                )

    def test_profile_options_are_versioned_closed_and_strict(self):
        cases = []
        for options in (
            None,
            {},
            {"enabled": False},
            {"enabled": "true", "hubSubject": "123"},
            {"enabled": 1, "hubSubject": "123"},
            {"enabled": False, "hubSubject": "123"},
            {"enabled": True, "hubSubject": None},
            {"enabled": True, "hubSubject": 123},
            {"enabled": True, "hubSubject": "0123"},
            {"enabled": True, "hubSubject": "+123"},
            {"enabled": True, "hubSubject": "1" * 129},
            {"enabled": True, "hubSubject": "١٢٣"},
            {"enabled": True, "hubSubject": "123", "environment": {}},
            {"enabled": True, "hubSubject": "123", "jwksUrl": "https://wrong.invalid"},
        ):
            value = selected()
            value["userHubTrust"] = options
            cases.append(value)
        for version in (1, 2, True, "3", 4):
            value = selected()
            value["schemaVersion"] = version
            cases.append(value)
        for value in cases:
            with (
                self.subTest(options=value.get("userHubTrust")),
                self.assertRaises(profile.ProfileError),
            ):
                profile.validate_profile(value)

    def test_enabled_trust_requires_adopted_numbered_run_user_and_hub_origins(self):
        for name in ("user", "agent-hub"):
            for mutate in (
                lambda target: target.update(origin="https://custom.example.invalid"),
                lambda target: target.update(origin=None),
                lambda target: target.update(
                    origin="https://agent-hub-api-999888777666.europe-west3.run.app"
                ),
                lambda target: target.update(lifecycle="create", enabled=False, adoption=None),
            ):
                value = selected()
                mutate(value["targets"][name])
                if value["targets"][name]["lifecycle"] == "create" and name == "agent-hub":
                    value["bootstrapStages"][name] = "none"
                with self.subTest(target=name), self.assertRaises(profile.ProfileError):
                    profile.compile_user_hub_trust_artifacts(value)

    def test_disabled_trust_does_not_require_a_hub_instance_or_origin(self):
        value = web.owner_profile()
        value.update(schemaVersion=3, userHubTrust={"enabled": False, "hubSubject": None})
        value["targets"]["agent-hub"].update(origin=None, image=None)
        instance, hub, document, _ = compiled(value)
        self.assertIsNone(hub)
        self.assertEqual(
            profile.parse_user_hub_trust(
                profile.canonical(document),
                instance=instance,
                expected_sha256=profile.digest(document),
            ),
            document,
        )

    def test_no_ambient_credentials_network_or_identity_defaults_are_used(self):
        with (
            patch("socket.socket.connect", side_effect=AssertionError("No network")),
            patch.dict(
                "os.environ",
                {"GOOGLE_CLOUD_PROJECT": "wrong-project", "USER_TRUSTED_HUB_CALLERS": "bad"},
                clear=True,
            ),
        ):
            instance, hub, document, _ = compiled()
            profile.parse_user_hub_trust(
                profile.canonical(document),
                instance=instance,
                hub_instance=hub,
                expected_sha256=profile.digest(document),
            )
        self.assertNotIn("wrong-project", json.dumps(document))

    def test_configuration_hash_is_independent_and_every_semantic_field_is_bound(self):
        instance, hub, document, _ = compiled()
        for expected in (None, "", "0" * 64, "A" * 64, True):
            with self.subTest(pin=expected), self.assertRaises(profile.ProfileError):
                profile.parse_user_hub_trust(
                    profile.canonical(document),
                    instance=instance,
                    hub_instance=hub,
                    expected_sha256=expected,
                )
        changed = copy.deepcopy(document)
        changed["hubSubject"] = "999999999999999999999"
        changed["environment"]["USER_TRUSTED_HUB_CALLERS"] = profile.canonical(
            {
                changed["hubSubject"]: next(
                    iter(json.loads(document["environment"]["USER_TRUSTED_HUB_CALLERS"]).values())
                ),
            }
        ).decode()
        with self.assertRaises(profile.ProfileError):
            profile.parse_user_hub_trust(
                profile.canonical(changed),
                instance=instance,
                hub_instance=hub,
                expected_sha256=profile.digest(document),
            )

    def test_cross_instance_user_hub_pairs_reject_even_with_recomputed_pin(
        self,
    ):
        instance, hub, document, _ = compiled()
        cases = [(hub, hub), (instance, None), (instance, instance)]
        for name, value in (
            ("instanceId", "other-instance"),
            ("region", "us-east1"),
            ("project", {"id": "other-project", "number": "999888777666"}),
            (
                "source",
                {
                    "repositoryUrl": "https://github.com/example/other.git",
                    "repositoryResource": hub["source"]["repositoryResource"],
                },
            ),
        ):
            changed = copy.deepcopy(hub)
            changed[name] = value
            cases.append((instance, changed))
        for user, producer in cases:
            candidate = copy.deepcopy(document)
            candidate["userDeploymentSha256"] = profile.digest(user)
            candidate["hubDeploymentSha256"] = profile.digest(producer) if producer else None
            with (
                self.subTest(producer=producer and producer["target"]),
                self.assertRaises(profile.ProfileError),
            ):
                profile.parse_user_hub_trust(
                    profile.canonical(candidate),
                    instance=user,
                    hub_instance=producer,
                    expected_sha256=profile.digest(candidate),
                )

    def test_wrong_email_audience_issuer_and_unbounded_settings_reject_even_when_repinned(self):
        instance, hub, document, _ = compiled()
        mutations = [
            lambda x: x.update(target="portfolio"),
            lambda x: x.update(instanceId="other-instance"),
            lambda x: x.update(userDeploymentSha256="0" * 64),
            lambda x: x.update(hubDeploymentSha256="0" * 64),
            lambda x: x.update(schemaVersion=True),
            lambda x: x.update(approved=True),
            lambda x: x["environment"].update(USER_SERVICE_AUDIENCE="https://other.invalid"),
            lambda x: x["environment"].update(
                USER_DELEGATION_AUDIENCE=x["environment"]["USER_SERVICE_AUDIENCE"]
            ),
            lambda x: x["environment"].update(USER_DELEGATION_ISSUER="https://other.invalid"),
            lambda x: x["environment"].update(
                USER_TRUSTED_HUB_CALLERS='{"123":"other@other-project.iam.gserviceaccount.com"}'
            ),
            lambda x: x["environment"].update(USER_TRUSTED_HUB_CALLERS='{"123":null}'),
            lambda x: x["environment"].update(USER_TRUSTED_HUB_CALLERS="{}"),
            lambda x: x["environment"].update(
                USER_TRUSTED_HUB_CALLERS=" " + x["environment"]["USER_TRUSTED_HUB_CALLERS"]
            ),
            lambda x: x["environment"].update(USER_JWKS_URL="https://untrusted.invalid"),
            lambda x: x["environment"].update(USER_DELEGATION_ISSUER=123),
        ]
        for mutate in mutations:
            candidate = copy.deepcopy(document)
            mutate(candidate)
            with self.subTest(candidate=candidate), self.assertRaises(profile.ProfileError):
                profile.parse_user_hub_trust(
                    profile.canonical(candidate),
                    instance=instance,
                    hub_instance=hub,
                    expected_sha256=profile.digest(candidate),
                )

    def test_disabled_document_cannot_smuggle_any_identity_or_environment(self):
        instance, _, document, _ = compiled(selected(enabled=False))
        for mutate in (
            lambda x: x.update(hubDeploymentSha256="a" * 64),
            lambda x: x["environment"].update(USER_TRUSTED_HUB_CALLERS="{}"),
            lambda x: x["environment"].update(USER_SERVICE_AUDIENCE="https://wrong.invalid"),
        ):
            candidate = copy.deepcopy(document)
            mutate(candidate)
            with self.assertRaises(profile.ProfileError):
                profile.parse_user_hub_trust(
                    profile.canonical(candidate),
                    instance=instance,
                    expected_sha256=profile.digest(candidate),
                )

    def test_canonical_parser_rejects_duplicate_noncanonical_oversized_and_non_json_bytes(self):
        instance, hub, document, _ = compiled()
        encoded = profile.canonical(document)
        for data in (
            encoded + b"\n",
            json.dumps(document).encode(),
            b'{"schemaVersion":1,' + encoded[1:],
            b'{"environment":{"USER_SERVICE_AUDIENCE":"first",'
            + b'"USER_SERVICE_AUDIENCE":"second"}}',
            b"NaN",
            b"null",
            b"[]",
            b"\xff",
            b"x" * 4001,
        ):
            with self.subTest(data=data[:40]), self.assertRaises(profile.ProfileError):
                profile.parse_user_hub_trust(
                    data,
                    instance=instance,
                    hub_instance=hub,
                    expected_sha256=profile.digest(document),
                )
        for data in (b'{"schemaVersion":3,"schemaVersion":3}', b'{"schemaVersion":NaN}'):
            with self.assertRaises(profile.ProfileError):
                profile.parse_profile(data)

    def test_trust_document_is_not_an_existing_target_or_terraform_input(self):
        _, _, document, _ = compiled()
        with self.assertRaises(profile.ProfileError):
            profile.parse_target(profile.canonical(document))
        with self.assertRaises(profile.ProfileError):
            profile.terraform_inputs(document)

    def test_cli_emits_only_private_offline_candidates_and_redacted_manifest(self):
        value = selected()
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            source, output = root / "selected.json", root / "review"
            source.write_bytes(profile.canonical(value))
            command = [
                sys.executable,
                str(profiles.DIRECTORY / "deployment_profile.py"),
                "compile-user-hub-trust",
                "--profile",
                str(source),
                "--output-dir",
                str(output),
            ]
            result = subprocess.run(command, capture_output=True, check=True, timeout=20)
            manifest = json.loads(result.stdout)
            self.assertEqual(
                {p.name for p in output.iterdir()},
                {
                    "user-hub-trust.candidate.json",
                    "deployment-config.candidate.json",
                    "terraform-inputs.candidate.json",
                    "trigger-substitutions.candidate.json",
                    "manifest.json",
                },
            )
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
            for file in output.iterdir():
                self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
            for file, expected in manifest["filesSha256"].items():
                self.assertEqual(hashlib.sha256((output / file).read_bytes()).hexdigest(), expected)
            for hidden in (
                value["project"]["id"],
                value["userHubTrust"]["hubSubject"],
                "USER_SERVICE_",
                "gserviceaccount.com",
            ):
                self.assertNotIn(hidden.encode(), result.stdout + result.stderr)
            self.assertFalse(manifest["productionActivation"])
            self.assertEqual(manifest["approval"], "not_requested")
            before = (output / "user-hub-trust.candidate.json").read_bytes()
            self.assertEqual(subprocess.run(command, capture_output=True, timeout=20).returncode, 1)
            self.assertEqual((output / "user-hub-trust.candidate.json").read_bytes(), before)
            bad = subprocess.run(command + ["--target", "user"], capture_output=True, timeout=20)
            self.assertEqual(bad.returncode, 1)
            self.assertNotIn(value["userHubTrust"]["hubSubject"].encode(), bad.stdout + bad.stderr)

    def test_explicit_user_extension_is_self_contained_and_uses_existing_hash_gates(self):
        for enabled in (False, True):
            value = selected(enabled=enabled)
            artifacts = profile.compile_user_hub_trust_artifacts(value)
            extended = artifacts["deployment-config.candidate.json"]
            parsed = profile.parse_target(profile.canonical(extended))
            self.assertEqual(parsed["schemaVersion"], 1)
            self.assertEqual(parsed["target"], "user")
            self.assertEqual(parsed["inputs"], profile.compile_target(value, "user")["inputs"])
            self.assertEqual(
                profile.terraform_inputs(parsed),
                {
                    "deployment": parsed["inputs"],
                    "hub_trust": artifacts["user-hub-trust.candidate.json"]["environment"],
                },
            )
            self.assertEqual(
                artifacts["trigger-substitutions.candidate.json"],
                {
                    "_DEPLOYMENT_CONFIG": profile.canonical(parsed).decode(),
                    "_DEPLOYMENT_SHA256": profile.digest(parsed),
                },
            )
            summary = profiles.pipeline.instance_manifest(parsed)
            self.assertEqual(
                summary["deployment_inputs_sha256"],
                profile.digest(profile.terraform_inputs(parsed)),
            )
            self.assertNotEqual(
                profile.digest(parsed), profile.digest(profile.compile_target(value, "user"))
            )

    def test_extended_projection_rejects_unknown_fields_other_targets_and_modified_nested_identity(
        self,
    ):
        original = profile.compile_user_hub_trust_artifacts(selected())[
            "deployment-config.candidate.json"
        ]
        mutations = [
            lambda x: x["userHubTrust"].update(extra=True),
            lambda x: x["userHubTrust"].update(hubDeployment=None),
            lambda x: x["userHubTrust"]["configuration"]["environment"].update(
                USER_DELEGATION_ISSUER="https://wrong.invalid"
            ),
            lambda x: x["userHubTrust"]["hubDeployment"]["inputs"].update(
                runtime_account_id="wrong-runtime"
            ),
            lambda x: x["inputs"].update(hub_trust={}),
        ]
        for mutate in mutations:
            value = copy.deepcopy(original)
            mutate(value)
            with self.assertRaises(profile.ProfileError):
                profile.parse_target(profile.canonical(value))
        for target in ("repo", "web", "portfolio", "agent-hub"):
            value = profile.compile_target(selected(), target)
            value["userHubTrust"] = original["userHubTrust"]
            with self.assertRaises(profile.ProfileError):
                profile.parse_target(profile.canonical(value))

    def test_unmigrated_source_rejects_extension_while_explicit_user_source_opt_in_allows_it(self):
        extended = profile.compile_user_hub_trust_artifacts(selected())[
            "deployment-config.candidate.json"
        ]
        legacy = profile.compile_target(selected(), "user")
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            directory = root / "infra/gcp/terraform/envs/prod/user"
            directory.mkdir(parents=True)
            policy = {
                "schema_version": 2,
                "targets": {
                    "user": {
                        "enabled": True,
                        "directory": "infra/gcp/terraform/envs/prod/user",
                        "deployment_source": "trigger-v1",
                        "configuration_controllers": ["module.user.terraform_data.configuration"],
                    }
                },
            }
            (root / profiles.pipeline.POLICY).write_text(json.dumps(policy))
            (root / "infra/gcp/terraform/toolchain.json").write_text(
                (profiles.DIRECTORY / "terraform/toolchain.json").read_text()
            )
            with self.assertRaisesRegex(RuntimeError, "has not adopted"):
                profiles.pipeline.registry(root, "user", extended)
            _, _, actual = profiles.pipeline.registry(root, "user", legacy)
            self.assertEqual(actual, directory)
            marker = directory / "user-hub-trust.consumer.json"
            marker.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "target": "user",
                        "trustContract": "user-hub-trust.v1",
                        "terraformVariable": "hub_trust",
                    }
                )
            )
            policy, selected_target, actual = profiles.pipeline.registry(root, "user", extended)
            self.assertEqual(actual, directory)
            self.assertEqual(policy["deployment"], extended)
            self.assertEqual(selected_target["state_prefix"], "prod/user")

    def test_consumer_marker_is_closed_bounded_and_rejects_duplicate_keys_and_symlinks(self):
        marker_value = {
            "schemaVersion": 1,
            "target": "user",
            "trustContract": "user-hub-trust.v1",
            "terraformVariable": "hub_trust",
        }
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            marker = root / "user-hub-trust.consumer.json"
            with self.assertRaises(RuntimeError):
                profiles.pipeline.require_user_hub_trust_consumer(root)
            marker.write_text(json.dumps(marker_value, indent=2) + "\n")
            profiles.pipeline.require_user_hub_trust_consumer(root)
            for data in (
                b'{"schemaVersion":1,"schemaVersion":1,"target":"user","trustContract":"user-hub-trust.v1","terraformVariable":"hub_trust"}',
                json.dumps({**marker_value, "schemaVersion": True}).encode(),
                json.dumps({**marker_value, "extra": True}).encode(),
                json.dumps({**marker_value, "target": "portfolio"}).encode(),
                json.dumps({**marker_value, "terraformVariable": "environment"}).encode(),
                b"null",
                b"NaN",
                b"\xff",
                b" " * 513,
            ):
                marker.write_bytes(data)
                with self.assertRaises(RuntimeError):
                    profiles.pipeline.require_user_hub_trust_consumer(root)
            marker.unlink()
            destination = root / "other.json"
            destination.write_text(json.dumps(marker_value))
            marker.symlink_to(destination)
            with self.assertRaises(RuntimeError):
                profiles.pipeline.require_user_hub_trust_consumer(root)

    def test_schemas_remain_closed_and_example_defaults_disabled(self):
        directory = profiles.DIRECTORY / "deployment-profiles"
        schema = json.loads((directory / "profile-v3.schema.json").read_text())
        self.assertEqual(schema["properties"]["schemaVersion"], {"const": 3})
        self.assertEqual(
            set(schema["properties"]), profile.TOP_FIELDS | {"webOwnerApis", "userHubTrust"}
        )
        self.assertEqual(
            set(schema["properties"]["userHubTrust"]["properties"]), profile.USER_HUB_TRUST_OPTIONS
        )
        trust = json.loads((directory / "user-hub-trust.schema.json").read_text())
        self.assertEqual(set(trust["properties"]), profile.USER_HUB_TRUST_FIELDS)
        self.assertEqual(set(trust["required"]), profile.USER_HUB_TRUST_FIELDS)
        self.assertFalse(trust["additionalProperties"])
        self.assertEqual(
            set(trust["properties"]["environment"]["properties"]),
            profile.USER_HUB_TRUST_ENVIRONMENT_FIELDS,
        )
        self.assertFalse(trust["properties"]["environment"]["additionalProperties"])
        example = profile.load_profile(directory / "example-v3.profile.json")
        self.assertEqual(example["userHubTrust"], {"enabled": False, "hubSubject": None})


if __name__ == "__main__":
    unittest.main()
