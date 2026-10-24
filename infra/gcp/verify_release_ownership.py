"""Prove Terraform configuration ownership against real isolated release and rollback.

The opt-in verifier creates one private, scale-to-zero Cloud Run service and one
keyless runtime identity without role grants. It never adopts production services,
invokes application URLs, builds images, or exports raw plans, state or credentials.
"""

import argparse
import hashlib
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

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "ownership_compatibility", ROOT / "verify_release_compatibility.py"
)
LEGACY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LEGACY)
RELEASE = LEGACY.RELEASE
require = LEGACY.require
progress = LEGACY.progress
terraform_binary = LEGACY.terraform_binary
ADDRESS = LEGACY.ADDRESS
CONTROLLER = "module.service.terraform_data.configuration"
PRODUCTION = ("market-api", "user-api", "config-api", "market-web")
REQUIRED_CHECKS = (
    "isolated_private_cost_contract",
    "baseline_ready",
    "baseline_noop",
    "saved_plan_scoped",
    "release_b_ready",
    "fresh_plan_scoped",
    "saved_apply_preserved_b_and_environment",
    "saved_apply_preserved_release_markers",
    "configuration_b_noop",
    "release_c_ready",
    "rollback_b_observed",
    "rollback_plan_scoped",
    "rollback_apply_preserved_c_and_environment",
    "rollback_apply_preserved_b_traffic",
    "rollback_apply_preserved_release_markers",
    "rollback_configuration_noop",
    "next_release_preserved_environment",
    "next_release_latest_traffic",
    "final_noop",
    "service_deleted",
    "account_deleted",
    "production_unchanged",
)

SOURCE_FILES = (
    "configure_cloud_run_service.py",
    "deploy_existing_service.py",
    "terraform/modules/cloud-run-service/main.tf",
    "verify_release_ownership.py",
)


def source_provenance():
    files = {
        f"infra/gcp/{name}": hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        for name in SOURCE_FILES
    }
    head = None
    try:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            text=True,
            capture_output=True,
            check=False,
            timeout=15,
        )
        candidate = result.stdout.strip()
        if result.returncode == 0 and re.fullmatch(r"[a-f0-9]{40}", candidate):
            head = candidate
    except (OSError, subprocess.SubprocessError):
        pass
    return {"git_head": head, "files_sha256": files}


class Cloud(LEGACY.Cloud):
    def __init__(self):
        super().__init__()
        self.heartbeat = time.monotonic()

    def request(self, method, resource, body=None, **kwargs):
        if time.monotonic() - self.heartbeat >= 30:
            progress("Cloud verification is still waiting for observed reconciliation...")
            self.heartbeat = time.monotonic()
        return super().request(method, resource, body, **kwargs)


def markers(service):
    annotations = service.get("annotations", {})
    return {
        key: annotations.get(key)
        for key in (RELEASE.BUILD_ANNOTATION, RELEASE.TIME_ANNOTATION, RELEASE.COMMIT_ANNOTATION)
    }


def same_revision(left, right):
    return (
        isinstance(left, str)
        and isinstance(right, str)
        and left.rsplit("/", 1)[-1] == right.rsplit("/", 1)[-1]
    )


def traffic_at(service, revision, *, desired=False):
    traffic = service.get("traffic" if desired else "trafficStatuses", [])
    positive = [target for target in traffic if target.get("percent", 0)]
    return (
        sum(target.get("percent", 0) for target in traffic) == 100
        and len(positive) == 1
        and same_revision(positive[0].get("revision"), revision)
    )


def latest_traffic(service):
    traffic = service.get("traffic", [])
    return sum(target.get("percent", 0) for target in traffic) == 100 and all(
        not target.get("percent", 0)
        or target.get("type") == "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
        for target in traffic
    )


def environment(stage):
    return {
        "FV_COMPAT_STAGE": stage,
        "MARKET_DATA_SOURCE": "mock",
        "MARKET_CACHE_BACKEND": "sqlite",
    }


def ready_with_configuration(service, image, expected_environment):
    template = service.get("template", {})
    containers = template.get("containers", [])
    if len(containers) != 1:
        return False
    observed_environment = {
        entry.get("name"): entry.get("value")
        for entry in containers[0].get("env", [])
        if "valueSource" not in entry
    }
    return (
        service.get("terminalCondition", {}).get("state") == "CONDITION_SUCCEEDED"
        and not service.get("reconciling")
        and bool(service.get("generation"))
        and service.get("observedGeneration") == service["generation"]
        and containers[0].get("image") == image
        and observed_environment == expected_environment
    )


def snapshot(service):
    """Explicit public allowlist: no environment, full annotations or UID."""
    return {
        "image": service.get("template", {}).get("containers", [{}])[0].get("image"),
        "revision": service.get("template", {}).get("revision"),
        "latest_ready_revision": service.get("latestReadyRevision"),
        "traffic": [
            {key: target[key] for key in ("type", "revision", "percent") if key in target}
            for target in service.get("traffic", [])
        ],
        "observed_traffic": [
            {key: target[key] for key in ("type", "revision", "percent") if key in target}
            for target in service.get("trafficStatuses", [])
        ],
        "deployment_build": service.get("annotations", {}).get(RELEASE.BUILD_ANNOTATION),
        "terminal_state": service.get("terminalCondition", {}).get("state"),
    }


def summarize_plan(plan):
    """Permit a configuration controller replacement, never native service changes."""
    changes = []
    for resource in plan.get("resource_changes", []):
        if resource.get("mode") == "data":
            continue
        address = resource.get("address")
        require(address in (ADDRESS, CONTROLLER), "Unexpected managed resource in test plan.")
        change = resource.get("change", {})
        actions = change.get("actions")
        if actions == ["no-op"]:
            continue
        require(address == CONTROLLER, "Native service mutation would overwrite release ownership.")
        require(
            actions in (["update"], ["delete", "create"], ["create", "delete"]),
            "Unexpected configuration-controller action.",
        )
        before = (change.get("before") or {}).get("input") or {}
        after = (change.get("after") or {}).get("input") or {}
        require(
            isinstance(before, dict) and isinstance(after, dict),
            "Configuration controller must expose a structured input.",
        )
        forbidden = {"image", "revision", "traffic", "annotations"}
        require(
            not (forbidden & (set(before) | set(after))),
            "Configuration controller must not capture release-owned fields.",
        )
        require(
            before.get("environment") != after.get("environment"),
            "Expected the isolated environment configuration change.",
        )
        changes.append(
            {
                "address": address,
                "actions": actions,
                "environment_changed": True,
                "release_fields_captured": False,
            }
        )
    return changes


class Terraform(LEGACY.Terraform):
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
        started = heartbeat = time.monotonic()
        with log.open("w") as output:
            process = subprocess.Popen(
                [self.binary, f"-chdir={self.directory}", *args],
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
            )
            try:
                while process.poll() is None:
                    now = time.monotonic()
                    if now - started > 900:
                        raise TimeoutError(f"Terraform exceeded fifteen minutes: {log}")
                    if now - heartbeat >= 30:
                        progress(f"Terraform {args[0]} is still running; private diagnostic: {log}")
                        heartbeat = now
                    time.sleep(1)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)
        if process.returncode and not allow_failure:
            raise RuntimeError(f"Terraform failed; private diagnostic: {log}")
        return process.returncode, log

    def plan(self, name):
        self.run("plan", "-input=false", "-lock-timeout=60s", f"-out={name}.tfplan")
        _, output = self.run("show", "-json", f"{name}.tfplan")
        return summarize_plan(json.loads(output.read_text()))


def fixture(directory, args, name, image, stage):
    config = {
        "terraform": {
            "required_version": "= 1.16.7",
            "required_providers": {"google": {"source": "hashicorp/google", "version": "= 7.28.0"}},
        },
        "provider": {"google": {"project": args.project, "region": args.region}},
        "module": {
            "service": {
                "source": "./infra/gcp/terraform/modules/cloud-run-service",
                "project_id": args.project,
                "region": args.region,
                "name": name,
                "image": image,
                "runtime_service_account": f"{name}@{args.project}.iam.gserviceaccount.com",
                "environment": environment(stage),
                "min_instances": 0,
                "max_instances": 1,
                "allow_unauthenticated": False,
                "ingress": "INGRESS_TRAFFIC_INTERNAL_ONLY",
            }
        },
    }
    (directory / "main.tf.json").write_text(json.dumps(config, indent=2) + "\n")


def copy_fixture(directory):
    gcp = directory / "infra/gcp"
    gcp.mkdir(parents=True)
    for script in ROOT.glob("*.py"):
        shutil.copyfile(script, gcp / script.name)
    shutil.copytree(
        ROOT / "terraform/modules/cloud-run-service",
        gcp / "terraform/modules/cloud-run-service",
        ignore=shutil.ignore_patterns(".terraform", "tests", "*.tfstate*", "*.tfplan", "*.log"),
    )
    shutil.copyfile(
        ROOT / "terraform/bootstrap/.terraform.lock.hcl", directory / ".terraform.lock.hcl"
    )


def production_fingerprints(api, args):
    result = {}
    for name in PRODUCTION:
        resource = f"projects/{args.project}/locations/{args.region}/services/{name}"
        service = api.request("GET", resource)
        require(service.get("uid") and service.get("etag"), "Production snapshot lacks identity.")
        configuration = {
            key: service.get(key)
            for key in ("template", "traffic", "annotations", "ingress", "scaling")
        }
        result[name] = {
            "uid": service["uid"],
            "etag": service["etag"],
            "generation": service.get("generation"),
            "latest_ready_revision": service.get("latestReadyRevision"),
            "configuration_sha256": hashlib.sha256(
                json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
        }
    return result


def check(report, key, condition, message):
    report["checks"][key] = bool(condition)
    require(condition, message)


def deleted(call, resource):
    """Independent post-cleanup GET, with a bounded eventual-deletion wait."""
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            call("GET", resource)
        except HTTPError as error:
            if error.code == 404:
                return True
            raise
        time.sleep(3)
    return False


def classify_evidence(report):
    complete = all(report.get("checks", {}).get(key) is True for key in REQUIRED_CHECKS)
    return (
        "PASS"
        if complete and not report.get("error") and report.get("cleanup_errors") == []
        else "ERROR"
    )


def sanitized_evidence(evidence):
    result = {}
    snapshot_keys = {
        "baseline",
        "release_b",
        "stale_plan_after_b",
        "release_c",
        "rollback_to_b",
        "configuration_after_rollback",
        "next_release",
    }
    for key in sorted(snapshot_keys & set(evidence)):
        item = evidence[key]
        result[key] = {
            field: item.get(field)
            for field in (
                "image",
                "revision",
                "latest_ready_revision",
                "deployment_build",
                "terminal_state",
            )
        }
        for field in ("traffic", "observed_traffic"):
            result[key][field] = [
                {name: target[name] for name in ("type", "revision", "percent") if name in target}
                for target in item.get(field, [])
            ]
    for key in sorted(
        {"plan_before_b", "fresh_plan_after_b", "plan_before_rollback"} & set(evidence)
    ):
        result[key] = [
            {
                "address": item.get("address"),
                "actions": item.get("actions"),
                "environment_changed": item.get("environment_changed") is True,
                "release_fields_captured": item.get("release_fields_captured") is True,
            }
            for item in evidence[key]
        ]
    return result


def public_report(report):
    """Only explicit safe fields leave the private report directory."""
    return {
        "schema_version": 1,
        "verified_at": report["verified_at"],
        "status": report["status"],
        "project": "financial-analysis-512202",
        "region": "northamerica-northeast2",
        "terraform_version": "1.16.7",
        "google_provider_version": "7.28.0",
        "images": list(report["images"]),
        "service": report["service"],
        "source": {
            "git_head": report.get("source", {}).get("git_head"),
            "files_sha256": {
                f"infra/gcp/{name}": report.get("source", {})
                .get("files_sha256", {})
                .get(f"infra/gcp/{name}")
                for name in SOURCE_FILES
            },
            "note": "File hashes identify the tested code, including uncommitted changes.",
        },
        "checks": {key: report.get("checks", {}).get(key) is True for key in REQUIRED_CHECKS},
        "evidence": sanitized_evidence(report.get("evidence", {})),
        "cleanup_error_count": len(report.get("cleanup_errors", [])),
        "execution_error": bool(report.get("error")),
        "limitations": [
            "Uses synthetic verification build IDs and existing immutable images; "
            "does not test Cloud Build triggers.",
            "Traffic rollback is exercised through the Cloud Run API, not the Console UI.",
            "No production resource is adopted or modified, and no application URL is invoked.",
            "Raw provider plans, state, environment values and diagnostics remain private.",
        ],
    }


def recover_state_uid(tf):
    """Recover only the Terraform-recorded UID after an interrupted initial apply."""
    _, output = tf.run("show", "-json")
    state = json.loads(output.read_text())
    pending = [state.get("values", {}).get("root_module", {})]
    while pending:
        module = pending.pop()
        for resource in module.get("resources", []):
            if resource.get("address") == ADDRESS:
                return resource.get("values", {}).get("uid")
        pending.extend(module.get("child_modules", []))
    return None


def release(api, resource, image):
    build_id = str(uuid.uuid4())
    result = RELEASE.deploy(
        api,
        resource,
        image,
        build_id,
        datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "0" * 40,
    )
    require(result == "deployed", "Verification release was not deployed.")
    service = LEGACY.wait_service(api, resource)
    revision = RELEASE.deployment_revision(resource.rsplit("/", 1)[-1], build_id)
    require(
        same_revision(service.get("template", {}).get("revision"), revision)
        and same_revision(service.get("latestReadyRevision"), revision)
        and markers(service)[RELEASE.BUILD_ANNOTATION] == build_id
        and all(markers(service).values())
        and latest_traffic(service)
        and traffic_at(service, revision),
        "Verification release has not reached its exact ready revision and 100% traffic.",
    )
    return service


def verify(args, api):
    LEGACY.validate_inputs(args)
    args.terraform = terraform_binary(args.terraform)
    progress("Checking the pinned Terraform CLI before cloud access...")
    version = json.loads(
        subprocess.check_output([args.terraform, "version", "-json"], text=True, timeout=60)
    )
    require(version.get("terraform_version") == "1.16.7", "Use repository-pinned Terraform 1.16.7.")
    require(
        (ROOT / "configure_cloud_run_service.py").is_file(),
        "The configuration ownership helper is missing.",
    )
    provenance = source_provenance()
    progress("Reading existing image digests and production configuration fingerprints...")
    images = (
        LEGACY.validate_images(args, [args.image_a, args.image_b, args.image_c])
        if args.image_a
        else LEGACY.discover_images(api, args)
    )
    before = production_fingerprints(api, args)
    name = f"fv-compat-{uuid.uuid4().hex[:12]}"
    directory = Path(tempfile.mkdtemp(prefix=f"{name}-"))
    directory.chmod(0o700)
    resource = f"projects/{args.project}/locations/{args.region}/services/{name}"
    account = (
        f"projects/{args.project}/serviceAccounts/{name}@{args.project}.iam.gserviceaccount.com"
    )
    report = {
        "verified_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "service": resource,
        "account": account,
        "images": images,
        "evidence": {},
        "checks": {},
        "production_before": before,
        "source": provenance,
        "status": "ERROR",
    }
    uid, unique_id, creating, account_attempted = None, None, False, False
    tf = Terraform(args.terraform, directory, api)
    stages = [f"ownership-{uuid.uuid4().hex}" for _ in range(3)]
    progress(f"Isolated service: {resource}. Private evidence directory: {directory}")
    try:
        LEGACY.absent(api.request, resource)
        LEGACY.absent(api.iam, account)
        progress("Creating the isolated keyless runtime identity without role grants...")
        account_attempted = True
        created = api.iam(
            "POST",
            f"projects/{args.project}/serviceAccounts",
            {
                "accountId": name,
                "serviceAccount": {"displayName": "Disposable release ownership verification"},
            },
        )
        unique_id = created.get("uniqueId")
        require(unique_id, "Created account response has no uniqueId; manual inspection required.")
        copy_fixture(directory)
        fixture(directory, args, name, images[0], stages[0])
        tf.run("init", "-input=false", "-lockfile=readonly")
        creating = True
        tf.run("apply", "-input=false", "-auto-approve", "-lock-timeout=60s")
        uid = recover_state_uid(tf)
        require(uid, "Created test service has no Terraform-recorded UID.")
        service = LEGACY.wait_service(api, resource)
        require(service.get("uid") == uid, "Service identity differs from Terraform state.")
        template = service.get("template", {})
        scaling = template.get("scaling", {})
        check(
            report,
            "isolated_private_cost_contract",
            service.get("ingress") == "INGRESS_TRAFFIC_INTERNAL_ONLY"
            and template.get("serviceAccount") == account.rsplit("/", 1)[-1]
            and scaling.get("minInstanceCount", 0) == 0
            and scaling.get("maxInstanceCount") == 1
            and template.get("containers", [{}])[0].get("resources", {}).get("cpuIdle") is True,
            "Isolated service does not match private scale-to-zero cost controls.",
        )
        check(
            report,
            "baseline_ready",
            ready_with_configuration(service, images[0], environment(stages[0]))
            and latest_traffic(service)
            and traffic_at(service, service.get("latestReadyRevision")),
            "Baseline A is not ready with the expected private configuration.",
        )
        report["evidence"]["baseline"] = snapshot(service)
        check(report, "baseline_noop", tf.plan("baseline") == [], "Baseline plan is not a no-op.")
        fixture(directory, args, name, images[0], stages[1])
        plan = tf.plan("before-b")
        check(report, "saved_plan_scoped", len(plan) == 1, "Expected one config-controller change.")
        report["evidence"]["plan_before_b"] = plan
        progress("Publishing B, then applying a configuration plan saved while A was current...")
        service_b = release(api, resource, images[1])
        check(
            report,
            "release_b_ready",
            ready_with_configuration(service_b, images[1], environment(stages[0])),
            "Release B failed to preserve the baseline configuration.",
        )
        revision_b = service_b["template"]["revision"]
        markers_b = markers(service_b)
        report["evidence"]["release_b"] = snapshot(service_b)
        plan = tf.plan("after-b")
        check(report, "fresh_plan_scoped", len(plan) == 1, "Fresh B plan is not config-only.")
        report["evidence"]["fresh_plan_after_b"] = plan
        tf.run("apply", "-input=false", "before-b.tfplan")
        service = LEGACY.wait_service(api, resource)
        check(
            report,
            "saved_apply_preserved_b_and_environment",
            ready_with_configuration(service, images[1], environment(stages[1]))
            and service["template"].get("revision", "").startswith(f"{name}-cfg-")
            and latest_traffic(service)
            and traffic_at(service, service.get("latestReadyRevision")),
            "The saved A-era plan did not preserve B and apply the intended configuration.",
        )
        check(
            report,
            "saved_apply_preserved_release_markers",
            markers(service) == markers_b,
            "Configuration apply altered B release markers.",
        )
        report["evidence"]["stale_plan_after_b"] = snapshot(service)
        check(
            report, "configuration_b_noop", tf.plan("configured-b") == [], "B plan is not a no-op."
        )
        progress("Publishing C and saving another configuration plan before rollback...")
        service_c = release(api, resource, images[2])
        check(
            report,
            "release_c_ready",
            ready_with_configuration(service_c, images[2], environment(stages[1])),
            "Release C failed to preserve the configured environment.",
        )
        markers_c = markers(service_c)
        report["evidence"]["release_c"] = snapshot(service_c)
        fixture(directory, args, name, images[0], stages[2])
        plan = tf.plan("before-rollback")
        check(
            report, "rollback_plan_scoped", len(plan) == 1, "Rollback-era plan is not config-only."
        )
        report["evidence"]["plan_before_rollback"] = plan
        current = api.request("GET", resource)
        require(current.get("etag"), "Rollback requires an observed etag.")
        api.request(
            "PATCH",
            f"{resource}?{urlencode({'updateMask': 'traffic'})}",
            {
                "name": resource,
                "etag": current["etag"],
                "traffic": [
                    {
                        "type": "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
                        "revision": revision_b,
                        "percent": 100,
                    }
                ],
            },
        )
        service = LEGACY.wait_service(api, resource, traffic_revision=revision_b)
        check(
            report,
            "rollback_b_observed",
            traffic_at(service, revision_b)
            and traffic_at(service, revision_b, desired=True)
            and ready_with_configuration(service, images[2], environment(stages[1])),
            "Rollback did not pin B traffic while retaining desired C.",
        )
        report["evidence"]["rollback_to_b"] = snapshot(service)
        progress("Applying the saved config plan while B remains pinned, without publishing C...")
        tf.run("apply", "-input=false", "before-rollback.tfplan")
        service = LEGACY.wait_service(api, resource, traffic_revision=revision_b)
        check(
            report,
            "rollback_apply_preserved_c_and_environment",
            ready_with_configuration(service, images[2], environment(stages[2]))
            and service["template"].get("revision", "").startswith(f"{name}-cfg-")
            and not same_revision(
                service["template"].get("revision"), service_c["template"]["revision"]
            ),
            "Rollback-era config apply did not stage configured C in a new revision.",
        )
        check(
            report,
            "rollback_apply_preserved_b_traffic",
            traffic_at(service, revision_b) and traffic_at(service, revision_b, desired=True),
            "Config apply changed the pinned B rollback traffic.",
        )
        check(
            report,
            "rollback_apply_preserved_release_markers",
            markers(service) == markers_c,
            "Config apply altered C release markers while rollback was active.",
        )
        report["evidence"]["configuration_after_rollback"] = snapshot(service)
        check(
            report,
            "rollback_configuration_noop",
            tf.plan("configured-rollback") == [],
            "Post-rollback configuration plan is not a no-op.",
        )
        progress("Publishing the next image release using the staged configuration...")
        service = release(api, resource, images[1])
        check(
            report,
            "next_release_preserved_environment",
            ready_with_configuration(service, images[1], environment(stages[2])),
            "The next image release did not preserve the staged configuration.",
        )
        check(
            report,
            "next_release_latest_traffic",
            latest_traffic(service) and traffic_at(service, service["template"]["revision"]),
            "The next release did not deliberately restore 100% LATEST traffic.",
        )
        report["evidence"]["next_release"] = snapshot(service)
        check(report, "final_noop", tf.plan("final") == [], "Final Terraform plan is not a no-op.")
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
        progress(
            "Deleting isolated resources and independently checking production fingerprints..."
        )
        if creating and not uid:
            try:
                uid = recover_state_uid(tf)
            except Exception as error:
                report["identity_recovery_error"] = f"{type(error).__name__}: {error}"
        report["cleanup_errors"] = LEGACY.cleanup(api, resource, uid, account, unique_id)
        if creating and not uid:
            report["cleanup_errors"].append("No recorded service UID; inspect only " + resource)
        if account_attempted and not unique_id:
            report["cleanup_errors"].append("No recorded account uniqueId; inspect only " + account)
        for key, call, target in (
            ("service_deleted", api.request, resource),
            ("account_deleted", api.iam, account),
        ):
            try:
                report["checks"][key] = deleted(call, target)
            except Exception as error:
                report["checks"][key] = False
                report["cleanup_errors"].append(f"Independent {key} check: {error}")
        try:
            after = production_fingerprints(api, args)
            report["production_after"] = after
            report["checks"]["production_unchanged"] = before == after
        except Exception as error:
            report["checks"]["production_unchanged"] = False
            report["cleanup_errors"].append(f"Independent production check: {error}")
        report["status"] = classify_evidence(report)
        (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        (directory / "public-report.json").write_text(
            json.dumps(public_report(report), indent=2) + "\n"
        )
        progress(f"Verification {report['status']}. Private evidence: {directory / 'report.json'}")
        if report.get("error"):
            progress(f"Stopped safely: {report['error']}")
        for error in report["cleanup_errors"]:
            progress(error)
    return 0 if report["status"] == "PASS" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--project", required=True)
    parser.add_argument("--region", default="northamerica-northeast2")
    parser.add_argument(
        "--terraform",
        type=terraform_binary,
        default=str(Path.home() / "folioview-terraform-tools/terraform"),
    )
    parser.add_argument("--repository", default="financial-analysis")
    parser.add_argument("--image-package", default="market-api")
    for label in ("a", "b", "c"):
        parser.add_argument(f"--image-{label}")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = verify(args, Cloud())
    except (
        argparse.ArgumentTypeError,
        OSError,
        RuntimeError,
        ValueError,
        subprocess.SubprocessError,
    ) as error:
        parser.exit(1, f"Verification preflight failed: {error}\n")
    raise SystemExit(result)


if __name__ == "__main__":
    main()
