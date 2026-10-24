"""Review Market adoption with real provider plans and no cloud writes.

Only read-only API queries and Terraform version/init/validate/plan/show are permitted.
Downloaded administrative state, inventory, provider output and saved plans stay
in a fresh private directory. The explicit report contains an allowlist of safe
identifiers, actions, hashes and verification results; it never contains values
from environment variables, IAM policy payloads, state or plan output.
"""

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from configure_cloud_run_service import configuration, configuration_body, matches

ROOT = Path(__file__).resolve().parent
PROJECT = "financial-analysis-512202"
REGION = "northamerica-northeast2"
BASE = f"projects/{PROJECT}/locations/{REGION}"
SERVICE = f"{BASE}/services/market-api"
RUNTIME = f"projects/{PROJECT}/serviceAccounts/fa-api-runtime@{PROJECT}.iam.gserviceaccount.com"
IMAGE_TRIGGER = "db77a22e-83bf-45cc-b114-50e32192a9c8"
BOOTSTRAP_BUCKET = f"{PROJECT}-tf-bootstrap"
BOOTSTRAP_OBJECT = "bootstrap/default.tfstate"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def write_private(path, content):
    data = content if isinstance(content, bytes) else content.encode()
    with path.open("xb") as stream:
        os.chmod(path, 0o600)
        stream.write(data)


def write_json(path, value):
    write_private(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def clean_environment():
    # Ignore inherited provider credentials, Terraform flags/config and CLI auth
    # overrides. gcloud uses its normal already-signed-in local configuration.
    return {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("TF_", "GOOGLE_", "GCLOUD_", "CLOUDSDK_", "FOLIOVIEW_TEST_"))
    }


class Cloud:
    def token(self):
        result = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            env=clean_environment(),
            capture_output=True,
            timeout=60,
            check=False,
        )
        require(
            result.returncode == 0,
            "Local gcloud authentication failed; diagnostics withheld.",
        )
        token = result.stdout.decode().strip()
        require(bool(token), "Local gcloud returned no access token.")
        return token

    def get(self, host, path, *, raw=False):
        request = Request(
            f"https://{host}/{path}",
            method="GET",
            headers={"Authorization": "Bearer " + self.token()},
        )
        with urlopen(request, timeout=60) as response:
            data = response.read()
        return data if raw else json.loads(data)

    def iam_policy(self, host, path):
        # These two Google getIamPolicy RPCs use POST despite being read-only.
        allowed = {
            ("iam.googleapis.com", "v1/" + RUNTIME + ":getIamPolicy"),
            (
                "cloudresourcemanager.googleapis.com",
                f"v1/projects/{PROJECT}:getIamPolicy",
            ),
        }
        require((host, path) in allowed, "Only the two fixed IAM read RPCs permit POST.")
        request = Request(
            f"https://{host}/{path}",
            method="POST",
            data=b"{}",
            headers={
                "Authorization": "Bearer " + self.token(),
                "Content-Type": "application/json",
            },
        )
        with urlopen(request, timeout=60) as response:
            return json.load(response)

    def snapshot(self):
        service = self.get("run.googleapis.com", "v2/" + SERVICE)
        return {
            "service": service,
            "service_iam": self.get("run.googleapis.com", "v2/" + SERVICE + ":getIamPolicy"),
            "runtime": self.get("iam.googleapis.com", "v1/" + RUNTIME),
            "runtime_iam": self.iam_policy("iam.googleapis.com", "v1/" + RUNTIME + ":getIamPolicy"),
            "project_iam": self.iam_policy(
                "cloudresourcemanager.googleapis.com",
                f"v1/projects/{PROJECT}:getIamPolicy",
            ),
            "image_trigger": self.get(
                "cloudbuild.googleapis.com", f"v1/{BASE}/triggers/{IMAGE_TRIGGER}"
            ),
            "other_services": {
                name: self.get("run.googleapis.com", f"v2/{BASE}/services/{name}")
                for name in ("user-api", "config-api", "market-web")
            },
        }

    def bootstrap_state(self):
        path = f"storage/v1/b/{BOOTSTRAP_BUCKET}/o/{quote(BOOTSTRAP_OBJECT, safe='')}"
        metadata = self.get("storage.googleapis.com", path)
        generation = metadata["generation"]
        data = self.get(
            "storage.googleapis.com",
            path + "?" + urlencode({"alt": "media", "generation": generation}),
            raw=True,
        )
        return generation, data


def terraform_binary(value):
    supplied = str(value).strip()
    if not supplied or any(ord(character) < 32 for character in supplied):
        raise argparse.ArgumentTypeError("Terraform path contains control characters or is empty.")
    try:
        path = Path(supplied).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise argparse.ArgumentTypeError(
            "Install the repository's pinned Terraform CLI first."
        ) from error
    if not path.is_file() or not os.access(path, os.X_OK):
        raise argparse.ArgumentTypeError("Terraform path must identify an executable file.")
    return str(path)


class Terraform:
    ALLOWED = ("version", "init", "validate", "plan", "show")

    def __init__(self, binary, cloud, evidence):
        self.binary, self.cloud, self.evidence = binary, cloud, evidence

    def run(self, phase, arguments, directory, label, *, allowed=(0,)):
        require(phase in self.ALLOWED, "Only read-only Terraform commands are permitted.")
        environment = {
            **clean_environment(),
            "GOOGLE_OAUTH_ACCESS_TOKEN": self.cloud.token(),
            "TF_IN_AUTOMATION": "1",
            "TF_INPUT": "0",
            "TF_CLI_CONFIG_FILE": os.devnull,
        }
        try:
            result = subprocess.run(
                [self.binary, phase, *arguments],
                cwd=directory,
                env=environment,
                capture_output=True,
                timeout=900,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            write_private(
                self.evidence / (label + ".log"),
                (error.stdout or b"") + (error.stderr or b""),
            )
            raise RuntimeError(f"Terraform {phase} timed out; inspect private evidence.") from None
        write_private(self.evidence / (label + ".stdout"), result.stdout)
        write_private(self.evidence / (label + ".stderr"), result.stderr)
        require(
            result.returncode in allowed,
            f"Terraform {phase} failed; inspect private evidence.",
        )
        return result.stdout

    def plan(self, directory, label, variables=()):
        self.run("init", ["-lockfile=readonly", "-no-color"], directory, label + "-init")
        self.run("validate", ["-no-color"], directory, label + "-validate")
        output = directory / "adoption.tfplan"
        self.run(
            "plan",
            [
                "-input=false",
                "-no-color",
                "-detailed-exitcode",
                "-out=" + str(output),
                *variables,
            ],
            directory,
            label + "-plan",
            allowed=(0, 2),
        )
        return json.loads(self.run("show", ["-json", str(output)], directory, label + "-show"))


def source_evidence():
    market = ROOT / "terraform/envs/prod/market"
    bootstrap = ROOT / "terraform/bootstrap"
    modules = ROOT / "terraform/modules"
    files = {
        ROOT / name
        for name in (
            "terraform/pipeline.json",
            "terraform/toolchain.json",
            "configure_cloud_run_service.py",
            "deploy_existing_service.py",
            "terraform_pipeline.py",
            "terraform_tools.py",
            "verify_market_adoption.py",
            "cloudbuild.terraform-plan.yaml",
            "cloudbuild.terraform-apply.yaml",
        )
    }
    files.update(market / name for name in ("main.tf", "imports.tf", "outputs.tf", "versions.tf"))
    files.update(market.glob("*.tf"))
    files.add(market / ".terraform.lock.hcl")
    files.update(path for path in bootstrap.glob("*.tf") if path.name != "backend.tf")
    files.add(bootstrap / ".terraform.lock.hcl")
    files.update(
        path
        for path in modules.rglob("*")
        if path.is_file()
        and "tests" not in path.relative_to(modules).parts
        and ".terraform" not in path.parts
        and (path.suffix == ".tf" or path.name == ".terraform.lock.hcl")
    )
    hashes = {}
    for path in sorted(files):
        require(
            path.is_file() and not path.is_symlink(),
            "A required verification source is missing or uses a symlink.",
        )
        hashes[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    repository = ROOT.parents[1]
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        env=clean_environment(),
        capture_output=True,
        timeout=30,
        check=False,
    )
    require(head.returncode == 0, "Cannot identify the source commit.")
    commit = head.stdout.decode().strip()
    require(
        re.fullmatch(r"[a-f0-9]{40}", commit),
        "Source commit is not a full Git object ID.",
    )
    status = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=normal"],
        cwd=repository,
        env=clean_environment(),
        capture_output=True,
        timeout=30,
        check=False,
    )
    require(
        status.returncode == 0,
        "Cannot identify whether the source tree has local changes.",
    )
    return {
        "git_head": commit,
        "working_tree_dirty": bool(status.stdout),
        "sha256": hashes,
    }


def copy_sources(destination, expected_sources):
    def ignored(directory, names):
        ignored_names = []
        for name in names:
            path = Path(directory) / name
            require(not path.is_symlink(), "Verification source must not contain symlinks.")
            if (
                name in {".terraform", "tests", "__pycache__", "backend.tf", ".DS_Store"}
                or name.endswith(
                    (
                        ".tfvars",
                        ".tfvars.json",
                        ".tfstate",
                        ".tfstate.backup",
                        ".tfplan",
                    )
                )
                or name.startswith("terraform.tfstate")
            ):
                ignored_names.append(name)
        return ignored_names

    shutil.copytree(ROOT, destination, ignore=ignored)
    for name, expected_hash in expected_sources["sha256"].items():
        path = destination / name
        require(
            path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == expected_hash,
            "Copied verification source differs from its recorded hash.",
        )
    versions = destination / "terraform/envs/prod/market/versions.tf"
    text, count = re.subn(r'\n\s*backend "gcs" \{\s*\}', "", versions.read_text())
    require(count == 1, "Expected exactly one empty Market GCS backend declaration.")
    versions.write_text(text)
    require(
        not any(destination.rglob("backend.tf")),
        "A real backend file was copied unexpectedly.",
    )


def bootstrap_review(plan):
    image_member = f"serviceAccount:fa-build@{PROJECT}.iam.gserviceaccount.com"
    imports = {
        "module.market_image_release.google_cloudbuild_trigger.this": (
            f"{BASE}/triggers/{IMAGE_TRIGGER}"
        ),
        "google_cloud_run_v2_service_iam_member.market_image_deployer": (
            f"{SERVICE} roles/run.developer {image_member}"
        ),
        'google_service_account_iam_member.market_runtime_deployer["image"]': (
            f"{RUNTIME} roles/iam.serviceAccountUser {image_member}"
        ),
        "google_project_iam_member.market_cache": (
            f"{PROJECT} roles/datastore.user "
            f"serviceAccount:fa-api-runtime@{PROJECT}.iam.gserviceaccount.com"
        ),
    }
    target = 'module.target_execution["market"].'
    creates = {
        target + name
        for name in (
            "google_storage_bucket.state",
            'google_service_account.execution["plan"]',
            'google_service_account.execution["apply"]',
            'google_project_iam_member.logging["plan"]',
            'google_project_iam_member.logging["apply"]',
            'google_project_iam_member.build_metadata["plan"]',
            'google_project_iam_member.build_metadata["apply"]',
            'google_storage_bucket_iam_member.plan_state["roles/storage.objectViewer"]',
            'google_storage_bucket_iam_member.plan_state["roles/storage.objectCreator"]',
            "google_storage_bucket_iam_member.plan_unlock",
            "google_storage_bucket_iam_member.apply_state",
            "google_storage_bucket_iam_member.plan_artifact_write",
            "google_storage_bucket_iam_member.plan_artifact_read",
            "google_storage_bucket_iam_member.apply_recovery_write",
            "google_cloudbuild_trigger.plan",
            "google_cloudbuild_trigger.apply",
        )
    } | {
        'google_service_account_iam_member.market_runtime_deployer["terraform"]',
        'google_cloud_run_v2_service_iam_member.market_execution["plan"]',
        'google_cloud_run_v2_service_iam_member.market_execution["apply"]',
        'google_service_account_iam_member.market_execution_metadata["plan"]',
        'google_service_account_iam_member.market_execution_metadata["apply"]',
        "google_project_iam_custom_role.market_service_read",
        "google_project_iam_custom_role.market_service_configuration",
        "google_project_iam_custom_role.market_identity_read",
        "google_project_iam_custom_role.market_identity_metadata",
    }
    seen_imports, seen_creates, actions = set(), set(), []
    for entry in plan.get("resource_changes", []):
        change, address = entry["change"], entry["address"]
        action = change["actions"]
        require(
            action in (["no-op"], ["create"]),
            "Bootstrap attempted to change an existing resource.",
        )
        if change.get("importing"):
            require(
                address in imports and action == ["no-op"],
                "Unexpected or mutating bootstrap import.",
            )
            require(
                change["importing"].get("id") == imports[address],
                "Import ID differs from the exact existing Market object.",
            )
            seen_imports.add(address)
        elif action == ["create"]:
            require(
                address in creates and change.get("before") is None,
                "Unexpected bootstrap resource creation.",
            )
            seen_creates.add(address)
        if action != ["no-op"] or change.get("importing"):
            actions.append(
                {
                    "address": address,
                    "actions": action,
                    "import": bool(change.get("importing")),
                }
            )
    require(
        seen_imports == set(imports),
        "Expected four existing Market administrative imports.",
    )
    require(
        seen_creates == creates,
        "Expected only the exact Market execution boundary and scoped grants.",
    )
    return actions


def market_review(plan):
    imports = {
        "module.market.google_cloud_run_v2_service.service": SERVICE,
        "module.runtime_identity.google_service_account.this": RUNTIME,
    }
    controller = "module.market.terraform_data.configuration"
    reads = {
        "module.market.data.google_cloud_run_v2_service.configured",
        "data.google_cloud_run_v2_service.market_boundary",
    }
    seen_imports, seen_controller, desired, actions = set(), False, None, []
    for entry in plan.get("resource_changes", []):
        change, address = entry["change"], entry["address"]
        action = change["actions"]
        if change.get("importing"):
            require(
                address in imports and action == ["no-op"],
                "Market import must not mutate the existing object.",
            )
            require(
                change["importing"].get("id") == imports[address],
                "Import ID differs from the exact existing Market object.",
            )
            seen_imports.add(address)
        elif address == controller:
            require(
                action == ["create"] and change.get("before") is None,
                "Expected only initial configuration controller creation.",
            )
            desired, seen_controller = change["after"]["input"], True
        elif entry.get("mode") == "data":
            require(
                address in reads and action in (["read"], ["no-op"]),
                "Unexpected Market verification read.",
            )
        else:
            require(
                action == ["no-op"] and address in imports,
                "Market attempted a native resource write or unexpected action.",
            )
        actions.append(
            {
                "address": address,
                "actions": action,
                "import": bool(change.get("importing")),
            }
        )
    require(
        seen_imports == set(imports) and seen_controller,
        "Missing expected Market imports or controller.",
    )
    return actions, desired


def controller_review(service, desired):
    require(
        configuration(service) == desired,
        "Desired Market configuration differs from the existing service.",
    )
    container = service["template"]["containers"][0]
    resources = container.get("resources", {})
    cpu = resources.get("limits", {}).get("cpu")
    require(
        cpu in ("1000m", "1") and resources.get("cpuIdle") is True,
        "Unexpected existing CPU or billing configuration.",
    )
    body = configuration_body(copy.deepcopy(service), desired)
    require(
        body["template"]["containers"][0]["image"] == container["image"],
        "Controller simulation changed the image.",
    )
    require(
        "traffic" not in body and "invokerIamDisabled" not in body,
        "Controller simulation owns release traffic or invocation mode.",
    )
    require(
        body["etag"] == service["etag"] and body["name"] == service["name"],
        "Controller simulation lost conditional service identity.",
    )
    require(
        configuration({**service, **body}) == desired,
        "Controller simulation changed desired configuration.",
    )
    require(
        matches({**service, **body}, desired),
        "Simulated CPU normalization does not match the shared controller contract.",
    )
    require(
        all(
            body["annotations"].get(key) == value
            for key, value in service.get("annotations", {}).items()
        ),
        "Controller simulation lost existing release annotations.",
    )
    return {
        "analysis_only": True,
        "configuration_matches_existing": True,
        "cpu_representation_normalization_required": cpu == "1000m",
        "first_apply_creates_configuration_revision": not matches(service, desired),
        "simulated_image_preserved": True,
        "simulated_traffic_and_invoker_mode_excluded": True,
        "simulated_conditional_identity_and_release_annotations_preserved": True,
    }


def verify(args):
    require(args.live, "Pass --live to permit authenticated read-only cloud inspection.")
    os.umask(0o077)
    if args.evidence_directory:
        evidence = Path(args.evidence_directory).expanduser().resolve()
        evidence.mkdir(mode=0o700, parents=False, exist_ok=False)
    else:
        evidence = Path(tempfile.mkdtemp(prefix="folioview-market-readonly-"))
    os.chmod(evidence, 0o700)
    print(f"Private read-only evidence: {evidence}", flush=True)
    cloud = Cloud()
    source = evidence / "source/infra/gcp"
    sources_before = source_evidence()
    write_json(evidence / "source-evidence.json", sources_before)
    copy_sources(source, sources_before)
    runner = Terraform(args.terraform, cloud, evidence)
    version = json.loads(runner.run("version", ["-json"], source, "version"))
    expected = json.loads((ROOT / "terraform/toolchain.json").read_text())["terraform_version"]
    require(
        version["terraform_version"] == expected,
        "Terraform CLI does not match the pinned toolchain.",
    )
    registry = json.loads((source / "terraform/pipeline.json").read_text())
    require(
        {name for name, target in registry["targets"].items() if target["enabled"]}
        == {"repo", "market"},
        "Only Repo and Market may be enabled.",
    )
    before = cloud.snapshot()
    write_json(evidence / "before.json", before)
    generation, state = cloud.bootstrap_state()
    bootstrap = source / "terraform/bootstrap"
    write_private(bootstrap / "terraform.tfstate", state)
    repository = before["image_trigger"]["repositoryEventConfig"]["repository"]
    print("Reviewing bootstrap against a private local state copy.", flush=True)
    bootstrap_plan = runner.plan(bootstrap, "bootstrap", ["-var=repository_id=" + repository])
    bootstrap_actions = bootstrap_review(bootstrap_plan)
    print("Reviewing Market imports with a new private local state.", flush=True)
    market_plan = runner.plan(source / "terraform/envs/prod/market", "market")
    market_actions, desired = market_review(market_plan)
    imported_service = next(
        entry["change"]["after"]
        for entry in market_plan["resource_changes"]
        if entry["address"] == "module.market.google_cloud_run_v2_service.service"
    )
    require(
        imported_service.get("uid") == before["service"]["uid"],
        "Imported native service UID differs from the independent cloud snapshot.",
    )
    analysis = controller_review(before["service"], desired)
    after = cloud.snapshot()
    write_json(evidence / "after.json", after)
    unchanged = {key: digest(before[key]) == digest(after[key]) for key in before}
    require(
        all(unchanged.values()),
        "Live resources changed during the read-only verification; inspect private evidence.",
    )
    current_generation, _ = cloud.bootstrap_state()
    require(
        current_generation == generation,
        "Administrative remote state changed during verification.",
    )
    sources_after = source_evidence()
    require(
        sources_before["sha256"] == sources_after["sha256"],
        "Verification source changed during the run; repeat with stable reviewed source.",
    )
    require(
        sources_before["git_head"] == sources_after["git_head"],
        "Source commit changed during verification.",
    )
    report = {
        "schema_version": 1,
        "source_evidence": sources_before,
        "source_hashes_unchanged": True,
        "source_validity": (
            "This report applies only to the recorded source hashes; "
            "local modifications are identified independently of Git HEAD."
        ),
        "private_copy_adjustments": [
            "Skip local bootstrap backend.tf, operator tfvars, state, plans and caches.",
            "Remove only the empty Market GCS backend declaration; "
            "both verification roots use private local state.",
        ],
        "verified_at": datetime.now(UTC).isoformat(),
        "project_id": PROJECT,
        "region": REGION,
        "target": "market",
        "status": "PASS",
        "cloud_operations": "GET and fixed read-only getIamPolicy RPCs only",
        "production_apply_executed": False,
        "release_or_rollback_executed": False,
        "remote_state_written": False,
        "terraform_version": expected,
        "bootstrap_state_generation": generation,
        "service_resource": SERVICE,
        "service_uid": before["service"]["uid"],
        "image_trigger_id": IMAGE_TRIGGER,
        "bootstrap_actions": bootstrap_actions,
        "market_actions": market_actions,
        "controller_analysis": analysis,
        "live_snapshots_unchanged": unchanged,
        "before_sha256": {key: digest(value) for key, value in before.items()},
        "after_sha256": {key: digest(value) for key, value in after.items()},
        "verification_limit": (
            "Real provider import plans and in-memory controller analysis only; "
            "production apply, release and rollback still require approved acceptance."
        ),
    }
    report_path = (
        Path(args.report).expanduser().resolve() if args.report else evidence / "report.json"
    )
    write_json(report_path, report)
    print(
        "PASS: Market adoption plans contain no existing-resource writes. "
        f"Sanitized report: {report_path}",
        flush=True,
    )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Permit authenticated read-only cloud inspection.",
    )
    parser.add_argument(
        "--terraform",
        required=True,
        type=terraform_binary,
        help="Pinned Terraform executable.",
    )
    parser.add_argument("--report", help="New sanitized JSON report path; never overwritten.")
    parser.add_argument(
        "--evidence-directory",
        help="New private evidence directory; never overwritten.",
    )
    args = parser.parse_args()
    try:
        verify(args)
    except (
        RuntimeError,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
    ):
        # SDK/HTTP/provider exception bodies may contain resource values. Keep
        # public diagnostics fixed; private command output remains available.
        raise SystemExit(
            "Read-only Market verification failed; inspect private evidence "
            "or rerun with authenticated CLI."
        ) from None


if __name__ == "__main__":
    main()
