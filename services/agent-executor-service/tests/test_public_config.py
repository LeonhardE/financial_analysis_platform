"""Real public JSON and exact cloud-object conditions; no host mount or cloud access."""

import json
import os
from unittest.mock import Mock, patch

from fixtures import Fixture

from app.contracts import Stopped
from app.public_config import ROOT_PIN, measured_sources, pin_root, read_public
from folioview_shared.encrypted.errors import ContractError

URI = "gs://synthetic-executor-state/executor-config/connection/runtime.json"


class PublicConfigTests(Fixture):
    def cloud(self, raw=None):
        raw = raw if raw is not None else json.dumps(self.value).encode()
        client = Mock()
        blob = client.bucket.return_value.blob.return_value
        blob.size, blob.generation = len(raw), 31234
        blob.download_as_bytes.return_value = raw
        return client, blob

    def environment(self):
        return {"EXECUTOR_CONFIG_OBJECT": URI, ROOT_PIN: self.config.binding["rootKeyId"]}

    def test_generation_crc_size_and_public_root_pin_are_independent(self):
        client, blob = self.cloud()
        with patch.dict(os.environ, self.environment(), clear=True):
            value = read_public("EXECUTOR_CONFIG", client=client)
            pin_root(value["rootJwk"], required=True)
        self.assertEqual(value, self.value)
        client.bucket.assert_called_once_with("synthetic-executor-state")
        client.bucket.return_value.blob.assert_called_once_with(
            "executor-config/connection/runtime.json"
        )
        blob.reload.assert_called_once_with(timeout=4, retry=None)
        blob.download_as_bytes.assert_called_once_with(
            if_generation_match=31234, timeout=4, retry=None, checksum="crc32c"
        )
        client.list_blobs.assert_not_called()

    def test_bad_remote_selectors_and_ambiguous_sources_fail_before_cloud_access(self):
        for uri in [
            "https://attacker.example/public.json",
            "gs://synthetic-executor-state/executor-state/keys.json",
            "gs://synthetic-executor-state/executor-config/../runtime.json",
            "gs://synthetic-executor-state/executor-config//runtime.json",
            URI + "?generation=1",
            URI + "#old",
            URI.replace("gs://", "gs://user@"),
        ]:
            client, _ = self.cloud()
            with patch.dict(
                os.environ, self.environment() | {"EXECUTOR_CONFIG_OBJECT": uri}, clear=True
            ):
                with self.subTest(uri=uri), self.assertRaises(Stopped):
                    read_public("EXECUTOR_CONFIG", client=client)
            client.bucket.assert_not_called()
        for changes in [
            {"EXECUTOR_CONFIG": "/tmp/never-fallback.json"},
            {ROOT_PIN: "wrong"},
            {"STORAGE_EMULATOR_HOST": "http://attacker.example"},
        ]:
            client, _ = self.cloud()
            with patch.dict(os.environ, self.environment() | changes, clear=True):
                with self.assertRaises(Stopped):
                    read_public("EXECUTOR_CONFIG", client=client)
            client.bucket.assert_not_called()

    def test_oversized_generation_crc_and_malformed_json_cannot_select_fallback(self):
        for size in [0, 65537, True, None]:
            client, blob = self.cloud()
            blob.size = size
            with patch.dict(os.environ, self.environment(), clear=True):
                with self.assertRaises(Stopped):
                    read_public("EXECUTOR_CONFIG", client=client)
            blob.download_as_bytes.assert_not_called()
        for raw in [b'{"same":1,"same":2}', b"[]", b'{"bad":']:
            client, _ = self.cloud(raw)
            with patch.dict(os.environ, self.environment(), clear=True):
                with self.assertRaises(Stopped):
                    read_public("EXECUTOR_CONFIG", client=client)
        client, blob = self.cloud()
        blob.download_as_bytes.side_effect = RuntimeError("synthetic generation/CRC rejection")
        with patch.dict(os.environ, self.environment(), clear=True):
            with self.assertRaises(Stopped):
                read_public("EXECUTOR_CONFIG", client=client)
        self.assertEqual(blob.download_as_bytes.call_count, 1)

    def test_root_substitution_and_unmeasured_source_fail_closed(self):
        from fixtures import public

        env = self.environment()
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(Stopped):
                pin_root(public(self.keys["device"]), required=True)
            for environment in [{}, {**env, "EXECUTOR_CONFIG_OBJECT": URI + "changed"}]:
                with self.assertRaises(Stopped):
                    measured_sources({"environment": environment}, ["EXECUTOR_CONFIG"])
            measured_sources({"environment": env}, ["EXECUTOR_CONFIG"])
            with self.assertRaises(ContractError):
                pin_root(self.keys["root"].export(private_key=True, as_dict=True), required=True)

    def test_bounded_local_public_input_has_no_implicit_remote_or_missing_source(self):
        path = self.directory / "public.json"
        path.write_text(json.dumps(self.value))
        with patch.dict(os.environ, {"EXECUTOR_CONFIG": str(path)}, clear=True):
            self.assertEqual(read_public("EXECUTOR_CONFIG"), self.value)
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(Stopped):
                read_public("EXECUTOR_CONFIG")
