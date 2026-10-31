"""Offline Portfolio trust, exact invokers and explicit source adoption gates."""

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import test_deployment_profile as profiles
import test_user_hub_trust_configuration as user

profile, pipeline = profiles.profile, profiles.pipeline


def selected(hub=True, web=True):
    value = user.selected()
    value.update(
        schemaVersion=4,
        portfolioHubTrust={
            "hubEnabled": hub,
            "hubSubject": "123456789012345678901" if hub else None,
            "webOwnerEnabled": web,
        },
    )
    return value


class PortfolioHubTrustTests(unittest.TestCase):
    def artifacts(self, value=None):
        return profile.compile_portfolio_hub_trust_artifacts(value or selected())

    def test_enabled_values_bind_numeric_hub_and_keep_web_out_of_internal_caller_map(self):
        value = selected()
        a = self.artifacts(value)
        d = a["portfolio-hub-trust.candidate.json"]
        prefix = "https://portfolio-api-222333444555.europe-west3.run.app"
        issuer = "https://agent-hub-api-222333444555.europe-west3.run.app"
        email = (
            value["targets"]["agent-hub"]["runtimeAccountId"]
            + "@demo-folio-beta.iam.gserviceaccount.com"
        )
        web = (
            value["targets"]["web"]["runtimeAccountId"] + "@demo-folio-beta.iam.gserviceaccount.com"
        )
        self.assertEqual(
            d["environment"],
            {
                "PORTFOLIO_SERVICE_AUDIENCE": prefix,
                "PORTFOLIO_DELEGATION_AUDIENCE": prefix + "/internal/v2",
                "PORTFOLIO_DELEGATION_ISSUER": issuer,
                "PORTFOLIO_TRUSTED_HUB_CALLERS": profile.canonical(
                    {d["hubSubject"]: email}
                ).decode(),
                "PORTFOLIO_HUB_AUTHORITY_ORIGIN": issuer,
            },
        )
        self.assertEqual(d["invokerServiceAccounts"], {"hub": email, "web": web})
        self.assertNotIn(web, d["environment"]["PORTFOLIO_TRUSTED_HUB_CALLERS"])
        extended = a["deployment-config.candidate.json"]
        self.assertLessEqual(len(profile.canonical(extended)), 4000)
        self.assertEqual(profile.parse_target(profile.canonical(extended)), extended)
        self.assertEqual(
            a["terraform-inputs.candidate.json"],
            {
                "deployment": extended["inputs"],
                "hub_trust": d["environment"],
            },
        )
        self.assertNotIn("invoker", json.dumps(a["terraform-inputs.candidate.json"]))

    def test_independent_switches_and_old_profiles_stay_closed(self):
        for hub, web in [(False, False), (True, False), (False, True), (True, True)]:
            d = self.artifacts(selected(hub, web))["portfolio-hub-trust.candidate.json"]
            self.assertEqual(
                set(d["invokerServiceAccounts"]),
                ({"hub"} if hub else set()) | ({"web"} if web else set()),
            )
            self.assertEqual(any(d["environment"].values()), hub)
        for value in [profiles.adopted(), user.selected()]:
            d = self.artifacts(value)["portfolio-hub-trust.candidate.json"]
            self.assertEqual(d["invokerServiceAccounts"], {})
            self.assertFalse(any(d["environment"].values()))

    def test_compile_and_render_outputs_remain_byte_equivalent_for_old_paths(self):
        value = selected()
        old = copy.deepcopy(value)
        old.pop("portfolioHubTrust")
        old["schemaVersion"] = 3
        for target in profile.TARGET_SERVICES:
            self.assertEqual(
                profile.compile_artifacts(value, target), profile.compile_artifacts(old, target)
            )
        for name, artifact in profile.render(old).items():
            if name != "manifest.json":
                self.assertEqual(profile.render(value)[name], artifact)
        self.assertEqual(
            profile.compile_user_hub_trust_artifacts(value)["deployment-config.candidate.json"],
            profile.compile_user_hub_trust_artifacts(old)["deployment-config.candidate.json"],
        )

    def test_profile_rejects_unknown_partial_noncanonical_and_inactive_trust(self):
        mutations = [
            lambda v: v["portfolioHubTrust"].update(extra=True),
            lambda v: v["portfolioHubTrust"].pop("webOwnerEnabled"),
            lambda v: v["portfolioHubTrust"].update(hubEnabled="true"),
            lambda v: v["portfolioHubTrust"].update(webOwnerEnabled=1),
            lambda v: v["portfolioHubTrust"].update(hubSubject="01"),
            lambda v: v["portfolioHubTrust"].update(hubSubject="0"),
            lambda v: v["portfolioHubTrust"].update(hubSubject="1" * 129),
            lambda v: v["portfolioHubTrust"].update(hubSubject=None),
            lambda v: v["portfolioHubTrust"].update(hubEnabled=False),
            lambda v: v["targets"]["portfolio"].update(origin="https://untrusted.example"),
            lambda v: v["targets"]["agent-hub"].update(origin="https://untrusted.example"),
            lambda v: v["targets"]["web"].update(origin="https://untrusted.example"),
        ]
        for mutation in mutations:
            value = selected()
            mutation(value)
            with self.subTest(mutation=mutation), self.assertRaises(profile.ProfileError):
                self.artifacts(value)

    def test_document_mutations_and_wrong_hash_are_rejected(self):
        a = self.artifacts()
        extended = a["deployment-config.candidate.json"]
        hub = extended["portfolioHubTrust"]["hubDeployment"]
        base = profile.compile_target(selected(), "portfolio")
        document = a["portfolio-hub-trust.candidate.json"]
        mutations = [
            lambda d: d.update(target="user"),
            lambda d: d.update(instanceId="other-instance"),
            lambda d: d.update(portfolioDeploymentSha256="0" * 64),
            lambda d: d.update(hubDeploymentSha256="0" * 64),
            lambda d: d.update(hubSubject="01"),
            lambda d: d.update(webRuntimeAccountId="allUsers"),
            lambda d: d.update(webRuntimeAccountId=base["inputs"]["runtime_account_id"]),
            lambda d: d["environment"].update(
                PORTFOLIO_DELEGATION_AUDIENCE="https://other.example"
            ),
            lambda d: d["environment"].update(
                PORTFOLIO_HUB_AUTHORITY_ORIGIN="https://other.example"
            ),
            lambda d: d["invokerServiceAccounts"].update(extra="allUsers"),
            lambda d: d["invokerServiceAccounts"].update(
                web="other@foreign-project.iam.gserviceaccount.com"
            ),
            lambda d: d.update(environment={}),
            lambda d: d.update(extra=True),
        ]
        for mutation in mutations:
            d = copy.deepcopy(document)
            mutation(d)
            with self.subTest(mutation=mutation), self.assertRaises(profile.ProfileError):
                profile.parse_portfolio_hub_trust(
                    profile.canonical(d),
                    instance=base,
                    hub_instance=hub,
                    expected_sha256=profile.digest(d),
                )
        with self.assertRaises(profile.ProfileError):
            profile.parse_portfolio_hub_trust(
                profile.canonical(document),
                instance=base,
                hub_instance=hub,
                expected_sha256="0" * 64,
            )

    def test_hub_anchor_cross_project_source_identity_and_uid_rejected(self):
        a = self.artifacts()
        base = profile.compile_target(selected(), "portfolio")
        document = a["portfolio-hub-trust.candidate.json"]
        for key, value in [("instanceId", "other-instance"), ("region", "us-central1")]:
            hub = copy.deepcopy(
                a["deployment-config.candidate.json"]["portfolioHubTrust"]["hubDeployment"]
            )
            hub[key] = value
            document = {**document, "hubDeploymentSha256": profile.digest(hub)}
            with self.subTest(key=key), self.assertRaises(profile.ProfileError):
                profile.validate_portfolio_hub_trust(document, base, hub)

    def test_canonical_transport_hashes_and_closed_target_envelope(self):
        a = self.artifacts()
        extended = a["deployment-config.candidate.json"]
        sub = a["trigger-substitutions.candidate.json"]
        self.assertEqual(
            hashlib.sha256(sub["_DEPLOYMENT_CONFIG"].encode()).hexdigest(),
            sub["_DEPLOYMENT_SHA256"],
        )
        for name, digest in a["manifest.json"]["filesSha256"].items():
            self.assertEqual(hashlib.sha256(profile.canonical(a[name]) + b"\n").hexdigest(), digest)
        self.assertFalse(a["manifest.json"]["productionActivation"])
        self.assertEqual(a["manifest.json"]["approval"], "not_requested")
        for payload in [
            profile.canonical(extended) + b"\n",
            b'{"target":"portfolio",' + profile.canonical(extended)[1:],
        ]:
            with self.assertRaises(profile.ProfileError):
                profile.parse_target(payload)
        other = profile.compile_target(selected(), "user")
        other["portfolioHubTrust"] = extended["portfolioHubTrust"]
        with self.assertRaises(profile.ProfileError):
            profile.parse_target(profile.canonical(other))

    def test_portfolio_source_requires_exact_bounded_nonsymlink_consumer_marker(self):
        marker_value = {
            "schemaVersion": 1,
            "target": "portfolio",
            "trustContract": "portfolio-hub-trust.v1",
            "terraformVariable": "hub_trust",
        }
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            marker = directory / "portfolio-hub-trust.consumer.json"
            with self.assertRaises(RuntimeError):
                pipeline.require_trust_consumer(directory, "portfolio")
            marker.write_text(json.dumps(marker_value))
            pipeline.require_trust_consumer(directory, "portfolio")
            for content in [
                json.dumps({**marker_value, "schemaVersion": True}),
                json.dumps({**marker_value, "target": "user"}),
                json.dumps({**marker_value, "extra": 1}),
                " " * 513,
            ]:
                marker.write_text(content)
                with self.assertRaises(RuntimeError):
                    pipeline.require_trust_consumer(directory, "portfolio")
            marker.unlink()
            target = directory / "real.json"
            target.write_text(json.dumps(marker_value))
            marker.symlink_to(target)
            with self.assertRaises(RuntimeError):
                pipeline.require_trust_consumer(directory, "portfolio")

    def test_managed_registry_refuses_unadopted_portfolio_source_and_preserves_legacy(self):
        extended = self.artifacts()["deployment-config.candidate.json"]
        legacy = profile.compile_target(selected(), "portfolio")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            directory = root / "infra/gcp/terraform/envs/prod/portfolio"
            directory.mkdir(parents=True)
            policy = {
                "schema_version": 2,
                "targets": {
                    "portfolio": {
                        "enabled": True,
                        "directory": "infra/gcp/terraform/envs/prod/portfolio",
                        "deployment_source": "trigger-v1",
                        "configuration_controllers": [
                            "module.portfolio.terraform_data.configuration"
                        ],
                    }
                },
            }
            (root / pipeline.POLICY).write_text(json.dumps(policy))
            (root / "infra/gcp/terraform/toolchain.json").write_text(
                (profiles.DIRECTORY / "terraform/toolchain.json").read_text()
            )
            with self.assertRaisesRegex(RuntimeError, "has not adopted"):
                pipeline.registry(root, "portfolio", extended)
            self.assertEqual(pipeline.registry(root, "portfolio", legacy)[2], directory)
            (directory / "portfolio-hub-trust.consumer.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "target": "portfolio",
                        "trustContract": "portfolio-hub-trust.v1",
                        "terraformVariable": "hub_trust",
                    }
                )
            )
            actual, target, path = pipeline.registry(root, "portfolio", extended)
            self.assertEqual(actual["deployment"], extended)
            self.assertEqual(target["state_prefix"], "prod/portfolio")
            self.assertEqual(path, directory)

    def test_cli_outputs_private_files_and_rejects_ambient_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            d = Path(temporary)
            source = d / "profile.json"
            source.write_text(json.dumps(selected()))
            output = d / "review"
            command = [
                sys.executable,
                str(profiles.DIRECTORY / "deployment_profile.py"),
                "compile-portfolio-hub-trust",
                "--profile",
                str(source),
                "--output-dir",
                str(output),
            ]
            result = subprocess.run(command, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for path in output.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotEqual(
                subprocess.run(command + ["--target", "portfolio"], capture_output=True).returncode,
                0,
            )

    def test_structural_v4_example_and_loader_agree(self):
        directory = profiles.DIRECTORY / "deployment-profiles"
        schema = json.loads((directory / "profile-v4.schema.json").read_text())
        expected = profile.TOP_FIELDS | {"webOwnerApis", "userHubTrust", "portfolioHubTrust"}
        self.assertEqual(schema["properties"]["schemaVersion"], {"const": 4})
        self.assertEqual(set(schema["properties"]), expected)
        self.assertEqual(set(schema["required"]), expected)
        self.assertFalse(schema["additionalProperties"])
        trust = schema["properties"]["portfolioHubTrust"]
        options = {"hubEnabled", "hubSubject", "webOwnerEnabled"}
        self.assertEqual(set(trust["properties"]), options)
        self.assertEqual(set(trust["required"]), options)
        self.assertFalse(trust["additionalProperties"])
        self.assertEqual(trust["properties"]["hubEnabled"], {"type": "boolean"})
        self.assertEqual(trust["properties"]["webOwnerEnabled"], {"type": "boolean"})
        self.assertEqual(trust["properties"]["hubSubject"]["pattern"], "^[1-9][0-9]{0,127}$")
        example = profile.load_profile(directory / "example-v4.profile.json")
        self.assertEqual(
            example["portfolioHubTrust"],
            {"hubEnabled": False, "hubSubject": None, "webOwnerEnabled": False},
        )
        for value in [example, selected()]:
            self.assertEqual(set(value), expected)
            profile.validate_profile(value)
