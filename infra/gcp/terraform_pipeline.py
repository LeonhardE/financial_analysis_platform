"""Plan privately, then apply the exact reviewed plan from an approved Cloud Build.

The committed registry is the only source of targets and backend locations. This
runner never provisions its own bootstrap, accepts ad-hoc Terraform arguments,
prints plan values, or runs a fresh plan during apply.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
POLICY = "infra/gcp/terraform/pipeline.json"
CONFIG_FILES = {
    "plan": "infra/gcp/cloudbuild.terraform-plan.yaml",
    "apply": "infra/gcp/cloudbuild.terraform-apply.yaml",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def build_id(value):
    try:
        require(str(UUID(value)) == value, "Cloud Build ID must be a canonical UUID.")
    except (ValueError, AttributeError) as error:
        raise RuntimeError("Cloud Build ID must be a canonical UUID.") from error
    return value


class TerraformCommandError(RuntimeError):
    def __init__(self, phase, output):
        super().__init__(f"Terraform {phase} failed; output withheld.")
        self.output = output


def command(arguments, directory, allowed=(0,)):
    # Provider diagnostics and Terraform output can contain infrastructure values;
    # never forward subprocess output to public build logs, including on failure.
    try:
        result = subprocess.run(
            arguments,
            cwd=directory,
            env={
                **{key: value for key, value in os.environ.items() if not key.startswith("TF_")},
                "TF_IN_AUTOMATION": "1",
                "TF_INPUT": "0",
                "TF_CLI_CONFIG_FILE": os.devnull,
            },
            capture_output=True,
            check=False,
            timeout=600,
        )
    except subprocess.TimeoutExpired as error:
        raise TerraformCommandError(
            arguments[1], (error.stdout or b"") + b"\n" + (error.stderr or b"")
        ) from None
    if result.returncode not in allowed:
        raise TerraformCommandError(arguments[1], result.stdout + b"\n" + result.stderr)
    return result.stdout


class GoogleAPI:
    def __init__(self, policy):
        self.policy = policy
        self.token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"], timeout=60, text=True
        ).strip()

    def request(self, url, *, data=None, content_type="application/json"):
        request = Request(
            url,
            data=data,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": content_type,
            },
        )
        with urlopen(request, timeout=60) as response:
            return response.read()

    def cloud_build(self, resource):
        prefix = (
            "https://cloudbuild.googleapis.com/v1/projects/"
            f"{self.policy['project_id']}/locations/{self.policy['region']}"
        )
        return json.loads(self.request(f"{prefix}/{resource}"))

    def build(self, identifier):
        return self.cloud_build(f"builds/{build_id(identifier)}")

    def trigger(self, identifier):
        return self.cloud_build(f"triggers/{build_id(identifier)}")

    def object_metadata(self, bucket, name):
        url = f"https://storage.googleapis.com/storage/v1/b/{quote(bucket, safe='')}/o/"
        return json.loads(self.request(url + quote(name, safe="")))

    def state_generation(self, bucket, name):
        try:
            return self.object_metadata(bucket, name)["generation"]
        except HTTPError as error:
            if error.code == 404:
                return "0"
            raise

    def download(self, bucket, name, generation):
        url = f"https://storage.googleapis.com/storage/v1/b/{quote(bucket, safe='')}/o/"
        return self.request(
            url + quote(name, safe="") + "?" + urlencode({"alt": "media", "generation": generation})
        )

    def upload(self, bucket, name, data):
        url = f"https://storage.googleapis.com/upload/storage/v1/b/{quote(bucket, safe='')}/o?"
        metadata = json.loads(
            self.request(
                url + urlencode({"uploadType": "media", "name": name, "ifGenerationMatch": "0"}),
                data=data,
                content_type="application/octet-stream",
            )
        )
        require(metadata.get("generation"), "Artifact upload did not return its generation.")
        return {"generation": metadata["generation"], "sha256": hashlib.sha256(data).hexdigest()}


def registry(root, target):
    policy = json.loads((root / POLICY).read_text())
    require(policy.get("schema_version") == 1, "Unsupported pipeline policy schema.")
    require(target in policy["targets"], "Target is not registered in the pipeline policy.")
    selected = policy["targets"][target]
    directory = (root / selected["directory"]).resolve()
    allowed = (root / "infra/gcp/terraform/envs/prod").resolve()
    require(directory.is_relative_to(allowed) and directory != allowed, "Invalid target directory.")
    require(directory.is_dir(), "The registered Terraform directory does not exist.")
    require(
        re.fullmatch(r"prod/[a-z][a-z0-9-]*", selected["state_prefix"]), "Invalid state prefix."
    )
    return policy, selected, directory


def configuration_hash(root, directory):
    files = {
        root / POLICY,
        root / "infra/gcp/terraform_pipeline.py",
        root / "infra/gcp/configure_cloud_run_service.py",
        root / "infra/gcp/deploy_existing_service.py",
        root / "infra/gcp/terraform/toolchain.json",
    }
    files.update(root / name for name in CONFIG_FILES.values())
    tools = root / "infra/gcp/terraform_tools.py"
    if tools.exists():
        files.add(tools)
    modules = root / "infra/gcp/terraform/modules"
    for base in (directory, modules):
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if ".terraform" in path.parts:
                continue
            require(not path.is_symlink(), "Terraform source must not contain symlinks.")
            require(
                not (
                    path.name.endswith((".tfvars", ".tfvars.json")) or path.name == "terraform.rc"
                ),
                "Ad-hoc Terraform variable or CLI configuration files are not allowed.",
            )
            if path.is_file():
                files.add(path)
    require((directory / ".terraform.lock.hcl").is_file(), "A provider lock file is required.")
    digest = hashlib.sha256()
    for path in sorted(files):
        require(path.is_file() and not path.is_symlink(), "A pipeline source file is missing.")
        name = path.relative_to(root).as_posix().encode()
        data = path.read_bytes()
        digest.update(len(name).to_bytes(8) + name + len(data).to_bytes(8) + data)
    return digest.hexdigest()


def verify_build(
    api, policy, selected, mode, identifier, commit, *, target, plan_build_id=None, producer=False
):
    build = api.build(identifier)
    substitutions = build.get("substitutions", {})
    require(
        build.get("id") == identifier
        and build.get("projectId") == policy["project_id"]
        and build.get("status") == ("SUCCESS" if producer else "WORKING")
        and substitutions.get("COMMIT_SHA") == commit
        and substitutions.get("BRANCH_NAME") == "main"
        and substitutions.get("_TARGET") == target
        and (mode != "apply" or substitutions.get("_PLAN_BUILD_ID") == plan_build_id),
        "Cloud Build source, identity, or status does not match this execution.",
    )
    expected_account = selected[f"{mode}_service_account"]

    def same_account(value):
        match = re.fullmatch(r"projects/([^/]+)/serviceAccounts/([^/]+)", value or "")
        return (
            match
            and match[1] in (policy["project_id"], policy.get("project_number"), "-")
            and match[2] == expected_account
        )

    require(same_account(build.get("serviceAccount")), "Unexpected Cloud Build service account.")
    trigger = api.trigger(build.get("buildTriggerId", ""))
    filenames = [trigger.get("filename"), trigger.get("gitFileSource", {}).get("path")]
    require(
        trigger.get("name") == selected[f"{mode}_trigger"]
        and same_account(trigger.get("serviceAccount"))
        and any(filenames)
        and all(name == CONFIG_FILES[mode] for name in filenames if name),
        "Cloud Build trigger does not match the registered pipeline.",
    )

    def repository_identity(value):
        projects = "|".join(
            re.escape(project)
            for project in (policy["project_id"], policy.get("project_number"))
            if project
        )
        region = re.escape(policy["region"])
        match = re.fullmatch(
            rf"projects/(?:{projects})/(locations/{region}/connections/[\w.-]+/repositories/[\w.-]+)",
            value or "",
            flags=re.ASCII,
        )
        require(match, "The pipeline repository must belong to this project's regional connection.")
        return match[1]

    if mode == "plan":
        event = trigger.get("repositoryEventConfig", {})
        repository = event.get("repository", "")
        push = event.get("push", {})
        require(
            push.get("branch") == "^main$" and not push.get("invertRegex"),
            "The plan trigger must select only main.",
        )
    else:
        source = trigger.get("sourceToBuild", {})
        repository = source.get("repository", "")
        require(
            source.get("ref") == "refs/heads/main"
            and repository_identity(trigger.get("gitFileSource", {}).get("repository"))
            == repository_identity(repository)
            and trigger.get("gitFileSource", {}).get("revision") == "refs/heads/main",
            "The apply trigger must read its source and pipeline from the registered main branch.",
        )
    expected_repository = repository_identity(repository)
    provenance = build.get("sourceProvenance", {})
    require(isinstance(provenance, dict), "Cloud Build returned invalid source provenance.")
    resolved_sources = {
        key: value for key, value in provenance.items() if key.startswith("resolved") and value
    }
    require(
        len(resolved_sources) == 1
        and next(iter(resolved_sources)) in ("resolvedConnectedRepository", "resolvedGitSource"),
        "Cloud Build must return exactly one supported output-only source provenance.",
    )
    kind, resolved = next(iter(resolved_sources.items()))
    require(isinstance(resolved, dict), "Cloud Build returned invalid source provenance.")
    if kind == "resolvedConnectedRepository":
        matches_repository = (
            bool(resolved.get("repository"))
            and repository_identity(resolved["repository"]) == expected_repository
        )
    else:
        # GitHub triggers can return a resolved Git URL rather than a connected
        # repository ID. Pin its identity in reviewed policy, never substitutions
        # or the caller-supplied build.source object. Do not normalize URL aliases.
        expected_url = policy.get("repository_url")
        matches_repository = (
            isinstance(expected_url, str)
            and expected_url.startswith("https://github.com/")
            and resolved.get("url") == expected_url
        )
    require(
        matches_repository and resolved.get("revision") == commit and not resolved.get("dir"),
        "Output-only source provenance does not match the registered repository and commit.",
    )
    if mode == "apply":
        require(
            trigger.get("approvalConfig", {}).get("approvalRequired") is True
            and build.get("approval", {}).get("result", {}).get("decision") == "APPROVED",
            "Apply requires a native Cloud Build approval.",
        )
    return build


def preserve_failure(api, bucket, prefix, directory, error):
    failures = []
    artifacts = {"diagnostics.txt": getattr(error, "output", str(error).encode())}
    state = directory / "errored.tfstate"
    try:
        if state.exists() or state.is_symlink():
            require(state.is_file() and not state.is_symlink(), "Invalid recovery state file.")
            artifacts["errored.tfstate"] = state.read_bytes()
    except (OSError, RuntimeError) as failed:
        failures.append(failed)
    for name, data in artifacts.items():
        try:
            api.upload(bucket, prefix + name, data)
        except Exception as failed:
            failures.append(failed)
    if failures:
        raise RuntimeError(
            "Terraform apply failed and recovery capture was incomplete; "
            "an administrator must reconcile state before retrying."
        ) from error
    print(f"Private recovery artifacts: gs://{bucket}/{prefix}")
    print("An administrator must review recovery artifacts and state before retrying.")


def plan_summary(plan, version):
    require(plan.get("terraform_version") == version, "Plan Terraform version does not match.")
    lines = []
    for resource in plan.get("resource_changes", []):
        actions = resource["change"]["actions"]
        require(
            "delete" not in actions, "Delete and replacement actions require a separate workflow."
        )
        require(actions in (["no-op"], ["create"], ["read"], ["update"]), "Unknown plan action.")
        if actions != ["no-op"]:
            lines.append(f"{resource['address']}: {','.join(actions)}")
    return "\n".join(lines) or "No resource changes."


def run(
    mode,
    target,
    identifier,
    commit,
    branch,
    *,
    plan_build_id=None,
    terraform="terraform",
    root=ROOT,
    api=None,
    now=None,
):
    root = root.resolve()
    require(mode in ("plan", "apply"), "Unsupported pipeline operation.")
    require(branch == "main" and re.fullmatch(r"[a-f0-9]{40}", commit), "A main SHA is required.")
    build_id(identifier)
    require((mode == "apply") == bool(plan_build_id), "Only apply requires a plan build ID.")
    if plan_build_id:
        build_id(plan_build_id)
    policy, selected, directory = registry(root, target)
    fingerprint = configuration_hash(root, directory)
    version = policy["terraform_version"]
    require(
        json.loads(command([terraform, "version", "-json"], directory))["terraform_version"]
        == version,
        "Installed Terraform version does not match policy.",
    )
    api = api or GoogleAPI(policy)
    verify_build(
        api, policy, selected, mode, identifier, commit, target=target, plan_build_id=plan_build_id
    )
    moment = now or datetime.now(UTC)
    bucket = policy["plan_bucket"]
    prefix = f"plans/{target}/{plan_build_id or identifier}/"
    state_name = selected["state_prefix"] + "/default.tfstate"

    def generation():
        return api.state_generation(policy["state_bucket"], state_name)

    observed = generation() if mode == "apply" else None
    manifest = None
    if mode == "apply":
        verify_build(
            api, policy, selected, "plan", plan_build_id, commit, target=target, producer=True
        )
        metadata = api.object_metadata(bucket, prefix + "manifest.json")
        manifest = json.loads(
            api.download(bucket, prefix + "manifest.json", metadata["generation"])
        )
        require(
            manifest.get("schema_version") == 1
            and manifest.get("project_id") == policy["project_id"]
            and manifest.get("target") == target
            and manifest.get("commit") == commit
            and manifest.get("producer_build_id") == plan_build_id
            and manifest.get("terraform_version") == version
            and manifest.get("configuration_sha256") == fingerprint
            and manifest.get("state_generation") == observed,
            "The reviewed plan does not match this source, toolchain, target, or current state.",
        )
        age = (moment - datetime.fromisoformat(manifest["created_at"])).total_seconds()
        require(
            0 <= age <= policy["max_plan_age_seconds"],
            "The reviewed plan is stale or future-dated.",
        )

    command(
        [
            terraform,
            "init",
            "-input=false",
            "-lockfile=readonly",
            f"-backend-config=bucket={policy['state_bucket']}",
            f"-backend-config=prefix={selected['state_prefix']}",
        ],
        directory,
    )
    command([terraform, "validate", "-no-color"], directory)
    if mode == "plan":
        # Backend initialization may create the first empty state object. Bind
        # the plan to that initialized state, not to a pre-init absence.
        observed = generation()
    with tempfile.TemporaryDirectory(prefix="folioview-terraform-") as temporary:
        binary = Path(temporary) / "terraform.tfplan"
        if mode == "plan":
            command(
                [
                    terraform,
                    "plan",
                    "-input=false",
                    "-lock-timeout=60s",
                    "-detailed-exitcode",
                    f"-out={binary}",
                ],
                directory,
                allowed=(0, 2),
            )
            summary = plan_summary(
                json.loads(command([terraform, "show", "-json", str(binary)], directory)), version
            )
            text = command([terraform, "show", "-no-color", str(binary)], directory)
            require(generation() == observed, "State changed while planning; create a fresh plan.")
            artifacts = {
                name: api.upload(bucket, prefix + name, data)
                for name, data in {
                    "terraform.tfplan": binary.read_bytes(),
                    "plan.txt": text,
                }.items()
            }
            manifest = {
                "schema_version": 1,
                "project_id": policy["project_id"],
                "target": target,
                "commit": commit,
                "producer_build_id": identifier,
                "created_at": moment.isoformat(),
                "terraform_version": version,
                "configuration_sha256": fingerprint,
                "state_generation": observed,
                "artifacts": artifacts,
            }
            api.upload(
                bucket, prefix + "manifest.json", json.dumps(manifest, sort_keys=True).encode()
            )
            print(summary)
            print(f"Private review artifacts: gs://{bucket}/{prefix}")
        else:
            for name in ("terraform.tfplan", "plan.txt"):
                artifact = manifest["artifacts"][name]
                require(
                    re.fullmatch(r"[1-9][0-9]*", artifact["generation"])
                    and re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]),
                    "Invalid plan artifact metadata.",
                )
                data = api.download(bucket, prefix + name, artifact["generation"])
                require(
                    hashlib.sha256(data).hexdigest() == artifact["sha256"], "Plan digest mismatch."
                )
                if name == "terraform.tfplan":
                    binary.write_bytes(data)
            require(generation() == observed, "State changed before apply; create a fresh plan.")
            try:
                command(
                    [terraform, "apply", "-input=false", "-lock-timeout=60s", str(binary)],
                    directory,
                )
            except (TerraformCommandError, OSError) as error:
                preserve_failure(api, bucket, f"recovery/{target}/{identifier}/", directory, error)
                raise
            print(f"Applied the approved saved plan from build {plan_build_id}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("plan", "apply"))
    parser.add_argument("--target", required=True)
    parser.add_argument("--build-id", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--plan-build-id")
    parser.add_argument("--terraform", default="terraform")
    args = parser.parse_args()
    run(
        args.mode,
        args.target,
        args.build_id,
        args.commit,
        args.branch,
        plan_build_id=args.plan_build_id,
        terraform=args.terraform,
    )


if __name__ == "__main__":
    main()
