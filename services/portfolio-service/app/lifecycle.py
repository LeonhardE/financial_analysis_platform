"""Bounded local source fences; no broker session or remote Hub transport.

These records are source-owned metadata. An ACK accepted by the internal adapter
is not a wire format or proof of a live Hub transaction. No HTTP route can create
an ACK, clear a pending fence, or reactivate a disconnected/deleted source.
"""

from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import validate_schema

from .store import StoreUnavailable, document_path

MAX_SOURCE_MUTATIONS = 128
ACTIONS = {
    "fence": "resource_fence_request",
    "disconnect": "source_disconnect",
    "delete": "source_delete",
}
_STATE_FIELDS = frozenset(
    {
        "ownerSubject",
        "sourceId",
        "resourceRef",
        "sourceEpoch",
        "state",
        "mutationCount",
        "pendingMutationId",
        "lastMutationId",
    }
)
_MUTATION_FIELDS = frozenset(
    {
        "ownerSubject",
        "sourceId",
        "vaultId",
        "resourceRef",
        "operationId",
        "action",
        "expectedAuthorityVersion",
        "expectedSourceEpoch",
        "sourceEpoch",
        "commandFingerprint",
        "state",
        "requestedAt",
        "completedAt",
    }
)


def _positive(value, *, zero=False):
    return type(value) is int and (0 if zero else 1) <= value <= 9_007_199_254_740_991


def state_path(owner, source):
    return document_path("portfolio_source_states", owner, source)


def mutation_path(owner, source, operation):
    return document_path("portfolio_source_mutations", owner, source, operation)


def source_state(unit, authority):
    row = authority.document
    value = unit.get(state_path(row["ownerSubject"], row["sourceId"]))
    if value is None:
        return {
            "ownerSubject": row["ownerSubject"],
            "sourceId": row["sourceId"],
            "resourceRef": row["resourceRef"],
            "sourceEpoch": row["sourceEpoch"],
            "state": "active",
            "mutationCount": 0,
            "pendingMutationId": None,
            "lastMutationId": None,
        }
    if (
        type(value) is not dict
        or set(value) != _STATE_FIELDS
        or any(
            value[key] != row[key]
            for key in ("ownerSubject", "sourceId", "resourceRef", "sourceEpoch")
        )
        or value["state"] not in {"active", "revoking", "disconnected", "deleted"}
        or type(value["mutationCount"]) is not int
        or not 1 <= value["mutationCount"] <= MAX_SOURCE_MUTATIONS
        or (value["state"] == "revoking") != (value["pendingMutationId"] is not None)
    ):
        raise StoreUnavailable
    try:
        validate_schema("OperationIdentifier", value["lastMutationId"])
        if value["pendingMutationId"] is not None:
            validate_schema("OperationIdentifier", value["pendingMutationId"])
            if value["pendingMutationId"] != value["lastMutationId"]:
                raise StoreUnavailable
    except ContractError:
        raise StoreUnavailable from None
    return value


def require_active(state):
    if state["state"] != "active":
        raise ContractError("insufficient_scope")


def mutation_record(value, *, owner, source, operation, resource_ref):
    if value is None:
        raise ContractError("not_found")
    if (
        type(value) is not dict
        or set(value) != _MUTATION_FIELDS
        or value["ownerSubject"] != owner
        or value["sourceId"] != source
        or value["resourceRef"] != resource_ref
        or value["operationId"] != operation
        or value["action"] not in ACTIONS
        or value["state"] not in {"pending", "acknowledged"}
        or not _positive(value["expectedAuthorityVersion"])
        or not _positive(value["expectedSourceEpoch"])
        or not _positive(value["sourceEpoch"])
        or value["sourceEpoch"] != value["expectedSourceEpoch"] + 1
        or not isinstance(value["requestedAt"], str)
        or (value["state"] == "pending") != (value["completedAt"] is None)
        or (value["completedAt"] is not None and not isinstance(value["completedAt"], str))
    ):
        raise StoreUnavailable
    try:
        validate_schema("Digest", value["commandFingerprint"])
    except ContractError:
        raise StoreUnavailable from None
    return value


def public_mutation(value):
    # No key material or signature is retained. Exact command identity is a
    # public signing-input fingerprint; it is not authority to complete a fence.
    return {
        "operationId": value["operationId"],
        "action": value["action"],
        "resourceRef": value["resourceRef"],
        "sourceEpoch": value["sourceEpoch"],
        "state": value["state"],
        "requestedAt": value["requestedAt"],
        "completedAt": value["completedAt"],
    }
