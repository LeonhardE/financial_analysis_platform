"""Offline Web-owner configuration without activating existing cloud consumers."""

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
from uuid import UUID

import test_deployment_profile as profiles

profile = profiles.profile


def owner_profile(*, portfolio=False, hub=False):
    value = profiles.adopted()
    value["schemaVersion"] = 2
    value["webOwnerApis"] = {"portfolio": portfolio, "agentHub": hub}
    if hub:
        value["targets"]["agent-hub"].update(
            lifecycle="adopt",
            adoption={
                field: str(UUID(int=100 + i))
                for i, field in enumerate(sorted(profile.ADOPTION_FIELDS))
            },
        )
        value["bootstrapStages"]["agent-hub"] = "service"
    return value


def stable_legacy_profile():
    """Stable synthetic anchors for a digest snapshot from the pre-change compiler."""
    value = profiles.adopted()
    for i, name in enumerate(sorted(value["targets"])):
        target = value["targets"][name]
        if target["lifecycle"] != "adopt":
            continue
        target["adoption"] = {
            field: None
            if name == "repo" and field in {"serviceUid", "buildTriggerId"}
            else str(UUID(int=10 * i + j + 1))
            for j, field in enumerate(sorted(profile.ADOPTION_FIELDS))
        }
    return value


class WebOwnerConfigurationTests(unittest.TestCase):
    def artifacts(self, value=None):
        value = owner_profile(portfolio=True) if value is None else value
        artifacts = profile.compile_web_owner_artifacts(value)
        return (
            profile.compile_target(value, "web"),
            artifacts["web-owner-server.candidate.json"],
            artifacts["web-owner-public.candidate.json"],
            artifacts["manifest.json"],
        )

    def test_v1_and_v2_disabled_keep_all_existing_target_projections_identical(self):
        legacy = stable_legacy_profile()
        newer = copy.deepcopy(legacy)
        newer.update(schemaVersion=2, webOwnerApis={"portfolio": False, "agentHub": False})
        baseline = json.loads(
            (profiles.DIRECTORY / "tests/fixtures/web-owner-legacy-projections.json").read_text()
        )
        for target, expected in baseline.items():
            first = profile.compile_target(legacy, target)
            second = profile.compile_target(newer, target)
            self.assertEqual(first, second)
            self.assertEqual(profile.digest(first), expected["projectionSha256"])
            self.assertEqual(
                profile.digest(profile.terraform_inputs(second)), expected["terraformInputsSha256"]
            )
            self.assertEqual(
                profile.compile_artifacts(legacy, target), profile.compile_artifacts(newer, target)
            )
        before, after = profile.render(legacy), profile.render(newer)
        self.assertEqual(set(before), set(after))
        for name in set(before) - {"manifest.json"}:
            self.assertEqual(before[name], after[name], name)
        self.assertEqual(
            before["manifest.json"]["filesSha256"], after["manifest.json"]["filesSha256"]
        )
        self.assertNotEqual(
            before["manifest.json"]["profileSha256"], after["manifest.json"]["profileSha256"]
        )

    def test_new_flags_do_not_enter_existing_compile_or_render_consumer_inputs(self):
        value = owner_profile(portfolio=True, hub=True)
        disabled = copy.deepcopy(value)
        disabled["webOwnerApis"] = {"portfolio": False, "agentHub": False}
        for target in profile.TARGET_SERVICES:
            self.assertEqual(
                profile.compile_artifacts(value, target),
                profile.compile_artifacts(disabled, target),
            )
        before, after = profile.render(value), profile.render(disabled)
        for name in set(before) - {"manifest.json"}:
            self.assertEqual(before[name], after[name])
        self.assertEqual(
            before["manifest.json"]["filesSha256"], after["manifest.json"]["filesSha256"]
        )
        self.assertEqual(len(profile.compile_target(value, "web")["build"]), 9)
        self.assertNotIn(
            "environment",
            profile.terraform_inputs(profile.compile_target(value, "web"))["deployment"],
        )

    def test_missing_v1_configuration_and_explicit_v2_false_both_default_closed(self):
        for value in (profiles.adopted(), owner_profile()):
            with self.subTest(version=value["schemaVersion"]):
                _, server, public, _ = self.artifacts(value)
                self.assertEqual(public["flags"], {"portfolio": False, "agentHub": False})
                self.assertEqual(
                    server["environment"],
                    {
                        "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID": "",
                        "FOLIOVIEW_PORTFOLIO_OWNER_ENABLED": "false",
                        "FOLIOVIEW_PORTFOLIO_ORIGIN": "",
                        "FOLIOVIEW_PORTFOLIO_AUDIENCE": "",
                        "FOLIOVIEW_HUB_OWNER_ENABLED": "false",
                        "FOLIOVIEW_HUB_ORIGIN": "",
                    },
                )

    def test_portfolio_can_enable_without_a_hub_service_or_origin(self):
        value = owner_profile(portfolio=True)
        value["targets"]["agent-hub"].update(origin=None, image=None)
        instance, server, public, _ = self.artifacts(value)
        environment = server["environment"]
        self.assertEqual(environment["FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID"], value["project"]["id"])
        self.assertEqual(
            environment["FOLIOVIEW_PORTFOLIO_ORIGIN"], value["targets"]["portfolio"]["origin"]
        )
        self.assertEqual(
            environment["FOLIOVIEW_PORTFOLIO_AUDIENCE"], environment["FOLIOVIEW_PORTFOLIO_ORIGIN"]
        )
        self.assertEqual(environment["FOLIOVIEW_HUB_ORIGIN"], "")
        self.assertEqual(public["flags"], {"portfolio": True, "agentHub": False})
        self.assertEqual(
            profile.parse_web_owner_server(
                profile.canonical(server), instance=instance, expected_sha256=profile.digest(server)
            ),
            server,
        )

    def test_hub_can_enable_independently_with_public_https_origin_and_no_iam_audience(self):
        value = owner_profile(hub=True)
        value["targets"]["portfolio"].update(origin="https://portfolio.example.invalid")
        value["targets"]["agent-hub"]["origin"] = "https://hub.example.invalid"
        instance, server, public, _ = self.artifacts(value)
        environment = server["environment"]
        self.assertEqual(environment["FOLIOVIEW_HUB_ORIGIN"], "https://hub.example.invalid")
        self.assertEqual(environment["FOLIOVIEW_PORTFOLIO_AUDIENCE"], "")
        self.assertEqual(set(environment), profile.WEB_OWNER_ENVIRONMENT_FIELDS)
        self.assertNotIn("https://hub.example.invalid", json.dumps(public))
        self.assertEqual(public["flags"], {"portfolio": False, "agentHub": True})
        self.assertEqual(
            profile.parse_web_owner_public(
                profile.canonical(public),
                server=server,
                instance=instance,
                expected_server_sha256=profile.digest(server),
            ),
            public,
        )

    def test_profile_version_and_owner_options_remain_closed_and_strictly_boolean(self):
        cases = [
            {**profiles.adopted(), "webOwnerApis": {"portfolio": False, "agentHub": False}},
            {**profiles.adopted(), "schemaVersion": 2},
        ]
        for options in (
            None,
            {},
            {"portfolio": False},
            {"portfolio": "false", "agentHub": False},
            {"portfolio": 0, "agentHub": False},
            {"portfolio": False, "agentHub": False, "upstream": "https://untrusted.invalid"},
            {"portfolio": False, "agentHub": False, "environment": {}},
        ):
            candidate = owner_profile()
            candidate["webOwnerApis"] = options
            cases.append(candidate)
        for version in (True, 0, 3, "2"):
            cases.append({**owner_profile(), "schemaVersion": version})
        for candidate in cases:
            with self.subTest(keys=set(candidate)), self.assertRaises(profile.ProfileError):
                profile.validate_profile(candidate)

    def test_enabled_routes_require_explicit_adopted_upstreams_and_firebase(self):
        mutations = [
            lambda x: x["firebase"].update(enabled=False, apiKey="", authDomain="", appId=""),
            lambda x: x["targets"]["portfolio"].update(origin=None),
            lambda x: x["targets"]["web"].update(lifecycle="create", enabled=False, adoption=None),
            lambda x: (
                x["targets"]["portfolio"].update(lifecycle="create", enabled=False, adoption=None),
                x["bootstrapStages"].update(portfolio="none"),
            ),
            lambda x: x["webOwnerApis"].update(agentHub=True),
        ]
        for mutation in mutations:
            candidate = owner_profile(portfolio=True)
            mutation(candidate)
            with self.assertRaises(profile.ProfileError):
                profile.validate_profile(candidate)

    def test_profile_keeps_existing_source_project_region_uid_and_image_guards(self):
        mutations = [
            lambda x: x["targets"]["portfolio"].update(
                origin=x["targets"]["portfolio"]["origin"].replace("222333444555", "999888777666")
            ),
            lambda x: x["targets"]["portfolio"].update(
                origin=x["targets"]["portfolio"]["origin"].replace("europe-west3", "us-east1")
            ),
            lambda x: x["source"].update(
                repositoryResource=x["source"]["repositoryResource"].replace(
                    "222333444555", "999888777666"
                )
            ),
            lambda x: x["targets"]["portfolio"]["adoption"].update(
                serviceUid=x["targets"]["web"]["adoption"]["serviceUid"]
            ),
            lambda x: x["targets"]["portfolio"].update(
                image=x["targets"]["portfolio"]["image"].replace(
                    x["project"]["id"], "other-project"
                )
            ),
        ]
        for mutation in mutations:
            candidate = owner_profile(portfolio=True)
            mutation(candidate)
            with self.assertRaises(profile.ProfileError):
                profile.compile_web_owner_artifacts(candidate)

    def test_numbered_portfolio_origin_is_an_explicit_first_consumer_support_boundary(self):
        for address in (
            "https://portfolio.example.invalid",
            "https://portfolio-api-hash-ue.a.run.app",
        ):
            candidate = owner_profile(portfolio=True)
            candidate["targets"]["portfolio"]["origin"] = address
            with self.assertRaises(profile.ProfileError):
                profile.compile_web_owner_artifacts(candidate)
            candidate["webOwnerApis"]["portfolio"] = False
            self.assertEqual(
                profile.validate_profile(candidate)["targets"]["portfolio"]["origin"], address
            )
            candidate.pop("webOwnerApis")
            candidate["schemaVersion"] = 1
            self.assertEqual(
                profile.validate_profile(candidate)["targets"]["portfolio"]["origin"], address
            )

    def test_parser_binds_server_to_trusted_hash_and_exact_selected_web_instance(self):
        instance, server, _, _ = self.artifacts()
        with self.assertRaises(profile.ProfileError):
            profile.parse_web_owner_server(
                profile.canonical(server), instance=instance, expected_sha256="0" * 64
            )
        for mutate in (
            lambda x: x.update(instanceId="other-instance"),
            lambda x: x["source"].update(repositoryUrl="https://github.com/example/other.git"),
            lambda x: x["adoption"].update(serviceUid=str(UUID(int=999))),
            lambda x: x["inputs"].update(runtime_account_id="other-runtime"),
        ):
            other = copy.deepcopy(instance)
            mutate(other)
            with self.assertRaises(profile.ProfileError):
                profile.parse_web_owner_server(
                    profile.canonical(server),
                    instance=other,
                    expected_sha256=profile.digest(server),
                )
        with self.assertRaises(profile.ProfileError):
            profile.parse_web_owner_server(
                profile.canonical(server),
                instance=profile.compile_target(profiles.adopted(), "portfolio"),
                expected_sha256=profile.digest(server),
            )

    def test_server_rejects_wrong_audience_project_upstream_headers_and_free_environment(self):
        instance, server, _, _ = self.artifacts(owner_profile(portfolio=True, hub=True))
        mutations = [
            lambda x: x.update(schemaVersion=True),
            lambda x: x.update(serverToken="synthetic"),
            lambda x: x["environment"].update(FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID="other-project"),
            lambda x: x["environment"].update(
                FOLIOVIEW_PORTFOLIO_AUDIENCE="https://other.example.invalid"
            ),
            lambda x: x["environment"].update(
                FOLIOVIEW_PORTFOLIO_ORIGIN="https://untrusted.example.invalid"
            ),
            lambda x: x["environment"].update(
                FOLIOVIEW_HUB_ORIGIN="https://agent-hub-api-999888777666.europe-west3.run.app"
            ),
            lambda x: x["environment"].update(
                FOLIOVIEW_HUB_ORIGIN="https://user:secret@hub.example.invalid"
            ),
            lambda x: x["environment"].update(
                FOLIOVIEW_HUB_ORIGIN="https://hub.example.invalid/oauth"
            ),
            lambda x: x["environment"].update(
                FOLIOVIEW_HUB_ORIGIN=instance["build"]["_USER_API_BASE_URL"]
            ),
            lambda x: x["environment"].update(FOLIOVIEW_PORTFOLIO_OWNER_ENABLED=True),
            lambda x: x["environment"].update(NEXT_PUBLIC_SERVER_TOKEN="synthetic"),
            lambda x: x["environment"].update(FOLIOVIEW_HUB_AUDIENCE="https://hub.example.invalid"),
        ]
        for mutation in mutations:
            candidate = copy.deepcopy(server)
            mutation(candidate)
            with self.assertRaises(profile.ProfileError):
                profile.parse_web_owner_server(
                    profile.canonical(candidate),
                    instance=instance,
                    expected_sha256=profile.digest(candidate),
                )

    def test_disabled_server_rejects_retained_upstreams_audience_or_project(self):
        instance, server, _, _ = self.artifacts(owner_profile())
        for field in (
            "FOLIOVIEW_PORTFOLIO_ORIGIN",
            "FOLIOVIEW_PORTFOLIO_AUDIENCE",
            "FOLIOVIEW_HUB_ORIGIN",
            "FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID",
        ):
            changed = copy.deepcopy(server)
            changed["environment"][field] = "https://retained.example.invalid"
            with self.assertRaises(profile.ProfileError):
                profile.parse_web_owner_server(
                    profile.canonical(changed),
                    instance=instance,
                    expected_sha256=profile.digest(changed),
                )

    def test_public_contains_only_bound_flags_and_rejects_mixed_or_injected_config(self):
        instance, server, public, _ = self.artifacts()
        mutations = [
            lambda x: x.update(serverConfigurationSha256="0" * 64),
            lambda x: x.update(instanceId="other-instance"),
            lambda x: x.update(schemaVersion=True),
            lambda x: x.update(environment={"token": "synthetic"}),
            lambda x: x["flags"].update(portfolio=False),
            lambda x: x["flags"].update(portfolio=1),
            lambda x: x["flags"].update(origin="https://untrusted.invalid"),
        ]
        for mutation in mutations:
            changed = copy.deepcopy(public)
            mutation(changed)
            with self.assertRaises(profile.ProfileError):
                profile.parse_web_owner_public(
                    profile.canonical(changed),
                    server=server,
                    instance=instance,
                    expected_server_sha256=profile.digest(server),
                )
        with self.assertRaises(profile.ProfileError):
            profile.parse_web_owner_public(
                profile.canonical(public),
                server=server,
                instance=instance,
                expected_server_sha256="0" * 64,
            )
        for invalid_server in (None, {"environment": object()}):
            with self.assertRaises(profile.ProfileError):
                profile.parse_web_owner_public(
                    profile.canonical(public),
                    server=invalid_server,
                    instance=instance,
                    expected_server_sha256=profile.digest(server),
                )

    def test_parsers_reject_duplicate_noncanonical_oversized_or_non_json_documents(self):
        instance, server, public, _ = self.artifacts()
        for document, parser in (
            (
                server,
                lambda data: profile.parse_web_owner_server(
                    data, instance=instance, expected_sha256=profile.digest(server)
                ),
            ),
            (
                public,
                lambda data: profile.parse_web_owner_public(
                    data,
                    server=server,
                    instance=instance,
                    expected_server_sha256=profile.digest(server),
                ),
            ),
        ):
            encoded = profile.canonical(document)
            for data in (
                encoded + b"\n",
                json.dumps(document).encode(),
                b'{"schemaVersion":1,' + encoded[1:],
                b"NaN",
                b"null",
                b"\xff",
                b"x" * 4001,
            ):
                with self.assertRaises(profile.ProfileError):
                    parser(data)

    def test_separate_cli_writes_only_private_owner_candidates_and_no_cloud_inputs(self):
        watched = (
            "cloudbuild.web.yaml",
            "terraform/pipeline.json",
            "terraform/envs/prod/web/main.tf",
            "terraform/bootstrap/web.tf",
        )
        before = {name: (profiles.DIRECTORY / name).read_bytes() for name in watched}
        value = owner_profile(portfolio=True)
        with patch("socket.socket.connect", side_effect=AssertionError("No network allowed")):
            self.artifacts(value)
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            source, destination = root / "selected.profile.json", root / "review"
            source.write_bytes(profile.canonical(value))
            command = [
                sys.executable,
                str(profiles.DIRECTORY / "deployment_profile.py"),
                "compile-web-owner",
                "--profile",
                str(source),
                "--output-dir",
                str(destination),
            ]
            result = subprocess.run(command, capture_output=True, check=True, timeout=20)
            manifest = json.loads(result.stdout)
            self.assertEqual(
                set(path.name for path in destination.iterdir()),
                {
                    "web-owner-server.candidate.json",
                    "web-owner-public.candidate.json",
                    "manifest.json",
                },
            )
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o700)
            for path in destination.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            for file, expected in manifest["filesSha256"].items():
                self.assertEqual(
                    hashlib.sha256((destination / file).read_bytes()).hexdigest(), expected
                )
            self.assertEqual(manifest["approval"], "not_requested")
            self.assertFalse(manifest["productionActivation"])
            for hidden in (
                value["project"]["id"],
                value["firebase"]["apiKey"],
                value["targets"]["portfolio"]["origin"],
                "FOLIOVIEW_",
            ):
                self.assertNotIn(hidden.encode(), result.stdout + result.stderr)
            original = (destination / "web-owner-server.candidate.json").read_bytes()
            self.assertEqual(subprocess.run(command, capture_output=True, timeout=20).returncode, 1)
            self.assertEqual(
                (destination / "web-owner-server.candidate.json").read_bytes(), original
            )
            self.assertEqual(
                subprocess.run(
                    command + ["--target", "web"], capture_output=True, timeout=20
                ).returncode,
                1,
            )
        self.assertEqual(
            before, {name: (profiles.DIRECTORY / name).read_bytes() for name in watched}
        )

    def test_structural_schemas_match_closed_loader_contracts(self):
        directory = profiles.DIRECTORY / "deployment-profiles"
        old = json.loads((directory / "profile.schema.json").read_text())
        newer = json.loads((directory / "profile-v2.schema.json").read_text())
        self.assertEqual(old["properties"]["schemaVersion"], {"const": 1})
        self.assertEqual(newer["properties"]["schemaVersion"], {"const": 2})
        self.assertEqual(set(newer["properties"]), profile.TOP_FIELDS | {"webOwnerApis"})
        self.assertEqual(
            set(newer["properties"]["webOwnerApis"]["properties"]), profile.WEB_OWNER_FLAGS
        )
        for name, fields in (
            ("web-owner-server", profile.WEB_OWNER_SERVER_FIELDS),
            ("web-owner-public", profile.WEB_OWNER_PUBLIC_FIELDS),
        ):
            schema = json.loads((directory / (name + ".schema.json")).read_text())
            self.assertEqual(set(schema["properties"]), fields)
            self.assertEqual(set(schema["required"]), fields)
            self.assertFalse(schema["additionalProperties"])
        server = json.loads((directory / "web-owner-server.schema.json").read_text())
        self.assertEqual(
            set(server["properties"]["environment"]["properties"]),
            profile.WEB_OWNER_ENVIRONMENT_FIELDS,
        )
        self.assertFalse(server["properties"]["environment"]["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
