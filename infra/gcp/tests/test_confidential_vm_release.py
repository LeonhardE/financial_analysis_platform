"""No-credential VM release preparation, exact prior-state pins and typed health evidence."""

import base64
import copy
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from test_first_provision import (
    BUILD_ID,
    COMMIT,
    PROJECT,
    REGION,
    SOURCE_URL,
    captured_build,
    captured_trigger,
    synthetic_registry,
)

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "infra/gcp"))
import confidential_vm_release as vm  # noqa: E402
import deploy_existing_service as deploy  # noqa: E402
import first_provision as first  # noqa: E402


def key_ids():
    return {
        name: base64.urlsafe_b64encode(bytes([n]) * 32).decode().rstrip("=")
        for n, name in enumerate(["agent_signing", "agent_encryption", "tls"], 1)
    }


class VMReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="repo003-vm-release-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        synthetic_registry(self.root)
        path = self.root / "scripts/service-targets.json"
        doc = json.loads(path.read_text())
        doc["targets"][-1]["runtime"] = "confidential_vm"
        path.write_text(json.dumps(doc))
        (self.root / "services/synthetic-service/app/health_check.py").write_text(
            "# Offline-only probe\n"
        )
        self.registry = vm.load_registry(self.root)
        self.build = captured_build()
        self.trigger = captured_trigger()
        self.policy = {
            "schema_version": 1,
            "runtime": "confidential_vm",
            "target": "synthetic-service",
            "project_id": PROJECT,
            "region": REGION,
            "approved_image": f"{REGION}-docker.pkg.dev/{PROJECT}/financial-analysis/"
            "synthetic-api@sha256:" + "b" * 64,
            "workload_identity": f"synthetic-runtime@{PROJECT}.iam.gserviceaccount.com",
            "policy_checkpoint": {"version": 3, "digest": "c" * 64},
        }
        self.trusted = dict(
            registry=self.registry,
            target_id="synthetic-service",
            project=PROJECT,
            region=REGION,
            artifact_repository="financial-analysis",
            repository_url=SOURCE_URL,
            commit=COMMIT,
            build_id=BUILD_ID,
            policy=self.policy,
            action="first_provision",
        )

    def prepare(self, **changes):
        return vm.prepare_request(self.build, self.trigger, **(self.trusted | changes))

    def evidence(self, request):
        return {
            "profile": request["health_profile"],
            "request_digest": vm.digest(request),
            "target": "synthetic-service",
            "image": self.policy["approved_image"],
            "workload_identity": self.policy["workload_identity"],
            "instance_id": "123456789",
            "original_key_ids": key_ids(),
            "state_head": "d" * 64,
            "checks": {name: True for name in vm._CHECKS},
            "observed_at": 1000,
        }

    def record(self, request, evidence=None, **changes):
        return vm.record_release(
            request,
            evidence or self.evidence(request),
            **(
                dict(
                    expected_request=request,
                    expected_key_ids=key_ids(),
                    expected_state_head="d" * 64,
                    now=1001,
                )
                | changes
            ),
        )

    def baseline(self):
        return self.record(self.prepare())

    def test_first_build_review_and_observation_are_distinct_non_authorizing_records(self):
        request = self.prepare()
        self.assertEqual(request["build"]["kind"], "build_evidence")
        self.assertEqual(request["approval"], {"status": "not_requested"})
        self.assertIsNone(request["previous_release_digest"])
        self.assertEqual(request["execution"], "separate_reviewed_target_infrastructure_saved_plan")
        self.assertEqual(
            vm.validate_request(request, self.build, self.trigger, **self.trusted), request
        )
        record = self.record(request)
        self.assertEqual(record["capture_status"], "metadata_only_not_authorization")
        self.assertEqual(record["original_key_ids"], key_ids())
        self.assertNotIn("secretEnv", json.dumps(request))
        self.assertNotEqual(record["kind"], request["kind"])

    def test_restore_and_upgrade_pin_prior_record_head_keys_and_current_policy(self):
        prior = self.baseline()
        restore = self.prepare(action="restore", baseline=prior)
        self.assertEqual(restore["previous_release_digest"], vm.digest(prior))
        self.assertEqual(restore["expected_state"]["original_key_ids"], key_ids())
        self.assertEqual(self.record(restore)["state_head"], prior["state_head"])
        self.build["results"]["images"][0]["digest"] = "sha256:" + "e" * 64
        self.policy["approved_image"] = self.policy["approved_image"][:-64] + "e" * 64
        upgrade = self.prepare(action="upgrade", baseline=prior)
        self.assertEqual(self.record(upgrade)["original_key_ids"], prior["original_key_ids"])
        with self.assertRaises(ValueError):
            self.prepare(action="restore", baseline=prior)
        self.policy["policy_checkpoint"]["version"] = 2
        with self.assertRaises(ValueError):
            self.prepare(action="upgrade", baseline=prior)

    def test_wrong_source_modes_digest_config_target_or_policy_are_rejected(self):
        original = (
            copy.deepcopy(self.build),
            copy.deepcopy(self.trigger),
            copy.deepcopy(self.policy),
        )
        for group, field, value in [
            ("build", "status", "WORKING"),
            ("build", "projectId", "wrong-project"),
            ("trigger", "filename", "infra/gcp/cloudbuild.user.yaml"),
            ("policy", "runtime", "cloud_run"),
            ("policy", "target", "user-service"),
            ("policy", "approved_image", self.policy["approved_image"][:-64] + "f" * 64),
            ("policy", "workload_identity", "operator@other-project.iam.gserviceaccount.com"),
        ]:
            self.build, self.trigger, self.policy = map(copy.deepcopy, original)
            self.trusted["policy"] = self.policy
            {"build": self.build, "trigger": self.trigger, "policy": self.policy}[group][field] = (
                value
            )
            with self.subTest(group=group, field=field), self.assertRaises(ValueError):
                self.prepare()
        self.build, self.trigger, self.policy = map(copy.deepcopy, original)
        self.trusted["policy"] = self.policy
        self.build["sourceProvenance"]["resolvedGitSource"]["url"] = (
            "https://evil.example.invalid/other.git"
        )
        with self.assertRaises(ValueError):
            self.prepare()
        self.build, self.trigger, self.policy = map(copy.deepcopy, original)
        self.trusted["policy"] = self.policy
        self.trigger["substitutions"]["_DEPLOY_SERVICE"] = "true"
        with self.assertRaises(ValueError):
            self.prepare()

    def test_wrong_action_baseline_rebinding_rollback_or_injected_approval_fail(self):
        prior = self.baseline()
        for action, baseline in [
            ("apply", None),
            ("upgrade", None),
            ("restore", None),
            ("upgrade", prior),
            ("first_provision", prior),
        ]:
            with self.subTest(action=action), self.assertRaises(ValueError):
                self.prepare(action=action, baseline=baseline)
        for change in [
            {"target": "wrong-service"},
            {"workload_identity": "operator@test-project.iam.gserviceaccount.com"},
            {"original_key_ids": {**key_ids(), "tls": key_ids()["agent_signing"]}},
            {"policy_checkpoint": {"version": 4, "digest": "e" * 64}},
        ]:
            with self.assertRaises(ValueError):
                self.prepare(action="restore", baseline=prior | change)
        request = self.prepare()
        for change in [
            {"approval": {"status": "approved"}},
            {"runtime": "cloud_run"},
            {"action": "restore"},
            {"extra": "field"},
            {"policy_digest": "0" * 64},
        ]:
            with self.assertRaises(ValueError):
                vm.validate_request(request | change, self.build, self.trigger, **self.trusted)

    def test_live_health_cannot_be_replaced_by_docker_or_own_key_and_state_claims(self):
        request = self.prepare()
        evidence = self.evidence(request)
        for change in [
            {"profile": "confidential_vm_offline_probe.v1"},
            {"image": self.policy["approved_image"][:-64] + "f" * 64},
            {"state_head": "e" * 64},
            {"request_digest": "0" * 64},
            {
                "original_key_ids": {
                    **key_ids(),
                    "tls": base64.urlsafe_b64encode(b"x" * 32).decode().rstrip("="),
                }
            },
            {"observed_at": 600},
            {"observed_at": 1002},
            {"observed_at": True},
            {"instance_id": "instance;execute"},
        ]:
            with self.subTest(field=next(iter(change))), self.assertRaises(ValueError):
                self.record(request, evidence | change)
        for check in vm._CHECKS:
            for bad in [False, 1, None]:
                with self.assertRaises(ValueError):
                    self.record(request, evidence | {"checks": evidence["checks"] | {check: bad}})
        prior = self.baseline()
        restore = self.prepare(action="restore", baseline=prior)
        with self.assertRaises(ValueError):
            self.record(restore, expected_state_head="e" * 64)
        with self.assertRaises(ValueError):
            self.record(
                restore,
                expected_key_ids={
                    **key_ids(),
                    "tls": base64.urlsafe_b64encode(b"x" * 32).decode().rstrip("="),
                },
            )

    def test_vm_rejected_by_cloud_run_publication_and_first_provision_before_auth(self):
        argv = [
            "deploy",
            "--project=test-project",
            f"--region={REGION}",
            f"--build-region={REGION}",
            "--service=synthetic-api",
            f"--image={self.policy['approved_image']}",
            f"--build-id={BUILD_ID}",
            f"--commit={COMMIT}",
            "--branch=main",
        ]
        for flag in ["true", "false"]:
            with (
                patch("sys.argv", argv + ["--deploy-enabled=" + flag]),
                patch.object(deploy, "load_registry", return_value=self.registry),
                patch.object(deploy, "gcloud") as auth,
                patch.object(deploy, "RunAPI") as api,
            ):
                with self.assertRaisesRegex(RuntimeError, "VM targets"):
                    deploy.main()
                auth.assert_not_called()
                api.assert_not_called()
        trusted = {k: v for k, v in self.trusted.items() if k not in {"action", "policy"}}
        with self.assertRaisesRegex(ValueError, "Cloud Run target"):
            first.prepare_request(self.build, self.trigger, **trusted)
        with self.assertRaises(ValueError):
            self.prepare(target_id="user-service")

    def test_cli_exclusive_outputs_revalidation_record_and_no_publish_command(self):
        files = {"build-json": self.build, "trigger-json": self.trigger, "policy-json": self.policy}
        for name, value in files.items():
            (self.root / name).write_text(json.dumps(value))
        args = [
            "vm-review",
            "prepare",
            "--action=first_provision",
            "--target=synthetic-service",
            f"--project={PROJECT}",
            f"--region={REGION}",
            "--artifact-repository=financial-analysis",
            f"--repository-url={SOURCE_URL}",
            f"--commit={COMMIT}",
            f"--build-id={BUILD_ID}",
        ]
        args += [f"--{name}={self.root / name}" for name in files]
        output = self.root / "request.json"
        with (
            patch.object(vm, "ROOT", self.root),
            patch("sys.argv", args + ["--output=" + str(output)]),
        ):
            self.assertEqual(vm.main(), 0)
        with (
            patch.object(vm, "ROOT", self.root),
            patch("sys.argv", args + ["--output=" + str(output)]),
            redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(vm.main(), 1)
        validate = [arg if arg != "prepare" else "validate" for arg in args] + [
            "--request-json=" + str(output)
        ]
        with patch.object(vm, "ROOT", self.root), patch("sys.argv", validate):
            self.assertEqual(vm.main(), 0)
        request = json.loads(output.read_text())
        health = self.root / "health.json"
        health.write_text(json.dumps(self.evidence(request)))
        pins = self.root / "pins.json"
        pins.write_text(json.dumps({"original_key_ids": key_ids(), "state_head": "d" * 64}))
        receipt = self.root / "record.json"
        record_args = [arg if arg != "validate" else "record" for arg in validate] + [
            "--health-json=" + str(health),
            "--pins-json=" + str(pins),
            "--output=" + str(receipt),
        ]
        with (
            patch.object(vm, "ROOT", self.root),
            patch("sys.argv", record_args),
            patch.object(vm.time, "time", return_value=1001),
        ):
            self.assertEqual(vm.main(), 0)
        self.assertEqual(
            json.loads(receipt.read_text())["capture_status"], "metadata_only_not_authorization"
        )
        invalid = [arg if arg != "prepare" else "deploy" for arg in args]
        with (
            patch("sys.argv", invalid),
            redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit),
        ):
            vm.main()


if __name__ == "__main__":
    unittest.main()
