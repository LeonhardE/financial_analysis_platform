"""Offline VM build/release review records; never credentials, approval or deployment.

Captured build/health JSON is not authenticated Google or Policy evidence. The
operator must independently verify its live origin. All `policy`, `baseline`,
`expected_request` and pins are trusted review inputs, never copied from requests.
Actual VM resources and saved-plan approval belong to the target's own infra PR.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
import time
from pathlib import Path

from first_provision import (
    MAX_METADATA_BYTES,
    MAX_REQUEST_BYTES,
    _json_bytes,
    _read_json,
    load_registry,
    prepare_build_evidence,
)

ROOT = Path(__file__).resolve().parents[2]
_POLICY_FIELDS = {
    "schema_version",
    "runtime",
    "target",
    "project_id",
    "region",
    "approved_image",
    "workload_identity",
    "policy_checkpoint",
}
_RECORD_FIELDS = {
    "schema_version",
    "kind",
    "capture_status",
    "target",
    "image",
    "workload_identity",
    "original_key_ids",
    "state_head",
    "request_digest",
    "policy_checkpoint",
    "instance_id",
    "observed_at",
}
_REQUEST_FIELDS = {
    "schema_version",
    "kind",
    "runtime",
    "action",
    "build",
    "policy_digest",
    "workload_identity",
    "policy_checkpoint",
    "previous_release_digest",
    "expected_state",
    "health_profile",
    "approval",
    "execution",
}
_KEY_FIELDS = {"agent_signing", "agent_encryption", "tls"}
_CHECKS = {
    "attestation_verified",
    "tls_key_bound",
    "policy_current",
    "original_keys_proven",
    "revocation_checked",
    "receipt_continuity_verified",
}
_DIGEST = re.compile(r"[a-f0-9]{64}\Z")
_IMAGE = re.compile(
    r"[a-z]+(?:-[a-z]+)+[0-9]+-docker\.pkg\.dev/[a-z][a-z0-9-]{4,28}[a-z0-9]/[a-z][a-z0-9-]{0,62}/[a-z][a-z0-9-]{0,48}@sha256:[a-f0-9]{64}\Z"
)


def require(condition):
    if not condition:
        raise ValueError("Invalid or mismatched confidential VM review evidence.")


def closed(value, fields):
    require(type(value) is dict and set(value) == fields)


def digest(value):
    return hashlib.sha256(_json_bytes(value)).hexdigest()


def integer(value):
    require(type(value) is int and 1 <= value <= 9007199254740991)


def checkpoint(value):
    closed(value, {"version", "digest"})
    integer(value["version"])
    require(type(value["digest"]) is str and _DIGEST.fullmatch(value["digest"]) is not None)


def keys(value):
    import base64

    closed(value, _KEY_FIELDS)
    for v in value.values():
        require(type(v) is str and re.fullmatch(r"[A-Za-z0-9_-]{43}", v) is not None)
        raw = base64.urlsafe_b64decode(v + "=")
        require(len(raw) == 32 and base64.urlsafe_b64encode(raw).decode().rstrip("=") == v)
    require(len(set(value.values())) == len(_KEY_FIELDS))


def baseline_record(value):
    closed(value, _RECORD_FIELDS)
    require(type(value["schema_version"]) is int and value["schema_version"] == 1)
    require(
        value["kind"] == "confidential_vm_release_record"
        and value["capture_status"] == "metadata_only_not_authorization"
    )
    require(type(value["image"]) is str and _IMAGE.fullmatch(value["image"]) is not None)
    keys(value["original_key_ids"])
    for name in ("state_head", "request_digest"):
        require(type(value[name]) is str and _DIGEST.fullmatch(value[name]) is not None)
    checkpoint(value["policy_checkpoint"])
    integer(value["observed_at"])
    require(
        type(value["instance_id"]) is str
        and re.fullmatch(r"[1-9][0-9]{0,19}", value["instance_id"]) is not None
    )
    return copy.deepcopy(value)


def prepare_request(build, trigger, *, policy, action, baseline=None, **trusted):
    """Bind captured artifacts to independent policy and previous release pins.

    This does not approve a digest, prove a workload measurement, or apply a plan.
    Existing registry entries default to Cloud Run and cannot enter this path.
    """
    target = trusted["registry"].target(trusted["target_id"])
    require(target.runtime == "confidential_vm" and target.release_mode == "build_only")
    require(action in ("first_provision", "upgrade", "restore"))
    artifact = prepare_build_evidence(build, trigger, **trusted)
    closed(policy, _POLICY_FIELDS)
    require(type(policy["schema_version"]) is int and policy["schema_version"] == 1)
    require(policy["runtime"] == "confidential_vm" and policy["target"] == target.id)
    require(
        policy["project_id"] == artifact["project_id"] and policy["region"] == artifact["region"]
    )
    require(policy["approved_image"] == artifact["image"]["reference"])
    identity = policy["workload_identity"]
    require(
        type(identity) is str
        and re.fullmatch(
            r"[a-z][a-z0-9-]{4,28}[a-z0-9]@"
            + re.escape(artifact["project_id"])
            + r"\.iam\.gserviceaccount\.com",
            identity,
        )
        is not None
    )
    checkpoint(policy["policy_checkpoint"])
    previous, state = None, None
    if action == "first_provision":
        require(baseline is None)
    else:
        prior = baseline_record(baseline)
        require(prior["target"] == target.id and prior["workload_identity"] == identity)
        old_cp, new_cp = prior["policy_checkpoint"], policy["policy_checkpoint"]
        require(new_cp["version"] >= old_cp["version"])
        require(new_cp["version"] != old_cp["version"] or new_cp == old_cp)
        require((prior["image"] == artifact["image"]["reference"]) == (action == "restore"))
        previous = digest(prior)
        state = {"original_key_ids": prior["original_key_ids"], "state_head": prior["state_head"]}
    result = {
        "schema_version": 1,
        "kind": "confidential_vm_release_request",
        "runtime": "confidential_vm",
        "action": action,
        "build": artifact,
        "policy_digest": digest(policy),
        "workload_identity": identity,
        "policy_checkpoint": copy.deepcopy(policy["policy_checkpoint"]),
        "previous_release_digest": previous,
        "expected_state": state,
        "health_profile": "confidential_vm_attested.v1",
        "approval": {"status": "not_requested"},
        "execution": "separate_reviewed_target_infrastructure_saved_plan",
    }
    require(len(_json_bytes(result)) <= MAX_REQUEST_BYTES)
    return result


def validate_request(request, build, trigger, **trusted):
    expected = prepare_request(build, trigger, **trusted)
    closed(request, _REQUEST_FIELDS)
    require(
        len(_json_bytes(request)) <= MAX_REQUEST_BYTES
        and _json_bytes(request) == _json_bytes(expected)
    )
    return expected


def record_release(
    request, evidence, *, expected_request, expected_key_ids, expected_state_head, now
):
    """Check a bounded independently captured observation, not signed attestation.

    Callers must recompute expected_request with validate_request and obtain pins
    from trusted enrollment/state. Matching JSON/boolean claims are not authority.
    """
    integer(now)
    closed(request, _REQUEST_FIELDS)
    require(_json_bytes(request) == _json_bytes(expected_request))
    require(
        request["kind"] == "confidential_vm_release_request"
        and request["runtime"] == "confidential_vm"
    )
    require(
        request["approval"] == {"status": "not_requested"}
        and request["health_profile"] == "confidential_vm_attested.v1"
    )
    keys(expected_key_ids)
    require(type(expected_state_head) is str and _DIGEST.fullmatch(expected_state_head) is not None)
    if request["expected_state"] is not None:
        require(
            request["expected_state"]
            == {"original_key_ids": expected_key_ids, "state_head": expected_state_head}
        )
    closed(
        evidence,
        {
            "request_digest",
            "profile",
            "target",
            "image",
            "workload_identity",
            "instance_id",
            "original_key_ids",
            "state_head",
            "checks",
            "observed_at",
        },
    )
    closed(evidence["checks"], _CHECKS)
    require(all(value is True for value in evidence["checks"].values()))
    integer(evidence["observed_at"])
    require(now - 300 <= evidence["observed_at"] <= now)
    require(
        evidence["profile"] == request["health_profile"]
        and evidence["request_digest"] == digest(request)
    )
    require(
        evidence["target"] == request["build"]["target"]
        and evidence["image"] == request["build"]["image"]["reference"]
    )
    require(evidence["workload_identity"] == request["workload_identity"])
    require(
        evidence["original_key_ids"] == expected_key_ids
        and evidence["state_head"] == expected_state_head
    )
    return baseline_record(
        {
            "schema_version": 1,
            "kind": "confidential_vm_release_record",
            "capture_status": "metadata_only_not_authorization",
            "target": evidence["target"],
            "image": evidence["image"],
            "workload_identity": evidence["workload_identity"],
            "original_key_ids": copy.deepcopy(expected_key_ids),
            "state_head": expected_state_head,
            "request_digest": digest(request),
            "policy_checkpoint": copy.deepcopy(request["policy_checkpoint"]),
            "instance_id": evidence["instance_id"],
            "observed_at": evidence["observed_at"],
        }
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "validate", "record"))
    parser.add_argument(
        "--action", required=True, choices=("first_provision", "upgrade", "restore")
    )
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
        "policy-json",
    ):
        parser.add_argument("--" + name, required=True)
    for name in (
        "connected-repository",
        "baseline-json",
        "request-json",
        "health-json",
        "pins-json",
        "output",
    ):
        parser.add_argument("--" + name)
    args = parser.parse_args()
    try:
        require(bool(args.request_json) == (args.command != "prepare"))
        require(
            bool(args.health_json) == (args.command == "record")
            and bool(args.pins_json) == (args.command == "record")
        )
        require(bool(args.baseline_json) == (args.action != "first_provision"))
        trusted = dict(
            registry=load_registry(ROOT),
            target_id=args.target,
            project=args.project,
            region=args.region,
            artifact_repository=args.artifact_repository,
            repository_url=args.repository_url,
            commit=args.commit,
            build_id=args.build_id,
            connected_repository=args.connected_repository,
            action=args.action,
            policy=_read_json(args.policy_json, MAX_REQUEST_BYTES),
            baseline=_read_json(args.baseline_json, MAX_REQUEST_BYTES)
            if args.baseline_json
            else None,
        )
        build, trigger = (
            _read_json(path, MAX_METADATA_BYTES) for path in (args.build_json, args.trigger_json)
        )
        if args.command == "prepare":
            result = prepare_request(build, trigger, **trusted)
        else:
            result = validate_request(
                _read_json(args.request_json, MAX_REQUEST_BYTES), build, trigger, **trusted
            )
        if args.command == "record":
            pins = _read_json(args.pins_json, MAX_REQUEST_BYTES)
            closed(pins, {"original_key_ids", "state_head"})
            result = record_release(
                result,
                _read_json(args.health_json, MAX_REQUEST_BYTES),
                expected_request=result,
                expected_key_ids=pins["original_key_ids"],
                expected_state_head=pins["state_head"],
                now=int(time.time()),
            )
        require(not args.output or args.command != "validate")
        if args.command != "validate":
            encoded = json.dumps(result, indent=2) + "\n"
            if args.output:
                with Path(args.output).open("x", encoding="utf-8") as out:
                    out.write(encoded)
            else:
                print(encoded, end="")
    except (ValueError, KeyError, TypeError, OSError):
        print(
            "Confidential VM review failed; no deployment or approval performed.", file=sys.stderr
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
