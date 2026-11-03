"""Permanent, root-approved denial of one immutable task-upload operation.

The original operation document is also fenced, so a rolling older writer fails
closed and an already-running transaction conflicts before acknowledging a save.
"""

import math
import time

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .store import StoreUnavailable, document_path
from .vaults import _current, identifier, positive

PROFILE = "folioview.task-upload-cancellation.v1"
MAX_CANCELLATIONS = 32
MAX_BODY_BYTES = 8192
TOMBSTONE = "task_upload_cancellation_tombstone"
_PAYLOAD_FIELDS = {
    "artifactType",
    "contractVersion",
    "profile",
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "rootEpoch",
    "cancellationId",
    "target",
}
_TARGET_FIELDS = {
    "taskId",
    "operationId",
    "mode",
    "expectedVersion",
    "authorKeyId",
    "envelopeFingerprint",
    "requestFingerprint",
    "packetDigest",
}
_LEDGER_FIELDS = {"ownerSubject", "vaultId", "rootKeyId", "rootEpoch", "records"}
_RECEIPT_FIELDS = {
    "cancellationId",
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "rootEpoch",
    "target",
    "commandFingerprint",
    "outcome",
    "acceptedAt",
}


def _copy(value):
    return strict_json_loads(canonical_json(value))


def ledger_path(owner, vault):
    return document_path("hub_upload_cancellations", owner, vault)


def operation_path(owner, vault, task, operation):
    return document_path("hub_task_operations", owner, vault, task, operation)


def _target(value):
    if type(value) is not dict or set(value) != _TARGET_FIELDS:
        raise ContractError("malformed_request")
    identifier(value["taskId"])
    validate_schema("OperationIdentifier", value["operationId"])
    validate_schema("KeyId", value["authorKeyId"])
    for key in ("envelopeFingerprint", "requestFingerprint", "packetDigest"):
        validate_schema("Digest", value[key])
    positive(value["expectedVersion"], zero=True)
    if (
        type(value["mode"]) is not str
        or value["mode"] not in {"create", "update", "transition"}
        or (value["mode"] == "create") != (value["expectedVersion"] == 0)
        or value["expectedVersion"] >= 50
    ):
        raise ContractError("malformed_request")


def _payload(command, vault):
    if len(canonical_json(command)) > MAX_BODY_BYTES:
        raise ContractError("payload_too_large")
    payload = verify_jws(
        command, vault["rootJwk"], typ="fv-control+jws", expected_kid=vault["rootKeyId"]
    )
    if type(payload) is not dict or set(payload) != _PAYLOAD_FIELDS:
        raise ContractError("malformed_request")
    if payload["contractVersion"] != CONTRACT_VERSION:
        raise ContractError("unsupported_contract")
    if payload["profile"] != PROFILE:
        raise ContractError("unsupported_profile")
    if (
        payload["artifactType"] != "task_upload_cancellation_intent"
        or type(payload["rootEpoch"]) is not int
        or payload["rootEpoch"] != 1
    ):
        raise ContractError("malformed_request")
    if any(payload[key] != vault[key] for key in ("ownerSubject", "vaultId", "rootKeyId")):
        raise ContractError("recipient_binding_mismatch")
    validate_schema("OperationIdentifier", payload["cancellationId"])
    _target(payload["target"])
    return payload


def _receipt(payload, command, outcome, accepted_at):
    return {
        **{
            key: payload[key]
            for key in (
                "cancellationId",
                "ownerSubject",
                "vaultId",
                "rootKeyId",
                "rootEpoch",
                "target",
            )
        },
        "commandFingerprint": signing_input_fingerprint(command),
        "outcome": outcome,
        "acceptedAt": accepted_at,
    }


def _response(record):
    result = {"contractVersion": CONTRACT_VERSION, "profile": PROFILE, **record}
    check_read_response(result)
    return _copy(result)


def _ledger(unit, vault):
    row = unit.get(ledger_path(vault["ownerSubject"], vault["vaultId"]))
    if row is None:
        return {
            **{key: vault[key] for key in ("ownerSubject", "vaultId", "rootKeyId")},
            "rootEpoch": 1,
            "records": {},
        }
    try:
        if (
            type(row) is not dict
            or set(row) != _LEDGER_FIELDS
            or any(row[key] != vault[key] for key in ("ownerSubject", "vaultId", "rootKeyId"))
            or type(row["rootEpoch"]) is not int
            or row["rootEpoch"] != 1
            or type(row["records"]) is not dict
            or not 1 <= len(row["records"]) <= MAX_CANCELLATIONS
        ):
            raise StoreUnavailable
        for cancellation, record in row["records"].items():
            if type(record) is not dict or set(record) != {"command", "receipt"}:
                raise StoreUnavailable
            payload = _payload(record["command"], vault)
            receipt = record["receipt"]
            if (
                payload["cancellationId"] != cancellation
                or type(receipt) is not dict
                or set(receipt) != _RECEIPT_FIELDS
                or type(receipt["acceptedAt"]) is not int
                or not 0 <= receipt["acceptedAt"] <= 253402300799
                or receipt["outcome"] not in {"saved", "cancelled"}
                or canonical_json(receipt)
                != canonical_json(
                    _receipt(payload, record["command"], receipt["outcome"], receipt["acceptedAt"])
                )
            ):
                raise StoreUnavailable
        return row
    except (ContractError, ValueError, TypeError, KeyError):
        raise StoreUnavailable from None


def _matching(ledger, task, operation):
    records = [
        record
        for record in ledger["records"].values()
        if record["receipt"]["target"]["taskId"] == task
        and record["receipt"]["target"]["operationId"] == operation
    ]
    if records and any(
        canonical_json(record["receipt"]["target"])
        != canonical_json(records[0]["receipt"]["target"])
        or record["receipt"]["outcome"] != records[0]["receipt"]["outcome"]
        for record in records
    ):
        raise StoreUnavailable
    return records


def _saved(unit, vault, task, operation, saved):
    # Keep the task's historical verifier authoritative and avoid nested store
    # transactions; importing at call time avoids a module initialization cycle.
    from .tasks import _OP_FIELDS, _head, _index
    from .tasks import _response as task_response

    owner, vault_id = vault["ownerSubject"], vault["vaultId"]
    try:
        index = _index(unit, owner, vault_id)
        head = _head(unit, owner, vault_id, task, index)
        if (
            type(saved) is not dict
            or set(saved) != _OP_FIELDS
            or saved["ownerSubject"] != owner
            or saved["vaultId"] != vault_id
            or saved["taskId"] != task
            or head is None
        ):
            raise StoreUnavailable
        positive(saved["version"])
        validate_schema("Digest", saved["fingerprint"])
        validate_schema("KeyId", saved["authorKeyId"])
        if saved["version"] > head["metadata"]["taskVersion"]:
            raise StoreUnavailable
        original = task_response(unit, owner, vault, task, saved["version"])
        context = _signed_parts(original["signedObject"])[1]["context"]
        if (
            context["stableOperationId"] != operation
            or context["authorSigningKeyId"] != saved["authorKeyId"]
        ):
            raise StoreUnavailable
        return {
            "taskId": task,
            "operationId": operation,
            "mode": {
                "create_task": "create",
                "update_task": "update",
                "transition_task": "transition",
            }[context["operationType"]],
            "expectedVersion": context["expectedRevision"],
            "authorKeyId": saved["authorKeyId"],
            "envelopeFingerprint": original["metadata"]["envelopeFingerprint"],
            "requestFingerprint": saved["fingerprint"],
        }
    except (ContractError, ValueError, TypeError, KeyError):
        raise StoreUnavailable from None


def _saved_matches(unit, vault, task, operation, saved, target):
    facts = _saved(unit, vault, task, operation, saved)
    # packetDigest is the owner's signed digest of its complete PendingTask;
    # the producer does not possess or reconstruct that client-only packet.
    return all(facts[key] == target[key] for key in facts)


def _tombstone(vault, record):
    receipt = record["receipt"]
    target = receipt["target"]
    return {
        "artifactType": TOMBSTONE,
        "ownerSubject": vault["ownerSubject"],
        "vaultId": vault["vaultId"],
        "taskId": target["taskId"],
        "operationId": target["operationId"],
        "cancellationId": receipt["cancellationId"],
        "target": target,
        "commandFingerprint": receipt["commandFingerprint"],
    }


def operation_cancelled(unit, vault, task, operation, saved, *, ledger=None):
    """Validate the current operation's permanent fence within its transaction."""
    ledger = _ledger(unit, vault) if ledger is None else ledger
    matching = _matching(ledger, task, operation)
    if type(saved) is dict and saved.get("artifactType") == TOMBSTONE:
        if type(saved.get("cancellationId")) is not str:
            raise StoreUnavailable
        record = ledger["records"].get(saved.get("cancellationId"))
        if (
            not matching
            or record is None
            or record["receipt"]["outcome"] != "cancelled"
            or canonical_json(saved) != canonical_json(_tombstone(vault, record))
            or record not in matching
        ):
            raise StoreUnavailable
        return True
    if matching:
        if (
            matching[0]["receipt"]["outcome"] != "saved"
            or saved is None
            or not _saved_matches(
                unit, vault, task, operation, saved, matching[0]["receipt"]["target"]
            )
        ):
            raise StoreUnavailable
    return False


class TaskUploadCancellationService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock

    def now(self):
        now = self.clock()
        if type(now) not in (int, float) or not math.isfinite(now) or not 0 <= now <= 253402300799:
            raise StoreUnavailable
        return int(now)

    def get(self, uid, task, cancellation):
        identifier(task)
        validate_schema("OperationIdentifier", cancellation)
        owner = owner_key(uid)

        def read(unit):
            vault, _ = _current(unit, owner, self.now())
            ledger = _ledger(unit, vault)
            record = ledger["records"].get(cancellation)
            if record is None or record["receipt"]["target"]["taskId"] != task:
                raise ContractError("not_found")
            target = record["receipt"]["target"]
            saved = unit.get(operation_path(owner, vault["vaultId"], task, target["operationId"]))
            cancelled = operation_cancelled(
                unit, vault, task, target["operationId"], saved, ledger=ledger
            )
            if cancelled != (record["receipt"]["outcome"] == "cancelled"):
                raise StoreUnavailable
            return _response(record)

        return self.store.transact(read)

    def cancel(self, uid, task, body, cancellation):
        identifier(task)
        validate_schema("OperationIdentifier", cancellation)
        if (
            type(body) is not dict
            or set(body) != {"contractVersion", "command"}
            or body["contractVersion"] != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        if len(canonical_json(body)) > MAX_BODY_BYTES:
            raise ContractError("payload_too_large")
        owner = owner_key(uid)

        def update(unit):
            vault, _ = _current(unit, owner, self.now())
            payload = _payload(body["command"], vault)
            if payload["cancellationId"] != cancellation:
                raise ContractError("idempotency_conflict")
            target = payload["target"]
            if target["taskId"] != task:
                raise ContractError("recipient_binding_mismatch")
            ledger = _ledger(unit, vault)
            prior = ledger["records"].get(cancellation)
            if prior and prior["receipt"]["commandFingerprint"] != signing_input_fingerprint(
                body["command"]
            ):
                raise ContractError("idempotency_conflict")
            path = operation_path(owner, vault["vaultId"], task, target["operationId"])
            saved = unit.get(path)
            cancelled = operation_cancelled(
                unit, vault, task, target["operationId"], saved, ledger=ledger
            )
            matching = _matching(ledger, task, target["operationId"])
            if matching and canonical_json(matching[0]["receipt"]["target"]) != canonical_json(
                target
            ):
                raise ContractError("idempotency_conflict")
            if prior:
                return _response(prior)
            if len(ledger["records"]) >= MAX_CANCELLATIONS:
                raise ContractError("version_conflict")
            if saved is not None and not cancelled:
                if not _saved_matches(unit, vault, task, target["operationId"], saved, target):
                    raise ContractError("idempotency_conflict")
                outcome = "saved"
            else:
                outcome = "cancelled"
            record = {
                "command": _copy(body["command"]),
                "receipt": _receipt(payload, body["command"], outcome, self.now()),
            }
            result = _response(record)
            next_ledger = {**ledger, "records": {**ledger["records"], cancellation: record}}
            # All reads, including historical saved validation, precede writes.
            unit.put(ledger_path(owner, vault["vaultId"]), next_ledger)
            if saved is None:
                unit.put(path, _tombstone(vault, record))
            return result

        return self.store.transact(update)
