"""Verify guarded Terraform configuration ownership through actual localhost HTTP.

The pinned Terraform CLI and Google provider execute the current shared module,
including its Python configuration provisioner. Only the bounded Cloud Run wire
fixture is substituted; no cloud credentials or outbound connection are used.
The separate provider_check.py retains the five original native-provider bugs.
"""

import argparse
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fake_cloud_run import PROJECT, REGION, RESOURCE, SERVICE, TOKEN, FakeCloudRun
from provider_check import IMAGES, MODULE, ROOT, http, image, release, release_helper, rollback

CONTROLLER = "module.fixture.terraform_data.configuration"
NATIVE = "module.fixture.google_cloud_run_v2_service.service"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def environment_value(template, name="MODE"):
    return next(
        entry["value"] for entry in template["containers"][0]["env"] if entry["name"] == name
    )


def served_revision(service):
    traffic = service["trafficStatuses"]
    require(sum(target["percent"] for target in traffic) == 100, "Observed traffic must total 100%")
    active = [target for target in traffic if target["percent"]]
    require(len(active) == 1, "Fixture scenarios require one serving revision")
    return active[0]["revision"].rsplit("/", 1)[-1]


class OwnershipCase:
    """Run an unmodified production module and provisioner in an isolated root."""

    def __init__(self, directory, fixture, terraform, provider_dir):
        self.directory = directory
        self.fixture = fixture
        self.terraform = terraform
        self.environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("GOOGLE_", "GCLOUD_", "CLOUDSDK_", "TF_", "FOLIOVIEW_"))
            and key.upper()
            not in (
                "GCP_PROJECT",
                "GCP_REGION",
                "GCE_METADATA_HOST",
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "NO_PROXY",
            )
        }
        self.environment.update(
            CHECKPOINT_DISABLE="1",
            TF_IN_AUTOMATION="1",
            TF_CLI_CONFIG_FILE=str(directory / "terraform.rc"),
            GCE_METADATA_HOST="127.0.0.1:1",
            NO_PROXY="127.0.0.1,localhost",
            FOLIOVIEW_TEST_CLOUD_RUN_ENDPOINT=fixture.endpoint,
        )
        copied_module = directory / "infra/gcp/terraform/modules/cloud-run-service"
        shutil.copytree(MODULE, copied_module, ignore=shutil.ignore_patterns(".terraform", "tests"))
        for script in (ROOT / "infra/gcp").glob("*.py"):
            shutil.copyfile(script, directory / "infra/gcp" / script.name)
        shutil.copyfile(MODULE / ".terraform.lock.hcl", directory / ".terraform.lock.hcl")
        (directory / "terraform.rc").write_text(
            "provider_installation {\n  filesystem_mirror {\n    path = "
            + json.dumps(str(provider_dir))
            + "\n  }\n}\n"
        )
        (directory / "main.tf").write_text(
            f'''terraform {{
  required_version = "= 1.16.7"
  required_providers {{
    google = {{ source = "hashicorp/google", version = "= 7.28.0" }}
  }}
}}
provider "google" {{
  project = "{PROJECT}"
  region = "{REGION}"
  access_token = "{TOKEN}"
  cloud_run_v2_custom_endpoint = "{fixture.endpoint}"
  add_terraform_attribution_label = false
}}
module "fixture" {{
  source = "./infra/gcp/terraform/modules/cloud-run-service"
  project_id = "{PROJECT}"
  name = "{SERVICE}"
  image = "{IMAGES["A"]}"
  runtime_service_account = "runtime@{PROJECT}.iam.gserviceaccount.com"
  environment = {{ MODE = "one" }}
}}
'''
        )
        self.run("init", "-backend=false", "-lockfile=readonly")
        self.run("apply", "-auto-approve")
        require(self.plan("baseline")[0] == 0, "Initial owned service must have a clean plan")

    def run(self, *args, expected=(0,)):
        result = subprocess.run(
            [str(self.terraform), f"-chdir={self.directory}", *args, "-no-color"],
            capture_output=True,
            text=True,
            env=self.environment,
            timeout=120,
            check=False,
        )
        require(
            result.returncode in expected,
            f"Terraform {' '.join(args)} returned {result.returncode}:\n"
            f"{result.stdout[-8000:]}\n{result.stderr[-8000:]}",
        )
        return result

    def environment_change(self, value):
        path = self.directory / "main.tf"
        content = path.read_text()
        start = content.index('  environment = { MODE = "')
        end = content.index("\n", start)
        path.write_text(content[:start] + f'  environment = {{ MODE = "{value}" }}' + content[end:])

    def plan(self, name, *extra, expected=(0, 2)):
        result = self.run(
            "plan", "-detailed-exitcode", f"-out={name}.tfplan", *extra, expected=expected
        )
        if result.returncode == 1:
            return 1, result
        plan = json.loads(self.run("show", "-json", f"{name}.tfplan").stdout)
        native = next(
            change["change"] for change in plan["resource_changes"] if change["address"] == NATIVE
        )
        require(native["actions"] == ["no-op"], "Native provider must never update the service")
        if result.returncode == 2:
            changed = [
                change["address"]
                for change in plan["resource_changes"]
                if change["mode"] == "managed" and change["change"]["actions"] != ["no-op"]
            ]
            require(changed == [CONTROLLER], f"Only configuration controller may change: {changed}")
        return result.returncode, plan

    def apply(self, name):
        before = len(self.fixture.requests)
        result = self.run("apply", f"{name}.tfplan")
        patches = [
            request for request in self.fixture.requests[before:] if request["method"] == "PATCH"
        ]
        return result, copy.deepcopy(patches)


def guarded_patch(patches, before, expected_image, expected_mode):
    require(len(patches) == 1, "One desired configuration must cause exactly one guarded PATCH")
    patch = patches[0]
    body = patch["body"]
    require(body.get("etag") == before["etag"], "Configuration must use a fresh service etag")
    require(image(body) == expected_image, "Configuration must preserve the current live image")
    require(
        body["template"]["revision"] != before["template"].get("revision"),
        "New config needs a new revision",
    )
    require(
        "-cfg-" in body["template"]["revision"], "Configuration revision must use its own namespace"
    )
    require(environment_value(body["template"]) == expected_mode, "Managed environment must change")
    require(
        body.get("traffic", before["traffic"]) == before["traffic"],
        "Traffic policy must be preserved",
    )
    expected_annotations = dict(before.get("annotations", {}))
    expected_annotations["financial-analysis/configuration-revision"] = body["template"]["revision"]
    build = expected_annotations.get("financial-analysis/deployment-build")
    if build:
        expected_annotations["financial-analysis/configuration-base-build"] = build
    require(
        body["annotations"] == expected_annotations,
        "Configuration may only add its own markers and must preserve release ordering annotations",
    )


def scenarios(terraform, provider_dir):
    helper = release_helper()
    findings = []

    def case(callback):
        with (
            tempfile.TemporaryDirectory(prefix="folioview-ownership-check-") as scratch,
            FakeCloudRun() as fixture,
        ):
            controller = OwnershipCase(Path(scratch), fixture, terraform, provider_dir)
            return callback(controller, fixture)

    def post_release_noop(controller, fixture):
        revision_b = release(fixture, helper, "B")
        require(controller.plan("after-release-b")[0] == 0, "Release B must have no Terraform diff")
        _, patches = controller.apply("after-release-b")
        require(not patches, "No-op plan must not PATCH the service")
        require(served_revision(fixture.service) == revision_b, "No-op must preserve serving B")
        return {"scenario": "release-b-followed-by-no-op", "status": "passed"}

    findings.append(case(post_release_noop))

    def stale_before_release(controller, fixture):
        controller.environment_change("two")
        require(controller.plan("before-release-b")[0] == 2, "Environment change must be planned")
        release(fixture, helper, "B")
        before = copy.deepcopy(fixture.service)
        _, patches = controller.apply("before-release-b")
        guarded_patch(patches, before, IMAGES["B"], "two")
        require(image(fixture.service) == IMAGES["B"], "Old saved plan must preserve new image B")
        require(controller.plan("after-stale-apply")[0] == 0, "Applied config must settle to no-op")
        return {
            "scenario": "pre-release-saved-plan-preserves-new-image",
            "status": "passed",
            "wire_etag": True,
            "wire_image": "B",
            "next_plan": "no-op",
        }

    findings.append(case(stale_before_release))

    def pinned_rollback(controller, fixture, stale):
        revision_b = release(fixture, helper, "B")
        release(fixture, helper, "C")
        controller.environment_change("two")
        if stale:
            require(controller.plan("before-rollback")[0] == 2, "Save config plan before rollback")
        rollback(fixture, revision_b)
        before = copy.deepcopy(fixture.service)
        if not stale:
            require(
                controller.plan("after-rollback")[0] == 2, "Config change after rollback must plan"
            )
        _, patches = controller.apply("before-rollback" if stale else "after-rollback")
        guarded_patch(patches, before, IMAGES["C"], "two")
        require(
            served_revision(fixture.service) == revision_b, "Pinned rollback B must keep serving"
        )
        require(
            environment_value(fixture.revisions[revision_b]) == "one",
            "Immutable serving B must keep its original config until an explicit release",
        )
        require(
            controller.plan("after-rollback-config")[0] == 0, "Staged config must settle to no-op"
        )
        return {
            "scenario": (
                "pre-rollback-saved-plan-preserves-pinned-traffic"
                if stale
                else "configuration-after-rollback-preserves-pinned-traffic"
            ),
            "status": "passed",
            "desired_template_image": "C",
            "serving_revision_image": "B",
            "configuration_is_staged": True,
            "next_plan": "no-op",
        }

    findings.append(case(lambda controller, fixture: pinned_rollback(controller, fixture, False)))
    findings.append(case(lambda controller, fixture: pinned_rollback(controller, fixture, True)))

    def drift_repair(controller, fixture):
        release(fixture, helper, "B")
        external = copy.deepcopy(fixture.service["template"])
        external.pop("revision", None)
        external["containers"][0]["env"] = [{"name": "MODE", "value": "console-drift"}]
        http(
            fixture,
            "PATCH",
            {"name": RESOURCE, "etag": fixture.service["etag"], "template": external},
            "?updateMask=template",
        )
        requests = len(fixture.requests)
        code, failed = controller.plan("unexpected-drift", expected=(1,))
        require(code == 1, "Unexpected managed config drift must fail a normal plan")
        require(
            "drift" in (failed.stdout + failed.stderr).lower(),
            "Plan failure must explain configuration drift",
        )
        require(
            not any(request["method"] == "PATCH" for request in fixture.requests[requests:]),
            "Drift check must only observe",
        )
        require(
            controller.plan("repair-drift", f"-replace={CONTROLLER}")[0] == 2,
            "Reviewed explicit controller replacement must permit repair",
        )
        before = copy.deepcopy(fixture.service)
        _, patches = controller.apply("repair-drift")
        guarded_patch(patches, before, IMAGES["B"], "one")
        require(controller.plan("after-repair")[0] == 0, "Drift repair must settle to no-op")
        return {
            "scenario": "configuration-drift-blocks-until-explicit-repair",
            "status": "passed",
            "normal_plan": "failed-with-drift-diagnostic",
            "repair_preserves_image": "B",
            "next_plan": "no-op",
        }

    findings.append(case(drift_repair))
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--terraform", required=True, type=Path)
    parser.add_argument("--provider-dir", type=Path, help="Existing pinned provider mirror")
    parser.add_argument("--report", type=Path, help="Write only the sanitized regression result")
    args = parser.parse_args()
    terraform = args.terraform.resolve(strict=True)
    candidates = [
        args.provider_dir,
        MODULE / ".terraform/providers",
        ROOT / "infra/gcp/terraform/bootstrap/.terraform/providers",
    ]
    provider_dir = next((path.resolve() for path in candidates if path and path.is_dir()), None)
    require(provider_dir is not None, "Initialize the pinned provider or pass --provider-dir")
    findings = scenarios(terraform, provider_dir)
    report = {
        "verification_passed": True,
        "compatibility_status": "passed-localhost-wire",
        "terraform": "1.16.7",
        "provider": "hashicorp/google 7.28.0",
        "scenarios": findings,
        "limitation": (
            "Localhost serialization regressions do not replace live Cloud Run validation."
        ),
    }
    rendered = json.dumps(report, indent=2)
    if args.report:
        args.report.write_text(rendered + "\n")
    print(rendered)


if __name__ == "__main__":
    try:
        main()
    except (
        AssertionError,
        KeyError,
        OSError,
        subprocess.SubprocessError,
        TypeError,
        ValueError,
    ) as error:
        print(json.dumps({"verification_passed": False, "error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from error
