"""Reproduce release-ownership blockers with the real pinned Google provider.

Everything except the provider process is a localhost fixture. Success means the
expected blockers were reproduced; it does NOT authorize service adoption.
"""

import argparse
import copy
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

from fake_cloud_run import PROJECT, REGION, RESOURCE, SERVICE, TOKEN, FakeCloudRun

ROOT = Path(__file__).resolve().parents[4]
MODULE = ROOT / "infra/gcp/terraform/modules/cloud-run-service"
IMAGE_PREFIX = "example.invalid/fixture/api@sha256:"
IMAGES = {name: IMAGE_PREFIX + name.lower() * 64 for name in ("A", "B", "C")}
SCOPED_NAME = "module.fixture.google_cloud_run_v2_service.service"
LEGACY_MAIN = """
# Frozen native-provider baseline from PR #14. It must remain independent of
# the current ownership controller so every regression still reproduces its bug.
variable "project_id" { type = string }
variable "name" { type = string }
variable "image" { type = string }
variable "runtime_service_account" { type = string }
variable "environment" { type = map(string) }
resource "google_cloud_run_v2_service" "service" {
  project             = var.project_id
  location            = "northamerica-northeast2"
  name                = var.name
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = true

  template {
    service_account                  = var.runtime_service_account
    timeout                          = "60s"
    max_instance_request_concurrency = 40

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = false
      }

      dynamic "env" {
        for_each = var.environment
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    prevent_destroy = true
  }
}
"""


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def release_helper():
    spec = importlib.util.spec_from_file_location(
        "fixture_release_helper", ROOT / "infra/gcp/deploy_existing_service.py"
    )
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


def http(fixture, method, body=None, query=""):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(
        fixture.endpoint + RESOURCE + query,
        method=method,
        data=data,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with build_opener(ProxyHandler({})).open(request, timeout=10) as response:
        return json.load(response)


def release(fixture, helper, version):
    service = http(fixture, "GET")
    identifier = {
        "B": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "C": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    }[version]
    body = helper.deployment_body(
        service,
        IMAGES[version],
        identifier,
        "2026-10-23T12:00:00Z",
        version.lower() * 40,
    )
    http(fixture, "PATCH", body, "?updateMask=template,annotations,traffic")
    return body["template"]["revision"]


def rollback(fixture, revision):
    service = http(fixture, "GET")
    http(
        fixture,
        "PATCH",
        {
            "name": RESOURCE,
            "etag": service["etag"],
            "traffic": [
                {
                    "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                    "revision": revision,
                    "percent": 100,
                }
            ],
        },
        "?updateMask=traffic",
    )


class TerraformCase:
    def __init__(self, directory, fixture, terraform, provider_dir, variant):
        self.directory = directory
        self.fixture = fixture
        self.terraform = terraform
        self.environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("GOOGLE_", "GCLOUD_", "CLOUDSDK_", "TF_"))
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
        )
        (directory / "module").mkdir()
        shutil.copyfile(MODULE / "versions.tf", directory / "module/versions.tf")
        (directory / "module/main.tf").write_text(LEGACY_MAIN)
        shutil.copyfile(MODULE / ".terraform.lock.hcl", directory / ".terraform.lock.hcl")
        module_main = directory / "module/main.tf"
        if variant != "baseline":
            ignores = ["template[0].containers[0].image", "traffic"]
            if variant == "naive-ignore":
                ignores.append("template[0].revision")
            text = module_main.read_text()
            text = text.replace(
                "prevent_destroy = true",
                "prevent_destroy = true\n    ignore_changes = [" + ", ".join(ignores) + "]",
            )
            module_main.write_text(text)
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
  source = "./module"
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
        require(self.plan("initial")[0] == 0, "Initial fixture must have a clean plan")

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
            f"{result.stdout[-5000:]}\n{result.stderr[-5000:]}",
        )
        return result

    def environment_change(self):
        path = self.directory / "main.tf"
        path.write_text(path.read_text().replace('MODE = "one"', 'MODE = "two"'))

    def plan(self, name):
        result = self.run("plan", "-detailed-exitcode", f"-out={name}.tfplan", expected=(0, 2))
        shown = self.run("show", "-json", f"{name}.tfplan")
        plan = json.loads(shown.stdout)
        change = next(c["change"] for c in plan["resource_changes"] if c["address"] == SCOPED_NAME)
        return result.returncode, change

    def apply(self, name, expected=(0,)):
        result = self.run("apply", f"{name}.tfplan", expected=expected)
        patches = [r for r in self.fixture.requests if r["method"] == "PATCH"]
        require(patches, "Provider must emit an actual PATCH request")
        return result, copy.deepcopy(patches[-1]["body"])


def image(body):
    template = body["template"]
    if isinstance(template, list):
        template = template[0]
    return template["containers"][0]["image"]


def scenarios(terraform, provider_dir):
    helper = release_helper()
    findings = []

    def case(variant, callback):
        with (
            tempfile.TemporaryDirectory(prefix="folioview-provider-check-") as scratch,
            FakeCloudRun() as fixture,
        ):
            terraform_case = TerraformCase(Path(scratch), fixture, terraform, provider_dir, variant)
            return callback(terraform_case, fixture)

    def baseline(case, fixture):
        release(fixture, helper, "B")
        code, change = case.plan("release-b")
        require(
            code == 2 and image(change["after"]) == IMAGES["A"],
            "Baseline must propose image A after release B",
        )
        _, wire = case.apply("release-b")
        require(image(wire) == IMAGES["A"], "Baseline provider PATCH must replay A")
        return {
            "scenario": "baseline-replays-reviewed-image",
            "status": "blocked",
            "wire_image": "A",
            "released_image": "B",
        }

    findings.append(case("baseline", baseline))

    def immutable(case, fixture):
        revision_b = release(fixture, helper, "B")
        require(case.plan("release-b")[0] == 0, "Naive ignore must mask release drift")
        case.environment_change()
        case.plan("environment")
        result, wire = case.apply("environment", expected=(1,))
        require(
            "Named revision already exists" in result.stderr,
            "Expected named-revision immutability failure",
        )
        require(
            wire["template"]["revision"] == revision_b and image(wire) == IMAGES["B"],
            "Provider must resend named B revision",
        )
        return {
            "scenario": "naive-ignore-reuses-immutable-revision",
            "status": "blocked",
            "post_release_plan": "no-op",
            "environment_apply": "409-named-revision",
            "wire_image": "B",
        }

    findings.append(case("naive-ignore", immutable))

    def stale_image(case, fixture):
        release(fixture, helper, "B")
        case.environment_change()
        case.plan("before-c")
        release(fixture, helper, "C")
        _, wire = case.apply("before-c")
        require(
            image(wire) == IMAGES["B"] and "etag" not in wire,
            "Saved plan must replay stale B without etag",
        )
        require(
            image(fixture.service) == IMAGES["B"],
            "Stale saved plan must overwrite desired C in fixture",
        )
        return {
            "scenario": "saved-plan-replays-pre-release-image",
            "status": "blocked",
            "current_image_before_apply": "C",
            "wire_image": "B",
            "wire_etag": False,
        }

    findings.append(case("image-traffic-ignore", stale_image))

    def rollback_semantics(case, fixture):
        revision_b = release(fixture, helper, "B")
        release(fixture, helper, "C")
        rollback(fixture, revision_b)
        require(
            image(fixture.service) == IMAGES["C"],
            "Traffic rollback must leave desired template C",
        )
        require(
            fixture.service["trafficStatuses"][0]["revision"] == revision_b,
            "Rollback must serve revision B",
        )
        case.environment_change()
        case.plan("after-rollback")
        _, wire = case.apply("after-rollback")
        require(
            image(wire) == IMAGES["C"] and wire["traffic"][0]["revision"] == revision_b,
            "Fresh apply must preserve desired C and serving B distinction",
        )
        require(
            fixture.revisions[revision_b]["containers"][0]["env"][0]["value"] == "one",
            "Serving immutable B must retain old environment",
        )
        return {
            "scenario": "rollback-serving-template-divergence",
            "status": "blocked",
            "desired_template_image": "C",
            "serving_revision_image": "B",
            "configuration_change_reaches_serving_revision": False,
        }

    findings.append(case("image-traffic-ignore", rollback_semantics))

    def stale_traffic(case, fixture):
        revision_b = release(fixture, helper, "B")
        release(fixture, helper, "C")
        case.environment_change()
        case.plan("before-rollback")
        rollback(fixture, revision_b)
        _, wire = case.apply("before-rollback")
        require(
            wire["traffic"][0]["type"] == "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
            "Saved plan must replay pre-rollback LATEST traffic",
        )
        require("etag" not in wire, "Provider full PATCH has no current-etag guard")
        require(
            fixture.service["trafficStatuses"][0]["revision"] != revision_b,
            "Stale apply must undo traffic rollback",
        )
        return {
            "scenario": "saved-plan-replays-pre-rollback-traffic",
            "status": "blocked",
            "rollback_revision_preserved": False,
            "wire_traffic": "LATEST",
            "wire_etag": False,
        }

    findings.append(case("image-traffic-ignore", stale_traffic))
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--terraform", required=True, type=Path)
    parser.add_argument(
        "--provider-dir",
        type=Path,
        help="Existing filesystem mirror containing pinned Google 7.28.0; no network installation",
    )
    parser.add_argument(
        "--report", type=Path, help="Write the sanitized JSON result to this local path"
    )
    args = parser.parse_args()
    terraform = args.terraform.resolve(strict=True)
    candidates = [
        args.provider_dir,
        MODULE / ".terraform/providers",
        ROOT / "infra/gcp/terraform/bootstrap/.terraform/providers",
    ]
    provider_dir = next((p.resolve() for p in candidates if p and p.is_dir()), None)
    require(
        provider_dir is not None,
        "Initialize the pinned module provider first, or pass --provider-dir",
    )
    findings = scenarios(terraform, provider_dir)
    report = {
        "verification_passed": True,
        "compatible": False,
        "compatibility_status": "blocked",
        "provider": "hashicorp/google 7.28.0",
        "scenarios": findings,
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
        print(
            json.dumps({"verification_passed": False, "error": str(error)}),
            file=sys.stderr,
        )
        raise SystemExit(1) from error
