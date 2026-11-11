"""The retired independent route cannot enter current deployment artifacts."""

import copy
import unittest

import test_web_owner_configuration as web

profile = web.profile


class RetiredIndependentProjectionTests(unittest.TestCase):
    def test_existing_owner_projection_retains_exact_six_fields_without_agent_configuration(self):
        value = web.owner_profile(hub=True)
        for compiler in [
            profile.compile_web_owner_artifacts,
            profile.compile_web_owner_deployment_artifacts,
        ]:
            result = compiler(value)
            server = result["web-owner-server.candidate.json"]
            self.assertEqual(set(server["environment"]), profile.WEB_OWNER_ENVIRONMENT_FIELDS)
            self.assertFalse(result["manifest.json"]["productionActivation"])
            self.assertNotIn("INDEPENDENT_AGENT", profile.canonical(result).decode("ascii"))

    def test_retired_profile_version_and_selection_never_compile(self):
        value = web.owner_profile(hub=True)
        for version in [value["schemaVersion"], 5]:
            candidate = copy.deepcopy(value)
            candidate.update(schemaVersion=version, webIndependentAgent=None)
            with self.assertRaises(profile.ProfileError):
                profile.compile_web_owner_deployment_artifacts(candidate)
        old = copy.deepcopy(value)
        old.update(schemaVersion=5)
        with self.assertRaises(profile.ProfileError):
            profile.validate_profile(old)

    def test_old_environment_pair_is_refused_even_with_a_fresh_matching_digest(self):
        result = profile.compile_web_owner_deployment_artifacts(web.owner_profile(hub=True))
        instance = result["deployment-config.candidate.json"]
        server = result["web-owner-server.candidate.json"]
        for extra in [
            {"FOLIOVIEW_INDEPENDENT_AGENT_ENABLED": "true"},
            {
                "FOLIOVIEW_INDEPENDENT_AGENT_ENABLED": "true",
                "FOLIOVIEW_INDEPENDENT_AGENT_CONFIG": "{}",
            },
        ]:
            candidate = copy.deepcopy(server)
            candidate["environment"].update(extra)
            with self.assertRaises(profile.ProfileError):
                profile.parse_web_owner_server(
                    profile.canonical(candidate),
                    instance=instance,
                    expected_sha256=profile.digest(candidate),
                )
