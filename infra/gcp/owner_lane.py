"""Independent Owner saved-plan execution; never consult the ordinary operator catalog.

inspect is credential-free. plan/apply are future administrator-trigger operations,
not commands run by source CI or by inspection. Live contracts come exclusively
from actual protected trigger metadata, never a request file or substitutions.
"""

import argparse
import hashlib
import json
import re
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import terraform_pipeline as common  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CONFIGS = {mode: f"infra/gcp/cloudbuild.owner-{mode}.yaml" for mode in ("plan", "apply")}
PROJECT = r"[a-z][a-z0-9-]{4,28}[a-z0-9]"
REGION = r"[a-z]+(?:-[a-z0-9]+)+[0-9]"
TARGET = r"[a-z][a-z0-9-]{0,28}[a-z0-9]"


def require(value):
    if not value:
        raise ValueError("Invalid independent Owner lane or stale execution evidence.")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result)
        result[key] = value
    return result


def parse(raw, maximum=4000):
    require(type(raw) is bytes and 0 < len(raw) <= maximum)
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: require(False))
    except (ValueError, UnicodeError, RecursionError):
        raise ValueError("Invalid independent Owner lane or stale execution evidence.") from None


def closed(value, fields):
    require(type(value) is dict and set(value) == set(fields))


def schema(value, spec, depth=0):
    """Small closed public-input schema owned by the selected target's source."""
    require(depth <= 12 and type(spec) is dict)
    if value is None and spec.get("nullable") is True:
        return
    kind = spec["type"]
    if kind == "object":
        require(type(value) is dict)
        fields = spec["properties"]
        require(set(value) <= set(fields) and set(spec.get("required", fields)) <= set(value))
        for key, item in value.items():
            schema(item, fields[key], depth + 1)
    elif kind == "array":
        require(type(value) is list and spec.get("min", 0) <= len(value) <= spec["max"])
        require(len({canonical(item) for item in value}) == len(value))
        for item in value:
            schema(item, spec["items"], depth + 1)
    elif kind == "string":
        require(type(value) is str and 0 < len(value) <= spec["max"] and "$" not in value)
        if "pattern" in spec:
            require(re.fullmatch(spec["pattern"], value, flags=re.ASCII) is not None)
    elif kind == "boolean":
        require(type(value) is bool)
    elif kind == "integer":
        require(type(value) is int and spec["min"] <= value <= spec["max"])
    else:
        require(False)
    if "enum" in spec:
        require(value in spec["enum"])


def consumer(root, target):
    require(type(target) is str and re.fullmatch(TARGET, target) is not None)
    require(target not in {"repo", "web", "shared", "bootstrap"})
    directory = root / f"infra/gcp/terraform/envs/prod/{target}"
    marker = directory / "owner-lane.consumer.json"
    require(marker.is_file() and not marker.is_symlink())
    value = parse(marker.read_bytes(), 65536)
    closed(value, ["schemaVersion", "target", "inputs", "controllers", "replacement"])
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
    require(value["target"] == target and len(value["controllers"]) <= 1)
    require(directory.resolve() == directory and (directory / ".terraform.lock.hcl").is_file())
    for address in value["controllers"]:
        require(
            re.fullmatch(
                r"module\.[a-z_][a-z0-9_]*(?:\[0\])?\.terraform_data\.configuration", address
            )
        )
    return directory, value


def contract(raw, root=ROOT):
    value = parse(raw)
    closed(
        value,
        [
            "schemaVersion",
            "target",
            "projectId",
            "projectNumber",
            "region",
            "repository",
            "repositoryUrl",
            "inputs",
        ],
    )
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
    for key, pattern in [
        ("projectId", PROJECT),
        ("projectNumber", r"[1-9][0-9]{5,19}"),
        ("region", REGION),
    ]:
        require(type(value[key]) is str and re.fullmatch(pattern, value[key]))
    require(
        re.fullmatch(
            r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git", value["repositoryUrl"]
        )
    )
    prefix = (
        f"projects/({value['projectId']}|{value['projectNumber']})/locations/{value['region']}/"
    )
    require(re.fullmatch(prefix + r"connections/[\w.-]+/repositories/[\w.-]+", value["repository"]))
    directory, adopted = consumer(root, value["target"])
    schema(value["inputs"], adopted["inputs"])
    deployment = value["inputs"]["deployment"]
    require(
        deployment["project_id"] == value["projectId"] and deployment["region"] == value["region"]
    )
    require(raw == canonical(value) and all(32 <= byte <= 126 for byte in raw) and b"$" not in raw)
    return value, directory, adopted


def fingerprint(root, directory, lane):
    files = {
        root / name
        for name in [
            "infra/gcp/owner_lane.py",
            "infra/gcp/terraform_pipeline.py",
            "infra/gcp/deployment_profile.py",
            "infra/gcp/terraform_tools.py",
            "infra/gcp/terraform/toolchain.json",
            *CONFIGS.values(),
        ]
    }
    for base in [directory, root / "infra/gcp/terraform/modules"]:
        for path in base.rglob("*"):
            if set(path.relative_to(base).parts) & {".terraform", ".deployment", "__pycache__"}:
                continue
            require(not path.is_symlink())
            if path.is_file():
                require(
                    not path.name.endswith((".tfvars", ".tfvars.json"))
                    and path.name != "terraform.rc"
                )
                files.add(path)
    result = hashlib.sha256(canonical(lane))
    for path in sorted(files):
        require(path.is_file() and not path.is_symlink())
        name = path.relative_to(root).as_posix().encode()
        body = path.read_bytes()
        result.update(len(name).to_bytes(8, "big") + name + len(body).to_bytes(8, "big") + body)
    return result.hexdigest()


def execution(api, identifier, lane, mode, commit, producer=False, plan_id=None):
    build = api.build(common.build_id(identifier))
    trigger = api.trigger(common.build_id(build.get("buildTriggerId")))
    require(trigger.get("id") == build["buildTriggerId"])
    substitutions = build.get("substitutions", {})
    expected = {
        "_TARGET": lane["target"],
        "_OWNER_LANE": canonical(lane).decode(),
        "_OWNER_LANE_SHA256": digest(lane),
    }
    require(
        all(
            record.get("substitutions", {}).get(k) == v
            for record in [build, trigger]
            for k, v in expected.items()
        )
    )
    require(build.get("id") == identifier and build.get("projectId") == lane["projectId"])
    require(build.get("status") == ("SUCCESS" if producer else "WORKING"))
    require(
        substitutions.get("COMMIT_SHA") == commit and substitutions.get("BRANCH_NAME") == "main"
    )
    account = f"fv-owner-{mode}@{lane['projectId']}.iam.gserviceaccount.com"
    pattern = (
        rf"projects/({lane['projectId']}|{lane['projectNumber']}|-)/"
        rf"serviceAccounts/{re.escape(account)}"
    )
    require(
        all(re.fullmatch(pattern, record.get("serviceAccount", "")) for record in [build, trigger])
    )
    require(trigger.get("name") == f"owner-{mode}-{lane['target']}")
    require(trigger.get("disabled", False) is False)
    if mode == "plan":
        require(trigger.get("filename") == CONFIGS[mode])
        source = trigger.get("repositoryEventConfig", {})
        require(source.get("repository") == lane["repository"])
        require(source.get("push") == {"branch": "^main$"})
    else:
        require(substitutions.get("_PLAN_BUILD_ID") == plan_id)
        source = trigger.get("sourceToBuild", {})
        code = trigger.get("gitFileSource", {})
        require(
            source.get("repository") == lane["repository"]
            and source.get("ref") == "refs/heads/main"
        )
        require(
            code.get("repository") == lane["repository"]
            and code.get("revision") == "refs/heads/main"
            and code.get("path") == CONFIGS[mode]
        )
        require(trigger.get("approvalConfig", {}).get("approvalRequired") is True)
        require(build.get("approval", {}).get("result", {}).get("decision") == "APPROVED")
    resolved = {
        key: item
        for key, item in build.get("sourceProvenance", {}).items()
        if key.startswith("resolved") and item
    }
    require(len(resolved) == 1)
    kind, source = next(iter(resolved.items()))
    require(kind in {"resolvedConnectedRepository", "resolvedGitSource"})
    require(source.get("revision") == commit and not source.get("dir"))
    require(
        source.get("repository") == lane["repository"]
        if kind == "resolvedConnectedRepository"
        else source.get("url") == lane["repositoryUrl"]
    )
    return build


def summary(plan, version, lane, adopted, directory, root):
    require(plan.get("terraform_version") == version)
    messages = []
    for resource in plan.get("resource_changes", []):
        change = resource["change"]
        actions = change["actions"]
        if "delete" in actions:
            # Only source-registered local config controllers can be replaced.
            # A VM replacement requires a separate target-owned explicit review.
            address = resource.get("address", "")
            require(address in adopted["controllers"] and actions == ["delete", "create"])
            require(
                resource.get("type") == "terraform_data"
                and resource.get("provider_name") == "terraform.io/builtin/terraform"
            )
            label = address.split(".")[1].removesuffix("[0]")
            module = (
                plan.get("configuration", {})
                .get("root_module", {})
                .get("module_calls", {})
                .get(label, {})
            )
            source = module.get("source", "")
            require(
                source.startswith(".")
                and (directory / source).resolve()
                == root / "infra/gcp/terraform/modules/cloud-run-service"
            )
        else:
            require(actions in [["no-op"], ["create"], ["read"], ["update"]])
        if actions != ["no-op"]:
            messages.append(f"{resource['address']}: {','.join(actions)}")
    return "\n".join(messages) or "No resource changes."


def run(
    mode,
    target,
    identifier,
    commit,
    branch,
    project,
    region,
    *,
    plan_id=None,
    terraform="terraform",
    root=ROOT,
    api=None,
    now=None,
):
    require(
        mode in {"plan", "apply"} and branch == "main" and re.fullmatch(r"[a-f0-9]{40}", commit)
    )
    common.build_id(identifier)
    require((mode == "apply") == bool(plan_id))
    consumer(root, target)  # Refuse unadopted targets before credentials.
    require(re.fullmatch(PROJECT, project) and re.fullmatch(REGION, region))
    api = api or common.GoogleAPI({"project_id": project, "region": region})
    current = api.build(identifier)
    trigger = api.trigger(common.build_id(current.get("buildTriggerId")))
    lane, directory, adopted = contract(
        trigger.get("substitutions", {}).get("_OWNER_LANE", "").encode(), root
    )
    require(lane["target"] == target and lane["projectId"] == project and lane["region"] == region)
    execution(api, identifier, lane, mode, commit, plan_id=plan_id)
    version = json.loads((root / "infra/gcp/terraform/toolchain.json").read_text())[
        "terraform_version"
    ]
    require(
        json.loads(common.command([terraform, "version", "-json"], directory))["terraform_version"]
        == version
    )
    source_hash = fingerprint(root, directory, lane)
    bucket, state_bucket = f"{project}-owner-tfplans", f"{project}-owner-tfstate"
    state_prefix = f"prod/{target}"
    state_name = state_prefix + "/default.tfstate"

    def generation():
        return api.state_generation(state_bucket, state_name)

    prefix = f"plans/{target}/{plan_id or identifier}/"
    moment = now or datetime.now(UTC)
    observed = generation()
    expected = {
        "schemaVersion": 1,
        "target": target,
        "projectId": project,
        "commit": commit,
        "terraformVersion": version,
        "sourceSha256": source_hash,
        "laneSha256": digest(lane),
        "stateBucket": state_bucket,
        "statePrefix": state_prefix,
        "stateGeneration": observed,
    }
    manifest = None
    if mode == "apply":
        execution(api, plan_id, lane, "plan", commit, producer=True)
        metadata = api.object_metadata(bucket, prefix + "manifest.json")
        manifest = parse(
            api.download(bucket, prefix + "manifest.json", metadata["generation"]), 16384
        )
        require(all(manifest.get(key) == value for key, value in expected.items()))
        require(manifest.get("producerBuildId") == plan_id)
        age = (moment - datetime.fromisoformat(manifest["createdAt"])).total_seconds()
        require(0 <= age <= 21600)
    common.command(
        [
            terraform,
            "init",
            "-input=false",
            "-lockfile=readonly",
            f"-backend-config=bucket={state_bucket}",
            f"-backend-config=prefix={state_prefix}",
        ],
        directory,
    )
    common.command([terraform, "validate", "-no-color"], directory)
    with tempfile.TemporaryDirectory(prefix="owner-lane-") as temporary:
        binary = Path(temporary) / "terraform.tfplan"
        if mode == "plan":
            observed = generation()
            variables = Path(temporary) / "inputs.tfvars.json"
            variables.write_bytes(canonical(lane["inputs"]))
            variables.chmod(0o600)
            common.command(
                [
                    terraform,
                    "plan",
                    "-input=false",
                    "-lock-timeout=60s",
                    "-detailed-exitcode",
                    f"-out={binary}",
                    f"-var-file={variables}",
                ],
                directory,
                allowed=(0, 2),
            )
            plan = json.loads(common.command([terraform, "show", "-json", str(binary)], directory))
            description = summary(plan, version, lane, adopted, directory, root)
            text = common.command([terraform, "show", "-no-color", str(binary)], directory)
            require(generation() == observed)
            artifacts = {
                name: api.upload(bucket, prefix + name, body)
                for name, body in {
                    "terraform.tfplan": binary.read_bytes(),
                    "plan.txt": text,
                }.items()
            }
            api.upload(
                bucket,
                prefix + "manifest.json",
                canonical(
                    {
                        **expected,
                        "stateGeneration": observed,
                        "createdAt": moment.isoformat(),
                        "producerBuildId": identifier,
                        "artifacts": artifacts,
                    }
                ),
            )
            print(description)
        else:
            for name in ["terraform.tfplan", "plan.txt"]:
                item = manifest["artifacts"][name]
                require(
                    re.fullmatch(r"[1-9][0-9]*", item["generation"])
                    and re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
                )
                body = api.download(bucket, prefix + name, item["generation"])
                require(hashlib.sha256(body).hexdigest() == item["sha256"])
                if name == "terraform.tfplan":
                    binary.write_bytes(body)
            summary(
                json.loads(common.command([terraform, "show", "-json", str(binary)], directory)),
                version,
                lane,
                adopted,
                directory,
                root,
            )
            require(generation() == observed)
            try:
                common.command(
                    [terraform, "apply", "-input=false", "-lock-timeout=60s", str(binary)],
                    directory,
                )
            except (common.TerraformCommandError, OSError) as error:
                common.preserve_failure(
                    api, bucket, f"recovery/{target}/{identifier}/", directory, error
                )
                raise
            print("Applied one independently approved saved plan.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["inspect", "plan", "apply"])
    parser.add_argument("--target", required=True)
    for field in [
        "contract",
        "build-id",
        "commit",
        "branch",
        "project",
        "region",
        "plan-build-id",
        "terraform",
    ]:
        parser.add_argument("--" + field)
    args = parser.parse_args()
    if args.mode == "inspect":
        require(args.contract is not None)
        lane, directory, _ = contract(Path(args.contract).read_bytes())
        require(lane["target"] == args.target)
        print(
            json.dumps(
                {
                    "target": args.target,
                    "laneSha256": digest(lane),
                    "sourceSha256": fingerprint(ROOT, directory, lane),
                    "deploymentAuthorized": False,
                }
            )
        )
    else:
        require(
            args.contract is None
            and all([args.build_id, args.commit, args.branch, args.project, args.region])
        )
        run(
            args.mode,
            args.target,
            args.build_id,
            args.commit,
            args.branch,
            args.project,
            args.region,
            plan_id=args.plan_build_id,
            terraform=args.terraform or "terraform",
        )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Independent Owner lane refused; private details withheld.") from None
