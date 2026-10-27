"""Prepare digest-pinned first-provision review material without cloud access.

Captured JSON is not proof that Google emitted it. This tool checks its shape and
consistency with independently supplied deployment configuration. It never grants
approval, obtains credentials, invokes Terraform, or creates a service. Actual
first provision belongs to a target's saved-plan/native-approval infrastructure
workflow, after reviewing the captured build/trigger against the live authority.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from service_targets import Registry, load_registry  # noqa: E402

MAX_METADATA_BYTES = 1_048_576
MAX_REQUEST_BYTES = 16_384
_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")
_REGION = re.compile(r"[a-z]+(?:-[a-z]+)+[0-9]+\Z")
_REPOSITORY = re.compile(r"[a-z][a-z0-9-]{0,62}\Z")
_COMMIT = re.compile(r"[a-f0-9]{40}\Z")
_DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _uuid(value: str) -> str:
    try:
        _require(type(value) is str and str(UUID(value)) == value, "Invalid build/trigger ID.")
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid build/trigger ID.") from None
    return value


def _source_url(value: str) -> str:
    try:
        _require(type(value) is str and 0 < len(value) <= 2048, "Invalid source repository URL.")
        parsed = urlsplit(value)
        _require(
            parsed.scheme == "https"
            and bool(parsed.hostname)
            and parsed.port in (None, 443)
            and parsed.username is None
            and parsed.password is None
            and bool(parsed.path.strip("/"))
            and not parsed.query
            and not parsed.fragment
            and all(32 < ord(char) < 127 and char != "\\" for char in value),
            "Invalid source repository URL.",
        )
    except (ValueError, TypeError):
        raise ValueError("Invalid source repository URL.") from None
    return value


def _repository_resource(value: object, region: str) -> str:
    _require(
        type(value) is str
        and re.fullmatch(
            rf"projects/[a-z0-9-]+/locations/{re.escape(region)}/connections/[A-Za-z0-9._-]+/repositories/[A-Za-z0-9._-]+",
            value,
        )
        is not None,
        "Invalid regional connected repository.",
    )
    return value


def _provenance(
    build: dict,
    trigger_repository: str,
    *,
    repository_url: str,
    connected_repository: str | None,
    commit: str,
    region: str,
) -> dict:
    value = build.get("sourceProvenance")
    _require(type(value) is dict, "Missing output-only source provenance.")
    resolved = {key: item for key, item in value.items() if key.startswith("resolved") and item}
    _require(len(resolved) == 1, "Ambiguous output-only source provenance.")
    kind, selected = next(iter(resolved.items()))
    _require(
        type(selected) is dict and selected.get("revision") == commit and not selected.get("dir"),
        "Output-only source revision does not match.",
    )
    if kind == "resolvedGitSource":
        _require(selected.get("url") == repository_url, "Source repository URL does not match.")
        return {"kind": kind, "repository_url": repository_url, "revision": commit}
    _require(
        kind == "resolvedConnectedRepository" and connected_repository is not None,
        "Connected provenance requires an independently configured repository resource.",
    )
    expected = _repository_resource(connected_repository, region)
    _require(
        selected.get("repository") == expected == trigger_repository,
        "Connected source repository does not match.",
    )
    return {"kind": kind, "repository_resource": expected, "revision": commit}


def prepare_request(
    build: dict,
    trigger: dict,
    *,
    registry: Registry,
    target_id: str,
    project: str,
    region: str,
    artifact_repository: str,
    repository_url: str,
    commit: str,
    build_id: str,
    connected_repository: str | None = None,
) -> dict:
    """Return review material, not an authorization or provisioning operation.

    All keyword parameters are independently trusted configuration. For connected
    repository provenance, callers must supply its trusted resource-to-URL mapping;
    copying that resource from the untrusted capture does not establish trust.
    """
    _require(isinstance(registry, Registry), "A validated repository registry is required.")
    target = registry.target(target_id)
    _require(target.release_mode == "build_only", "First provision requires a build-only target.")
    _require(type(project) is str and _PROJECT.fullmatch(project) is not None, "Invalid project.")
    _require(type(region) is str and _REGION.fullmatch(region) is not None, "Invalid region.")
    _require(
        type(artifact_repository) is str and _REPOSITORY.fullmatch(artifact_repository) is not None,
        "Invalid artifact repository.",
    )
    _source_url(repository_url)
    _require(
        type(commit) is str and _COMMIT.fullmatch(commit) is not None and int(commit, 16) != 0,
        "A full main-branch commit is required.",
    )
    _uuid(build_id)
    _require(
        type(build) is dict and type(trigger) is dict, "Build and trigger captures must be objects."
    )
    substitutions = build.get("substitutions")
    _require(
        build.get("id") == build_id
        and build.get("projectId") == project
        and build.get("status") == "SUCCESS"
        and type(substitutions) is dict
        and substitutions.get("BRANCH_NAME") == "main"
        and substitutions.get("COMMIT_SHA") == commit,
        "A successful build for the exact main commit and project is required.",
    )
    _require(
        substitutions.get("_DEPLOY_SERVICE") == "false",
        "The captured build must explicitly be build-only.",
    )
    _require(
        substitutions.get("_REGION") == region
        and substitutions.get("_REPOSITORY") == artifact_repository,
        "Build region or artifact repository does not match.",
    )
    trigger_id = _uuid(build.get("buildTriggerId"))
    trigger_name = "build-" + target.service
    _require(
        trigger.get("id") == trigger_id
        and trigger.get("name") == trigger_name
        and trigger.get("filename") == target.cloudbuild
        and not trigger.get("gitFileSource")
        and not trigger.get("build"),
        "Build trigger identity or registered configuration does not match.",
    )
    trigger_substitutions = trigger.get("substitutions")
    _require(
        type(trigger_substitutions) is dict
        and trigger_substitutions.get("_DEPLOY_SERVICE") == "false",
        "The captured trigger must explicitly be build-only.",
    )
    event = trigger.get("repositoryEventConfig")
    _require(
        type(event) is dict and type(event.get("push")) is dict, "A main push trigger is required."
    )
    push = event["push"]
    _require(
        push.get("branch") == "^main$"
        and push.get("invertRegex", False) is False
        and not push.get("tag")
        and not event.get("pullRequest"),
        "A main-only push trigger is required.",
    )
    for key in ("sourceToBuild", "triggerTemplate", "github", "pubsubConfig", "webhookConfig"):
        _require(not trigger.get(key), "Ambiguous build trigger source.")
    trigger_repository = _repository_resource(event.get("repository"), region)
    if connected_repository is not None:
        _require(
            trigger_repository == _repository_resource(connected_repository, region),
            "Configured trigger repository does not match.",
        )
    provenance = _provenance(
        build,
        trigger_repository,
        repository_url=repository_url,
        connected_repository=connected_repository,
        commit=commit,
        region=region,
    )
    image_name = f"{region}-docker.pkg.dev/{project}/{artifact_repository}/{target.service}"
    image_tag = f"{image_name}:{build_id}"
    images = build.get("results", {}).get("images") if type(build.get("results")) is dict else None
    _require(
        type(images) is list and len(images) == 1 and type(images[0]) is dict,
        "Exactly one unambiguous build image result is required.",
    )
    image = images[0]
    digest = image.get("digest")
    _require(
        image.get("name") == image_tag
        and type(digest) is str
        and _DIGEST.fullmatch(digest) is not None,
        "The exact registered image tag and SHA-256 digest are required.",
    )
    result = {
        "schema_version": 1,
        "kind": "first_provision_request",
        "target": target.id,
        "project_id": project,
        "region": region,
        "service": target.service,
        "artifact_repository": artifact_repository,
        "repository_url": repository_url,
        "commit": commit,
        "build_id": build_id,
        "trigger_id": trigger_id,
        "trigger_name": trigger_name,
        "build_config": target.cloudbuild,
        "source_provenance": provenance,
        "image": {"tag": image_tag, "digest": digest, "reference": f"{image_name}@{digest}"},
        "approval": {"status": "not_requested"},
        "execution": "separate_reviewed_target_infrastructure_saved_plan",
    }
    _require(len(_json_bytes(result)) <= MAX_REQUEST_BYTES, "First-provision request is too large.")
    return result


def _json_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise ValueError("Invalid first-provision JSON.") from None


def validate_request(request: dict, build: dict, trigger: dict, **trusted) -> dict:
    """Recompute every field; even a matching request never grants approval."""
    expected = prepare_request(build, trigger, **trusted)
    _require(
        type(request) is dict and len(_json_bytes(request)) <= MAX_REQUEST_BYTES,
        "Invalid first-provision request.",
    )
    _require(
        _json_bytes(request) == _json_bytes(expected),
        "First-provision request does not match the independently bound evidence.",
    )
    return expected


def _unique(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        _require(key not in result, "Duplicate JSON field in captured metadata.")
        result[key] = value
    return result


def _constant(_value: str):
    raise ValueError("Non-finite JSON values are not accepted.")


def _read_json(path: str, maximum: int) -> dict:
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(maximum + 1)
        _require(len(raw) <= maximum, "Captured metadata exceeds its byte budget.")
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique, parse_constant=_constant)
        _require(type(value) is dict, "Captured metadata must be an object.")
        return value
    except (OSError, UnicodeError, ValueError, TypeError, RecursionError):
        raise ValueError("Unable to read bounded captured JSON.") from None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "validate"))
    for name in (
        "target",
        "project",
        "region",
        "artifact-repository",
        "repository-url",
        "commit",
        "build-id",
        "build-json",
        "trigger-json",
    ):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--connected-repository")
    parser.add_argument("--request-json")
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        _require(
            (args.command == "validate") == bool(args.request_json),
            "Only validation requires an existing request JSON.",
        )
        _require(
            not args.output or args.command == "prepare", "Only prepare accepts an output file."
        )
        registry = load_registry(ROOT)
        trusted = dict(
            registry=registry,
            target_id=args.target,
            project=args.project,
            region=args.region,
            artifact_repository=args.artifact_repository,
            repository_url=args.repository_url,
            commit=args.commit,
            build_id=args.build_id,
            connected_repository=args.connected_repository,
        )
        build, trigger = (
            _read_json(path, MAX_METADATA_BYTES) for path in (args.build_json, args.trigger_json)
        )
        if args.command == "prepare":
            result = prepare_request(build, trigger, **trusted)
            encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
            if args.output:
                with Path(args.output).open("x", encoding="utf-8") as stream:
                    stream.write(encoded)
            else:
                print(encoded, end="")
        else:
            validate_request(
                _read_json(args.request_json, MAX_REQUEST_BYTES), build, trigger, **trusted
            )
            print("Request matches captured evidence; approval remains not_requested.")
    except (ValueError, OSError):
        print(
            "First-provision preparation/validation failed; "
            "no approval or resource operation occurred.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
