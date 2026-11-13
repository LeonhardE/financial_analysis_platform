"""Additive task/assignment/lifecycle predicates, not a scheduler or storage engine.

Every current-state argument is a trusted consumer transaction read. Controls
require current Owner signatures; grants, PoP, input/source checks, unique CAS
and original receipts remain independent mandatory consumer responsibilities.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from importlib.resources import files
from types import MappingProxyType
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jsonschema import Draft202012Validator

from .authority import VerifiedRegistry
from .constants import CONTRACT_VERSION, MAX_CONTROL_BYTES
from .crypto import signing_input_fingerprint
from .errors import ContractError
from .jsonutil import canonical_json
from .persistent_agents import _device_control, _integer, _match, validate_persistent_schema
from .persistent_content import persistent_manifest_fingerprint, validate_persistent_manifest
from .provider_connections import (
    load_provider_connection_schema,
    provider_slot_id,
    validate_provider_slot,
)
from .schema import validate_schema

TASK_CENTER_PROFILE = "folioview.task-center.v1"
TRASH_RETENTION_SECONDS = 30 * 24 * 60 * 60
MANUAL_INTENT_SECONDS = 600
_SCHEMAS = frozenset(
    {
        "CenterSchedule",
        "CenterTaskDefinition",
        "CenterAssignmentTarget",
        "CenterAssignment",
        "CenterIntentTarget",
        "CenterOwnerControl",
        "CenterTrigger",
        "CenterRunBinding",
        "CenterExecutorProgress",
        "CenterProgressSnapshot",
    }
)
_VERSIONS = ("taskVersion", "executionEpoch", "ruleVersion", "lifecycleEpoch")


def _digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


@lru_cache(maxsize=1)
def _document():
    document = json.loads(files(__package__).joinpath("task_center.json").read_text())
    legacy = load_provider_connection_schema("ProviderConnectionSlot")["$defs"]
    if set(document["$defs"]) & set(legacy):
        raise RuntimeError("Task center schema name collision")
    document["$defs"] = {**legacy, **document["$defs"]}
    Draft202012Validator.check_schema(document)
    return document


def load_task_center_schema(name):
    if type(name) is not str or name not in _SCHEMAS:
        raise ContractError("malformed_request")
    document = copy.deepcopy(_document())
    document["$ref"] = "#/$defs/" + name
    return document


@lru_cache(maxsize=16)
def _validator(name):
    return Draft202012Validator(load_task_center_schema(name))


def validate_task_center_schema(name, value):
    try:
        if len(canonical_json(value)) > MAX_CONTROL_BYTES:
            raise ContractError("payload_too_large")
        if next(_validator(name).iter_errors(value), None) is not None:
            raise ContractError("malformed_request")
        return copy.deepcopy(value)
    except ContractError:
        raise
    except (TypeError, ValueError, RecursionError):
        raise ContractError("malformed_request") from None


def _context(owner_subject, vault_id, task_id):
    for value in (owner_subject, vault_id, task_id):
        validate_schema("Identifier", value)
    return dict(
        contractVersion=CONTRACT_VERSION,
        profile=TASK_CENTER_PROFILE,
        ownerSubject=owner_subject,
        vaultId=vault_id,
        taskId=task_id,
    )


def validate_schedule(value):
    value = validate_task_center_schema("CenterSchedule", value)
    days = value["days"]
    if (
        days != sorted(set(days))
        or (value["frequency"] == "daily" and days)
        or (value["frequency"] == "weekly" and not days)
    ):
        raise ContractError("malformed_request")
    try:
        ZoneInfo(value["timeZone"])
    except (ZoneInfoNotFoundError, ValueError):
        raise ContractError("malformed_request") from None
    return value


def validate_definition(value):
    value = validate_task_center_schema("CenterTaskDefinition", value)
    if max(value["ruleVersion"], value["lifecycleEpoch"]) > value["definitionVersion"]:
        raise ContractError("version_conflict")
    if value["schedule"] is not None:
        validate_schedule(value["schedule"])
    if value["status"] == "active":
        if value["deletedAt"] is not None or value["purgeAfter"] is not None:
            raise ContractError("malformed_request")
    elif (
        value["deletedAt"] is None
        or value["purgeAfter"] != value["deletedAt"] + TRASH_RETENTION_SECONDS
    ):
        raise ContractError("malformed_request")
    if value["status"] == "purged" and value["schedule"] is not None:
        raise ContractError("malformed_request")
    return value


def assignment_id(owner_subject, vault_id, task_id, slot_id):
    context = _context(owner_subject, vault_id, task_id)
    validate_schema("Identifier", slot_id)
    return "assignment_" + _digest([context, slot_id])


def validate_assignment(value):
    value = validate_task_center_schema("CenterAssignment", value)
    if value["slotId"] != provider_slot_id(value["ownerSubject"], value["provider"]) or value[
        "assignmentId"
    ] != assignment_id(value["ownerSubject"], value["vaultId"], value["taskId"], value["slotId"]):
        raise ContractError("recipient_binding_mismatch")
    return value


def _control(
    signed, *, registry, owner_subject, vault_id, task_id, action, current_definition, now
):
    _integer(now)
    context = _context(owner_subject, vault_id, task_id)
    if not isinstance(registry, VerifiedRegistry):
        raise ContractError("key_authorization_required")
    if (registry.owner_subject, registry.vault_id) != (owner_subject, vault_id):
        raise ContractError("recipient_binding_mismatch")
    payload = _device_control(
        signed, registry, "CenterOwnerControl", now, validator=validate_task_center_schema
    )
    _match(payload, {**context, "rootKeyId": registry.root_key_id, "action": action})
    if action in {"set_assignment", "manual_intent"}:
        cert = registry.cert(
            payload["deviceSigningKeyId"], role="device_sig", connection_id=None, now=now
        )
        if "task_grant" not in cert["capabilities"]:
            raise ContractError("key_authorization_required")
    if current_definition is not None:
        current_definition = validate_definition(current_definition)
        _match(current_definition, context)
        if action != "set_rules":
            _match(payload, {k: current_definition[k] for k in ("taskVersion", "executionEpoch")})
    if payload["expectedDefinitionVersion"] != (
        current_definition["definitionVersion"] if current_definition else 0
    ):
        raise ContractError("version_conflict")
    allowed = {
        "set_rules": {"schedule"},
        "set_assignment": {"assignment", "assignmentId", "expectedAssignmentVersion"},
        "remove_assignment": {"assignmentId", "expectedAssignmentVersion"},
        "manual_intent": {"intent"},
    }.get(action, set())
    if any(
        payload[field] is not None
        for field in {
            "schedule",
            "assignment",
            "assignmentId",
            "expectedAssignmentVersion",
            "intent",
        }
        - allowed
    ):
        raise ContractError("malformed_request")
    return payload, current_definition, context


def plan_task_rules(
    signed,
    *,
    registry,
    owner_subject,
    vault_id,
    task_id,
    current_definition,
    task_version,
    execution_epoch,
    now,
):
    p, old, context = _control(
        signed,
        registry=registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        task_id=task_id,
        action="set_rules",
        current_definition=current_definition,
        now=now,
    )
    _integer(task_version, 1)
    _integer(execution_epoch, 1)
    _match(p, {"taskVersion": task_version, "executionEpoch": execution_epoch})
    if old and (
        old["status"] != "active"
        or task_version < old["taskVersion"]
        or execution_epoch < old["executionEpoch"]
    ):
        raise ContractError("version_conflict")
    schedule = None if p["schedule"] is None else validate_schedule(p["schedule"])
    if schedule is not None and schedule["effectiveFrom"] < p["issuedAt"]:
        raise ContractError("version_conflict")
    return validate_definition(
        {
            **context,
            "taskVersion": task_version,
            "executionEpoch": execution_epoch,
            "definitionVersion": (old["definitionVersion"] if old else 0) + 1,
            "ruleVersion": (old["ruleVersion"] if old else 0) + 1,
            "lifecycleEpoch": old["lifecycleEpoch"] if old else 1,
            "status": "active",
            "schedule": schedule,
            "deletedAt": None,
            "purgeAfter": None,
        }
    )


def plan_assignment(
    signed,
    *,
    registry,
    owner_subject,
    vault_id,
    task_id,
    current_definition,
    current_assignment,
    current_slot,
    current_identity,
    now,
    remove=False,
):
    action = "remove_assignment" if remove else "set_assignment"
    p, definition, context = _control(
        signed,
        registry=registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        task_id=task_id,
        action=action,
        current_definition=current_definition,
        now=now,
    )
    if definition is None or definition["status"] != "active":
        raise ContractError("key_authorization_required")
    old = None if current_assignment is None else validate_assignment(current_assignment)
    if old is not None:
        _match(old, context)
    if p["expectedAssignmentVersion"] != (old["assignmentVersion"] if old else 0):
        raise ContractError("version_conflict")
    if remove:
        if old is None or p["assignmentId"] != old["assignmentId"]:
            raise ContractError("version_conflict")
        return validate_assignment(
            {**old, "assignmentVersion": old["assignmentVersion"] + 1, "status": "removed"}
        )
    target = validate_task_center_schema("CenterAssignmentTarget", p["assignment"])
    slot = validate_provider_slot(
        current_slot, owner_subject=owner_subject, vault_id=vault_id, provider=target["provider"]
    )
    if (target["slotId"], target["slotGeneration"], target["credential"]) != (
        slot["slotId"],
        slot["slotGeneration"],
        slot["currentCredential"],
    ):
        raise ContractError("key_authorization_required")
    identity = validate_persistent_schema("PersistentAgentIdentity", current_identity)
    _match(
        identity,
        {
            "ownerSubject": owner_subject,
            "vaultId": vault_id,
            "connectionId": target["credential"]["connectionId"],
            "clientId": target["credential"]["clientId"],
            "agentId": target["agentId"],
            "rootKeyId": registry.root_key_id,
            "status": "active",
        },
    )
    ident = assignment_id(owner_subject, vault_id, task_id, slot["slotId"])
    if p["assignmentId"] != ident or (old is not None and old["assignmentId"] != ident):
        raise ContractError("recipient_binding_mismatch")
    return validate_assignment(
        {
            **context,
            **{k: definition[k] for k in _VERSIONS},
            **target,
            "assignmentId": ident,
            "assignmentVersion": (old["assignmentVersion"] if old else 0) + 1,
            "status": "active",
        }
    )


def require_assignment_current(definition, assignment, slot, *, authority_fingerprint):
    definition, assignment = validate_definition(definition), validate_assignment(assignment)
    context = _context(definition["ownerSubject"], definition["vaultId"], definition["taskId"])
    _match(assignment, context)
    if definition["status"] != "active" or assignment["status"] != "active":
        raise ContractError("key_authorization_required")
    _match(assignment, {k: definition[k] for k in _VERSIONS})
    slot = validate_provider_slot(
        slot,
        owner_subject=definition["ownerSubject"],
        vault_id=definition["vaultId"],
        provider=assignment["provider"],
    )
    if (
        assignment["slotId"],
        assignment["slotGeneration"],
        assignment["credential"],
        assignment["authorityFingerprint"],
    ) != (slot["slotId"], slot["slotGeneration"], slot["currentCredential"], authority_fingerprint):
        raise ContractError("key_authorization_required")
    return assignment


def plan_task_lifecycle(
    signed, *, registry, owner_subject, vault_id, task_id, current_definition, now, action
):
    if action not in {"trash", "restore", "purge"}:
        raise ContractError("malformed_request")
    _, old, _ = _control(
        signed,
        registry=registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        task_id=task_id,
        action=action,
        current_definition=current_definition,
        now=now,
    )
    if old is None:
        raise ContractError("not_found")
    value = {
        **old,
        "definitionVersion": old["definitionVersion"] + 1,
        "lifecycleEpoch": old["lifecycleEpoch"] + 1,
    }
    if action == "trash" and old["status"] == "active":
        value.update(status="trashed", deletedAt=now, purgeAfter=now + TRASH_RETENTION_SECONDS)
    elif action == "restore" and old["status"] == "trashed" and now < old["purgeAfter"]:
        value.update(status="active", deletedAt=None, purgeAfter=None)
    elif action == "purge" and old["status"] == "trashed" and now >= old["purgeAfter"]:
        value.update(status="purged", schedule=None)
    else:
        raise ContractError("version_conflict")
    return validate_definition(value)


def owner_history_visible(definition):
    """Old actor/epoch history is visible again after restore, without reactivation."""
    return validate_definition(definition)["status"] == "active"


def scheduled_occurrence(definition, *, local_date, now):
    definition = validate_definition(definition)
    _integer(now)
    schedule = definition["schedule"]
    if definition["status"] != "active" or schedule is None:
        return None
    try:
        day = date.fromisoformat(local_date)
        if day.isoformat() != local_date:
            raise ValueError
        if schedule["frequency"] == "weekly" and day.isoweekday() not in schedule["days"]:
            return None
        local = datetime.combine(
            day, time.fromisoformat(schedule["localTime"]), ZoneInfo(schedule["timeZone"])
        )
        utc = local.astimezone(UTC)
        if utc.astimezone(local.tzinfo).replace(tzinfo=None) != local.replace(tzinfo=None):
            return None  # Nonexistent spring-forward wall time; no fabricated slot.
        at = int(utc.timestamp())  # fold=0 is the first repeated occurrence.
    except (ValueError, TypeError, OverflowError):
        raise ContractError("malformed_request") from None
    if at < schedule["effectiveFrom"] or not at <= now <= at + schedule["graceMinutes"] * 60 + 59:
        return None
    key = "schedule_" + _digest(
        [
            definition["ownerSubject"],
            definition["vaultId"],
            definition["taskId"],
            definition["ruleVersion"],
            local_date,
            schedule,
        ]
    )
    return {
        "baseTriggerId": key,
        "scheduledAt": at,
        "sourceFingerprint": _digest([definition, local_date]),
    }


@dataclass(frozen=True)
class VerifiedManualIntent:
    payload: dict
    fingerprint: str

    def __post_init__(self):
        def freeze(value):
            if isinstance(value, dict):
                return MappingProxyType({k: freeze(v) for k, v in value.items()})
            if isinstance(value, list):
                return tuple(freeze(v) for v in value)
            return value

        object.__setattr__(self, "payload", freeze(copy.deepcopy(self.payload)))


def verify_manual_intent(
    signed, *, registry, owner_subject, vault_id, task_id, current_definition, assignments, now
):
    p, definition, _ = _control(
        signed,
        registry=registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        task_id=task_id,
        action="manual_intent",
        current_definition=current_definition,
        now=now,
    )
    if definition is None or definition["status"] != "active":
        raise ContractError("key_authorization_required")
    target = validate_task_center_schema("CenterIntentTarget", p["intent"])
    if not now < target["expiresAt"] <= p["issuedAt"] + MANUAL_INTENT_SECONDS:
        raise ContractError("key_authorization_required")
    refs = target["assignments"]
    if [r["assignmentId"] for r in refs] != sorted({r["assignmentId"] for r in refs}):
        raise ContractError("malformed_request")
    known = {}
    for assignment in assignments:
        assignment = validate_assignment(assignment)
        _match(
            assignment,
            {
                "ownerSubject": owner_subject,
                "vaultId": vault_id,
                "taskId": task_id,
                **{k: definition[k] for k in _VERSIONS},
                "status": "active",
            },
        )
        if assignment["assignmentId"] in known:
            raise ContractError("malformed_request")
        known[assignment["assignmentId"]] = assignment["assignmentVersion"]
    if any(known.get(r["assignmentId"]) != r["assignmentVersion"] for r in refs):
        raise ContractError("key_authorization_required")
    return VerifiedManualIntent(copy.deepcopy(p), signing_input_fingerprint(signed))


def assignment_trigger_id(assignment, base_trigger_id, *, kind="legacy_unknown"):
    assignment = validate_assignment(assignment)
    validate_schema("OperationIdentifier", base_trigger_id)
    if kind not in {"manual", "scheduled", "legacy_unknown"}:
        raise ContractError("malformed_request")
    return "tc_" + _digest(
        [
            assignment["ownerSubject"],
            assignment["vaultId"],
            assignment["taskId"],
            assignment["assignmentId"],
            assignment["assignmentVersion"],
            assignment["ruleVersion"],
            assignment["lifecycleEpoch"],
            kind,
            base_trigger_id,
        ]
    )


@dataclass(frozen=True)
class TrustedScheduleSource:
    """Construct only in a trusted adapter after actual source verification.

    No wire DTO, Agent verified flag or native source adapter is supplied here.
    A policy-valid time slot alone does not attest what triggered an execution.
    """

    event_id: str
    fingerprint: str
    assignment_id: str
    assignment_version: int
    base_trigger_id: str


def bind_task_run(
    definition,
    assignment,
    slot,
    manifest,
    *,
    base_trigger_id,
    kind="legacy_unknown",
    manual_intent=None,
    scheduled_source=None,
):
    manifest = validate_persistent_manifest(manifest)
    assignment = require_assignment_current(
        definition, assignment, slot, authority_fingerprint=manifest["taskPublicationFingerprint"]
    )
    _match(
        manifest,
        {
            "ownerSubject": assignment["ownerSubject"],
            "vaultId": assignment["vaultId"],
            "taskId": assignment["taskId"],
            "taskVersion": assignment["taskVersion"],
            "executionEpoch": assignment["executionEpoch"],
            "connectionId": assignment["credential"]["connectionId"],
            "clientId": assignment["credential"]["clientId"],
            "agentId": assignment["agentId"],
        },
    )
    trigger = {
        "kind": kind,
        "baseTriggerId": base_trigger_id,
        "sourceFingerprint": None,
        "scheduledAt": None,
    }
    if kind == "manual":
        if not isinstance(manual_intent, VerifiedManualIntent):
            raise ContractError("key_authorization_required")
        p = manual_intent.payload
        if (
            (
                p["ownerSubject"],
                p["vaultId"],
                p["taskId"],
                p["expectedDefinitionVersion"],
                p["stableOperationId"],
            )
            != (
                definition["ownerSubject"],
                definition["vaultId"],
                definition["taskId"],
                definition["definitionVersion"],
                base_trigger_id,
            )
            or not p["issuedAt"] <= manifest["createdAt"] < p["intent"]["expiresAt"]
            or {
                "assignmentId": assignment["assignmentId"],
                "assignmentVersion": assignment["assignmentVersion"],
            }
            not in p["intent"]["assignments"]
        ):
            raise ContractError("key_authorization_required")
        trigger["sourceFingerprint"] = manual_intent.fingerprint
    elif kind == "scheduled":
        if not isinstance(scheduled_source, TrustedScheduleSource):
            raise ContractError("key_authorization_required")
        validate_schema("Identifier", scheduled_source.event_id)
        validate_schema("Digest", scheduled_source.fingerprint)
        _integer(scheduled_source.assignment_version, 1)
        if (
            scheduled_source.assignment_id,
            scheduled_source.assignment_version,
            scheduled_source.base_trigger_id,
        ) != (assignment["assignmentId"], assignment["assignmentVersion"], base_trigger_id):
            raise ContractError("recipient_binding_mismatch")
        schedule = definition["schedule"]
        if schedule is None:
            raise ContractError("key_authorization_required")
        day = datetime.fromtimestamp(manifest["createdAt"], ZoneInfo(schedule["timeZone"])).date()
        occurrences = [
            scheduled_occurrence(
                definition,
                local_date=(day - timedelta(days=offset)).isoformat(),
                now=manifest["createdAt"],
            )
            for offset in (0, 1)
        ]
        occurrence = next(
            (v for v in occurrences if v and v["baseTriggerId"] == base_trigger_id), None
        )
        if occurrence is None:
            raise ContractError("key_authorization_required")
        trigger.update(
            sourceFingerprint=scheduled_source.fingerprint, scheduledAt=occurrence["scheduledAt"]
        )
    elif kind != "legacy_unknown" or manual_intent is not None:
        raise ContractError("key_authorization_required")
    expected = assignment_trigger_id(assignment, base_trigger_id, kind=kind)
    if manifest["triggerId"] != expected:
        raise ContractError("recipient_binding_mismatch")
    return validate_task_center_schema(
        "CenterRunBinding",
        {
            **{
                k: assignment[k]
                for k in (
                    "contractVersion",
                    "profile",
                    "ownerSubject",
                    "vaultId",
                    "taskId",
                    *_VERSIONS,
                    "assignmentId",
                    "assignmentVersion",
                    "slotId",
                    "slotGeneration",
                    "provider",
                    "credential",
                    "agentId",
                    "authorityFingerprint",
                )
            },
            "runId": manifest["runId"],
            "manifestFingerprint": persistent_manifest_fingerprint(manifest),
            "inputsDigest": _digest(manifest["inputs"]),
            "triggerId": expected,
            "trigger": trigger,
        },
    )


def validate_run_binding(binding, manifest):
    """Validate frozen history without requiring its actor still be current."""
    binding = validate_task_center_schema("CenterRunBinding", binding)
    manifest = validate_persistent_manifest(manifest)
    _match(
        binding,
        {
            k: manifest[k]
            for k in (
                "ownerSubject",
                "vaultId",
                "taskId",
                "taskVersion",
                "executionEpoch",
                "agentId",
                "runId",
                "triggerId",
            )
        },
    )
    if (
        binding["manifestFingerprint"] != persistent_manifest_fingerprint(manifest)
        or binding["inputsDigest"] != _digest(manifest["inputs"])
        or binding["authorityFingerprint"] != manifest["taskPublicationFingerprint"]
        or (binding["credential"]["connectionId"], binding["credential"]["clientId"])
        != (manifest["connectionId"], manifest["clientId"])
    ):
        raise ContractError("recipient_binding_mismatch")
    trigger = binding["trigger"]
    historical_assignment = {
        k: binding[k]
        for k in (
            "contractVersion",
            "profile",
            "ownerSubject",
            "vaultId",
            "taskId",
            *_VERSIONS,
            "assignmentId",
            "assignmentVersion",
            "slotId",
            "slotGeneration",
            "provider",
            "credential",
            "agentId",
            "authorityFingerprint",
        )
    }
    historical_assignment["status"] = "removed"
    validate_assignment(historical_assignment)
    if binding["triggerId"] != assignment_trigger_id(
        historical_assignment, trigger["baseTriggerId"], kind=trigger["kind"]
    ):
        raise ContractError("recipient_binding_mismatch")
    if (
        (
            trigger["kind"] == "legacy_unknown"
            and (trigger["sourceFingerprint"] is not None or trigger["scheduledAt"] is not None)
        )
        or (
            trigger["kind"] == "manual"
            and (trigger["sourceFingerprint"] is None or trigger["scheduledAt"] is not None)
        )
        or (
            trigger["kind"] == "scheduled"
            and (trigger["sourceFingerprint"] is None or trigger["scheduledAt"] is None)
        )
    ):
        raise ContractError("malformed_request")
    return binding


def require_run_current(binding, definition, assignment, slot, *, authority_fingerprint):
    binding = validate_task_center_schema("CenterRunBinding", binding)
    assignment = require_assignment_current(
        definition, assignment, slot, authority_fingerprint=authority_fingerprint
    )
    _match(
        binding,
        {
            k: assignment[k]
            for k in (
                "ownerSubject",
                "vaultId",
                "taskId",
                *_VERSIONS,
                "assignmentId",
                "assignmentVersion",
                "slotId",
                "slotGeneration",
                "provider",
                "credential",
                "agentId",
                "authorityFingerprint",
            )
        },
    )
    if binding["triggerId"] != assignment_trigger_id(
        assignment, binding["trigger"]["baseTriggerId"], kind=binding["trigger"]["kind"]
    ):
        raise ContractError("recipient_binding_mismatch")
    return binding


def aggregate_progress(snapshot):
    snapshot = validate_task_center_schema("CenterProgressSnapshot", snapshot)
    rows = snapshot["executors"]
    if len({r["assignmentId"] for r in rows}) != len(rows) or any(
        (r["stage"] in {"running", "result_received"} and r["runId"] is None)
        or (r["stage"] == "result_received" and r["resultId"] is None)
        for r in rows
    ):
        raise ContractError("malformed_request")
    counts = Counter(r["stage"] for r in rows)
    active = counts["waiting"] + counts["running"] + counts["awaiting_confirmation"]
    state = (
        "idle"
        if not rows
        else (
            "partial_failure"
            if counts["failed"] and counts["failed"] != len(rows)
            else "failed"
            if counts["failed"] == len(rows)
            else "running"
            if counts["running"]
            else "awaiting_confirmation"
            if counts["awaiting_confirmation"]
            else "waiting"
            if counts["waiting"]
            else "result_received"
            if counts["result_received"]
            else "cancelled"
        )
    )
    return {
        "state": state,
        "hasActiveExecutors": bool(active),
        "counts": {
            key: counts[key]
            for key in (
                "waiting",
                "awaiting_confirmation",
                "running",
                "result_received",
                "failed",
                "cancelled",
            )
        },
    }
