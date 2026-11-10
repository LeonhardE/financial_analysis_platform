"""Explicit same-image creation and restore-only startup; no cloud or native activation."""

import contextlib
import io
import json
import os
from unittest.mock import Mock, patch

import test_creation as creation
from fixtures import Fixture
from test_creation import Objects, Wrapper

from app.contracts import Stopped, digest
from app.public_config import ROOT_PIN
from folioview_shared.encrypted.crypto import sign_jws


class LaunchModeTests(Fixture):
    def test_explicit_creation_dispatch_never_opens_runtime_or_native_service(self):
        from app.main import main

        with (
            patch.dict(
                os.environ,
                {"EXECUTOR_CREATION_ENABLED": "1", "EXECUTOR_ENABLED": "0"},
                clear=True,
            ),
            patch("app.initialize.main") as create,
            patch("app.main.PolicyClient") as policy,
        ):
            main()
            create.assert_called_once()
            policy.assert_not_called()
        for changes in [{"EXECUTOR_ENABLED": "1"}, {"EXECUTOR_NATIVE_ENABLED": "1"}]:
            with (
                patch.dict(
                    os.environ,
                    {"EXECUTOR_CREATION_ENABLED": "1", "EXECUTOR_ENABLED": "0"} | changes,
                    clear=True,
                ),
                patch("app.initialize.main") as create,
            ):
                with self.assertRaises(Stopped):
                    main()
                create.assert_not_called()

    def test_missing_recovery_state_never_falls_back_to_creation(self):
        from app.main import main

        path = self.directory / "public.json"
        path.write_text(json.dumps(self.value))
        self.authority.head = "f" * 64
        with (
            patch.dict(
                os.environ,
                {"EXECUTOR_ENABLED": "1", "EXECUTOR_CONFIG": str(path)},
                clear=True,
            ),
            patch("app.main.PolicyClient", return_value=self.runtime.policy),
            patch("app.main.Attestation", return_value=self.attestor),
            patch.object(self.attestor, "close", create=True),
            patch("app.main.GCSSnapshots", return_value=self.snapshots),
            patch("app.initialize.main") as create,
        ):
            with self.assertRaises(Stopped):
                main()
            create.assert_not_called()


class RemoteCreationTests(Fixture):
    draft = creation.CreationTests.draft
    permit = creation.CreationTests.permit

    def test_remote_public_inputs_finalize_same_image_with_fresh_root_control(self):
        from app.initialize import main

        draft = self.draft()
        env = {
            "EXECUTOR_ENABLED": "0",
            "EXECUTOR_CREATION_ENABLED": "1",
            ROOT_PIN: self.config.binding["rootKeyId"],
            **{
                name + "_OBJECT": "gs://synthetic-state/executor-config/" + suffix + ".json"
                for name, suffix in [
                    ("EXECUTOR_DRAFT", "draft"),
                    ("EXECUTOR_PERMIT", "permit"),
                    ("EXECUTOR_ROOT_JWK", "root"),
                ]
            },
        }
        draft["creationWorkload"].update(args=["python", "-m", "app.main"], environment=env)
        values = {
            "executor-config/draft.json": draft,
            "executor-config/permit.json": self.permit(draft),
            "executor-config/root.json": self.value["rootJwk"],
        }
        client = Mock()

        def blob(name):
            body = json.dumps(values[name]).encode()
            result = Mock(size=len(body), generation=123)
            result.download_as_bytes.return_value = body
            return result

        client.bucket.return_value.blob.side_effect = blob
        objects, wrapper = Objects(), Wrapper()

        def finalize(name):
            offer = next(v for k, v in objects.values.items() if k.endswith("-pending"))
            self.assertEqual(name, offer["enrollmentId"] + "-finalization")
            return sign_jws(
                {
                    "profile": "folioview.agent-executor.v1",
                    "action": "finalize",
                    "offerDigest": digest(offer),
                    "bindingFingerprint": self.config.binding["bindingFingerprint"],
                    "workload": draft["workload"],
                    "operationId": "synthetic_remote_creation_finalize_01",
                    "issuedAt": self.now,
                    "expiresAt": self.now + 300,
                },
                self.keys["root"],
                typ="fv-control+jws",
            )

        objects.read = finalize
        stdout = io.StringIO()
        with (
            patch.dict(os.environ, env, clear=True),
            patch("google.cloud.storage.Client", return_value=client),
            patch("app.initialize.EnrollmentObjects", return_value=objects),
            patch("app.initialize.GCSSnapshots", return_value=self.snapshots),
            patch("app.initialize.KeyWrapper", return_value=wrapper),
            patch("app.initialize.CreationAttestation", return_value=self.attestor),
            patch.object(self.attestor, "close", create=True),
            contextlib.redirect_stdout(stdout),
        ):
            main()
        rows = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(
            [row["status"] for row in rows], ["awaiting_owner_finalization", "finalized"]
        )
        self.assertTrue(all(row["enrolled"] is False for row in rows))
        self.assertNotIn('"d":', stdout.getvalue())
        self.assertEqual(len(wrapper.calls), 1)
        self.assertEqual(len(self.attestor.statements), 2)
