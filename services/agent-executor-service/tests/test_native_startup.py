"""Measured native configuration pins and production TLS wiring, without cloud startup."""

import json
import os
import ssl
from pathlib import Path
from unittest.mock import Mock, patch

from native_fixtures import NativeFixture

from app.config import Config
from app.contracts import Stopped, digest
from app.provider_tls import ProviderProtocol
from app.tls import materialize
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import sign_jws
from folioview_shared.encrypted.executor_trust import EXECUTOR_TRUST_PROFILE


class NativeStartupTests(NativeFixture):
    def configure(self, extra_environment=None):
        env = {
            "EXECUTOR_NATIVE_ENABLED": "1",
            "EXECUTOR_NATIVE_CONFIG_SHA256": digest(self.native_value),
        }
        env.update(extra_environment or {})
        self.value["workload"]["environment"] = env
        self.value["binding"]["workloadDigest"] = digest(self.value["workload"])
        self.value["approval"] = sign_jws(
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_approval",
                "binding": self.value["binding"],
                "operationId": "synthetic_native_measured_config_01",
                "issuedAt": self.now - 1,
                "expiresAt": self.now + 86400,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )
        self.config = Config.parse(self.value, now=self.now)
        self.authority.config = self.config
        self.runtime = self.new_runtime()
        config = self.directory / "public.json"
        native = self.directory / "native.json"
        config.write_text(json.dumps(self.value))
        native.write_text(json.dumps(self.native_value))
        return {
            **env,
            "EXECUTOR_ENABLED": "1",
            "EXECUTOR_CONFIG": str(config),
            "EXECUTOR_NATIVE_CONFIG": str(native),
        }

    def test_native_startup_uses_measured_config_and_actual_provider_tls_protocol(self):
        from app.main import main

        env = self.configure()
        seen = []

        def ram(config, key, *, now):
            return materialize(
                config, key, now=now, directory=str(self.directory), require_tmpfs=False
            )

        class Server:
            def __init__(self, settings):
                self.settings = settings

            def run(server):
                settings = server.settings
                seen.append(settings)
                self.assertIs(settings.http, ProviderProtocol)
                self.assertEqual(settings.ssl.verify_mode, ssl.CERT_REQUIRED)
                self.assertFalse(Path(settings.ssl_keyfile).exists())
                self.assertFalse(settings.proxy_headers)

        hub = Mock()
        with (
            patch.dict(os.environ, env, clear=True),
            patch("app.main.PolicyClient", return_value=self.runtime.policy),
            patch("app.main.Attestation", return_value=self.attestor),
            patch.object(self.attestor, "close", create=True),
            patch("app.main.GCSSnapshots", return_value=self.snapshots),
            patch("app.main.HubClient", return_value=hub),
            patch("app.main.materialize", side_effect=ram),
            patch("app.main.uvicorn.Server", Server),
        ):
            main()
        self.assertEqual(len(seen), 1)
        hub.close.assert_called_once()

    def test_changed_native_anchor_or_unmeasured_hash_stops_before_policy_or_key_release(self):
        from app.main import main

        env = self.configure()
        for changes in [
            {"EXECUTOR_NATIVE_CONFIG_SHA256": "f" * 64},
            {"EXECUTOR_NATIVE_ENABLED": "true"},
        ]:
            with (
                patch.dict(os.environ, env | changes, clear=True),
                patch("app.main.PolicyClient") as policy,
            ):
                with self.assertRaises(Stopped):
                    main()
                policy.assert_not_called()
        native = {**self.native_value, "hubAudience": "https://other.example"}
        Path(env["EXECUTOR_NATIVE_CONFIG"]).write_text(json.dumps(native))
        env["EXECUTOR_NATIVE_CONFIG_SHA256"] = digest(native)
        with patch.dict(os.environ, env, clear=True), patch("app.main.PolicyClient") as policy:
            with self.assertRaises(Stopped):
                main()
            policy.assert_not_called()

    def test_remote_core_and_native_configuration_use_root_pins_without_self_hash_cycle(self):
        from app.main import main

        roots = {
            "EXECUTOR_ROOT_KEY_ID": self.config.binding["rootKeyId"],
            "EXECUTOR_CONFIG_OBJECT": "gs://synthetic-state/executor-config/runtime.json",
            "EXECUTOR_NATIVE_CONFIG_OBJECT": "gs://synthetic-state/executor-config/native.json",
        }
        env = self.configure(roots)
        del env["EXECUTOR_CONFIG"]
        del env["EXECUTOR_NATIVE_CONFIG"]
        values = {
            "executor-config/runtime.json": self.value,
            "executor-config/native.json": self.native_value,
        }
        client = Mock()

        def blob(name):
            raw = json.dumps(values[name]).encode()
            value = Mock(size=len(raw), generation=12345)
            value.download_as_bytes.return_value = raw
            return value

        client.bucket.return_value.blob.side_effect = blob
        hub = Mock()
        with (
            patch.dict(os.environ, env, clear=True),
            patch("google.cloud.storage.Client", return_value=client),
            patch("app.main.PolicyClient", return_value=self.runtime.policy),
            patch("app.main.Attestation", return_value=self.attestor),
            patch.object(self.attestor, "close", create=True),
            patch("app.main.GCSSnapshots", return_value=self.snapshots),
            patch("app.main.HubClient", return_value=hub),
            patch(
                "app.main.materialize", side_effect=RuntimeError("synthetic stop before serving")
            ) as tls,
        ):
            with self.assertRaises(RuntimeError):
                main()
            tls.assert_called_once()
        self.assertTrue(self.authority.confirmed)
        self.assertEqual(client.bucket.return_value.blob.call_count, 2)
        hub.close.assert_called_once()

    def test_remote_wrong_root_or_unapproved_object_stops_before_policy(self):
        from app.main import main

        roots = {
            "EXECUTOR_ROOT_KEY_ID": self.config.binding["rootKeyId"],
            "EXECUTOR_CONFIG_OBJECT": "gs://synthetic-state/executor-config/runtime.json",
        }
        env = self.configure(roots)
        del env["EXECUTOR_CONFIG"]
        raw = json.dumps(self.value).encode()
        client = Mock()
        blob = client.bucket.return_value.blob.return_value
        blob.size, blob.generation = len(raw), 12345
        blob.download_as_bytes.return_value = raw
        for changes in [
            {"EXECUTOR_ROOT_KEY_ID": self.crypto.kid("device_sig")},
            {"EXECUTOR_CONFIG_OBJECT": "gs://synthetic-state/executor-config/unapproved.json"},
        ]:
            with (
                patch.dict(os.environ, env | changes, clear=True),
                patch("google.cloud.storage.Client", return_value=client),
                patch("app.main.PolicyClient") as policy,
            ):
                with self.assertRaises(Stopped):
                    main()
                policy.assert_not_called()
