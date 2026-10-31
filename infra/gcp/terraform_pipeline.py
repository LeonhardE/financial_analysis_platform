"""Plan privately, then apply the exact reviewed plan from an approved Cloud Build.

The committed catalog selects target/source contracts. Explicitly migrated
targets bind instance inputs to actual managed-trigger metadata; legacy targets
keep committed instance policy. This runner never provisions its own bootstrap,
accepts ad-hoc Terraform arguments, prints plan values, or replans during apply.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import deployment_profile as deployments  # noqa: E402

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


def instance_target(instance):
    name, project = instance["target"], instance["project"]["id"]
    prefix = "fa-infra" if name == "repo" else "fa-infra-" + name
    return {
        "state_bucket": f"{project}-tfstate" + ("" if name == "repo" else "-" + name),
        "state_prefix": "prod/" + name,
        **{f"{phase}_trigger": f"terraform-{phase}-{name}" for phase in ("plan", "apply")},
        **{
            f"{phase}_service_account": f"{prefix}-{phase}@{project}.iam.gserviceaccount.com"
            for phase in ("plan", "apply")
        },
    }


def require_trust_consumer(directory, target="user"):
    """Explicit source opt-in prevents Terraform ignoring an undeclared trust variable."""
    marker = directory / f"{target}-hub-trust.consumer.json"
    message = (
        f"{target.title()} source has not adopted the reviewed {target.title()}/Hub trust contract."
    )
    try:
        require(marker.is_file() and not marker.is_symlink(), message)
        with marker.open("rb") as source:
            data = source.read(513)
        require(0 < len(data) <= 512, message)
        value = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=deployments.unique_pairs,
            parse_constant=deployments.reject_constant,
        )
        require(type(value) is dict and type(value.get("schemaVersion")) is int, message)
        require(
            value
            == {
                "schemaVersion": 1,
                "target": target,
                "trustContract": f"{target}-hub-trust.v1",
                "terraformVariable": "hub_trust",
            },
            message,
        )
    except (OSError, ValueError, TypeError, RecursionError):
        raise RuntimeError(message) from None


require_user_hub_trust_consumer = require_trust_consumer


def require_web_owner_consumer(directory):
    marker = directory / "web-owner.consumer.json"
    message = "Web source has not adopted the reviewed owner configuration contract."
    try:
        require(marker.is_file() and not marker.is_symlink(), message)
        with marker.open("rb") as source:
            data = source.read(513)
        require(0 < len(data) <= 512, message)
        value = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=deployments.unique_pairs,
            parse_constant=deployments.reject_constant,
        )
        require(type(value) is dict and type(value.get("schemaVersion")) is int, message)
        require(
            value
            == {
                "schemaVersion": 1,
                "target": "web",
                "configurationContract": "web-owner.v1",
                "terraformVariable": "owner_environment",
            },
            message,
        )
    except (OSError, ValueError, TypeError, RecursionError):
        raise RuntimeError(message) from None


def registry(root, target, instance=None):
    policy = json.loads((root / POLICY).read_text())
    require(isinstance(policy, dict), "Pipeline policy must be an object.")
    require(policy.get("schema_version") == 2, "Unsupported pipeline policy schema.")
    require(isinstance(policy.get("targets"), dict), "Pipeline targets must be an object.")
    project = policy.get("project_id")
    if instance is not None:
        instance = deployments.parse_target(deployments.canonical(instance))
        require(instance["target"] == target, "Deployment instance belongs to another target.")
    seen = {
        field: set()
        for field in ("directory", "state_bucket", "state_prefix", "identity", "trigger")
    }
    for name, entry in policy["targets"].items():
        require(isinstance(entry, dict), "Target policy must be an object.")
        require(
            re.fullmatch(r"[a-z]([a-z0-9-]{0,13}[a-z0-9])?", name)
            and name not in ("bootstrap", "shared"),
            "Invalid or reserved target identifier.",
        )
        require(type(entry.get("enabled")) is bool, "Target activation must be explicit.")
        source = entry.get("deployment_source", "committed-v2")
        require(
            source in {"committed-v2", "trigger-v1", "inactive-v1"},
            "Unsupported deployment source.",
        )
        neutral = source in {"trigger-v1", "inactive-v1"}
        if source == "inactive-v1":
            require(
                name == "agent-hub" and not entry["enabled"],
                "Inactive deployment source is reserved for disabled Agent Hub.",
            )
        if neutral:
            require(
                set(entry)
                <= {
                    "enabled",
                    "directory",
                    "configuration_controllers",
                    "deployment_source",
                    "state_prefix",
                    "plan_trigger",
                    "apply_trigger",
                },
                "Static trigger-managed policy cannot contain deployment instance fields.",
            )
        require(
            entry.get("directory") == f"infra/gcp/terraform/envs/prod/{name}",
            "Target directory must match its target.",
        )
        if source == "committed-v2":
            require(isinstance(project, str) and project, "Legacy instance policy is required.")
            expected = {
                "state_prefix": f"prod/{name}",
                "state_bucket": policy["state_bucket"]
                if name == "repo"
                else f"{project}-tfstate-{name}",
            }
        else:
            expected = {"state_prefix": f"prod/{name}"}
            if name == target and instance is not None:
                expected.update(instance_target(instance))
        for field, value in expected.items():
            require(
                (neutral and field not in entry) or entry.get(field) == value,
                "Target execution input does not match its deployment instance.",
            )
        controllers = entry.get("configuration_controllers")
        require(
            isinstance(controllers, list)
            and len(controllers) <= 1
            and all(
                isinstance(address, str)
                and re.fullmatch(
                    r"module\.[a-z_][a-z0-9_]*\.terraform_data\.configuration", address
                )
                for address in controllers
            ),
            "Only one exact shared configuration controller may be registered per target.",
        )
        require(
            name != "repo" or not controllers,
            "Repo cannot replace service configuration controllers.",
        )
        for phase in ("plan", "apply"):
            account = f"fa-infra-{phase}" if name == "repo" else f"fa-infra-{name}-{phase}"
            if source == "committed-v2":
                require(
                    entry.get(f"{phase}_service_account")
                    == f"{account}@{project}.iam.gserviceaccount.com",
                    "Execution identity must match its target and phase.",
                )
            require(
                (neutral and f"{phase}_trigger" not in entry)
                or entry.get(f"{phase}_trigger") == f"terraform-{phase}-{name}",
                "Execution trigger must match its target and phase.",
            )
            for field, value in (
                ("identity", entry.get(f"{phase}_service_account")),
                ("trigger", entry.get(f"{phase}_trigger")),
            ):
                if value is None and neutral:
                    continue
                require(
                    value not in seen[field],
                    "Execution targets must not share identities or triggers.",
                )
                seen[field].add(value)
        for field in ("directory", "state_bucket", "state_prefix"):
            if field not in entry and neutral:
                continue
            require(
                entry[field] not in seen[field],
                "Execution targets must have isolated state and roots.",
            )
            seen[field].add(entry[field])
    require(target in policy["targets"], "Target is not registered in the pipeline policy.")
    selected = policy["targets"][target]
    require(selected["enabled"], "Target is disabled; complete its reviewed adoption first.")
    if instance is not None:
        require(
            selected.get("deployment_source") == "trigger-v1", "Target is not instance-managed."
        )
        project = instance["project"]["id"]
        selected = {**selected, **instance_target(instance)}
        policy = {
            **policy,
            "project_id": project,
            "project_number": instance["project"]["number"],
            "region": instance["region"],
            "repository_url": instance["source"]["repositoryUrl"],
            "repository_resource": instance["source"]["repositoryResource"],
            "terraform_version": json.loads(
                (root / "infra/gcp/terraform/toolchain.json").read_text()
            )["terraform_version"],
            "state_bucket": f"{project}-tfstate",
            "plan_bucket": f"{project}-tfplans",
            "max_plan_age_seconds": deployments.MAX_PLAN_AGE_SECONDS,
            "deployment": instance,
        }
    directory = (root / selected["directory"]).resolve()
    allowed = (root / "infra/gcp/terraform/envs/prod").resolve()
    require(directory.is_relative_to(allowed) and directory != allowed, "Invalid target directory.")
    require(directory == root / selected["directory"], "Target roots must not use symlinks.")
    require(directory.is_dir(), "The registered Terraform directory does not exist.")
    if "state_prefix" in selected:
        require(
            re.fullmatch(r"prod/[a-z][a-z0-9-]*", selected["state_prefix"]), "Invalid state prefix."
        )
    if instance is not None and "userHubTrust" in instance:
        require_trust_consumer(directory)
    if instance is not None and "portfolioHubTrust" in instance:
        require_trust_consumer(directory, "portfolio")
    if instance is not None and "webOwner" in instance:
        require_web_owner_consumer(directory)
    return policy, selected, directory


def configuration_hash(root, directory, instance=None):
    files = {
        root / POLICY,
        root / "infra/gcp/terraform_pipeline.py",
        root / "infra/gcp/deployment_profile.py",
        root / "infra/gcp/configure_cloud_run_service.py",
        root / "infra/gcp/deploy_existing_service.py",
        # The configuration writer imports release constants; the release module
        # now imports this registry code. Bind those executable dependencies too.
        root / "scripts/service_targets.py",
        root / "scripts/service-targets.json",
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
    if instance is not None:
        for name, value in (
            (b"deployment-instance-v1", instance),
            (b"deployment-inputs-v1", deployments.terraform_inputs(instance)),
        ):
            data = deployments.canonical(value)
            digest.update(len(name).to_bytes(8) + name + len(data).to_bytes(8) + data)
    return digest.hexdigest()


def instance_manifest(instance):
    if instance is None:
        return {}
    return {
        "instance_id": instance["instanceId"],
        "deployment_sha256": deployments.digest(instance),
        "deployment_inputs_sha256": deployments.digest(deployments.terraform_inputs(instance)),
    }


def trigger_instance(api, identifier, target, project, region):
    build = api.build(identifier)
    trigger = api.trigger(build_id(build.get("buildTriggerId")))
    source = trigger.get("substitutions", {})
    body = source.get("_DEPLOYMENT_CONFIG")
    require(type(body) is str, "Managed deployment configuration is required.")
    instance = deployments.parse_target(body.encode("utf-8"))
    require(
        instance["target"] == target
        and instance["project"]["id"] == project
        and instance["region"] == region,
        "Deployment configuration does not match the located build.",
    )
    verify_instance_metadata(build, trigger, instance)
    return instance


def verify_instance_metadata(build, trigger, instance):
    expected = {
        "_DEPLOYMENT_CONFIG": deployments.canonical(instance).decode("ascii"),
        "_DEPLOYMENT_SHA256": deployments.digest(instance),
    }
    require(
        all(
            metadata.get("substitutions", {}).get(name) == value
            for metadata in (build, trigger)
            for name, value in expected.items()
        ),
        "Managed deployment configuration is missing, changed, or overridden.",
    )


def verify_build(
    api,
    policy,
    selected,
    mode,
    identifier,
    commit,
    *,
    target,
    plan_build_id=None,
    producer=False,
    repair_controller=None,
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
    instance = policy.get("deployment")
    if instance is not None:
        expected_trigger = instance["adoption"][f"{mode}TriggerId"]
        require(
            build.get("buildTriggerId") == expected_trigger
            and trigger.get("id") == expected_trigger,
            "Execution trigger identity differs from the adopted instance.",
        )
        verify_instance_metadata(build, trigger, instance)
    filenames = [trigger.get("filename"), trigger.get("gitFileSource", {}).get("path")]
    require(
        trigger.get("name") == selected[f"{mode}_trigger"]
        and trigger.get("substitutions", {}).get("_TARGET") == target
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
        repair = substitutions.get("_REPAIR_CONTROLLER", "")
        require(
            isinstance(repair, str)
            and (not repair or repair in selected.get("configuration_controllers", [])),
            "Plan repair must name the target's registered configuration controller.",
        )
        require(
            producer or repair == (repair_controller or ""),
            "Plan repair does not match build metadata.",
        )
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
    if instance is not None:
        require(
            expected_repository == repository_identity(policy["repository_resource"]),
            "Execution source differs from the instance repository.",
        )
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


def configuration_replacement(resource, plan, selected, directory, root):
    """Only the reviewed shared controller has a non-destructive replacement path."""
    address = resource.get("address", "")
    if address not in (selected or {}).get("configuration_controllers", []):
        return False
    if not (
        resource.get("mode") == "managed"
        and resource.get("type") == "terraform_data"
        and resource.get("name") == "configuration"
        and resource.get("provider_name") == "terraform.io/builtin/terraform"
        and resource.get("change", {}).get("actions") == ["delete", "create"]
        and directory is not None
    ):
        return False
    label = address.split(".")[1]
    call = (
        plan.get("configuration", {}).get("root_module", {}).get("module_calls", {}).get(label, {})
    )
    source = call.get("source", "")
    return (
        isinstance(source, str)
        and source.startswith(".")
        and (directory / source).resolve()
        == (root / "infra/gcp/terraform/modules/cloud-run-service").resolve()
    )


def plan_summary(plan, version, selected=None, directory=None, root=ROOT):
    require(plan.get("terraform_version") == version, "Plan Terraform version does not match.")
    lines = []
    for resource in plan.get("resource_changes", []):
        actions = resource["change"]["actions"]
        if "delete" in actions and configuration_replacement(
            resource, plan, selected, directory, root
        ):
            lines.append(
                f"{resource['address']}: replace local configuration controller (service retained)"
            )
            continue
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
    repair_controller=None,
    project=None,
    region=None,
):
    root = root.resolve()
    require(mode in ("plan", "apply"), "Unsupported pipeline operation.")
    require(branch == "main" and re.fullmatch(r"[a-f0-9]{40}", commit), "A main SHA is required.")
    build_id(identifier)
    require((mode == "apply") == bool(plan_build_id), "Only apply requires a plan build ID.")
    if plan_build_id:
        build_id(plan_build_id)
    policy, selected, directory = registry(root, target)
    external = selected.get("deployment_source") == "trigger-v1"
    if external:
        require(
            type(project) is str
            and deployments.PROJECT.fullmatch(project)
            and type(region) is str
            and deployments.REGION.fullmatch(region),
            "Instance-managed execution requires explicit project and region locators.",
        )
        version = json.loads((root / "infra/gcp/terraform/toolchain.json").read_text())[
            "terraform_version"
        ]
    else:
        require(
            project in (None, policy["project_id"]) and region in (None, policy["region"]),
            "Execution locators differ from committed legacy policy.",
        )
        version = policy["terraform_version"]
    require(
        not repair_controller
        or (mode == "plan" and repair_controller in selected["configuration_controllers"]),
        "Repair is allowed only for a registered configuration controller during plan.",
    )
    # Validate all checked-in source constraints before requesting credentials.
    configuration_hash(root, directory)
    require(
        json.loads(command([terraform, "version", "-json"], directory))["terraform_version"]
        == version,
        "Installed Terraform version does not match policy.",
    )
    api = api or GoogleAPI({"project_id": project, "region": region} if external else policy)
    instance = None
    if external:
        instance = trigger_instance(api, identifier, target, project, region)
        policy, selected, directory = registry(root, target, instance)
    fingerprint = configuration_hash(root, directory, instance)
    verify_build(
        api,
        policy,
        selected,
        mode,
        identifier,
        commit,
        target=target,
        plan_build_id=plan_build_id,
        repair_controller=repair_controller,
    )
    moment = now or datetime.now(UTC)
    bucket = policy["plan_bucket"]
    prefix = f"plans/{target}/{plan_build_id or identifier}/"
    state_name = selected["state_prefix"] + "/default.tfstate"
    state_bucket = selected["state_bucket"]

    def generation():
        return api.state_generation(state_bucket, state_name)

    observed = generation() if mode == "apply" else None
    manifest = None
    if mode == "apply":
        producer = verify_build(
            api, policy, selected, "plan", plan_build_id, commit, target=target, producer=True
        )
        metadata = api.object_metadata(bucket, prefix + "manifest.json")
        manifest = json.loads(
            api.download(bucket, prefix + "manifest.json", metadata["generation"])
        )
        require(
            manifest.get("schema_version") == 2
            and manifest.get("project_id") == policy["project_id"]
            and manifest.get("target") == target
            and manifest.get("commit") == commit
            and manifest.get("producer_build_id") == plan_build_id
            and manifest.get("terraform_version") == version
            and manifest.get("configuration_sha256") == fingerprint
            and manifest.get("state_generation") == observed,
            "The reviewed plan does not match this source, toolchain, target, or current state.",
        )
        require(
            all(manifest.get(name) == value for name, value in instance_manifest(instance).items()),
            "The reviewed plan belongs to a different deployment configuration.",
        )
        require(
            manifest.get("state_bucket") == state_bucket
            and manifest.get("state_prefix") == selected["state_prefix"]
            and manifest.get("repair_controller", "")
            == producer.get("substitutions", {}).get("_REPAIR_CONTROLLER", ""),
            "The reviewed plan backend or repair request does not match this target.",
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
            f"-backend-config=bucket={state_bucket}",
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
            variables = []
            if instance is not None:
                inputs_file = Path(temporary) / "deployment.tfvars.json"
                with inputs_file.open("xb") as output:
                    os.chmod(output.name, 0o600)
                    output.write(deployments.canonical(deployments.terraform_inputs(instance)))
                variables = [f"-var-file={inputs_file}"]
            command(
                [
                    terraform,
                    "plan",
                    "-input=false",
                    "-lock-timeout=60s",
                    "-detailed-exitcode",
                    f"-out={binary}",
                    *variables,
                    *([f"-replace={repair_controller}"] if repair_controller else []),
                ],
                directory,
                allowed=(0, 2),
            )
            summary = plan_summary(
                json.loads(command([terraform, "show", "-json", str(binary)], directory)),
                version,
                selected,
                directory,
                root,
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
                "schema_version": 2,
                "project_id": policy["project_id"],
                "target": target,
                "commit": commit,
                "producer_build_id": identifier,
                "created_at": moment.isoformat(),
                "terraform_version": version,
                "configuration_sha256": fingerprint,
                "state_generation": observed,
                "state_bucket": state_bucket,
                "state_prefix": selected["state_prefix"],
                "repair_controller": repair_controller or "",
                "artifacts": artifacts,
                **instance_manifest(instance),
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
            # Recheck the exact downloaded binary, not only the producer's text
            # summary. This uses the same target/controller destruction guard.
            plan_summary(
                json.loads(command([terraform, "show", "-json", str(binary)], directory)),
                version,
                selected,
                directory,
                root,
            )
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
    parser.add_argument("mode", choices=("plan", "apply", "check-registry"))
    parser.add_argument("--target")
    parser.add_argument("--build-id")
    parser.add_argument("--commit")
    parser.add_argument("--branch")
    parser.add_argument("--plan-build-id")
    parser.add_argument("--terraform", default="terraform")
    parser.add_argument("--repair-controller", default="")
    parser.add_argument("--project")
    parser.add_argument("--region")
    args = parser.parse_args()
    if args.mode == "check-registry":
        policy, _, _ = registry(ROOT, "repo")
        for target, selected in policy["targets"].items():
            if selected["enabled"]:
                _, _, directory = registry(ROOT, target)
                configuration_hash(ROOT, directory)
        print(
            "Execution registry is valid; enabled targets: "
            + ", ".join(name for name, entry in policy["targets"].items() if entry["enabled"])
        )
        return
    for field in ("target", "build_id", "commit", "branch"):
        if not getattr(args, field):
            parser.error(f"--{field.replace('_', '-')} is required for {args.mode}.")
    run(
        args.mode,
        args.target,
        args.build_id,
        args.commit,
        args.branch,
        plan_build_id=args.plan_build_id,
        terraform=args.terraform,
        repair_controller=args.repair_controller,
        project=args.project,
        region=args.region,
    )


if __name__ == "__main__":
    main()
