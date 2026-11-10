"""Offline public projection only; no resources, credentials or activation."""

import copy
import json
import unittest

import test_deployment_profile as profiles
import test_web_owner_configuration as web

profile = profiles.profile


def selection():
    vector = json.loads(
        (
            profiles.DIRECTORY.parents[1]
            / "services/common/tests/fixtures/executor_trust_node.json"
        ).read_text()
    )
    return {
        "connectionId": "independent_demo",
        "clientId": "native_client",
        "issuer": "https://policy.example.com",
        "audience": "https://executor.example.com/mcp",
        "policyJwk": vector["policyPublicJwk"],
        "nativeRedirectUris": ["https://chatgpt.com/connector_platform/oauth/callback"],
    }


def candidate(config=None):
    value = web.owner_profile(hub=True)
    value.update(
        schemaVersion=5,
        userHubTrust={"enabled": False, "hubSubject": None},
        portfolioHubTrust={"hubEnabled": False, "hubSubject": None, "webOwnerEnabled": False},
        webIndependentAgent=config,
    )
    return value


class IndependentWebProjectionTests(unittest.TestCase):
    def test_null_v5_keeps_existing_projection_bytes_and_no_activation(self):
        new = candidate()
        old = {k: v for k, v in new.items() if k != "webIndependentAgent"}
        old["schemaVersion"] = 4
        for compiler in [
            profile.compile_web_owner_artifacts,
            profile.compile_web_owner_deployment_artifacts,
        ]:
            before, after = compiler(old), compiler(new)
            for name in ("web-owner-server.candidate.json", "web-owner-public.candidate.json"):
                self.assertEqual(profile.canonical(before[name]), profile.canonical(after[name]))
            self.assertEqual(
                set(after["web-owner-server.candidate.json"]["environment"]),
                profile.WEB_OWNER_ENVIRONMENT_FIELDS,
            )
            self.assertFalse(after["manifest.json"]["productionActivation"])

    def test_selection_is_pinned_web_runtime_only_and_retains_four_kilobyte_budget(self):
        value = candidate(selection())
        before = candidate()
        for name, target in value["targets"].items():
            if target["lifecycle"] == "adopt":
                self.assertEqual(
                    profile.compile_target(before, name), profile.compile_target(value, name)
                )
        result = profile.compile_web_owner_deployment_artifacts(value)
        instance = result["deployment-config.candidate.json"]
        env = profile.terraform_inputs(instance)["owner_environment"]
        self.assertEqual(
            set(env),
            profile.WEB_OWNER_ENVIRONMENT_FIELDS | profile.WEB_INDEPENDENT_ENVIRONMENT_FIELDS,
        )
        self.assertEqual(env["FOLIOVIEW_INDEPENDENT_AGENT_ENABLED"], "true")
        self.assertEqual(
            env["FOLIOVIEW_INDEPENDENT_AGENT_CONFIG"],
            profile.canonical(selection()).decode("ascii"),
        )
        self.assertEqual(
            result["web-owner-public.candidate.json"]["flags"],
            {"portfolio": False, "agentHub": True},
        )
        self.assertEqual(instance["build"], profile.compile_target(before, "web")["build"])
        self.assertEqual(profile.MAX_TARGET_BYTES, 4000)
        self.assertLessEqual(len(profile.canonical(instance)), 4000)
        self.assertEqual(profile.parse_target(profile.canonical(instance)), instance)
        self.assertFalse(result["manifest.json"]["productionActivation"])

    def test_wrong_key_callback_scope_and_large_selection_fail_closed(self):
        mutations = [
            lambda c: c.update(rootPrivateJwk="CANARY"),
            lambda c: c["policyJwk"].update(d="CANARY"),
            lambda c: c["policyJwk"].update(x="A" * 43, y="A" * 43),
            lambda c: c["policyJwk"].update(crv="P-384"),
            lambda c: c.update(clientId="client:invalid"),
            lambda c: c.update(issuer="https://user:password@policy.example.com"),
            lambda c: c.update(audience="https://policy.example.com/mcp"),
            lambda c: c.update(nativeRedirectUris=["https://chatgpt.com/*"]),
            lambda c: c.update(nativeRedirectUris=["https://chatgpt.com/callback?client=x"]),
            lambda c: c.update(nativeRedirectUris=["https://chatgpt.com/a/../callback"]),
            lambda c: c.update(nativeRedirectUris=["https://chatgpt.com/callback"] * 2),
            lambda c: c.update(
                nativeRedirectUris=["https://chatgpt.com/" + "x" * 480 + str(i) for i in range(4)]
            ),
        ]
        for mutate in mutations:
            config = selection()
            mutate(config)
            with self.subTest(mutate=mutate), self.assertRaises(profile.ProfileError):
                profile.validate_profile(candidate(config))

    def test_hub_firebase_and_distinct_ordinary_targets_are_required(self):
        value = candidate(selection())
        value["webOwnerApis"]["agentHub"] = False
        with self.assertRaises(profile.ProfileError):
            profile.validate_profile(value)
        value = candidate(selection())
        value["webIndependentAgent"]["issuer"] = value["targets"]["agent-hub"]["origin"]
        with self.assertRaises(profile.ProfileError):
            profile.validate_profile(value)

    def test_partial_disabled_noncanonical_and_unpinned_environment_is_rejected(self):
        value = candidate(selection())
        artifacts = profile.compile_web_owner_artifacts(value)
        original = artifacts["web-owner-server.candidate.json"]
        base = profile.compile_target(value, "web")
        mutations = [
            lambda e: e.pop("FOLIOVIEW_INDEPENDENT_AGENT_ENABLED"),
            lambda e: e.update(FOLIOVIEW_INDEPENDENT_AGENT_ENABLED="false"),
            lambda e: e.update(FOLIOVIEW_HUB_OWNER_ENABLED="false", FOLIOVIEW_HUB_ORIGIN=""),
            lambda e: e.update(
                FOLIOVIEW_INDEPENDENT_AGENT_CONFIG=json.dumps(selection(), indent=2)
            ),
            lambda e: e.update(FOLIOVIEW_INDEPENDENT_AGENT_CONFIG='{"extra":true}'),
        ]
        for mutate in mutations:
            changed = copy.deepcopy(original)
            mutate(changed["environment"])
            with self.subTest(mutate=mutate), self.assertRaises(profile.ProfileError):
                profile.validate_web_owner_server(changed, base)
        changed = copy.deepcopy(original)
        config = selection()
        config["connectionId"] = "another_reviewed_identity"
        changed["environment"]["FOLIOVIEW_INDEPENDENT_AGENT_CONFIG"] = profile.canonical(
            config
        ).decode("ascii")
        with self.assertRaises(profile.ProfileError):
            profile.parse_web_owner_server(
                profile.canonical(changed), instance=base, expected_sha256=profile.digest(original)
            )

    def test_new_example_is_inert_and_schemas_remain_closed(self):
        directory = profiles.DIRECTORY / "deployment-profiles"
        example = profile.load_profile(directory / "example-v5.profile.json")
        self.assertIsNone(example["webIndependentAgent"])
        schema = json.loads((directory / "profile-v5.schema.json").read_text())
        previous = json.loads((directory / "profile-v4.schema.json").read_text())
        self.assertEqual(
            set(schema["properties"]), set(previous["properties"]) | {"webIndependentAgent"}
        )
        self.assertEqual(set(schema["required"]), set(schema["properties"]))
        self.assertFalse(schema["additionalProperties"])
        config = json.loads((directory / "web-independent-agent.schema.json").read_text())
        self.assertEqual(set(config["properties"]), profile.WEB_INDEPENDENT_FIELDS)
        self.assertFalse(config["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
