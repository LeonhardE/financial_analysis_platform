"""Owner-only encrypted snapshots; no plaintext collector or key authority API."""

import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from folioview_shared.encrypted.authority import verify_registry
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint
from folioview_shared.encrypted.envelope import (
    EnvelopeExpectation,
    operation_namespace,
    parse_carrier,
    validate_write_transition,
    verify_carrier,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .store import StoreUnavailable, document_path

_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
_AUTHORITY_FIELDS = frozenset(
    {
        "version",
        "ownerSubject",
        "sourceId",
        "vaultId",
        "rootJwk",
        "rootKeyId",
        "registryHistory",
        "resourceRef",
        "sourceEpoch",
        "active",
        "writerKeyIds",
        "recipientKeyIds",
    }
)
_RECEIPT_FIELDS = frozenset(
    {
        "contractVersion",
        "vaultId",
        "resourceRef",
        "snapshotId",
        "revision",
        "sourceEpoch",
        "stableOperationId",
        "envelopeFingerprint",
        "snapshotPath",
        "storedAt",
    }
)


class PortfolioError(ValueError):
    def __init__(self, code: str, status: int, message: str):
        self.code = code
        self.status = status
        super().__init__(message)


def _identifier(value):
    if not isinstance(value, str) or _IDENTIFIER.fullmatch(value) is None:
        raise ContractError("malformed_request")


def _positive(value, *, zero=False):
    if type(value) is not int or not (0 if zero else 1) <= value <= 9_007_199_254_740_991:
        raise ContractError("malformed_request")


def _key_ids(value):
    if type(value) is not list or not 1 <= len(value) <= 8 or value != sorted(set(value)):
        raise ContractError("key_authorization_required")
    for key in value:
        validate_schema("KeyId", key)


@dataclass(frozen=True)
class Authority:
    document: dict
    registry: object

    @property
    def version(self):
        return self.document["version"]


def _authority(document: dict, owner: str, source: str, now: int) -> Authority:
    """Verify a replica against its separately provisioned root pin and history.

    The document is read from the trusted store, never from a snapshot request.
    Retained consecutive signed directories preserve high-water/revocation checks
    across restart. Storage limits bound this replica; overflow fails closed.
    """
    if type(document) is not dict or set(document) != _AUTHORITY_FIELDS:
        raise StoreUnavailable
    if document["ownerSubject"] != owner or document["sourceId"] != source:
        raise StoreUnavailable
    _positive(document["version"])
    _positive(document["sourceEpoch"])
    _identifier(document["vaultId"])
    validate_schema("PublicJWK", document["rootJwk"])
    if jwk_thumbprint(document["rootJwk"]) != document["rootKeyId"]:
        raise StoreUnavailable
    validate_schema("ResourceRef", document["resourceRef"])
    if (
        document["resourceRef"]["kind"] != "holdings"
        or document["resourceRef"]["resourceId"] != source
        or type(document["active"]) is not bool
    ):
        raise StoreUnavailable
    _key_ids(document["writerKeyIds"])
    _key_ids(document["recipientKeyIds"])
    history = document["registryHistory"]
    if type(history) is not list or not 1 <= len(history) <= 32:
        raise StoreUnavailable
    registry = None
    for bundle in history:
        registry = verify_registry(
            bundle,
            root_jwk=document["rootJwk"],
            pinned_root_key_id=document["rootKeyId"],
            owner_subject=owner,
            vault_id=document["vaultId"],
            now=now,
            previous=registry,
        )
    return Authority(document, registry)


def _current_authority(unit, owner: str, source: str, now: int) -> Authority:
    row = unit.get(document_path("portfolio_authorities", owner, source))
    if row is None:
        raise PortfolioError(
            "authorization_unavailable", 503, "Trusted Portfolio authority is not available."
        )
    try:
        authority = _authority(row, owner, source, now)
    except (ContractError, ValueError, KeyError, TypeError):
        raise StoreUnavailable from None
    if not row["active"]:
        raise PortfolioError("insufficient_scope", 403, "This source is not authorized.")
    return authority


def _head(unit, owner: str, source: str) -> dict:
    row = unit.get(document_path("portfolio_heads", owner, source))
    if row is None:
        return {"ownerSubject": owner, "sourceId": source, "revision": 0, "snapshotId": None}
    if (
        type(row) is not dict
        or set(row) != {"ownerSubject", "sourceId", "revision", "snapshotId"}
        or row["ownerSubject"] != owner
        or row["sourceId"] != source
    ):
        raise StoreUnavailable
    _positive(row["revision"])
    _identifier(row["snapshotId"])
    return row


def _operation_path(owner: str, vault: str, operation: str) -> str:
    # The exact namespace matches shared operation_namespace for source snapshots.
    namespace = (owner, vault, None, None, None, None, "commit_snapshot", operation)
    return document_path("portfolio_operations", canonical_json(list(namespace)).decode())


def _snapshot_path(source: str, snapshot: str) -> str:
    return f"/api/v2/holdings/sources/{source}/snapshots/{snapshot}"


def _binding(authority: Authority, revision: int) -> dict:
    return {
        "taskId": None,
        "taskVersion": None,
        "runId": None,
        "manifestId": None,
        "taskEnvelopeFingerprint": None,
        "manifestFingerprint": None,
        "connectionId": None,
        "grantId": None,
        "grantEpoch": None,
        "executionEpoch": None,
        "resourceRef": authority.document["resourceRef"],
        "sourceRevision": revision,
        "sourceEpoch": authority.document["sourceEpoch"],
    }


def _receipt(value: dict, *, owner: str, source: str, snapshot: str) -> dict:
    if (
        type(value) is not dict
        or set(value) != _RECEIPT_FIELDS
        or value["contractVersion"] != CONTRACT_VERSION
        or value["resourceRef"]["resourceId"] != source
        or value["snapshotId"] != snapshot
        or value["snapshotPath"] != _snapshot_path(source, snapshot)
    ):
        raise StoreUnavailable
    validate_schema("ResourceRef", value["resourceRef"])
    validate_schema("OperationIdentifier", value["stableOperationId"])
    validate_schema("Digest", value["envelopeFingerprint"])
    _positive(value["revision"])
    _positive(value["sourceEpoch"])
    _identifier(value["vaultId"])
    if value["resourceRef"]["kind"] != "holdings" or not isinstance(value["storedAt"], str):
        raise StoreUnavailable
    return value


class PortfolioService:
    def __init__(self, store, *, clock=time.time):
        self.store = store
        self.clock = clock

    def now(self):
        value = self.clock()
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise StoreUnavailable
        return int(value)

    def install_authority(
        self,
        uid: str,
        source: str,
        *,
        expected_version: int,
        vault_id: str,
        root_jwk: dict,
        bundle: dict,
        resource_ref: dict,
        source_epoch: int,
        writer_key_ids: list[str],
        recipient_key_ids: list[str],
        active=True,
    ) -> int:
        """Internal trusted-replica adapter, intentionally not an HTTP endpoint.

        Only a future authenticated Hub adapter may invoke this in production.
        It is not key enrollment: callers must obtain the root pin independently.
        No request/env setting can install a root or turn this gate off.
        """
        _identifier(source)
        _identifier(vault_id)
        _positive(expected_version, zero=True)
        owner = owner_key(uid)
        now = self.now()

        def install(unit):
            path = document_path("portfolio_authorities", owner, source)
            previous = unit.get(path)
            if (previous["version"] if previous else 0) != expected_version:
                raise ContractError("version_conflict")
            history = []
            if previous is not None:
                prior = _authority(previous, owner, source, now)
                if (
                    prior.document["rootJwk"] != root_jwk
                    or prior.document["vaultId"] != vault_id
                    or prior.document["resourceRef"] != resource_ref
                    or source_epoch < prior.document["sourceEpoch"]
                ):
                    raise ContractError("recipient_binding_mismatch")
                history = list(prior.document["registryHistory"])
            if not history or canonical_json(bundle) != canonical_json(history[-1]):
                history.append(bundle)
            row = {
                "version": expected_version + 1,
                "ownerSubject": owner,
                "sourceId": source,
                "vaultId": vault_id,
                "rootJwk": root_jwk,
                "rootKeyId": jwk_thumbprint(root_jwk),
                "registryHistory": history,
                "resourceRef": resource_ref,
                "sourceEpoch": source_epoch,
                "active": active,
                "writerKeyIds": writer_key_ids,
                "recipientKeyIds": recipient_key_ids,
            }
            verified = _authority(row, owner, source, now)
            # Inactive replicas may retain a revoked writer/recipient for fencing.
            if active:
                for key in writer_key_ids:
                    certificate = verified.registry.cert(key, role="device_sig", now=now)
                    if "object_write" not in certificate["capabilities"]:
                        raise ContractError("key_authorization_required")
                roles = {verified.registry.cert(key, now=now)["role"] for key in recipient_key_ids}
                if roles != {"device_enc", "recovery_enc"}:
                    raise ContractError("key_authorization_required")
            unit.put(path, row)
            return row["version"]

        return self.store.transact(install)

    def metadata(self, uid: str, source: str):
        _identifier(source)
        owner = owner_key(uid)

        def read(unit):
            authority = _current_authority(unit, owner, source, self.now())
            head = _head(unit, owner, source)
            return {
                "contractVersion": CONTRACT_VERSION,
                "ownerSubject": owner,
                "sourceId": source,
                "vaultId": authority.document["vaultId"],
                "resourceRef": authority.document["resourceRef"],
                "sourceEpoch": authority.document["sourceEpoch"],
                "revision": head["revision"],
                "snapshotId": head["snapshotId"],
                "authorityVersion": authority.version,
            }

        return self.store.transact(read)

    def commit(
        self,
        uid: str,
        source: str,
        snapshot: str,
        *,
        expected_revision: int,
        writer_key_id: str,
        operation_id: str,
        carrier: dict,
        contract_header: str,
    ):
        _identifier(source)
        _identifier(snapshot)
        _positive(expected_revision, zero=True)
        validate_schema("OperationIdentifier", operation_id)
        validate_schema("KeyId", writer_key_id)
        owner = owner_key(uid)

        def write(unit):
            # Authority, all relevant records and CAS are read inside the same
            # transaction on every attempt, including SDK conflict retries.
            now = self.now()
            authority = _current_authority(unit, owner, source, now)
            row = authority.document
            if writer_key_id not in row["writerKeyIds"]:
                raise ContractError("key_authorization_required")
            expectation = EnvelopeExpectation(
                owner_subject=owner,
                vault_id=row["vaultId"],
                object_id=snapshot,
                object_type="holdings_snapshot",
                revision=expected_revision + 1,
                expected_revision=expected_revision,
                operation_type="commit_snapshot",
                author_signing_key_id=writer_key_id,
                binding=_binding(authority, expected_revision + 1),
                resource_bindings=(),
                recipient_key_ids=tuple(row["recipientKeyIds"]),
            )
            verified = verify_carrier(
                carrier,
                registry=authority.registry,
                expectation=expectation,
                now=now,
                contract_header=contract_header,
            )
            if verified.context["stableOperationId"] != operation_id:
                raise ContractError("idempotency_conflict")
            namespace = operation_namespace(verified.context)
            operation_path = document_path(
                "portfolio_operations", canonical_json(list(namespace)).decode()
            )
            operation = unit.get(operation_path)
            head = _head(unit, owner, source)
            snapshot_path = document_path("portfolio_snapshots", owner, source, snapshot)
            previous_snapshot = unit.get(snapshot_path)
            if operation is not None:
                if (
                    operation.get("ownerSubject") != owner
                    or operation.get("sourceId") != source
                    or operation.get("fingerprint") != verified.fingerprint
                ):
                    raise ContractError("idempotency_conflict")
                receipt = _receipt(
                    operation["receipt"], owner=owner, source=source, snapshot=snapshot
                )
                if (
                    receipt["envelopeFingerprint"] != verified.fingerprint
                    or receipt["stableOperationId"] != operation_id
                ):
                    raise StoreUnavailable
                return receipt
            if (
                verified.context["registrySequence"] != authority.registry.registry_sequence
                or verified.context["checkpointDigest"] != authority.registry.checkpoint_digest
            ):
                raise ContractError("registry_conflict")
            validate_write_transition(verified.context, current_revision=head["revision"])
            if previous_snapshot is not None:
                raise ContractError("idempotency_conflict")
            receipt = {
                "contractVersion": CONTRACT_VERSION,
                "vaultId": row["vaultId"],
                "resourceRef": row["resourceRef"],
                "snapshotId": snapshot,
                "revision": expected_revision + 1,
                "sourceEpoch": row["sourceEpoch"],
                "stableOperationId": operation_id,
                "envelopeFingerprint": verified.fingerprint,
                "snapshotPath": _snapshot_path(source, snapshot),
                "storedAt": datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z"),
            }
            saved = {
                "ownerSubject": owner,
                "sourceId": source,
                "snapshotId": snapshot,
                "revision": expected_revision + 1,
                "sourceEpoch": row["sourceEpoch"],
                "carrierJson": canonical_json(verified.carrier).decode(),
                "keyProofs": {
                    "checkpoint": row["registryHistory"][-1]["checkpoint"],
                    "certificates": [
                        entry["certificate"] for entry in row["registryHistory"][-1]["entries"]
                    ],
                },
                "fingerprint": verified.fingerprint,
                "receipt": receipt,
            }
            unit.put(snapshot_path, saved)
            unit.put(
                operation_path,
                {
                    "ownerSubject": owner,
                    "sourceId": source,
                    "fingerprint": verified.fingerprint,
                    "receipt": receipt,
                },
            )
            unit.put(
                document_path("portfolio_heads", owner, source),
                {
                    "ownerSubject": owner,
                    "sourceId": source,
                    "revision": expected_revision + 1,
                    "snapshotId": snapshot,
                },
            )
            return receipt

        return self.store.transact(write)

    def snapshot(self, uid: str, source: str, snapshot: str | None = None):
        _identifier(source)
        if snapshot is not None:
            _identifier(snapshot)
        owner = owner_key(uid)

        def read(unit):
            # Retrieval authorizes the current owner/source, not an old writer's
            # current key. Clients verify retained historical author proofs.
            authority = _current_authority(unit, owner, source, self.now())
            selected = (
                snapshot if snapshot is not None else _head(unit, owner, source)["snapshotId"]
            )
            if selected is None:
                raise PortfolioError("not_found", 404, "Snapshot not found.")
            row = unit.get(document_path("portfolio_snapshots", owner, source, selected))
            if (
                row is None
                or row.get("ownerSubject") != owner
                or row.get("sourceId") != source
                or row.get("snapshotId") != selected
            ):
                raise PortfolioError("not_found", 404, "Snapshot not found.")
            if row["sourceEpoch"] != authority.document["sourceEpoch"]:
                raise PortfolioError("insufficient_scope", 403, "This source is not authorized.")
            receipt = _receipt(row["receipt"], owner=owner, source=source, snapshot=selected)
            carrier = parse_carrier(row["carrierJson"], contract_header=CONTRACT_VERSION)
            if (
                signing_input_fingerprint(carrier["signedObject"]) != row["fingerprint"]
                or row["fingerprint"] != receipt["envelopeFingerprint"]
            ):
                raise StoreUnavailable
            validate_schema("KeyProofs", row["keyProofs"])
            result = {
                "contractVersion": CONTRACT_VERSION,
                "carrier": carrier,
                "keyProofs": row["keyProofs"],
                "receipt": receipt,
            }
            check_read_response(result)
            return result

        return self.store.transact(read)

    def receipt(self, uid: str, source: str, operation_id: str):
        _identifier(source)
        validate_schema("OperationIdentifier", operation_id)
        owner = owner_key(uid)

        def read(unit):
            authority = _current_authority(unit, owner, source, self.now())
            path = _operation_path(owner, authority.document["vaultId"], operation_id)
            row = unit.get(path)
            if row is None or row.get("ownerSubject") != owner or row.get("sourceId") != source:
                raise PortfolioError("not_found", 404, "Receipt not found.")
            receipt = _receipt(
                row["receipt"],
                owner=owner,
                source=source,
                snapshot=row["receipt"]["snapshotId"],
            )
            if receipt["sourceEpoch"] != authority.document["sourceEpoch"]:
                raise PortfolioError("insufficient_scope", 403, "This source is not authorized.")
            return receipt

        return self.store.transact(read)
