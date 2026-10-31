"""Managed Web opt-in reuses closed sidecars without changing public builds."""

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import test_deployment_profile as profiles
import test_web_owner_configuration as web

profile, pipeline = profiles.profile, profiles.pipeline


class ManagedWebOwnerTests(unittest.TestCase):
    def test_independent_flags_reuse_sidecars_and_existing_nine_build_fields(self):
        for portfolio, hub in [(False, False), (True, False), (False, True), (True, True)]:
            value = web.owner_profile(portfolio=portfolio, hub=hub)
            before = copy.deepcopy(value)
            old = profile.compile_web_owner_artifacts(value)
            new = profile.compile_web_owner_deployment_artifacts(value)
            base = profile.compile_target(value, "web")
            for name in ["web-owner-server.candidate.json", "web-owner-public.candidate.json"]:
                self.assertEqual(old[name], new[name])
            extended = new["deployment-config.candidate.json"]
            self.assertEqual({k: v for k, v in extended.items() if k != "webOwner"}, base)
            self.assertEqual(set(extended["build"]), profile.WEB_BUILD_FIELDS)
            self.assertEqual(len(extended["build"]), 9)
            self.assertEqual(
                profile.terraform_inputs(extended),
                {
                    "deployment": base["inputs"],
                    "owner_environment": old["web-owner-server.candidate.json"]["environment"],
                },
            )
            self.assertLessEqual(len(profile.canonical(extended)), 4000)
            self.assertEqual(profile.parse_target(profile.canonical(extended)), extended)
            self.assertEqual(value, before)
            self.assertEqual(
                new["web-owner-public.candidate.json"]["flags"],
                {"portfolio": portfolio, "agentHub": hub},
            )

    def test_old_profile_and_default_compiler_outputs_stay_unextended(self):
        for value in [profiles.adopted(), web.owner_profile(portfolio=True, hub=True)]:
            before = profile.compile_artifacts(value, "web")
            old_sidecars = profile.compile_web_owner_artifacts(value)
            profile.compile_web_owner_deployment_artifacts(value)
            self.assertEqual(profile.compile_artifacts(value, "web"), before)
            self.assertEqual(profile.compile_web_owner_artifacts(value), old_sidecars)
            self.assertNotIn("webOwner", before["deployment-config.candidate.json"])
            self.assertEqual(set(before["terraform-inputs.candidate.json"]), {"deployment"})

    def test_server_public_and_base_hash_mutations_fail_closed(self):
        a = profile.compile_web_owner_deployment_artifacts(
            web.owner_profile(portfolio=True, hub=True)
        )
        original = a["deployment-config.candidate.json"]
        mutations = [
            lambda v: v["webOwner"].update(extra=True),
            lambda v: v["webOwner"].pop("public"),
            lambda v: v["webOwner"]["server"].update(webDeploymentSha256="0" * 64),
            lambda v: v["webOwner"]["server"]["environment"].update(
                FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID="other-project"
            ),
            lambda v: v["webOwner"]["server"]["environment"].update(
                FOLIOVIEW_PORTFOLIO_AUDIENCE="https://other.example"
            ),
            lambda v: v["webOwner"]["server"]["environment"].update(
                FOLIOVIEW_HUB_ORIGIN="https://other.example"
            ),
            lambda v: v["webOwner"]["server"]["environment"].update(EXTRA="unexpected"),
            lambda v: v["webOwner"]["public"]["flags"].update(agentHub=False),
            lambda v: v["webOwner"]["public"].update(serverConfigurationSha256="0" * 64),
            lambda v: v["webOwner"]["public"].update(schemaVersion=True),
            lambda v: v["inputs"].update(runtime_account_id="another-runtime"),
        ]
        for mutate in mutations:
            value = copy.deepcopy(original)
            mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(profile.ProfileError):
                profile.parse_target(profile.canonical(value))

    def test_extension_is_web_only_and_canonical_transport_is_required(self):
        value = web.owner_profile(portfolio=True, hub=True)
        extended = profile.compile_web_owner_deployment_artifacts(value)[
            "deployment-config.candidate.json"
        ]
        for target in ["user", "portfolio", "agent-hub", "repo"]:
            other = profile.compile_target(value, target)
            other["webOwner"] = extended["webOwner"]
            with self.subTest(target=target), self.assertRaises(profile.ProfileError):
                profile.parse_target(profile.canonical(other))
        for data in [
            profile.canonical(extended) + b"\n",
            b'{"target":"web",' + profile.canonical(extended)[1:],
            b" " * 4001,
        ]:
            with self.assertRaises(profile.ProfileError):
                profile.parse_target(data)

    def test_managed_hub_origin_is_numbered_while_old_sidecar_contract_is_unchanged(self):
        value = web.owner_profile(hub=True)
        value["targets"]["agent-hub"]["origin"] = "https://hub.custom.example"
        self.assertEqual(
            profile.compile_web_owner_artifacts(value)["web-owner-server.candidate.json"][
                "environment"
            ]["FOLIOVIEW_HUB_ORIGIN"],
            "https://hub.custom.example",
        )
        with self.assertRaises(profile.ProfileError):
            profile.compile_web_owner_deployment_artifacts(value)

    def test_complete_artifacts_and_hashes_bind_both_public_and_server_projections(self):
        a = profile.compile_web_owner_deployment_artifacts(
            web.owner_profile(portfolio=True, hub=True)
        )
        m = a["manifest.json"]
        self.assertEqual(m["approval"], "not_requested")
        self.assertFalse(m["productionActivation"])
        for name, digest in m["filesSha256"].items():
            self.assertEqual(hashlib.sha256(profile.canonical(a[name]) + b"\n").hexdigest(), digest)
        self.assertEqual(
            m["terraformInputsSha256"], profile.digest(a["terraform-inputs.candidate.json"])
        )
        sub = a["trigger-substitutions.candidate.json"]
        self.assertEqual(
            hashlib.sha256(sub["_DEPLOYMENT_CONFIG"].encode()).hexdigest(),
            sub["_DEPLOYMENT_SHA256"],
        )

    def test_managed_source_opt_in_prevents_ignoring_owner_environment(self):
        value = web.owner_profile(portfolio=True, hub=True)
        base = profile.compile_target(value, "web")
        extended = profile.compile_web_owner_deployment_artifacts(value)[
            "deployment-config.candidate.json"
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            directory = root / "infra/gcp/terraform/envs/prod/web"
            directory.mkdir(parents=True)
            policy = {
                "schema_version": 2,
                "targets": {
                    "web": {
                        "enabled": True,
                        "directory": "infra/gcp/terraform/envs/prod/web",
                        "deployment_source": "trigger-v1",
                        "configuration_controllers": ["module.web.terraform_data.configuration"],
                    }
                },
            }
            (root / pipeline.POLICY).write_text(json.dumps(policy))
            (root / "infra/gcp/terraform/toolchain.json").write_text(
                (profiles.DIRECTORY / "terraform/toolchain.json").read_text()
            )
            self.assertEqual(pipeline.registry(root, "web", base)[2], directory)
            with self.assertRaisesRegex(RuntimeError, "has not adopted"):
                pipeline.registry(root, "web", extended)
            (directory / "web-owner.consumer.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "target": "web",
                        "configurationContract": "web-owner.v1",
                        "terraformVariable": "owner_environment",
                    }
                )
            )
            self.assertEqual(pipeline.registry(root, "web", extended)[0]["deployment"], extended)

    def test_source_marker_rejects_duplicates_unknowns_wrong_variable_and_symlinks(self):
        expected = {
            "schemaVersion": 1,
            "target": "web",
            "configurationContract": "web-owner.v1",
            "terraformVariable": "owner_environment",
        }
        with tempfile.TemporaryDirectory() as temporary:
            d = Path(temporary)
            marker = d / "web-owner.consumer.json"
            for raw in [
                json.dumps({**expected, "schemaVersion": True}),
                json.dumps({**expected, "terraformVariable": "hub_trust"}),
                json.dumps({**expected, "extra": True}),
                '{"schemaVersion":1,' + json.dumps(expected)[1:],
                " " * 513,
            ]:
                marker.write_text(raw)
                with self.assertRaises(RuntimeError):
                    pipeline.require_web_owner_consumer(d)
            marker.unlink()
            target = d / "real.json"
            target.write_text(json.dumps(expected))
            marker.symlink_to(target)
            with self.assertRaises(RuntimeError):
                pipeline.require_web_owner_consumer(d)

    def test_new_cli_has_private_artifacts_and_does_not_accept_target_override(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            p = root / "profile.json"
            p.write_text(json.dumps(web.owner_profile(portfolio=True, hub=True)))
            out = root / "review"
            args = [
                sys.executable,
                str(profiles.DIRECTORY / "deployment_profile.py"),
                "compile-web-owner-deployment",
                "--profile",
                str(p),
                "--output-dir",
                str(out),
            ]
            r = subprocess.run(args, capture_output=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(out.stat().st_mode & 0o777, 0o700)
            for file in out.iterdir():
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(list(out.iterdir())), 6)
            self.assertNotEqual(
                subprocess.run(args + ["--target", "web"], capture_output=True).returncode, 0
            )
