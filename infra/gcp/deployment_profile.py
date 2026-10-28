"""Validate explicit deployment inputs and render offline, non-activating candidates.

This producer never obtains credentials, calls Google, invokes Terraform, changes
committed policy, or authorizes a deployment. Existing production consumers keep
using their reviewed configuration until separately migrated per target.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
MAX_PROFILE_BYTES = 131_072
MAX_PLAN_AGE_SECONDS = 21_600
TARGET_SERVICES = {
    "repo": None,
    "market": "market-api",
    "user": "user-api",
    "config": "config-api",
    "web": "market-web",
    "portfolio": "portfolio-api",
    "agent-hub": "agent-hub-api",
}
TOP_FIELDS = {
    "schemaVersion",
    "profileId",
    "mode",
    "project",
    "region",
    "source",
    "artifactRepository",
    "state",
    "bootstrapStages",
    "firebase",
    "targets",
}
TARGET_FIELDS = {"enabled", "lifecycle", "origin", "image", "runtimeAccountId", "adoption"}
ADOPTION_FIELDS = {"serviceUid", "buildTriggerId", "planTriggerId", "applyTriggerId"}
SLUG = re.compile(r"[a-z][a-z0-9-]{1,62}\Z")
PROJECT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
REGION = re.compile(r"[a-z]+(?:-[a-z0-9]+)+[0-9]\Z")
ACCOUNT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
DOMAIN = re.compile(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\Z")


class ProfileError(ValueError):
    """Fixed diagnostics: never echo configuration, keys or parser exceptions."""

    def __init__(self):
        super().__init__("Invalid deployment profile or unsafe output destination.")


def require(condition):
    if not condition:
        raise ProfileError


def fields(value, expected):
    require(type(value) is dict and set(value) == set(expected))


def matches(pattern, value):
    require(type(value) is str and pattern.fullmatch(value) is not None)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def reject_constant(_value):
    raise ProfileError


def parse_profile(data):
    require(type(data) is bytes and 0 < len(data) <= MAX_PROFILE_BYTES)
    try:
        value = json.loads(
            data.decode("utf-8"), object_pairs_hook=unique_pairs, parse_constant=reject_constant
        )
        return validate_profile(value)
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise ProfileError from None


def load_profile(path):
    try:
        path = Path(path)
        require(not path.is_symlink() and path.is_file())
        with path.open("rb") as source:
            return parse_profile(source.read(MAX_PROFILE_BYTES + 1))
    except (OSError, ValueError, TypeError):
        raise ProfileError from None


def hostname(value):
    matches(DOMAIN, value)
    require(".." not in value and "." in value and not value.endswith("."))


def origin(value):
    require(type(value) is str and len(value) <= 2048)
    try:
        parsed = urlsplit(value)
        require(parsed.scheme == "https" and parsed.hostname is not None)
        require(not parsed.username and not parsed.password and not parsed.query)
        require(not parsed.fragment and not parsed.path and parsed.port is None)
        hostname(parsed.hostname)
        require(value == "https://" + parsed.hostname)
    except ValueError:
        raise ProfileError from None


def uuid(value):
    try:
        require(type(value) is str and str(UUID(value)) == value)
    except (ValueError, AttributeError):
        raise ProfileError from None


def validate_profile(value):
    """Closed structure and cross-field consistency, not live ownership attestation."""
    try:
        fields(value, TOP_FIELDS)
        require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1)
        matches(SLUG, value["profileId"])
        require(value["mode"] in {"adoption", "fresh_install"})
        fields(value["project"], {"id", "number"})
        project, number = value["project"]["id"], value["project"]["number"]
        matches(PROJECT, project)
        matches(re.compile(r"[1-9][0-9]{5,19}\Z"), number)
        matches(REGION, value["region"])
        region = value["region"]
        matches(SLUG, value["artifactRepository"])
        fields(value["state"], {"bootstrapBucket", "stateBucket", "planBucket"})
        require(
            value["state"]
            == {
                "bootstrapBucket": project + "-tf-bootstrap",
                "stateBucket": project + "-tfstate",
                "planBucket": project + "-tfplans",
            }
        )
        fields(value["source"], {"repositoryUrl", "repositoryResource"})
        source = value["source"]
        matches(
            re.compile(
                r"https://[a-z0-9.-]+/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.git\Z"
            ),
            source["repositoryUrl"],
        )
        parsed = urlsplit(source["repositoryUrl"])
        hostname(parsed.hostname)
        require(not parsed.username and not parsed.password)
        repository_pattern = re.compile(
            rf"projects/(?:{re.escape(project)}|{number})/locations/{region}/"
            r"connections/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/repositories/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z"
        )
        matches(repository_pattern, source["repositoryResource"])
        fields(value["bootstrapStages"], {"portfolio", "agent-hub"})
        require(
            all(
                stage in {"none", "execution", "service"}
                for stage in value["bootstrapStages"].values()
            )
        )
        if value["mode"] == "fresh_install":
            require(set(value["bootstrapStages"].values()) == {"none"})
        fields(value["firebase"], {"enabled", "apiKey", "authDomain", "appId"})
        firebase = value["firebase"]
        require(type(firebase["enabled"]) is bool)
        if firebase["enabled"]:
            matches(re.compile(r"AIza[A-Za-z0-9_-]{35}\Z"), firebase["apiKey"])
            hostname(firebase["authDomain"])
            if firebase["authDomain"].endswith(".firebaseapp.com"):
                require(firebase["authDomain"] == project + ".firebaseapp.com")
            matches(re.compile(rf"1:{number}:web:[a-f0-9]{{16,64}}\Z"), firebase["appId"])
        else:
            require(all(firebase[key] == "" for key in ("apiKey", "authDomain", "appId")))
        fields(value["targets"], TARGET_SERVICES)
        seen_origins, seen_anchors, seen_runtime_accounts = set(), set(), set()
        for name, target in value["targets"].items():
            fields(target, TARGET_FIELDS)
            require(type(target["enabled"]) is bool)
            require(target["lifecycle"] in {"adopt", "create"})
            if value["mode"] == "fresh_install":
                require(target["lifecycle"] == "create")
            if target["lifecycle"] == "create":
                require(target["enabled"] is False and target["adoption"] is None)
            else:
                anchors = target["adoption"]
                fields(anchors, ADOPTION_FIELDS)
                for key, identifier in anchors.items():
                    if name == "repo" and key in {"serviceUid", "buildTriggerId"}:
                        require(identifier is None)
                        continue
                    uuid(identifier)
                    require(identifier not in seen_anchors)
                    seen_anchors.add(identifier)
            if name == "repo":
                require(all(target[key] is None for key in ("origin", "image", "runtimeAccountId")))
                continue
            matches(ACCOUNT, target["runtimeAccountId"])
            require(target["runtimeAccountId"] not in seen_runtime_accounts)
            seen_runtime_accounts.add(target["runtimeAccountId"])
            if name in value["bootstrapStages"]:
                stage = value["bootstrapStages"][name]
                require(
                    stage == "service"
                    if target["lifecycle"] == "adopt"
                    else stage in {"none", "execution"}
                )
            address = target["origin"]
            if address is not None:
                origin(address)
                require(address not in seen_origins)
                seen_origins.add(address)
                # Check project/region when using the canonical numbered Run URL.
                if re.search(r"-[0-9]+\.[a-z0-9-]+\.run\.app\Z", address):
                    require(address == f"https://{TARGET_SERVICES[name]}-{number}.{region}.run.app")
            image = target["image"]
            if image is not None:
                matches(
                    re.compile(
                        rf"{region}-docker\.pkg\.dev/{project}/{value['artifactRepository']}/"
                        rf"{TARGET_SERVICES[name]}@sha256:[a-f0-9]{{64}}\Z"
                    ),
                    image,
                )
            if target["lifecycle"] == "adopt":
                require(address is not None and image is not None)
        if firebase["enabled"]:
            require(value["targets"]["web"]["origin"] is not None)
        # Canonical serialization rejects invalid Unicode and snapshots mutable callers.
        return json.loads(canonical(value))
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        raise ProfileError from None


def render(profile, *, root=ROOT):
    profile = validate_profile(profile)
    project, number = profile["project"]["id"], profile["project"]["number"]
    toolchain = json.loads((root / "infra/gcp/terraform/toolchain.json").read_text())
    targets = {}
    inventory = {}
    for name, target in profile["targets"].items():
        prefix = "fa-infra" if name == "repo" else "fa-infra-" + name
        targets[name] = {
            "enabled": target["enabled"],
            "directory": f"infra/gcp/terraform/envs/prod/{name}",
            "state_bucket": profile["state"]["stateBucket"]
            if name == "repo"
            else f"{project}-tfstate-{name}",
            "state_prefix": "prod/" + name,
            "plan_trigger": "terraform-plan-" + name,
            "apply_trigger": "terraform-apply-" + name,
            "plan_service_account": prefix + f"-plan@{project}.iam.gserviceaccount.com",
            "apply_service_account": prefix + f"-apply@{project}.iam.gserviceaccount.com",
            "configuration_controllers": []
            if name == "repo"
            else [f"module.{name.replace('-', '_')}.terraform_data.configuration"],
        }
        inventory[name] = {
            **target,
            "service": TARGET_SERVICES[name],
            "runtimeServiceAccount": None
            if name == "repo"
            else f"{target['runtimeAccountId']}@{project}.iam.gserviceaccount.com",
        }
    pipeline = {
        "schema_version": 2,
        "project_id": project,
        "project_number": number,
        "region": profile["region"],
        "repository_url": profile["source"]["repositoryUrl"],
        "terraform_version": toolchain["terraform_version"],
        "state_bucket": profile["state"]["stateBucket"],
        "plan_bucket": profile["state"]["planBucket"],
        "max_plan_age_seconds": MAX_PLAN_AGE_SECONDS,
        "targets": targets,
    }
    firebase = profile["firebase"]
    artifacts = {
        "pipeline.candidate.json": pipeline,
        "bootstrap-inputs.candidate.json": {
            "project_id": project,
            "region": profile["region"],
            "repository_id": profile["source"]["repositoryResource"],
            "portfolio_provisioning_stage": profile["bootstrapStages"]["portfolio"],
            "agent_hub_provisioning_stage": profile["bootstrapStages"]["agent-hub"],
        },
        "backends.candidate.json": {
            "bootstrap": {"bucket": profile["state"]["bootstrapBucket"], "prefix": "bootstrap"},
            **{
                name: {"bucket": entry["state_bucket"], "prefix": entry["state_prefix"]}
                for name, entry in targets.items()
            },
        },
        "web-substitutions.candidate.json": {
            "_REGION": profile["region"],
            "_REPOSITORY": profile["artifactRepository"],
            "_API_BASE_URL": profile["targets"]["market"]["origin"] or "",
            "_USER_API_BASE_URL": profile["targets"]["user"]["origin"] or "",
            "_CONFIG_API_BASE_URL": profile["targets"]["config"]["origin"] or "",
            "_FIREBASE_API_KEY": firebase["apiKey"],
            "_FIREBASE_AUTH_DOMAIN": firebase["authDomain"],
            "_FIREBASE_PROJECT_ID": project if firebase["enabled"] else "",
            "_FIREBASE_APP_ID": firebase["appId"],
        },
        "inventory.candidate.json": {
            "schemaVersion": 1,
            "profileId": profile["profileId"],
            "mode": profile["mode"],
            "source": profile["source"],
            "targets": inventory,
        },
    }
    manifest = {
        "schemaVersion": 1,
        "purpose": "offline_candidate",
        "approval": "not_requested",
        "productionActivation": False,
        "profileId": profile["profileId"],
        "profileSha256": digest(profile),
        "sourceSha256": digest(profile["source"]),
        "targetSha256": {
            name: digest({"profileSha256": digest(profile), "target": name, "input": target})
            for name, target in profile["targets"].items()
        },
        "filesSha256": {
            name: hashlib.sha256(canonical(value) + b"\n").hexdigest()
            for name, value in artifacts.items()
        },
    }
    return {**artifacts, "manifest.json": manifest}


def write_candidates(artifacts, destination):
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink())
    # Resolve directory aliases (including system temporary directories), while
    # refusing an existing/symlink destination and writing only new fixed filenames.
    destination = destination.resolve()
    created = False
    try:
        destination.mkdir(mode=0o700)
        created = True
        destination.chmod(0o700)
        for name, value in artifacts.items():
            require(Path(name).name == name)
            with (destination / name).open("xb") as output:
                os.chmod(output.name, 0o600)
                output.write(canonical(value) + b"\n")
    except (OSError, ProfileError):
        if created:
            shutil.rmtree(destination)
        raise ProfileError from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "render"))
    parser.add_argument("--profile", required=True)
    parser.add_argument("--output-dir")
    args = parser.parse_args()
    try:
        require((args.action == "render") == (args.output_dir is not None))
        profile = load_profile(args.profile)
        artifacts = render(profile)
        if args.action == "render":
            write_candidates(artifacts, args.output_dir)
        # Hashes identify selected input; they are not source-provenance or approval proof.
        print(json.dumps(artifacts["manifest.json"], sort_keys=True))
        return 0
    except (ProfileError, OSError, ValueError, TypeError):
        print("Deployment profile rejected; configuration values withheld.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
