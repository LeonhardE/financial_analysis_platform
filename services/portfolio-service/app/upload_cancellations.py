"""Permanent, root-authorized denial of one original holdings upload.

The fence occupies the existing upload operation namespace, so an older writer
transaction also conflicts with it. A receipt never authorizes a content write.
"""

from datetime import datetime

from folioview_shared.encrypted.authority import verify_registry
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.envelope import EnvelopeExpectation, parse_carrier, verify_carrier
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .holdings import (
    PortfolioError,
    _authority,
    _binding_for_history,
    _identifier,
    _operation_path,
    _positive,
    _receipt,
)
from .store import StoreUnavailable, document_path

PROFILE = "folioview.holdings-upload-cancellation.v1"
MAX_CANCELLATIONS = 32
TARGET_FIELDS = {
    "resourceRef",
    "sourceEpoch",
    "snapshotId",
    "operationId",
    "expectedRevision",
    "authorKeyId",
    "envelopeFingerprint",
    "packetDigest",
}
INTENT_FIELDS = {
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
RECEIPT_FIELDS = {
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
LEDGER_FIELDS = {"profile", "ownerSubject", "vaultId", "rootKeyId", "rootEpoch", "records"}
FENCE_FIELDS = {
    "profile",
    "kind",
    "ownerSubject",
    "vaultId",
    "sourceId",
    "operationId",
    "cancellationId",
    "commandFingerprint",
}
OPERATION_FIELDS = {"ownerSubject", "sourceId", "fingerprint", "receipt"}
SNAPSHOT_FIELDS = {
    "ownerSubject",
    "sourceId",
    "snapshotId",
    "revision",
    "sourceEpoch",
    "carrierJson",
    "keyProofs",
    "fingerprint",
    "receipt",
}


def _exact(value, fields):
    if type(value) is not dict or set(value) != fields:
        raise ContractError("malformed_request")


def _target(value):
    _exact(value, TARGET_FIELDS)
    validate_schema("ResourceRef", value["resourceRef"])
    if (value["resourceRef"]["kind"], value["resourceRef"]["sourceService"]) != (
        "holdings",
        "portfolio",
    ):
        raise ContractError("recipient_binding_mismatch")
    _positive(value["sourceEpoch"])
    _positive(value["expectedRevision"], zero=True)
    if value["expectedRevision"] == 9_007_199_254_740_991:
        raise ContractError("malformed_request")
    _identifier(value["snapshotId"])
    validate_schema("OperationIdentifier", value["operationId"])
    validate_schema("KeyId", value["authorKeyId"])
    for field in ("envelopeFingerprint", "packetDigest"):
        validate_schema("Digest", value[field])


def _trusted(unit, owner, source, now):
    _identifier(source)
    row = unit.get(document_path("portfolio_authorities", owner, source))
    if row is None:
        raise PortfolioError(
            "authorization_unavailable", 503, "Trusted Portfolio authority is not available."
        )
    try:
        return _authority(row, owner, source, now)
    except (ContractError, ValueError, KeyError, TypeError):
        raise StoreUnavailable from None


def _intent(command, authority):
    row = authority.document
    if len(canonical_json(command)) > 8192:
        raise ContractError("payload_too_large")
    payload = verify_jws(
        command, row["rootJwk"], typ="fv-control+jws", expected_kid=row["rootKeyId"]
    )
    _exact(payload, INTENT_FIELDS)
    if (
        payload["artifactType"] != "holdings_upload_cancellation_intent"
        or payload["contractVersion"] != CONTRACT_VERSION
        or payload["profile"] != PROFILE
        or type(payload["rootEpoch"]) is not int
        or payload["rootEpoch"] != 1
        or any(payload[field] != row[field] for field in ("ownerSubject", "vaultId", "rootKeyId"))
    ):
        raise ContractError("recipient_binding_mismatch")
    validate_schema("OperationIdentifier", payload["cancellationId"])
    _target(payload["target"])
    return payload


def _response(value, authority, cancellation, now):
    _exact(value, {"contractVersion", "profile", "command", "receipt"})
    if value["contractVersion"] != CONTRACT_VERSION or value["profile"] != PROFILE:
        raise StoreUnavailable
    payload = _intent(value["command"], authority)
    receipt = value["receipt"]
    _exact(receipt, RECEIPT_FIELDS)
    if (
        payload["cancellationId"] != cancellation
        or any(
            receipt[field] != payload[field]
            for field in (
                "cancellationId",
                "ownerSubject",
                "vaultId",
                "rootKeyId",
                "rootEpoch",
                "target",
            )
        )
        or receipt["commandFingerprint"] != signing_input_fingerprint(value["command"])
        or receipt["outcome"] not in {"saved", "cancelled"}
        or type(receipt["rootEpoch"]) is not int
        or type(receipt["acceptedAt"]) is not int
        or not 0 <= receipt["acceptedAt"] <= now
    ):
        raise StoreUnavailable
    check_read_response(value)
    return payload


def ledger_path(owner, vault):
    return document_path("portfolio_upload_cancellations", owner, vault)


def _ledger(unit, authority, now):
    row = authority.document
    value = unit.get(ledger_path(row["ownerSubject"], row["vaultId"]))
    if value is None:
        return {
            "profile": PROFILE,
            **{field: row[field] for field in ("ownerSubject", "vaultId", "rootKeyId")},
            "rootEpoch": 1,
            "records": {},
        }
    try:
        _exact(value, LEDGER_FIELDS)
        if (
            value["profile"] != PROFILE
            or type(value["rootEpoch"]) is not int
            or value["rootEpoch"] != 1
            or any(value[field] != row[field] for field in ("ownerSubject", "vaultId", "rootKeyId"))
            or type(value["records"]) is not dict
            or not 1 <= len(value["records"]) <= MAX_CANCELLATIONS
        ):
            raise StoreUnavailable
        for cancellation, response in value["records"].items():
            validate_schema("OperationIdentifier", cancellation)
            _response(response, authority, cancellation, now)
        return value
    except (ContractError, ValueError, KeyError, TypeError):
        raise StoreUnavailable from None


def is_fence(value):
    return type(value) is dict and set(value) != OPERATION_FIELDS


def validate_fence(unit, value, authority, operation, now, ledger=None):
    """Rejoin both immutable records, including on commit/receipt retries."""
    try:
        _exact(value, FENCE_FIELDS)
        row = authority.document
        ledger = _ledger(unit, authority, now) if ledger is None else ledger
        response = ledger["records"][value["cancellationId"]]
        payload = _response(response, authority, value["cancellationId"], now)
        target = payload["target"]
        if (
            value["profile"] != PROFILE
            or value["kind"] != "holdings_upload_cancelled"
            or any(value[field] != row[field] for field in ("ownerSubject", "vaultId"))
            or value["sourceId"] != target["resourceRef"]["resourceId"]
            or value["operationId"] != operation
            or target["operationId"] != operation
            or value["commandFingerprint"] != response["receipt"]["commandFingerprint"]
            or response["receipt"]["outcome"] != "cancelled"
        ):
            raise StoreUnavailable
        return response
    except (ContractError, ValueError, KeyError, TypeError):
        raise StoreUnavailable from None


def _saved(unit, operation, authority, target, now):
    """Inspect the fixed committed version internally; never expose hidden ciphertext."""
    try:
        row = authority.document
        _exact(operation, OPERATION_FIELDS)
        receipt = _receipt(
            operation["receipt"],
            owner=row["ownerSubject"],
            source=operation["sourceId"],
            snapshot=operation["receipt"]["snapshotId"],
        )
        if (
            operation["ownerSubject"] != row["ownerSubject"]
            or operation["fingerprint"] != receipt["envelopeFingerprint"]
            or receipt["vaultId"] != row["vaultId"]
            or receipt["stableOperationId"] != target["operationId"]
        ):
            raise StoreUnavailable
        if (
            operation["sourceId"] != row["sourceId"]
            or operation["fingerprint"] != target["envelopeFingerprint"]
            or any(
                receipt[field] != expected
                for field, expected in {
                    "vaultId": row["vaultId"],
                    "resourceRef": target["resourceRef"],
                    "snapshotId": target["snapshotId"],
                    "revision": target["expectedRevision"] + 1,
                    "sourceEpoch": target["sourceEpoch"],
                    "stableOperationId": target["operationId"],
                    "envelopeFingerprint": target["envelopeFingerprint"],
                }.items()
            )
        ):
            raise ContractError("idempotency_conflict")
        snapshot = unit.get(
            document_path(
                "portfolio_snapshots", row["ownerSubject"], row["sourceId"], target["snapshotId"]
            )
        )
        _exact(snapshot, SNAPSHOT_FIELDS)
        if any(
            snapshot[field] != expected
            for field, expected in {
                "ownerSubject": row["ownerSubject"],
                "sourceId": row["sourceId"],
                "snapshotId": target["snapshotId"],
                "revision": target["expectedRevision"] + 1,
                "sourceEpoch": target["sourceEpoch"],
                "receipt": receipt,
                "fingerprint": target["envelopeFingerprint"],
            }.items()
        ):
            raise StoreUnavailable
        carrier = parse_carrier(snapshot["carrierJson"], contract_header=CONTRACT_VERSION)
        message = strict_json_loads(b64url_decode(carrier["signedObject"]["payload"]))
        validate_schema("ObjectMessage", message)
        context = message["context"]
        if context["authorSigningKeyId"] != target["authorKeyId"]:
            raise ContractError("idempotency_conflict")
        written = datetime.fromisoformat(receipt["storedAt"].replace("Z", "+00:00")).timestamp()
        if not receipt["storedAt"].endswith("Z") or not 0 <= written <= now:
            raise StoreUnavailable
        written = int(written)
        historical = None
        for bundle in row["registryHistory"]:
            historical = verify_registry(
                bundle,
                root_jwk=row["rootJwk"],
                pinned_root_key_id=row["rootKeyId"],
                owner_subject=row["ownerSubject"],
                vault_id=row["vaultId"],
                now=written,
                previous=historical,
            )
            if snapshot["keyProofs"] == {
                "checkpoint": bundle["checkpoint"],
                "certificates": [entry["certificate"] for entry in bundle["entries"]],
            }:
                break
        else:
            raise StoreUnavailable
        if (
            context["registrySequence"] != historical.registry_sequence
            or context["checkpointDigest"] != historical.checkpoint_digest
            or context["keyEpoch"] != historical.key_epoch
        ):
            raise StoreUnavailable
        verified = verify_carrier(
            carrier,
            registry=historical,
            expectation=EnvelopeExpectation(
                owner_subject=row["ownerSubject"],
                vault_id=row["vaultId"],
                object_id=target["snapshotId"],
                object_type="holdings_snapshot",
                revision=target["expectedRevision"] + 1,
                expected_revision=target["expectedRevision"],
                operation_type="commit_snapshot",
                author_signing_key_id=target["authorKeyId"],
                binding=_binding_for_history(authority, snapshot),
                resource_bindings=(),
                recipient_key_ids=tuple(item["keyId"] for item in context["recipients"]),
            ),
            now=written,
            contract_header=CONTRACT_VERSION,
        )
        if (
            verified.fingerprint != target["envelopeFingerprint"]
            or verified.context["stableOperationId"] != target["operationId"]
        ):
            raise StoreUnavailable
    except ContractError as error:
        if error.code == "idempotency_conflict":
            raise
        raise StoreUnavailable from None
    except (ValueError, KeyError, TypeError, OverflowError):
        raise StoreUnavailable from None


def _association(unit, response, authority, now, ledger):
    target = response["receipt"]["target"]
    if target["resourceRef"]["resourceId"] != authority.document["sourceId"]:
        selected = _trusted(
            unit, authority.document["ownerSubject"], target["resourceRef"]["resourceId"], now
        )
        if any(
            selected.document[field] != authority.document[field]
            for field in ("ownerSubject", "vaultId", "rootKeyId")
        ):
            raise StoreUnavailable
        authority = selected
    if (
        target["resourceRef"] != authority.document["resourceRef"]
        or target["sourceEpoch"] > authority.document["sourceEpoch"]
    ):
        raise StoreUnavailable
    operation = unit.get(
        _operation_path(
            authority.document["ownerSubject"], authority.document["vaultId"], target["operationId"]
        )
    )
    if response["receipt"]["outcome"] == "cancelled":
        first = validate_fence(unit, operation, authority, target["operationId"], now, ledger)
        if first["receipt"]["target"] != target:
            raise StoreUnavailable
    else:
        try:
            _saved(unit, operation, authority, target, now)
        except ContractError:
            raise StoreUnavailable from None


def _operation_cancelled(unit, authority, operation, now, ledger, value):
    # Always join ledger decisions to the original operation record. Missing or
    # replaced fences cannot turn an already-cancelled upload into a fresh write.
    for response in ledger["records"].values():
        if response["receipt"]["target"]["operationId"] == operation:
            _association(unit, response, authority, now, ledger)
    if value is not None and is_fence(value):
        validate_fence(unit, value, authority, operation, now, ledger)
        return True
    return False


def operation_cancelled(unit, authority, operation, now):
    ledger = _ledger(unit, authority, now)
    value = unit.get(
        _operation_path(
            authority.document["ownerSubject"], authority.document["vaultId"], operation
        )
    )
    return _operation_cancelled(unit, authority, operation, now, ledger, value)


def cancel_upload(service, uid, source, body, cancellation):
    _identifier(source)
    validate_schema("OperationIdentifier", cancellation)
    _exact(body, {"contractVersion", "command"})
    if body["contractVersion"] != CONTRACT_VERSION:
        raise ContractError("unsupported_contract")
    if len(canonical_json(body)) > 8192:
        raise ContractError("payload_too_large")
    owner = owner_key(uid)

    def write(unit):
        now = service.now()
        authority = _trusted(unit, owner, source, now)
        payload = _intent(body["command"], authority)
        target = payload["target"]
        if (
            payload["cancellationId"] != cancellation
            or target["resourceRef"] != authority.document["resourceRef"]
            or target["sourceEpoch"] > authority.document["sourceEpoch"]
        ):
            raise ContractError("recipient_binding_mismatch")
        ledger = _ledger(unit, authority, now)
        path = _operation_path(owner, authority.document["vaultId"], target["operationId"])
        operation = unit.get(path)
        cancelled = _operation_cancelled(
            unit, authority, target["operationId"], now, ledger, operation
        )
        fingerprint = signing_input_fingerprint(body["command"])
        previous = ledger["records"].get(cancellation)
        if previous is not None:
            if previous["receipt"]["commandFingerprint"] != fingerprint:
                raise ContractError("idempotency_conflict")
            _association(unit, previous, authority, now, ledger)
            return previous
        if len(ledger["records"]) >= MAX_CANCELLATIONS:
            raise ContractError("version_conflict")
        if cancelled:
            first = validate_fence(unit, operation, authority, target["operationId"], now, ledger)
            if first["receipt"]["target"] != target:
                raise ContractError("idempotency_conflict")
        elif operation is not None:
            _saved(unit, operation, authority, target, now)
        outcome = "cancelled" if operation is None or cancelled else "saved"
        response = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "command": body["command"],
            "receipt": {
                **{
                    field: payload[field]
                    for field in (
                        "cancellationId",
                        "ownerSubject",
                        "vaultId",
                        "rootKeyId",
                        "rootEpoch",
                        "target",
                    )
                },
                "commandFingerprint": fingerprint,
                "outcome": outcome,
                "acceptedAt": now,
            },
        }
        _response(response, authority, cancellation, now)
        if outcome == "cancelled" and operation is None:
            unit.put(
                path,
                {
                    "profile": PROFILE,
                    "kind": "holdings_upload_cancelled",
                    "ownerSubject": owner,
                    "vaultId": authority.document["vaultId"],
                    "sourceId": source,
                    "operationId": target["operationId"],
                    "cancellationId": cancellation,
                    "commandFingerprint": fingerprint,
                },
            )
        unit.put(
            ledger_path(owner, authority.document["vaultId"]),
            {**ledger, "records": {**ledger["records"], cancellation: response}},
        )
        return response

    return service.store.transact(write)


def upload_cancellation(service, uid, source, cancellation):
    _identifier(source)
    validate_schema("OperationIdentifier", cancellation)
    owner = owner_key(uid)

    def read(unit):
        now = service.now()
        authority = _trusted(unit, owner, source, now)
        ledger = _ledger(unit, authority, now)
        response = ledger["records"].get(cancellation)
        if (
            response is None
            or response["receipt"]["target"]["resourceRef"] != authority.document["resourceRef"]
        ):
            raise ContractError("not_found")
        if response["receipt"]["target"]["sourceEpoch"] > authority.document["sourceEpoch"]:
            raise StoreUnavailable
        operation_cancelled(unit, authority, response["receipt"]["target"]["operationId"], now)
        _association(unit, response, authority, now, ledger)
        return response

    return service.store.transact(read)
