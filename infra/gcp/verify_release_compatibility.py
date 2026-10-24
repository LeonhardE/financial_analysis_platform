"""Exercise the current Terraform module and release helper on one disposable service.

This is an explicit live verification tool, not a deployment path. It never imports
an existing service, grants IAM roles, builds images, or invokes application URLs.
Private plans, provider diagnostics and recovery state stay in a mode-0700 folder.
"""

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
ADDRESS = "module.service.google_cloud_run_v2_service.service"
SPEC = importlib.util.spec_from_file_location(
    "compatibility_release", ROOT / "deploy_existing_service.py"
)
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def terraform_binary(value):
    supplied = str(value).strip()
    if not supplied or any(ord(character) < 32 for character in supplied):
        raise argparse.ArgumentTypeError(
            "Terraform path is empty or contains embedded control characters."
        )
    try:
        binary = Path(supplied).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise argparse.ArgumentTypeError(
            "Terraform executable was not found. Install the pinned CLI with "
            "infra/gcp/terraform_tools.py install --directory ~/folioview-terraform-tools."
        ) from error
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise argparse.ArgumentTypeError("Terraform path must identify an executable file.")
    return str(binary)


def progress(message):
    print(message, flush=True)


def validate_inputs(args):
    require(args.live, "Pass --live to create and delete the isolated verification resources.")
    require(
        args.project == "financial-analysis-512202" and args.region == "northamerica-northeast2",
        "This verification is restricted to financial-analysis-512202 in Toronto.",
    )
    for value in (args.repository, args.image_package):
        require(
            re.fullmatch(r"[a-z][a-z0-9-]{0,62}", value), "Invalid repository or image package."
        )
    images = [args.image_a, args.image_b, args.image_c]
    require(
        all(images) or not any(images), "Provide all three image digests, or none for discovery."
    )
    if all(images):
        validate_images(args, images)


def validate_images(args, images):
    prefix = f"{args.region}-docker.pkg.dev/{args.project}/{args.repository}/{args.image_package}"
    require(
        len(images) == 3
        and len(set(images)) == 3
        and all(
            re.fullmatch(re.escape(prefix) + r"@sha256:[a-f0-9]{64}", image) for image in images
        ),
        "Use three distinct immutable digests from the selected same-project regional package.",
    )
    return images


class Cloud:
    def __init__(self):
        self.token_time = 0
        self.token = ""

    def credentials(self):
        if time.monotonic() - self.token_time > 900 or not self.token:
            self.token = subprocess.check_output(
                ["gcloud", "auth", "print-access-token"],
                text=True,
                timeout=60,
                stderr=subprocess.DEVNULL,
            ).strip()
            require(bool(self.token), "Cloud Shell did not return an access token.")
            self.token_time = time.monotonic()
        return self.token

    def request(self, method, resource, body=None, *, host="run.googleapis.com", version="v2"):
        request = Request(
            f"https://{host}/{version}/{resource}",
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={
                "Authorization": f"Bearer {self.credentials()}",
                "Content-Type": "application/json",
            },
        )
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def iam(self, method, resource, body=None):
        return self.request(method, resource, body, host="iam.googleapis.com", version="v1")


def discover_images(api, args):
    parent = f"projects/{args.project}/locations/{args.region}/repositories/{args.repository}"
    images = []
    token = ""
    for _ in range(20):
        query = urlencode({"pageSize": 1000, "pageToken": token})
        page = api.request(
            "GET",
            f"{parent}/dockerImages?{query}",
            host="artifactregistry.googleapis.com",
            version="v1",
        )
        images.extend(page.get("dockerImages", []))
        token = page.get("nextPageToken", "")
        if not token:
            break
    require(not token, "Repository has over 20,000 images; provide explicit digests instead.")
    prefix = f"{args.region}-docker.pkg.dev/{args.project}/{args.repository}/{args.image_package}@"
    ordered = sorted(images, key=lambda item: item.get("uploadTime", ""), reverse=True)
    selected = list(
        dict.fromkeys(item["uri"] for item in ordered if item.get("uri", "").startswith(prefix))
    )[:3]
    return validate_images(args, selected)


def absent(call, resource):
    try:
        call("GET", resource)
    except HTTPError as error:
        if error.code == 404:
            return
        raise
    raise RuntimeError("The disposable resource already exists; refusing to touch it.")


def wait_service(api, resource, *, traffic_revision=None, timeout=600):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        service = api.request("GET", resource)
        condition = service.get("terminalCondition", {}).get("state")
        require(
            condition != "CONDITION_FAILED",
            "The isolated service reports failed reconciliation; inspect private diagnostics.",
        )
        if (
            not service.get("reconciling")
            and service.get("generation")
            and service.get("observedGeneration") == service["generation"]
            and condition == "CONDITION_SUCCEEDED"
        ):
            if traffic_revision is None:
                return service
            traffic = service.get("trafficStatuses", [])
            if (
                service.get("observedGeneration") == service.get("generation")
                and sum(target.get("percent", 0) for target in traffic) == 100
                and all(
                    target.get("percent", 0) == 0
                    or RELEASE.same_revision(target.get("revision"), traffic_revision)
                    for target in traffic
                )
            ):
                return service
        time.sleep(3)
    raise TimeoutError("The disposable service did not settle within ten minutes.")


def service_snapshot(service):
    template = service.get("template", {})
    return {
        "uid": service.get("uid"),
        "image": template.get("containers", [{}])[0].get("image"),
        "revision": template.get("revision"),
        "latest_ready_revision": service.get("latestReadyRevision"),
        "traffic": service.get("traffic", []),
        "observed_traffic": service.get("trafficStatuses", []),
        "deployment_build": service.get("annotations", {}).get(RELEASE.BUILD_ANNOTATION),
        "terminal_state": service.get("terminalCondition", {}).get("state"),
    }


def summarize_plan(plan):
    summaries = []
    for item in plan.get("resource_changes", []):
        if item.get("mode") == "data" or item["change"]["actions"] == ["no-op"]:
            continue
        require(item.get("address") == ADDRESS, "Unexpected resource in isolated Terraform plan.")
        change = item["change"]
        require(
            "delete" not in change["actions"], "Refusing a plan that deletes/replaces a resource."
        )
        before, after = change.get("before") or {}, change.get("after") or {}
        fields = [
            key
            for key in ("template", "traffic", "annotations")
            if before.get(key) != after.get(key)
        ]
        summaries.append(
            {"address": ADDRESS, "actions": change["actions"], "changed_fields": fields}
        )
    return summaries


class Terraform:
    def __init__(self, binary, directory, api):
        self.binary, self.directory, self.api = binary, directory, api
        self.counter = 0

    def run(self, *args, allow_failure=False):
        self.counter += 1
        log = self.directory / f"terraform-{self.counter:02d}.log"
        env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("TF_", "GOOGLE_", "GCLOUD_", "CLOUDSDK_", "GCP_"))
        }
        env.update(
            GOOGLE_OAUTH_ACCESS_TOKEN=self.api.credentials(),
            TF_IN_AUTOMATION="1",
            TF_INPUT="0",
            TF_CLI_CONFIG_FILE=os.devnull,
            CHECKPOINT_DISABLE="1",
        )
        progress(f"Terraform {args[0]}... Private diagnostic: {log}")
        with log.open("w") as output:
            result = subprocess.run(
                [self.binary, f"-chdir={self.directory}", *args],
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
                timeout=900,
                check=False,
            )
        if result.returncode and not allow_failure:
            raise RuntimeError(f"Terraform failed; private diagnostic: {log}")
        return result.returncode, log

    def plan(self, name):
        self.run("plan", "-input=false", "-lock-timeout=60s", f"-out={name}.tfplan")
        _, output = self.run("show", "-json", f"{name}.tfplan")
        return summarize_plan(json.loads(output.read_text()))


def fixture(directory, args, name, image, *, changed=False):
    config = {
        "terraform": {
            "required_version": "= 1.16.7",
            "required_providers": {"google": {"source": "hashicorp/google", "version": "= 7.28.0"}},
        },
        "provider": {"google": {"project": args.project, "region": args.region}},
        "module": {
            "service": {
                "source": "./cloud-run-service",
                "project_id": args.project,
                "region": args.region,
                "name": name,
                "image": image,
                "runtime_service_account": f"{name}@{args.project}.iam.gserviceaccount.com",
                "environment": {
                    "FV_COMPAT_STAGE": "config-change" if changed else "baseline",
                    "MARKET_DATA_SOURCE": "mock",
                    "MARKET_CACHE_BACKEND": "sqlite",
                },
            }
        },
    }
    (directory / "main.tf.json").write_text(json.dumps(config, indent=2) + "\n")


def cleanup(api, resource, uid, account, unique_id):
    errors = []
    prefix = "projects/financial-analysis-512202/locations/northamerica-northeast2/services/"
    name = resource.removeprefix(prefix)
    expected_account = (
        f"projects/financial-analysis-512202/serviceAccounts/"
        f"{name}@financial-analysis-512202.iam.gserviceaccount.com"
    )
    if (
        not resource.startswith(prefix)
        or not re.fullmatch(r"fv-compat-[0-9a-f]{12}", name)
        or account != expected_account
        or (unique_id is not None and not re.fullmatch(r"[0-9]+", unique_id))
    ):
        return ["Cleanup rejected an unexpected resource name or account identity."]
    if uid:
        try:
            service = api.request("GET", resource)
            require(service.get("uid") == uid, "Service UID changed; automatic cleanup refused.")
            require(service.get("etag"), "Service has no etag; automatic cleanup refused.")
            api.request("DELETE", f"{resource}?{urlencode({'etag': service['etag']})}")
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                try:
                    api.request("GET", resource)
                except HTTPError as error:
                    if error.code == 404:
                        break
                    raise
                time.sleep(3)
            else:
                raise TimeoutError("Service deletion has not completed.")
        except HTTPError as error:
            if error.code != 404:
                errors.append(f"Service cleanup returned HTTP {error.code}: {resource}")
        except Exception as error:
            errors.append(f"Service cleanup: {error}")
    if unique_id:
        try:
            current = api.iam("GET", account)
            require(
                current.get("uniqueId") == unique_id, "Account uniqueId changed; cleanup refused."
            )
            api.iam("DELETE", f"{account.rsplit('/', 1)[0]}/{unique_id}")
        except HTTPError as error:
            if error.code != 404:
                errors.append(f"Account cleanup returned HTTP {error.code}: {account}")
        except Exception as error:
            errors.append(f"Account cleanup: {error}")
    return errors


def verify(args, api):
    args.terraform = terraform_binary(args.terraform)
    progress("Checking the pinned Terraform CLI before cloud access...")
    version = json.loads(
        subprocess.check_output([args.terraform, "version", "-json"], text=True, timeout=60)
    )
    require(
        version.get("terraform_version") == "1.16.7", "Use the repository-pinned Terraform 1.16.7."
    )
    progress("Reading existing image digests...")
    images = (
        validate_images(args, [args.image_a, args.image_b, args.image_c])
        if args.image_a
        else discover_images(api, args)
    )
    name = f"fv-compat-{uuid.uuid4().hex[:12]}"
    directory = Path(tempfile.mkdtemp(prefix=f"{name}-"))
    directory.chmod(0o700)
    resource = f"projects/{args.project}/locations/{args.region}/services/{name}"
    account = (
        f"projects/{args.project}/serviceAccounts/{name}@{args.project}.iam.gserviceaccount.com"
    )
    report = {
        "service": resource,
        "account": account,
        "images": images,
        "evidence": {},
        "status": "ERROR",
    }
    uid, unique_id, creating, account_attempted = None, None, False, False
    tf = Terraform(args.terraform, directory, api)
    progress(f"Isolated service: {resource}. Private evidence directory: {directory}")
    try:
        absent(api.request, resource)
        absent(api.iam, account)
        progress("Creating the isolated runtime identity...")
        account_attempted = True
        created = api.iam(
            "POST",
            f"projects/{args.project}/serviceAccounts",
            {
                "accountId": name,
                "serviceAccount": {"displayName": "Disposable release compatibility verification"},
            },
        )
        unique_id = created.get("uniqueId")
        require(
            unique_id, "Created account response had no uniqueId; inspect its exact name manually."
        )
        shutil.copytree(
            ROOT / "terraform/modules/cloud-run-service",
            directory / "cloud-run-service",
            ignore=shutil.ignore_patterns(".terraform", "tests", "*.tfstate*", "*.tfplan", "*.log"),
        )
        shutil.copyfile(
            ROOT / "terraform/bootstrap/.terraform.lock.hcl", directory / ".terraform.lock.hcl"
        )
        fixture(directory, args, name, images[0])
        tf.run("init", "-input=false", "-lockfile=readonly")
        creating = True
        tf.run("apply", "-input=false", "-auto-approve", "-lock-timeout=60s")
        service = wait_service(api, resource)
        uid = service.get("uid")
        require(uid, "Created service response had no UID; manual cleanup is required.")
        report["evidence"]["baseline"] = {
            "service": service_snapshot(service),
            "plan": tf.plan("baseline"),
        }
        fixture(directory, args, name, images[0], changed=True)
        report["evidence"]["saved_before_release"] = tf.plan("before-release")
        for label, image in (("release_b", images[1]), ("release_c", images[2])):
            progress(f"Running {label}...")
            build_id = str(uuid.uuid4())
            RELEASE.deploy(
                api,
                resource,
                image,
                build_id,
                datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "0" * 40,
            )
            service = wait_service(api, resource)
            report["evidence"][label] = service_snapshot(service)
            if label == "release_b":
                revision_b = service["template"]["revision"]
                report["evidence"]["plan_after_release"] = tf.plan("after-release")
                code, log = tf.run(
                    "apply", "-input=false", "before-release.tfplan", allow_failure=True
                )
                report["evidence"]["stale_saved_plan"] = {
                    "exit_code": code,
                    "private_log": str(log),
                }
                service = wait_service(api, resource)
                report["evidence"]["stale_saved_plan"]["service"] = service_snapshot(service)
        service = api.request("GET", resource)
        progress("Rolling test traffic back to revision B...")
        api.request(
            "PATCH",
            f"{resource}?updateMask=traffic",
            {
                "name": resource,
                "etag": service["etag"],
                "traffic": [
                    {
                        "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                        "revision": revision_b,
                        "percent": 100,
                    }
                ],
            },
        )
        report["evidence"]["rollback_to_b"] = service_snapshot(
            wait_service(api, resource, traffic_revision=revision_b)
        )
        report["evidence"]["plan_after_rollback"] = tf.plan("after-rollback")
        report["status"] = (
            "BLOCKED"
            if report["evidence"]["plan_after_release"] or report["evidence"]["plan_after_rollback"]
            else "UNEXPECTED_RESULT"
        )
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
        progress("Cleaning up the isolated service and runtime identity...")
        report["cleanup_errors"] = cleanup(api, resource, uid, account, unique_id)
        if creating and not uid:
            report["cleanup_errors"].append(
                "No recorded service UID. Inspect this exact resource manually: " + resource
            )
        if account_attempted and not unique_id:
            report["cleanup_errors"].append(
                "No recorded account uniqueId. Inspect this exact account manually: " + account
            )
        if report["cleanup_errors"]:
            report["status"] = "ERROR"
        (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(f"Verification {report['status']}. Private evidence: {directory / 'report.json'}")
        for error in report["cleanup_errors"]:
            print(error)
    return 2 if report["status"] == "BLOCKED" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", default="northamerica-northeast2")
    parser.add_argument(
        "--terraform",
        type=terraform_binary,
        default=str(Path.home() / "folioview-terraform-tools/terraform"),
        help="Pinned executable path (defaults to ~/folioview-terraform-tools/terraform).",
    )
    parser.add_argument("--repository", default="financial-analysis")
    parser.add_argument("--image-package", default="market-api")
    for label in ("a", "b", "c"):
        parser.add_argument(f"--image-{label}")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        validate_inputs(args)
        result = verify(args, Cloud())
    except (argparse.ArgumentTypeError, OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"Verification preflight failed: {error}\n")
    raise SystemExit(result)


if __name__ == "__main__":
    main()
