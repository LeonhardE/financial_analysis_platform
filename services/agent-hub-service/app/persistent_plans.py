"""Agent statements and Hub execution observations; neither installs a native plan."""

import time

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.persistent_agents import validate_persistent_schema
from folioview_shared.encrypted.persistent_content import BINDING_FIELDS, digest
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .persistent_agents import snapshot
from .persistent_execution import PersistentExecutionService
from .persistent_publications import stored_authority
from .store import StoreUnavailable, document_path
from .vaults import _current

PROFILE = "folioview.persistent-native-plan.v1"
STATUSES = {"enabled", "paused", "removed", "unconfirmed"}
MAX_REPORTS_PER_DAY = 100


def plan_path(owner, vault, connection, task):
    return document_path("hub_persistent_plans", owner, vault, connection, task)


def operation_path(owner, vault, connection, operation):
    return document_path("hub_persistent_plan_operations", owner, vault, connection, operation)


def validate_report_receipt(value):
    if type(value) is not dict or set(value) != {
        "contractVersion",
        "profile",
        "connectionId",
        "taskId",
        "operationId",
        "version",
        "requestDigest",
        "taskPublicationFingerprint",
        "provider",
        "planReferenceHash",
        "reportedStatus",
        "reportedAt",
        "receivedAt",
        "authority",
        "nativeScheduleAttested",
    }:
        raise StoreUnavailable
    try:
        for field in ("connectionId", "taskId"):
            validate_schema("Identifier", value[field])
        validate_schema("OperationIdentifier", value["operationId"])
        for field in ("requestDigest", "taskPublicationFingerprint"):
            validate_schema("Digest", value[field])
        if value["planReferenceHash"] is not None:
            validate_schema("Digest", value["planReferenceHash"])
        if (
            value["contractVersion"] != CONTRACT_VERSION
            or value["profile"] != PROFILE
            or value["provider"] not in {"muse", "chatgpt"}
            or value["authority"] != "agent_statement"
            or value["nativeScheduleAttested"] is not False
            or type(value["reportedStatus"]) is not str
            or value["reportedStatus"] not in STATUSES
            or type(value["version"]) is not int
            or not 1 <= value["version"] <= 9007199254740991
            or any(type(value[k]) is not int or value[k] < 0 for k in ("reportedAt", "receivedAt"))
            or value["reportedAt"] > value["receivedAt"] + 2
            or (
                value["reportedStatus"] in {"enabled", "paused"}
                and value["planReferenceHash"] is None
            )
        ):
            raise StoreUnavailable
    except (ContractError, TypeError, KeyError):
        raise StoreUnavailable from None
    return value


def validate_observed(value):
    if value is None:
        return
    try:
        if type(value) is not dict or set(value) != {
            "source",
            "runId",
            "triggerId",
            "taskPublicationFingerprint",
            "runCreatedAt",
            "resultId",
            "receivedAt",
            "nativeScheduleAttested",
        }:
            raise StoreUnavailable
        validate_schema("Identifier", value["runId"])
        validate_schema("OperationIdentifier", value["triggerId"])
        validate_schema("Digest", value["taskPublicationFingerprint"])
        if (
            type(value["runCreatedAt"]) is not int
            or value["runCreatedAt"] < 0
            or value["nativeScheduleAttested"] is not False
        ):
            raise StoreUnavailable
        if value["resultId"] is None:
            if value["source"] != "hub_run_receipt" or value["receivedAt"] is not None:
                raise StoreUnavailable
        else:
            validate_schema("Identifier", value["resultId"])
            if (
                value["source"] != "hub_result_receipt"
                or type(value["receivedAt"]) is not int
                or value["receivedAt"] < value["runCreatedAt"]
            ):
                raise StoreUnavailable
    except (ContractError, TypeError, KeyError):
        raise StoreUnavailable from None


def stored_plan(unit, owner, vault, connection, task):
    row = unit.get(plan_path(owner, vault, connection, task))
    if row is None:
        return {"version": 0, "reported": None, "observed": None}
    if (
        type(row) is not dict
        or set(row) != {"version", "reported", "observed"}
        or type(row["version"]) is not int
        or not 0 <= row["version"] <= 9007199254740991
        or (row["reported"] is None) != (row["version"] == 0)
        or len(canonical_json(row)) > 16384
    ):
        raise StoreUnavailable
    if row["reported"] is not None:
        validate_report_receipt(row["reported"])
        if (
            row["reported"]["version"] != row["version"]
            or row["reported"]["taskId"] != task
            or row["reported"]["connectionId"] != connection
        ):
            raise StoreUnavailable
    validate_observed(row["observed"])
    return row


def observe_execution(unit, manifest, *, result_id=None, received_at=None):
    """A Hub receipt proves a Hub event, not which external scheduler caused it."""
    owner, vault, connection, task = (
        manifest[k] for k in ("ownerSubject", "vaultId", "connectionId", "taskId")
    )
    head = stored_plan(unit, owner, vault, connection, task)
    observed = {
        "source": "hub_run_receipt" if result_id is None else "hub_result_receipt",
        "runId": manifest["runId"],
        "triggerId": manifest["triggerId"],
        "taskPublicationFingerprint": manifest["taskPublicationFingerprint"],
        "runCreatedAt": manifest["createdAt"],
        "resultId": result_id,
        "receivedAt": received_at,
        "nativeScheduleAttested": False,
    }
    previous = head["observed"]
    # A delayed result for an earlier Run cannot replace the latest observed Run.
    if previous is not None and (
        previous["runCreatedAt"] > observed["runCreatedAt"]
        or (
            result_id is not None
            and previous["runId"] != observed["runId"]
            and previous["runCreatedAt"] == observed["runCreatedAt"]
        )
        or (
            previous["runId"] == observed["runId"]
            and previous["resultId"] is not None
            and result_id is None
        )
    ):
        return
    unit.put(plan_path(owner, vault, connection, task), {**head, "observed": observed})


def view(unit, owner, vault, connection, task):
    head = stored_plan(unit, owner, vault, connection, task)
    authority = stored_authority(unit, owner, vault, task)
    desired = None
    if authority is not None and authority["context"]["connectionId"] == connection:
        c = authority["context"]
        desired = {
            "taskPublicationFingerprint": authority["fingerprint"],
            "taskVersion": c["taskVersion"],
            "executionEpoch": c["executionEpoch"],
        }
    evidence = None
    if head["reported"] is not None:
        original = unit.get(
            operation_path(owner, vault, connection, head["reported"]["operationId"])
        )
        try:
            if (
                type(original) is not dict
                or set(original)
                != {
                    "requestDigest",
                    "receipt",
                    "requestJson",
                    "proofJson",
                    "identity",
                    "registrySequence",
                    "checkpointDigest",
                }
                or original["receipt"] != head["reported"]
            ):
                raise StoreUnavailable
            request = strict_json_loads(original["requestJson"], max_bytes=8192)
            proof = strict_json_loads(original["proofJson"], max_bytes=16384)
            validate_schema("SignedObject", proof)
            validate_persistent_schema("PersistentAgentIdentity", original["identity"])
            if (
                type(original["registrySequence"]) is not int
                or not 1 <= original["registrySequence"] <= 9007199254740991
            ):
                raise StoreUnavailable
            validate_schema("Digest", original["checkpointDigest"])
            if (
                original["requestDigest"] != head["reported"]["requestDigest"]
                or digest(request) != original["requestDigest"]
                or request["taskId"] != task
                or original["identity"]["connectionId"] != connection
            ):
                raise StoreUnavailable
            evidence = {
                "request": request,
                "proof": proof,
                "identity": original["identity"],
                "registrySequence": original["registrySequence"],
                "checkpointDigest": original["checkpointDigest"],
            }
        except (ContractError, TypeError, KeyError):
            raise StoreUnavailable from None
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": PROFILE,
        "taskId": task,
        "connectionId": connection,
        "version": head["version"],
        "desired": desired,
        "reported": head["reported"],
        "observed": head["observed"],
        "reportedEvidence": evidence,
        "nativeScheduleAttested": False,
    }


class PersistentPlanService(PersistentExecutionService):
    def plan_state(self, owner, vault, connection, proof, path, request):
        if path != (
            f"/agent/v3/persistent/owners/{owner}/vaults/{vault}"
            f"/connections/{connection}/plans/state"
        ):
            raise ContractError("key_authorization_required")
        if type(request) is not dict or set(request) != {"taskId"}:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["taskId"])

        def read(unit):
            *_, identity = self.authenticate(unit, owner, vault, connection, proof, path, request)
            authority = stored_authority(unit, owner, vault, request["taskId"])
            if authority is None or any(
                authority["context"][k] != identity[k] for k in BINDING_FIELDS
            ):
                raise ContractError("insufficient_scope")
            return view(unit, owner, vault, connection, request["taskId"])

        return self.store.transact(read)

    def report_plan(self, owner, vault, connection, proof, path, request):
        if path != (
            f"/agent/v3/persistent/owners/{owner}/vaults/{vault}"
            f"/connections/{connection}/plans/report"
        ):
            raise ContractError("key_authorization_required")
        if type(request) is not dict or set(request) != {
            "taskId",
            "taskPublicationFingerprint",
            "operationId",
            "expectedVersion",
            "provider",
            "planReferenceHash",
            "reportedStatus",
            "reportedAt",
        }:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["taskId"])
        validate_schema("OperationIdentifier", request["operationId"])
        validate_schema("Digest", request["taskPublicationFingerprint"])
        if request["planReferenceHash"] is not None:
            validate_schema("Digest", request["planReferenceHash"])
        if (
            request["provider"] not in {"muse", "chatgpt"}
            or type(request["reportedStatus"]) is not str
            or request["reportedStatus"] not in STATUSES
            or type(request["expectedVersion"]) is not int
            or not 0 <= request["expectedVersion"] < 9007199254740991
            or type(request["reportedAt"]) is not int
            or request["reportedAt"] < 0
            or (
                request["reportedStatus"] in {"enabled", "paused"}
                and request["planReferenceHash"] is None
            )
        ):
            raise ContractError("malformed_request")
        fingerprint = digest(request)

        def write(unit):
            _, _, registry, conn, identity = self.authenticate(
                unit, owner, vault, connection, proof, path, request
            )
            if request["provider"] != conn["provider"]:
                raise ContractError("recipient_binding_mismatch")
            op = operation_path(owner, vault, connection, request["operationId"])
            previous = unit.get(op)
            if previous is not None:
                if previous.get("requestDigest") != fingerprint:
                    raise ContractError("idempotency_conflict")
                validate_report_receipt(previous["receipt"])
                return snapshot(previous["receipt"])
            task = request["taskId"]
            if request["reportedStatus"] == "enabled":
                authority = self.task_authority(unit, owner, vault, connection, identity, task)
            else:
                authority = stored_authority(unit, owner, vault, task)
                if authority is None or any(
                    authority["context"][k] != identity[k] for k in BINDING_FIELDS
                ):
                    raise ContractError("insufficient_scope")
            if authority["fingerprint"] != request["taskPublicationFingerprint"]:
                raise ContractError("version_conflict")
            if request["reportedAt"] > self.now() + 2:
                raise ContractError("malformed_request")
            head = stored_plan(unit, owner, vault, connection, task)
            if head["version"] != request["expectedVersion"]:
                raise ContractError("version_conflict")
            quota_path = document_path(
                "hub_persistent_plan_quotas", owner, connection, str(self.now() // 86400)
            )
            quota = unit.get(quota_path) or {"count": 0}
            if (
                type(quota.get("count")) is not int
                or not 0 <= quota["count"] <= MAX_REPORTS_PER_DAY
            ):
                raise StoreUnavailable
            if quota["count"] >= MAX_REPORTS_PER_DAY:
                raise ContractError("version_conflict")
            receipt = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "connectionId": connection,
                "taskId": task,
                "operationId": request["operationId"],
                "version": head["version"] + 1,
                "requestDigest": fingerprint,
                "taskPublicationFingerprint": request["taskPublicationFingerprint"],
                "provider": conn["provider"],
                "planReferenceHash": request["planReferenceHash"],
                "reportedStatus": request["reportedStatus"],
                "reportedAt": request["reportedAt"],
                "receivedAt": self.now(),
                "authority": "agent_statement",
                "nativeScheduleAttested": False,
            }
            self.authenticate(unit, owner, vault, connection, proof, path, request)
            unit.put(
                op,
                {
                    "requestDigest": fingerprint,
                    "receipt": receipt,
                    "requestJson": canonical_json(request).decode(),
                    "proofJson": canonical_json(proof).decode(),
                    "identity": snapshot(identity),
                    "registrySequence": registry.registry_sequence,
                    "checkpointDigest": registry.checkpoint_digest,
                },
            )
            unit.put(
                plan_path(owner, vault, connection, task),
                {
                    **head,
                    "version": receipt["version"],
                    "reported": receipt,
                },
            )
            unit.put(quota_path, {"count": quota["count"] + 1})
            return receipt

        return self.store.transact(write)


class PersistentOwnerPlanService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def state(self, uid, vault, connection, task):
        for value in (vault, connection, task):
            validate_schema("Identifier", value)
        owner = owner_key(uid)

        def read(unit):
            _current(unit, owner, int(self.clock()), vault)
            conn = unit.get(document_path("hub_oauth_connections", owner, connection))
            if conn is None or conn.get("ownerSubject") != owner or conn.get("vaultId") != vault:
                raise ContractError("not_found")
            result = view(unit, owner, vault, connection, task)
            result["parentRevoked"] = conn.get("status") == "revoked"
            return result

        return self.store.transact(read)
