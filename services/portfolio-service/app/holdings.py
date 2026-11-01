"""Owner-only encrypted snapshots; no plaintext collector or key authority API."""

import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from folioview_shared.encrypted.authority import verify_control_command, verify_registry
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.envelope import (
    EnvelopeExpectation,
    operation_namespace,
    parse_carrier,
    validate_write_transition,
    verify_carrier,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .lifecycle import (
    ACTIONS,
    MAX_SOURCE_MUTATIONS,
    mutation_path,
    mutation_record,
    public_mutation,
    require_active,
    source_state,
    state_path,
)
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
        return {
            "ownerSubject": owner,
            "sourceId": source,
            "revision": 0,
            "snapshotId": None,
            "sourceEpoch": None,
        }
    if (
        type(row) is not dict
        or set(row)
        not in (
            {"ownerSubject", "sourceId", "revision", "snapshotId"},
            {"ownerSubject", "sourceId", "revision", "snapshotId", "sourceEpoch"},
        )
        or row["ownerSubject"] != owner
        or row["sourceId"] != source
    ):
        raise StoreUnavailable
    _positive(row["revision"])
    _identifier(row["snapshotId"])
    if "sourceEpoch" in row:
        _positive(row["sourceEpoch"])
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


def _binding_for_history(authority: Authority, row: dict) -> dict:
    binding = _binding(authority, row["revision"])
    binding["sourceEpoch"] = row["sourceEpoch"]
    return binding


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
                lifecycle = unit.get(state_path(owner, source))
                if lifecycle is not None:
                    source_state(unit, prior)
                    # Local fences own source epochs once initialized. A replica
                    # update may rotate public keys or lock the vault, but cannot
                    # skip a pending fence or resurrect a terminal source.
                    if source_epoch != prior.document["sourceEpoch"]:
                        raise ContractError("version_conflict")
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

    def synchronize_authority(self, uid: str, source: str, document: dict):
        """Install a public projection fetched by the authenticated Hub adapter.

        This method has no direct HTTP body binding. The caller must obtain its
        document from the fixed dual-authenticated Hub read, never a browser's
        proposed root. Hub versions are not local replica/lifecycle CAS versions.
        """
        _identifier(source)
        owner = owner_key(uid)
        now = self.now()
        verified = _authority(document, owner, source, now)
        if document["active"]:
            for key in document["writerKeyIds"]:
                cert = verified.registry.cert(key, role="device_sig", now=now)
                if "object_write" not in cert["capabilities"]:
                    raise ContractError("key_authorization_required")
            roles = {
                verified.registry.cert(key, now=now)["role"] for key in document["recipientKeyIds"]
            }
            if roles != {"device_enc", "recovery_enc"}:
                raise ContractError("key_authorization_required")

        def install(unit):
            path = document_path("portfolio_authorities", owner, source)
            previous = unit.get(path)
            version = 0
            if previous is not None:
                prior = _authority(previous, owner, source, self.now())
                # A read/sync cannot unlock a locally locked replica, replace a
                # root/incarnation or roll back/skip a source-owned fence.
                if not prior.document["active"]:
                    raise ContractError("insufficient_scope")
                if any(
                    previous[key] != document[key]
                    for key in ("rootJwk", "rootKeyId", "vaultId", "resourceRef", "sourceEpoch")
                ):
                    raise ContractError("recipient_binding_mismatch")
                old_history = previous["registryHistory"]
                if canonical_json(
                    document["registryHistory"][: len(old_history)]
                ) != canonical_json(old_history):
                    raise ContractError("registry_conflict")
                source_state(unit, prior)
                version = prior.version
                if all(previous[key] == document[key] for key in _AUTHORITY_FIELDS - {"version"}):
                    return {
                        "contractVersion": CONTRACT_VERSION,
                        "authorityVersion": version,
                        "sourceEpoch": previous["sourceEpoch"],
                    }
            _positive(version + 1)
            replica = {**document, "version": version + 1}
            _authority(replica, owner, source, self.now())
            unit.put(path, replica)
            return {
                "contractVersion": CONTRACT_VERSION,
                "authorityVersion": version + 1,
                "sourceEpoch": replica["sourceEpoch"],
            }

        return self.store.transact(install)

    def metadata(self, uid: str, source: str):
        _identifier(source)
        owner = owner_key(uid)

        def read(unit):
            authority = _current_authority(unit, owner, source, self.now())
            head = _head(unit, owner, source)
            lifecycle = source_state(unit, authority)
            return {
                "contractVersion": CONTRACT_VERSION,
                "ownerSubject": owner,
                "sourceId": source,
                "vaultId": authority.document["vaultId"],
                "resourceRef": authority.document["resourceRef"],
                "sourceEpoch": authority.document["sourceEpoch"],
                "revision": head["revision"],
                "snapshotId": head["snapshotId"],
                "snapshotSourceEpoch": head.get("sourceEpoch"),
                "authorityVersion": authority.version,
                "state": lifecycle["state"],
                "pendingMutationId": lifecycle["pendingMutationId"],
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
            require_active(source_state(unit, authority))
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
                    "sourceEpoch": row["sourceEpoch"],
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
            self._owner_history(unit, authority)
            if (
                type(row["sourceEpoch"]) is not int
                or not 1 <= row["sourceEpoch"] <= authority.document["sourceEpoch"]
            ):
                raise StoreUnavailable
            receipt = _receipt(row["receipt"], owner=owner, source=source, snapshot=selected)
            carrier = parse_carrier(row["carrierJson"], contract_header=CONTRACT_VERSION)
            if (
                signing_input_fingerprint(carrier["signedObject"]) != row["fingerprint"]
                or row["fingerprint"] != receipt["envelopeFingerprint"]
            ):
                raise StoreUnavailable
            message = strict_json_loads(b64url_decode(carrier["signedObject"]["payload"]))
            context = message["context"]
            if (
                context["ownerSubject"] != owner
                or context["vaultId"] != authority.document["vaultId"]
                or context["rootKeyId"] != authority.document["rootKeyId"]
                or context["objectType"] != "holdings_snapshot"
                or context["objectId"] != selected
                or context["revision"] != row["revision"]
                or context["binding"] != _binding_for_history(authority, row)
                or receipt["resourceRef"] != authority.document["resourceRef"]
                or receipt["sourceEpoch"] != row["sourceEpoch"]
                or receipt["revision"] != row["revision"]
                or receipt["vaultId"] != context["vaultId"]
                or receipt["stableOperationId"] != context["stableOperationId"]
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
            self._owner_history(unit, authority)
            if (
                not 1 <= receipt["sourceEpoch"] <= authority.document["sourceEpoch"]
                or receipt["resourceRef"] != authority.document["resourceRef"]
                or receipt["vaultId"] != authority.document["vaultId"]
                or receipt["stableOperationId"] != operation_id
                or receipt["envelopeFingerprint"] != row.get("fingerprint")
            ):
                raise StoreUnavailable
            return receipt

        return self.store.transact(read)

    @staticmethod
    def _owner_history(unit, authority):
        lifecycle = source_state(unit, authority)
        if lifecycle["state"] == "deleted":
            raise ContractError("not_found")
        if lifecycle["pendingMutationId"] is not None:
            row = mutation_record(
                unit.get(
                    mutation_path(
                        authority.document["ownerSubject"],
                        authority.document["sourceId"],
                        lifecycle["pendingMutationId"],
                    )
                ),
                owner=authority.document["ownerSubject"],
                source=authority.document["sourceId"],
                operation=lifecycle["pendingMutationId"],
                resource_ref=authority.document["resourceRef"],
            )
            if row["action"] == "delete":
                raise ContractError("not_found")

    def begin_mutation(
        self,
        uid: str,
        source: str,
        action: str,
        *,
        expected_version: int,
        expected_source_epoch: int,
        operation_id: str,
        writer_key_id: str,
        command: dict,
    ):
        """Atomically stop new source operations before an eventual Hub ACK.

        The signed closed shared control is checked against the independent
        owner/root/source and route-selected action. Only one mutation may be
        pending. No broker request, implicit refresh or remote ACK is attempted.
        """
        _identifier(source)
        _positive(expected_version)
        _positive(expected_source_epoch)
        validate_schema("OperationIdentifier", operation_id)
        validate_schema("KeyId", writer_key_id)
        if action not in ACTIONS:
            raise ContractError("malformed_request")
        owner = owner_key(uid)

        def write(unit):
            now = self.now()
            authority = _current_authority(unit, owner, source, now)
            row = authority.document
            if writer_key_id not in row["writerKeyIds"]:
                raise ContractError("key_authorization_required")
            certificate = authority.registry.cert(writer_key_id, role="device_sig", now=now)
            verify_jws(
                command, certificate["publicJwk"], typ="fv-control+jws", expected_kid=writer_key_id
            )
            parameters = {"resourceRef": row["resourceRef"]} if action == "fence" else {}
            payload = verify_control_command(
                command,
                registry=authority.registry,
                expected_action=ACTIONS[action],
                expected_target_id=source,
                expected_version=expected_version,
                expected_source_epoch=expected_source_epoch,
                expected_parameters=parameters,
                now=now,
            )
            if payload["stableOperationId"] != operation_id:
                raise ContractError("idempotency_conflict")
            fingerprint = signing_input_fingerprint(command)
            path = mutation_path(owner, source, operation_id)
            saved = unit.get(path)
            lifecycle = source_state(unit, authority)
            if saved is not None:
                saved = mutation_record(
                    saved,
                    owner=owner,
                    source=source,
                    operation=operation_id,
                    resource_ref=row["resourceRef"],
                )
                if saved["vaultId"] != row["vaultId"]:
                    raise StoreUnavailable
                if saved["commandFingerprint"] != fingerprint or saved["action"] != action:
                    raise ContractError("idempotency_conflict")
                return {"contractVersion": CONTRACT_VERSION, **public_mutation(saved)}
            if not (action == "delete" and lifecycle["state"] == "disconnected"):
                require_active(lifecycle)
            if authority.version != expected_version or row["sourceEpoch"] != expected_source_epoch:
                raise ContractError("version_conflict")
            # Retaining operation receipts is bounded without scan/delete loops.
            # Two terminal slots are reserved so an exhausted ordinary-fence
            # budget cannot prevent local disconnect followed by deletion.
            limit = MAX_SOURCE_MUTATIONS - {"fence": 2, "disconnect": 1, "delete": 0}[action]
            if lifecycle["mutationCount"] >= limit:
                raise ContractError("version_conflict")
            _positive(expected_source_epoch + 1)
            _positive(expected_version + 1)
            mutation = {
                "ownerSubject": owner,
                "sourceId": source,
                "vaultId": row["vaultId"],
                "resourceRef": row["resourceRef"],
                "operationId": operation_id,
                "action": action,
                "expectedAuthorityVersion": expected_version,
                "expectedSourceEpoch": expected_source_epoch,
                "sourceEpoch": expected_source_epoch + 1,
                "commandFingerprint": fingerprint,
                "state": "pending",
                "requestedAt": datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z"),
                "completedAt": None,
            }
            lifecycle.update(
                state="revoking",
                sourceEpoch=expected_source_epoch + 1,
                pendingMutationId=operation_id,
                lastMutationId=operation_id,
                mutationCount=lifecycle["mutationCount"] + 1,
            )
            unit.put(
                document_path("portfolio_authorities", owner, source),
                {
                    **row,
                    "version": expected_version + 1,
                    "sourceEpoch": expected_source_epoch + 1,
                },
            )
            unit.put(state_path(owner, source), lifecycle)
            unit.put(path, mutation)
            return {"contractVersion": CONTRACT_VERSION, **public_mutation(mutation)}

        return self.store.transact(write)

    def mutation(self, uid: str, source: str, operation_id: str):
        result = {
            "contractVersion": CONTRACT_VERSION,
            **public_mutation(self.fence_mutation(uid, source, operation_id)),
        }
        check_read_response(result)
        return result

    def fence_mutation(self, uid: str, source: str, operation_id: str):
        """Read one authoritative mutation for server-side delivery, without I/O."""
        _identifier(source)
        validate_schema("OperationIdentifier", operation_id)
        owner = owner_key(uid)

        def read(unit):
            authority = _current_authority(unit, owner, source, self.now())
            saved = mutation_record(
                unit.get(mutation_path(owner, source, operation_id)),
                owner=owner,
                source=source,
                operation=operation_id,
                resource_ref=authority.document["resourceRef"],
            )
            source_state(unit, authority)
            if saved["vaultId"] != authority.document["vaultId"]:
                raise StoreUnavailable
            return saved

        return self.store.transact(read)

    def finish_fence(
        self,
        uid: str,
        source: str,
        *,
        operation_id: str,
        resource_ref: dict,
        source_epoch: int,
        expected_mutation: dict | None = None,
    ):
        """Commit after the server adapter authenticates and validates a Hub ACK.

        Runtime delivery supplies its original stored mutation snapshot as CAS.
        Direct synthetic fixture calls are not evidence of a live Hub ACK.
        """
        _identifier(source)
        validate_schema("OperationIdentifier", operation_id)
        validate_schema("ResourceRef", resource_ref)
        _positive(source_epoch)
        owner = owner_key(uid)

        def write(unit):
            now = self.now()
            authority = _current_authority(unit, owner, source, now)
            row = authority.document
            saved = mutation_record(
                unit.get(mutation_path(owner, source, operation_id)),
                owner=owner,
                source=source,
                operation=operation_id,
                resource_ref=row["resourceRef"],
            )
            if (
                saved["resourceRef"] != resource_ref
                or saved["sourceEpoch"] != source_epoch
                or saved["vaultId"] != row["vaultId"]
            ):
                raise ContractError("recipient_binding_mismatch")
            lifecycle = source_state(unit, authority)
            if expected_mutation is not None and any(
                saved[key] != expected_mutation.get(key)
                for key in saved
                if key not in {"state", "completedAt"}
            ):
                raise ContractError("version_conflict")
            if saved["sourceEpoch"] > row["sourceEpoch"]:
                raise StoreUnavailable
            if saved["state"] == "acknowledged":
                return {"contractVersion": CONTRACT_VERSION, **public_mutation(saved)}
            if (
                lifecycle["state"] != "revoking"
                or lifecycle["pendingMutationId"] != operation_id
                or row["sourceEpoch"] != source_epoch
            ):
                raise ContractError("version_conflict")
            _positive(authority.version + 1)
            lifecycle.update(
                state={"fence": "active", "disconnect": "disconnected", "delete": "deleted"}[
                    saved["action"]
                ],
                pendingMutationId=None,
            )
            saved.update(
                state="acknowledged",
                completedAt=datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z"),
            )
            unit.put(
                document_path("portfolio_authorities", owner, source),
                {**row, "version": authority.version + 1},
            )
            unit.put(state_path(owner, source), lifecycle)
            unit.put(mutation_path(owner, source, operation_id), saved)
            return {"contractVersion": CONTRACT_VERSION, **public_mutation(saved)}

        return self.store.transact(write)
