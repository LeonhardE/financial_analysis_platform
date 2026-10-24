"""Safety boundaries for the opt-in live compatibility verifier; no cloud calls."""

import argparse
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError

SPEC = importlib.util.spec_from_file_location(
    "release_compatibility_live", Path(__file__).parents[1] / "verify_release_compatibility.py"
)
LIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LIVE)

PROJECT = "financial-analysis-512202"
REGION = "northamerica-northeast2"
NAME = "fv-compat-012345abcdef"
RESOURCE = f"projects/{PROJECT}/locations/{REGION}/services/{NAME}"
ACCOUNT = f"projects/{PROJECT}/serviceAccounts/{NAME}@{PROJECT}.iam.gserviceaccount.com"
PREFIX = f"{REGION}-docker.pkg.dev/{PROJECT}/financial-analysis/market-api"
IMAGES = [f"{PREFIX}@sha256:{value * 64}" for value in "abc"]


def arguments(**overrides):
    args = {
        "live": True,
        "project": PROJECT,
        "region": REGION,
        "repository": "financial-analysis",
        "image_package": "market-api",
        "terraform": "/verified/terraform",
        "image_a": None,
        "image_b": None,
        "image_c": None,
    }
    return argparse.Namespace(**(args | overrides))


class InputTests(unittest.TestCase):
    def test_pasted_path_whitespace_and_home_expansion_resolve_to_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "terraform"
            binary.write_text("fixture executable")
            binary.chmod(0o700)
            self.assertEqual(LIVE.terraform_binary(str(binary) + "\n\n"), str(binary.resolve()))
            with patch.dict(os.environ, {"HOME": temporary}):
                self.assertEqual(LIVE.terraform_binary(" ~/terraform\r\n"), str(binary.resolve()))

    def test_invalid_executable_stops_before_any_cloud_access(self):
        with tempfile.TemporaryDirectory() as temporary:
            nonexecutable = Path(temporary) / "terraform"
            nonexecutable.touch()
            for supplied in (
                "",
                "\n\n",
                str(nonexecutable),
                temporary,
                "/missing/terraform",
                "a\nb",
            ):
                api = Mock()
                with self.subTest(path=supplied), self.assertRaises(argparse.ArgumentTypeError):
                    LIVE.verify(arguments(terraform=supplied), api)
                api.request.assert_not_called()
                api.iam.assert_not_called()
                api.credentials.assert_not_called()

    def test_wrong_version_uses_normalized_path_and_stops_before_image_discovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "terraform"
            binary.touch()
            binary.chmod(0o700)
            api = Mock()
            with (
                patch.object(
                    LIVE.subprocess, "check_output", return_value='{"terraform_version":"0.0.0"}'
                ) as execute,
                self.assertRaisesRegex(RuntimeError, "pinned Terraform"),
            ):
                LIVE.verify(arguments(terraform=str(binary) + "\n\n"), api)
            self.assertEqual(execute.call_args.args[0], [str(binary.resolve()), "version", "-json"])
            api.request.assert_not_called()
            api.iam.assert_not_called()

    def test_preflight_error_is_concise_without_a_traceback(self):
        import io

        with (
            patch(
                "sys.argv", ["verify", "--live", "--project", PROJECT, "--terraform", "/missing/tf"]
            ),
            patch("sys.stderr", new_callable=io.StringIO) as error,
            patch.object(LIVE, "Cloud") as cloud,
            self.assertRaises(SystemExit),
        ):
            LIVE.main()
        self.assertIn("Terraform executable was not found", error.getvalue())
        self.assertNotIn("Traceback", error.getvalue())
        cloud.assert_not_called()

    def test_requires_explicit_live_opt_in_and_fixed_project_region(self):
        for overrides in ({"live": False}, {"project": "other-project"}, {"region": "us-central1"}):
            with self.subTest(overrides=overrides), self.assertRaises(RuntimeError):
                LIVE.validate_inputs(arguments(**overrides))

    def test_all_or_none_explicit_images(self):
        with self.assertRaisesRegex(RuntimeError, "all three"):
            LIVE.validate_inputs(arguments(image_a=IMAGES[0]))
        LIVE.validate_inputs(arguments(image_a=IMAGES[0], image_b=IMAGES[1], image_c=IMAGES[2]))

    def test_rejects_mutable_foreign_or_repeated_images(self):
        for bad in (
            f"{PREFIX}:latest",
            IMAGES[0].replace(PROJECT, "other-project"),
            IMAGES[0].replace(REGION, "us-central1"),
            IMAGES[0].replace("/market-api@", "/user-api@"),
            IMAGES[1],
        ):
            with self.subTest(bad=bad), self.assertRaises(RuntimeError):
                LIVE.validate_images(arguments(), [bad, IMAGES[1], IMAGES[2]])

    def test_discovery_reads_all_pages_and_selects_distinct_package_digests(self):
        api = Mock()
        api.request.side_effect = [
            {
                "dockerImages": [{"uri": IMAGES[0], "uploadTime": "2026-01-01T00:00:00Z"}],
                "nextPageToken": "next+token",
            },
            {
                "dockerImages": [
                    {"uri": IMAGES[2], "uploadTime": "2026-03-01T00:00:00Z"},
                    {"uri": IMAGES[1], "uploadTime": "2026-02-01T00:00:00Z"},
                    {
                        "uri": IMAGES[2].replace("market-api", "user-api"),
                        "uploadTime": "2026-04-01T00:00:00Z",
                    },
                ]
            },
        ]
        self.assertEqual(LIVE.discover_images(api, arguments()), list(reversed(IMAGES)))
        self.assertEqual(len(api.request.call_args_list), 2)
        self.assertTrue(all(call.args[0] == "GET" for call in api.request.call_args_list))
        self.assertIn("pageToken=next%2Btoken", api.request.call_args_list[1].args[1])

    def test_insufficient_discovery_fails_before_creation(self):
        api = Mock()
        api.request.return_value = {"dockerImages": [{"uri": IMAGES[0]}]}
        with self.assertRaisesRegex(RuntimeError, "three distinct"):
            LIVE.discover_images(api, arguments())
        api.iam.assert_not_called()

    def test_existing_resource_is_never_adopted(self):
        call = Mock(return_value={"uid": "existing"})
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            LIVE.absent(call, RESOURCE)
        self.assertEqual(call.call_args.args, ("GET", RESOURCE))


class PlanTests(unittest.TestCase):
    def test_only_disposable_service_updates_are_allowed(self):
        plan = {
            "resource_changes": [
                {
                    "address": LIVE.ADDRESS,
                    "mode": "managed",
                    "change": {
                        "actions": ["update"],
                        "before": {"traffic": [{"percent": 100, "revision": "old"}]},
                        "after": {"traffic": [{"percent": 100, "type": "LATEST"}]},
                    },
                }
            ]
        }
        self.assertEqual(LIVE.summarize_plan(plan)[0]["changed_fields"], ["traffic"])
        for address, actions in (
            ("google_storage_bucket.production", ["create"]),
            (LIVE.ADDRESS, ["delete", "create"]),
        ):
            with self.subTest(address=address, actions=actions), self.assertRaises(RuntimeError):
                LIVE.summarize_plan(
                    {"resource_changes": [{"address": address, "change": {"actions": actions}}]}
                )

    def test_native_noop_is_not_a_blocker(self):
        self.assertEqual(
            LIVE.summarize_plan(
                {"resource_changes": [{"address": LIVE.ADDRESS, "change": {"actions": ["no-op"]}}]}
            ),
            [],
        )

    def test_fixture_is_private_mock_mode_without_public_invokers(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            LIVE.fixture(directory, arguments(), NAME, IMAGES[0])
            config = json.loads((directory / "main.tf.json").read_text())
            module = config["module"]["service"]
            self.assertEqual(module["source"], "./cloud-run-service")
            self.assertEqual(module["environment"]["MARKET_DATA_SOURCE"], "mock")
            self.assertEqual(module["environment"]["MARKET_CACHE_BACKEND"], "sqlite")
            self.assertNotIn("allow_unauthenticated", module)
            self.assertNotIn("invoker_service_accounts", module)
            self.assertEqual(config["terraform"]["required_version"], "= 1.16.7")

    def test_terraform_ignores_inherited_cli_overrides_and_writes_private_diagnostics(self):
        api = Mock()
        api.credentials.return_value = "secret-access-token"
        with tempfile.TemporaryDirectory() as temporary:
            tf = LIVE.Terraform("/verified/terraform", Path(temporary), api)
            with (
                patch.dict(
                    os.environ,
                    {
                        "TF_CLI_ARGS_apply": "-destroy",
                        "TF_DATA_DIR": "/foreign",
                        "TF_CLI_CONFIG_FILE": "/dev-override",
                        "GOOGLE_CLOUD_RUN_V2_CUSTOM_ENDPOINT": "https://foreign.invalid/",
                        "GOOGLE_CREDENTIALS": "foreign-credentials",
                    },
                ),
                patch.object(LIVE.subprocess, "run", return_value=Mock(returncode=0)) as run,
            ):
                tf.run("plan", "-input=false")
            env = run.call_args.kwargs["env"]
            self.assertNotIn("TF_CLI_ARGS_apply", env)
            self.assertNotIn("TF_DATA_DIR", env)
            self.assertNotIn("GOOGLE_CLOUD_RUN_V2_CUSTOM_ENDPOINT", env)
            self.assertNotIn("GOOGLE_CREDENTIALS", env)
            self.assertEqual(env["TF_CLI_CONFIG_FILE"], os.devnull)
            self.assertEqual(env["GOOGLE_OAUTH_ACCESS_TOKEN"], "secret-access-token")
            self.assertNotIn("secret-access-token", str(run.call_args.args))
            self.assertTrue((Path(temporary) / "terraform-01.log").exists())


class ReadinessTests(unittest.TestCase):
    def test_failed_reconciliation_is_not_settled_success(self):
        api = Mock()
        api.request.return_value = {
            "reconciling": False,
            "terminalCondition": {"state": "CONDITION_FAILED"},
            "latestReadyRevision": "previous",
        }
        with self.assertRaisesRegex(RuntimeError, "failed reconciliation"):
            LIVE.wait_service(api, RESOURCE)

    def test_waits_for_observed_generation_and_rollback_traffic(self):
        api = Mock()
        good = {
            "generation": "3",
            "observedGeneration": "3",
            "terminalCondition": {"state": "CONDITION_SUCCEEDED"},
            "trafficStatuses": [{"revision": "revision-b", "percent": 100}],
        }
        api.request.side_effect = [good | {"observedGeneration": "2"}, good]
        with patch.object(LIVE.time, "sleep") as sleep:
            self.assertEqual(LIVE.wait_service(api, RESOURCE, traffic_revision="revision-b"), good)
        sleep.assert_called_once_with(3)


class CleanupTests(unittest.TestCase):
    def test_cleanup_refuses_any_production_name_before_network_calls(self):
        api = Mock()
        for resource, account in (
            (RESOURCE.replace(NAME, "market-api"), ACCOUNT),
            (RESOURCE, ACCOUNT.replace(NAME, "fa-api-runtime")),
        ):
            with self.subTest(resource=resource, account=account):
                self.assertTrue(LIVE.cleanup(api, resource, "uid", account, "12345"))
        api.request.assert_not_called()
        api.iam.assert_not_called()

    def test_uid_mismatch_never_deletes_recreated_service(self):
        api = Mock()
        api.request.return_value = {"uid": "recreated", "etag": "new"}
        errors = LIVE.cleanup(api, RESOURCE, "original", ACCOUNT, None)
        self.assertIn("UID changed", errors[0])
        self.assertTrue(all(call.args[0] == "GET" for call in api.request.call_args_list))

    def test_account_unique_id_mismatch_never_deletes_recreated_account(self):
        api = Mock()
        api.iam.return_value = {"uniqueId": "67890"}
        errors = LIVE.cleanup(api, RESOURCE, None, ACCOUNT, "12345")
        self.assertIn("uniqueId changed", errors[0])
        api.iam.assert_called_once_with("GET", ACCOUNT)

    def test_cleanup_deletes_only_recorded_uid_and_immutable_account_id(self):
        api = Mock()
        api.request.side_effect = [
            {"uid": "owned", "etag": "version+1"},
            {},
            HTTPError(RESOURCE, 404, "deleted", {}, None),
        ]
        api.iam.side_effect = [{"uniqueId": "12345"}, {}]
        self.assertEqual(LIVE.cleanup(api, RESOURCE, "owned", ACCOUNT, "12345"), [])
        self.assertEqual(
            api.request.call_args_list[1].args, ("DELETE", f"{RESOURCE}?etag=version%2B1")
        )
        self.assertEqual(
            api.iam.call_args_list[1].args, ("DELETE", f"projects/{PROJECT}/serviceAccounts/12345")
        )

    def test_forbidden_cleanup_remains_an_explicit_failure(self):
        api = Mock()
        api.request.side_effect = HTTPError(RESOURCE, 403, "forbidden", {}, None)
        self.assertIn("HTTP 403", LIVE.cleanup(api, RESOURCE, "owned", ACCOUNT, None)[0])


if __name__ == "__main__":
    unittest.main()
