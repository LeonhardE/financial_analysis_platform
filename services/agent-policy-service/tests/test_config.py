"""Pinned resource/configuration controls and independent production gates."""

import copy
import os
from unittest.mock import patch

from fixtures import PolicyFixture

from app.config import Config
from app.contracts import Unavailable
from app.store import configured_store


class ConfigurationTests(PolicyFixture):
    def test_private_jwk_wildcard_callback_key_or_default_database_is_refused(self):
        cases = []
        private = copy.deepcopy(self.value)
        private["rootJwk"]["d"] = "synthetic"
        cases.append(private)
        callback = copy.deepcopy(self.value)
        callback["clients"][0]["redirectUris"] = ["https://*.example/callback"]
        cases.append(callback)
        cases += [
            self.value | {"witnessDatabase": "(default)"},
            self.value | {"kmsSigningKeyVersion": "projects/wildcard/*"},
            self.value | {"issuer": "https://policy.example?wrong=1"},
        ]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(Unavailable):
                Config.parse(value)

    def test_default_gate_is_closed_before_parsing_optional_configuration(self):
        with patch.dict(
            os.environ, {"POLICY_ENABLED": "0", "POLICY_CONFIG": "private_marker"}, clear=True
        ):
            with self.assertRaises(Unavailable):
                Config.environment(active=True)

    def test_cloud_run_cannot_replace_the_independent_witness_with_a_local_backup(self):
        with patch.dict(
            os.environ,
            {"K_SERVICE": "synthetic-policy", "POLICY_STORE_BACKEND": "sqlite"},
            clear=True,
        ):
            with self.assertRaises(Unavailable):
                configured_store(self.config)
