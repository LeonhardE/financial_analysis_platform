"""Transactional source invalidation and immutable ACKs, never source reactivation.

Only the trusted Portfolio namespace can invalidate over HTTP. Future Run/result
writers must call require_current_bindings in the SAME transaction as their write,
after a fresh external active-source check. This guard is not a source-state RPC,
grant check, recipient-key authorization or result endpoint.
"""

import hashlib
import math
import re
import time
from datetime import UTC, datetime

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

from .store import StoreUnavailable, document_path

MAX_FENCE_MUTATIONS = 128
_OWNER = re.compile(r"[0-9a-f]{64}\Z")
_REASONS = {
    "account_scope_changed": "active",
    "disconnected": "disconnected",
    "deleted": "deleted",
}
_FIELDS = frozenset(
    {
        "contractVersion",
        "ownerSubject",
        "mutationId",
        "ref",
        "expectedSourceEpoch",
        "newSourceEpoch",
        "reason",
    }
)
_STATE_FIELDS = frozenset(
    {"ownerSubject", "ref", "sourceEpoch", "state", "mutationCount", "lastMutationId"}
)
_RECEIPT_FIELDS = frozenset({"request", "fingerprint", "ack"})
_ACK_FIELDS = frozenset(
    {"contractVersion", "mutationId", "ref", "acknowledgedSourceEpoch", "acknowledgedAt"}
)


def _owner(value):
    if type(value) is not str or _OWNER.fullmatch(value) is None:
        raise ContractError("malformed_request")


def _epoch(value):
    if type(value) is not int or not 1 <= value <= 9_007_199_254_740_991:
        raise ContractError("malformed_request")


def _reference(value):
    validate_schema("ResourceRef", value)


def _mutation(value):
    if (
        type(value) is not dict
        or set(value) != _FIELDS
        or value.get("contractVersion") != CONTRACT_VERSION
    ):
        raise ContractError("malformed_request")
    _owner(value["ownerSubject"])
    validate_schema("OperationIdentifier", value["mutationId"])
    _reference(value["ref"])
    _epoch(value["expectedSourceEpoch"])
    _epoch(value["newSourceEpoch"])
    if (
        value["newSourceEpoch"] != value["expectedSourceEpoch"] + 1
        or type(value["reason"]) is not str
        or value["reason"] not in _REASONS
    ):
        raise ContractError("malformed_request")


def fence_path(owner, ref):
    return document_path(
        "hub_source_fences",
        owner,
        ref["sourceService"],
        ref["kind"],
        ref["resourceId"],
        ref["incarnation"],
    )


def receipt_path(owner, namespace, mutation):
    # One operation ID cannot be repurposed for a different resource/incarnation
    # in the same owner's source namespace, even after a process restart.
    return document_path("hub_fence_mutations", owner, namespace, mutation)


def _fingerprint(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _state(unit, owner, ref):
    row = unit.get(fence_path(owner, ref))
    if row is None:
        # Missing means the source's initial epoch 1, never caller-selected
        # initialization at a higher epoch. Reading the absent document is also
        # a Firestore transaction dependency against a racing first fence.
        return {
            "ownerSubject": owner,
            "ref": ref,
            "sourceEpoch": 1,
            "state": "active",
            "mutationCount": 0,
            "lastMutationId": None,
        }
    try:
        if (
            type(row) is not dict
            or set(row) != _STATE_FIELDS
            or row["ownerSubject"] != owner
            or row["ref"] != ref
            or type(row["sourceEpoch"]) is not int
            or type(row["mutationCount"]) is not int
            or not 1 <= row["mutationCount"] <= MAX_FENCE_MUTATIONS
            or row["sourceEpoch"] != row["mutationCount"] + 1
            or row["state"] not in _REASONS.values()
        ):
            raise StoreUnavailable
        validate_schema("OperationIdentifier", row["lastMutationId"])
    except (ContractError, TypeError):
        raise StoreUnavailable from None
    return row


def _saved_ack(saved, request):
    try:
        if type(saved) is not dict or set(saved) != _RECEIPT_FIELDS:
            raise StoreUnavailable
        original = saved["request"]
        _mutation(original)
        if (
            original["ownerSubject"] != request["ownerSubject"]
            or original["ref"]["sourceService"] != request["ref"]["sourceService"]
            or original["mutationId"] != request["mutationId"]
            or saved["fingerprint"] != _fingerprint(original)
        ):
            raise StoreUnavailable
        ack = saved["ack"]
        if (
            type(ack) is not dict
            or set(ack) != _ACK_FIELDS
            or ack["contractVersion"] != CONTRACT_VERSION
            or ack["mutationId"] != original["mutationId"]
            or ack["ref"] != original["ref"]
            or type(ack["acknowledgedSourceEpoch"]) is not int
            or ack["acknowledgedSourceEpoch"] != original["newSourceEpoch"]
            or type(ack["acknowledgedAt"]) is not str
            or not ack["acknowledgedAt"].endswith("Z")
        ):
            raise StoreUnavailable
        datetime.fromisoformat(ack["acknowledgedAt"].replace("Z", "+00:00"))
    except (ContractError, TypeError, ValueError):
        raise StoreUnavailable from None
    if saved["fingerprint"] != _fingerprint(request):
        raise ContractError("idempotency_conflict")
    return strict_json_loads(canonical_json(ack), max_bytes=8192)


def require_current_bindings(unit, owner, bindings):
    """Read source fences inside a future Run/result writer's transaction.

    Caller must first perform fresh source active/epoch checks outside its DB
    transaction and additionally validate task/grant/recipient fences inside it.
    Empty bindings support resource-free tasks. This does not initialize sources
    or trust a caller's claimed source availability.
    """
    _owner(owner)
    if type(bindings) is not list or len(bindings) > 10:
        raise ContractError("malformed_request")
    seen = set()
    for binding in bindings:
        validate_schema("ResourceBinding", binding)
        _epoch(binding["sourceEpoch"])
        ref = binding["ref"]
        key = canonical_json(ref)
        if key in seen:
            raise ContractError("malformed_request")
        seen.add(key)
        current = _state(unit, owner, ref)
        if current["sourceEpoch"] != binding["sourceEpoch"] or current["state"] != "active":
            raise ContractError("version_conflict")


class FenceService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def invalidate(self, request, *, source_service):
        _mutation(request)
        # Route-selected namespace; never derived from request body, token
        # claims supplied by a user, URL, arbitrary service name or client ID.
        if source_service != "portfolio" or request["ref"]["sourceService"] != source_service:
            raise ContractError("insufficient_scope")
        if request["ref"]["kind"] != "holdings":
            raise ContractError("insufficient_scope")
        # Snapshot mutable input before any retry/callback. Only validated,
        # public fence metadata is stored, never a source body or credential.
        request = strict_json_loads(canonical_json(request), max_bytes=8192)
        owner, ref = request["ownerSubject"], request["ref"]

        def update(unit):
            op_path = receipt_path(owner, source_service, request["mutationId"])
            saved = unit.get(op_path)
            if saved is not None:
                return _saved_ack(saved, request)
            current = _state(unit, owner, ref)
            if (
                current["sourceEpoch"] != request["expectedSourceEpoch"]
                or current["state"] == "deleted"
                or (current["state"] == "disconnected" and request["reason"] != "deleted")
            ):
                raise ContractError("version_conflict")
            # Reserve disconnect/delete slots just like the Portfolio producer.
            limit = (
                MAX_FENCE_MUTATIONS
                - {
                    "account_scope_changed": 2,
                    "disconnected": 1,
                    "deleted": 0,
                }[request["reason"]]
            )
            if current["mutationCount"] >= limit:
                raise ContractError("version_conflict")
            now = self.clock()
            if (
                type(now) not in (int, float)
                or not math.isfinite(now)
                or not 0 <= now <= 253402300799
            ):
                raise StoreUnavailable
            ack = {
                "contractVersion": CONTRACT_VERSION,
                "mutationId": request["mutationId"],
                "ref": ref,
                "acknowledgedSourceEpoch": request["newSourceEpoch"],
                "acknowledgedAt": datetime.fromtimestamp(now, UTC)
                .isoformat()
                .replace("+00:00", "Z"),
            }
            # Canonical field ordering keeps first/replayed HTTP bytes identical
            # across SQLite restarts and Firestore map decoding.
            ack = strict_json_loads(canonical_json(ack), max_bytes=8192)
            unit.put(
                fence_path(owner, ref),
                {
                    "ownerSubject": owner,
                    "ref": ref,
                    "sourceEpoch": request["newSourceEpoch"],
                    "state": _REASONS[request["reason"]],
                    "mutationCount": current["mutationCount"] + 1,
                    "lastMutationId": request["mutationId"],
                },
            )
            unit.put(
                op_path, {"request": request, "fingerprint": _fingerprint(request), "ack": ack}
            )
            return ack

        return self.store.transact(update)
