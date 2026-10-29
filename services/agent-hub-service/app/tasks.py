"""Owner encrypted tasks, immutable versions and transaction-bound execution fences.

Only public routing and signature facts are interpreted. Private task rules,
template semantics and financial content are never decrypted by this service.
"""

import hashlib
import math
import secrets
import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.authority import verify_registry, verify_task_transition
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.envelope import EnvelopeExpectation, parse_carrier, verify_carrier
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

from .api import Owner, _invoke, body, transport
from .catalogue import CatalogueService, get_sources
from .fences import require_current_bindings
from .store import StoreUnavailable, document_path, get_store
from .vaults import VaultService, _current, _selection, identifier, positive

MAX_TASKS = 32
MAX_VERSIONS = 50
MAX_OPERATIONS = 128
CURSOR_SECONDS = 900
_INDEX_FIELDS = {"ownerSubject", "vaultId", "version", "tasks", "cursors"}
_HEAD_FIELDS = {"ownerSubject", "metadata", "operationCount"}
_VERSION_FIELDS = {"ownerSubject", "metadata", "carrierJson", "keyProofs"}
_OP_FIELDS = {"ownerSubject", "vaultId", "taskId", "version", "fingerprint", "authorKeyId"}


def _digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _snapshot(value):
    return strict_json_loads(canonical_json(value))


def _bindings(value):
    if type(value) is not list or len(value) > 10:
        raise ContractError("malformed_request")
    seen = set()
    for binding in value:
        validate_schema("ResourceBindingMetadata", binding)
        ref = binding["ref"]
        if ref["sourceService"] != ("portfolio" if ref["kind"] == "holdings" else "user"):
            raise ContractError("recipient_binding_mismatch")
        key = canonical_json(ref)
        if key in seen:
            raise ContractError("malformed_request")
        seen.add(key)
    return _snapshot(value)


def _scope(bindings):
    return sorted(canonical_json(row) for row in bindings)


def _task_binding(task_id, version):
    fields = (
        "taskId",
        "taskVersion",
        "runId",
        "manifestId",
        "taskEnvelopeFingerprint",
        "manifestFingerprint",
        "connectionId",
        "grantId",
        "grantEpoch",
        "executionEpoch",
        "resourceRef",
        "sourceRevision",
        "sourceEpoch",
    )
    result = dict.fromkeys(fields)
    result.update(taskId=task_id, taskVersion=version)
    return result


def _paths(owner, vault, task_id, version=None):
    return (
        document_path("hub_task_versions", owner, vault, task_id, str(version))
        if version is not None
        else document_path("hub_tasks", owner, vault, task_id)
    )


def _index(unit, owner, vault):
    row = unit.get(document_path("hub_task_indexes", owner, vault))
    if row is None:
        return {"ownerSubject": owner, "vaultId": vault, "version": 0, "tasks": {}, "cursors": {}}
    try:
        if (
            type(row) is not dict
            or set(row) != _INDEX_FIELDS
            or row["ownerSubject"] != owner
            or row["vaultId"] != vault
            or type(row["tasks"]) is not dict
            or len(row["tasks"]) > MAX_TASKS
            or type(row["cursors"]) is not dict
            or len(row["cursors"]) > 32
        ):
            raise StoreUnavailable
        positive(row["version"])
        for task_id, metadata in row["tasks"].items():
            validate_schema("TaskMetadata", metadata)
            if (
                metadata["taskId"] != task_id
                or metadata["vaultId"] != vault
                or metadata["objectRevision"] != metadata["taskVersion"]
                or metadata["deliveryRevision"] != 1
                or metadata["executionEpoch"] > metadata["taskVersion"]
                or metadata["taskVersion"] > MAX_VERSIONS
                or (metadata["status"] != "active" and metadata["taskVersion"] == 1)
            ):
                raise StoreUnavailable
            _bindings(metadata["resourceBindings"])
        if row["version"] != sum(meta["taskVersion"] for meta in row["tasks"].values()):
            raise StoreUnavailable
        for token, cursor in row["cursors"].items():
            b64url_decode(token, exact_bytes=24)
            if type(cursor) is not dict or set(cursor) != {
                "snapshot",
                "after",
                "expiresAt",
                "limit",
            }:
                raise StoreUnavailable
            validate_schema("Digest", cursor["snapshot"])
            identifier(cursor["after"])
            positive(cursor["expiresAt"])
            if type(cursor["limit"]) is not int or not 1 <= cursor["limit"] <= 50:
                raise StoreUnavailable
    except ContractError:
        raise StoreUnavailable from None
    return row


def _head(unit, owner, vault, task_id, index):
    row = unit.get(_paths(owner, vault, task_id))
    listed = index["tasks"].get(task_id)
    if row is None:
        if listed is not None:
            raise StoreUnavailable
        return None
    try:
        if (
            type(row) is not dict
            or set(row) != _HEAD_FIELDS
            or row["ownerSubject"] != owner
            or row["metadata"] != listed
        ):
            raise StoreUnavailable
        validate_schema("TaskMetadata", row["metadata"])
        positive(row["operationCount"])
        if (
            row["operationCount"] != row["metadata"]["taskVersion"]
            or row["operationCount"] > MAX_OPERATIONS
        ):
            raise StoreUnavailable
    except ContractError:
        raise StoreUnavailable from None
    return row


def _proofs(bundle):
    result = {
        "checkpoint": bundle["checkpoint"],
        "certificates": [entry["certificate"] for entry in bundle["entries"]],
    }
    validate_schema("KeyProofs", result)
    return _snapshot(result)


def _response(unit, owner, vault_row, task_id, version):
    row = unit.get(_paths(owner, vault_row["vaultId"], task_id, version))
    if row is None:
        raise ContractError("not_found")
    try:
        if type(row) is not dict or set(row) != _VERSION_FIELDS or row["ownerSubject"] != owner:
            raise StoreUnavailable
        metadata = row["metadata"]
        validate_schema("TaskMetadata", metadata)
        if (
            metadata["taskId"] != task_id
            or metadata["vaultId"] != vault_row["vaultId"]
            or metadata["taskVersion"] != version
            or metadata["objectRevision"] != version
            or metadata["deliveryRevision"] != 1
        ):
            raise StoreUnavailable
        carrier = parse_carrier(row["carrierJson"], contract_header=CONTRACT_VERSION)
        _, message = _signed_parts(carrier["signedObject"])
        context = message["context"]
        expected = {
            "ownerSubject": owner,
            "vaultId": vault_row["vaultId"],
            "rootKeyId": vault_row["rootKeyId"],
            "objectId": task_id,
            "objectType": "task",
            "revision": version,
            "binding": _task_binding(task_id, version),
            "resourceBindings": metadata["resourceBindings"],
            "keyEpoch": metadata["keyEpoch"],
        }
        if (
            any(
                canonical_json(context[key]) != canonical_json(value)
                for key, value in expected.items()
            )
            or signing_input_fingerprint(carrier["signedObject"]) != metadata["envelopeFingerprint"]
        ):
            raise StoreUnavailable
        validate_schema("KeyProofs", row["keyProofs"])
        matching = [
            bundle for bundle in vault_row["registryHistory"] if _proofs(bundle) == row["keyProofs"]
        ]
        if len(matching) != 1:
            raise StoreUnavailable
        written_at = int(
            datetime.fromisoformat(metadata["updatedAt"].replace("Z", "+00:00")).timestamp()
        )
        created_at = int(
            datetime.fromisoformat(metadata["createdAt"].replace("Z", "+00:00")).timestamp()
        )
        if not 0 <= created_at <= written_at:
            raise StoreUnavailable
        historical = None
        for bundle in vault_row["registryHistory"]:
            historical = verify_registry(
                bundle,
                root_jwk=vault_row["rootJwk"],
                pinned_root_key_id=vault_row["rootKeyId"],
                owner_subject=owner,
                vault_id=vault_row["vaultId"],
                now=written_at,
                previous=historical,
            )
            if bundle == matching[0]:
                break
        if (
            historical is None
            or historical.registry_sequence != context["registrySequence"]
            or historical.checkpoint_digest != context["checkpointDigest"]
        ):
            raise StoreUnavailable
        writers, recipients = _selection(historical, written_at)
        if (
            context["authorSigningKeyId"] not in writers
            or (version == 1 and context["operationType"] != "create_task")
            or (version > 1 and context["operationType"] not in {"update_task", "transition_task"})
        ):
            raise StoreUnavailable
        # Reuse public-only verification against authority at the original save,
        # never requiring a historical writer to remain active today.
        verify_carrier(
            carrier,
            registry=historical,
            expectation=EnvelopeExpectation(
                owner,
                vault_row["vaultId"],
                task_id,
                "task",
                version,
                version - 1,
                context["operationType"],
                context["authorSigningKeyId"],
                _task_binding(task_id, version),
                metadata["resourceBindings"],
                tuple(recipients),
            ),
            now=written_at,
            contract_header=CONTRACT_VERSION,
        )
        result = {
            "contractVersion": CONTRACT_VERSION,
            "metadata": metadata,
            "signedObject": carrier["signedObject"],
            "keyProofs": row["keyProofs"],
        }
        validate_schema("EncryptedTask", result)
        check_read_response(result)
        return _snapshot(result)
    except (ContractError, ValueError, TypeError, KeyError):
        raise StoreUnavailable from None


class TaskService:
    def __init__(self, store, catalogue=None, *, clock=time.time):
        self.store, self.catalogue, self.clock = store, catalogue, clock

    def now(self):
        value = self.clock()
        if (
            type(value) not in (int, float)
            or not math.isfinite(value)
            or not 0 <= value <= 253402300799
        ):
            raise StoreUnavailable
        return int(value)

    def _fresh(self, uid, bindings):
        if not bindings:
            return
        if self.catalogue is None:
            raise ContractError("source_unavailable")
        catalogue = self.catalogue.read(uid)
        available = {}
        for group in catalogue["groups"]:
            for row in group["items"]:
                if row["ref"] is not None and row["state"] in {"active", "ready", "empty"}:
                    available[canonical_json(row["ref"])] = row["sourceEpoch"]
        if any(available.get(canonical_json(row["ref"])) != row["sourceEpoch"] for row in bindings):
            raise ContractError("source_unavailable")

    def _write(self, uid, task_id, value, operation, author, *, mode):
        identifier(task_id)
        validate_schema("OperationIdentifier", operation)
        validate_schema("KeyId", author)
        fields = (
            {"contractVersion", "expectedVersion", "resourceBindings", "envelope"}
            | ({"taskId"} if mode == "create" else set())
            | ({"transitionIntent"} if mode == "transition" else set())
        )
        if (
            type(value) is not dict
            or set(value) != fields
            or value.get("contractVersion") != CONTRACT_VERSION
            or (mode == "create" and value["taskId"] != task_id)
        ):
            raise ContractError("malformed_request")
        positive(value["expectedVersion"], zero=mode == "create")
        if (mode == "create") != (value["expectedVersion"] == 0):
            raise ContractError("version_conflict")
        resources = _bindings(value["resourceBindings"])
        carrier = parse_carrier(value["envelope"], contract_header=CONTRACT_VERSION)
        _, message = _signed_parts(carrier["signedObject"])
        context = message["context"]
        if context["stableOperationId"] != operation:
            raise ContractError("recipient_binding_mismatch")
        value = _snapshot(value)
        owner = owner_key(uid)
        fingerprint = _digest(
            {
                "mode": mode,
                "taskId": task_id,
                "expectedVersion": value["expectedVersion"],
                "resourceBindings": resources,
                "envelopeFingerprint": signing_input_fingerprint(carrier["signedObject"]),
                "transitionFingerprint": signing_input_fingerprint(value["transitionIntent"])
                if mode == "transition"
                else None,
                "authorKeyId": author,
            }
        )

        def state(unit, *, commit=False, fresh=False):
            now = self.now()
            vault, registry = _current(unit, owner, now)
            vault_id = vault["vaultId"]
            index = _index(unit, owner, vault_id)
            head = _head(unit, owner, vault_id, task_id, index)
            op_path = document_path("hub_task_operations", owner, vault_id, task_id, operation)
            saved = unit.get(op_path)
            current = head["metadata"] if head is not None else None
            if saved is not None:
                if (
                    type(saved) is not dict
                    or set(saved) != _OP_FIELDS
                    or any(
                        saved[key] != expected
                        for key, expected in {
                            "ownerSubject": owner,
                            "vaultId": vault_id,
                            "taskId": task_id,
                        }.items()
                    )
                ):
                    raise StoreUnavailable
                if saved["fingerprint"] != fingerprint or saved["authorKeyId"] != author:
                    raise ContractError("idempotency_conflict")
                version = saved["version"]
                positive(version)
                if current is None or version > current["taskVersion"]:
                    raise StoreUnavailable
                original = _response(unit, owner, vault, task_id, version)
                operation_type = {
                    "create": "create_task",
                    "update": "update_task",
                    "transition": "transition_task",
                }[mode]
            else:
                if mode == "create":
                    if current is not None:
                        raise ContractError("version_conflict")
                    if len(index["tasks"]) >= MAX_TASKS:
                        raise ContractError("version_conflict")
                    version = 1
                else:
                    if current is None:
                        raise ContractError("not_found")
                    if current["taskVersion"] != value["expectedVersion"]:
                        raise ContractError("version_conflict")
                    if current["status"] == "archived":
                        raise ContractError("version_conflict")
                    version = current["taskVersion"] + 1
                operation_type = {
                    "create": "create_task",
                    "update": "update_task",
                    "transition": "transition_task",
                }[mode]
            writers, recipients = _selection(registry, now)
            if author not in writers:
                raise ContractError("key_authorization_required")
            expected = EnvelopeExpectation(
                owner,
                vault_id,
                task_id,
                "task",
                version,
                value["expectedVersion"],
                operation_type,
                author,
                _task_binding(task_id, version),
                resources,
                tuple(recipients),
            )
            verified = verify_carrier(
                carrier,
                registry=registry,
                expectation=expected,
                now=now,
                contract_header=CONTRACT_VERSION,
            )
            if saved is not None:
                original_context = _signed_parts(original["signedObject"])[1]["context"]
                if (
                    original["metadata"]["envelopeFingerprint"] != verified.fingerprint
                    or original_context["stableOperationId"] != operation
                ):
                    raise StoreUnavailable
                if mode == "transition":
                    certificate = registry.cert(
                        author, role="device_sig", connection_id=None, now=now
                    )
                    if "control_write" not in certificate["capabilities"]:
                        raise ContractError("key_authorization_required")
                    intent = verify_jws(
                        value["transitionIntent"],
                        certificate["publicJwk"],
                        typ="fv-control+jws",
                        expected_kid=author,
                    )
                    validate_schema("TaskTransitionIntentPayload", intent)
                    historical = original["metadata"]
                    expected_intent = {
                        "ownerSubject": owner,
                        "vaultId": vault_id,
                        "stableOperationId": operation,
                        "taskId": task_id,
                        "expectedVersion": value["expectedVersion"],
                        "nextTaskVersion": version,
                        "nextExecutionEpoch": historical["executionEpoch"],
                        "nextEnvelopeFingerprint": verified.fingerprint,
                        "keyEpoch": registry.key_epoch,
                    }
                    if (
                        any(intent[key] != expected for key, expected in expected_intent.items())
                        or registry.checkpoint_history.get(intent["registrySequence"])
                        != intent["checkpointDigest"]
                    ):
                        raise ContractError("recipient_binding_mismatch")
                return {"replayed": True, "response": original}
            if (
                verified.context["registrySequence"] != registry.registry_sequence
                or verified.context["checkpointDigest"] != registry.checkpoint_digest
            ):
                raise ContractError("registry_conflict")
            if (
                current is not None
                and now
                < datetime.fromisoformat(current["updatedAt"].replace("Z", "+00:00")).timestamp()
            ):
                raise StoreUnavailable
            scope_changed = current is not None and _scope(current["resourceBindings"]) != _scope(
                resources
            )
            key_changed = current is not None and current["keyEpoch"] != registry.key_epoch
            epoch = (
                1
                if current is None
                else current["executionEpoch"] + int(scope_changed or key_changed)
            )
            status = "active" if current is None else current["status"]
            action = None
            if mode == "transition":
                if scope_changed:
                    raise ContractError("recipient_binding_mismatch")
                header, payload = _signed_parts(value["transitionIntent"])
                action = payload.get("action")
                allowed = {"active": {"pause", "archive"}, "paused": {"resume", "archive"}}
                if action not in allowed.get(status, set()):
                    raise ContractError("version_conflict")
                epoch = current["executionEpoch"] + int(
                    action in {"pause", "archive"} or key_changed
                )
                status = {"pause": "paused", "resume": "active", "archive": "archived"}[action]
                if header["kid"] != author:
                    raise ContractError("recipient_binding_mismatch")
                intent = verify_task_transition(
                    value["transitionIntent"],
                    registry=registry,
                    task_id=task_id,
                    action=action,
                    expected_version=value["expectedVersion"],
                    next_task_version=version,
                    next_execution_epoch=epoch,
                    next_envelope_fingerprint=verified.fingerprint,
                    now=now,
                )
                if intent["stableOperationId"] != operation:
                    raise ContractError("recipient_binding_mismatch")
            limit = (
                MAX_VERSIONS
                if action == "archive"
                else MAX_VERSIONS - 1
                if action == "pause"
                else MAX_VERSIONS - 2
            )
            if version > limit or (head is not None and head["operationCount"] >= MAX_OPERATIONS):
                raise ContractError("version_conflict")
            needs_fresh = current is None or scope_changed or action == "resume"
            if needs_fresh and not fresh:
                return {"replayed": False, "fresh": True}
            if needs_fresh or (mode == "update" and status == "active"):
                require_current_bindings(unit, owner, resources)
            metadata = {
                "contractVersion": CONTRACT_VERSION,
                "vaultId": vault_id,
                "taskId": task_id,
                "taskVersion": version,
                "executionEpoch": epoch,
                "status": status,
                "resourceBindings": resources,
                "objectRevision": version,
                "deliveryRevision": 1,
                "envelopeFingerprint": verified.fingerprint,
                "keyEpoch": registry.key_epoch,
                "createdAt": current["createdAt"]
                if current
                else datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z"),
                "updatedAt": datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z"),
            }
            validate_schema("TaskMetadata", metadata)
            proofs = _proofs(vault["registryHistory"][-1])
            response = {
                "contractVersion": CONTRACT_VERSION,
                "metadata": metadata,
                "signedObject": verified.carrier["signedObject"],
                "keyProofs": proofs,
            }
            validate_schema("EncryptedTask", response)
            check_read_response(response)
            if commit:
                index["version"] += 1
                index["tasks"][task_id] = metadata
                unit.put(document_path("hub_task_indexes", owner, vault_id), index)
                unit.put(
                    _paths(owner, vault_id, task_id),
                    {"ownerSubject": owner, "metadata": metadata, "operationCount": version},
                )
                unit.put(
                    _paths(owner, vault_id, task_id, version),
                    {
                        "ownerSubject": owner,
                        "metadata": metadata,
                        "carrierJson": canonical_json(verified.carrier).decode(),
                        "keyProofs": proofs,
                    },
                )
                unit.put(
                    op_path,
                    {
                        "ownerSubject": owner,
                        "vaultId": vault_id,
                        "taskId": task_id,
                        "version": version,
                        "fingerprint": fingerprint,
                        "authorKeyId": author,
                    },
                )
            return {"replayed": False, "response": _snapshot(response)}

        initial = self.store.transact(state)
        if initial.get("replayed"):
            return initial["response"], True
        if initial.get("fresh"):
            try:
                self._fresh(uid, resources)
            except Exception:
                recovered = self.store.transact(state)
                if recovered.get("replayed"):
                    return recovered["response"], True
                raise
        result = self.store.transact(lambda unit: state(unit, commit=True, fresh=True))
        return result["response"], result["replayed"]

    def create(self, uid, value, operation, author):
        if type(value) is not dict or "taskId" not in value:
            raise ContractError("malformed_request")
        return self._write(uid, value["taskId"], value, operation, author, mode="create")

    def update(self, uid, task_id, value, operation, author):
        return self._write(uid, task_id, value, operation, author, mode="update")

    def transition(self, uid, task_id, value, operation, author):
        return self._write(uid, task_id, value, operation, author, mode="transition")

    def get(self, uid, task_id, version=None):
        identifier(task_id)
        if version is not None:
            positive(version)
        owner = owner_key(uid)

        def read(unit):
            vault, _ = _current(unit, owner, self.now())
            index = _index(unit, owner, vault["vaultId"])
            head = _head(unit, owner, vault["vaultId"], task_id, index)
            if head is None or (version is not None and version > head["metadata"]["taskVersion"]):
                raise ContractError("not_found")
            return _response(
                unit, owner, vault, task_id, version or head["metadata"]["taskVersion"]
            )

        return self.store.transact(read)

    def list(self, uid, *, limit=20, cursor=None):
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ContractError("unsupported_query")
        if cursor is not None:
            try:
                if type(cursor) is not str or len(cursor) > 2048:
                    raise ValueError
                b64url_decode(cursor, exact_bytes=24)
            except (ValueError, TypeError, ContractError):
                raise ContractError("unsupported_query") from None
        owner = owner_key(uid)
        issued_token = secrets.token_urlsafe(24)

        def read(unit):
            now = self.now()
            vault, _ = _current(unit, owner, now)
            index = _index(unit, owner, vault["vaultId"])
            ids = sorted(index["tasks"])
            snapshot = _digest({"version": index["version"], "tasks": index["tasks"]})
            start = 0
            if cursor is not None:
                saved = index["cursors"].get(cursor)
                if (
                    saved is None
                    or saved["limit"] != limit
                    or now >= saved["expiresAt"]
                    or saved["after"] not in ids
                ):
                    raise ContractError("unsupported_query")
                if saved["snapshot"] != snapshot:
                    raise ContractError("version_conflict")
                start = ids.index(saved["after"]) + 1
            chosen = ids[start : start + limit]
            next_cursor = None
            cursors = {
                token: saved
                for token, saved in index["cursors"].items()
                if saved["expiresAt"] > now and saved["snapshot"] == snapshot
            }
            if start + len(chosen) < len(ids):
                matches = [
                    token
                    for token, saved in cursors.items()
                    if saved["after"] == chosen[-1] and saved["limit"] == limit
                ]
                if matches:
                    next_cursor = sorted(matches)[0]
                else:
                    if len(cursors) >= 32:
                        raise ContractError("version_conflict")
                    next_cursor = issued_token
                    cursors[next_cursor] = {
                        "snapshot": snapshot,
                        "after": chosen[-1],
                        "expiresAt": now + CURSOR_SECONDS,
                        "limit": limit,
                    }
            if cursors != index["cursors"]:
                index["cursors"] = cursors
                unit.put(document_path("hub_task_indexes", owner, vault["vaultId"]), index)
            result = {
                "contractVersion": CONTRACT_VERSION,
                "items": [index["tasks"][key] for key in chosen],
                "nextCursor": next_cursor,
            }
            validate_schema("TaskMetadataPage", result)
            check_read_response(result)
            return result

        return self.store.transact(read)


def _protocol(request, *, write=False):
    if request.headers.getlist("x-folioview-delegation") or request.headers.getlist(
        "x-serverless-authorization"
    ):
        raise ContractError("insufficient_scope")
    if write:
        transport(request, operation=True, author=True)


def get_task_service():
    store = get_store()
    vaults = VaultService(store)
    return TaskService(store, CatalogueService(vaults, get_sources()))


router = APIRouter(prefix="/api/v2/tasks", route_class=PrivateRoute)
Tasks = Annotated[TaskService, Depends(get_task_service)]


@router.get("")
def list_tasks(request: Request, user: Owner, service: Tasks):
    def read():
        _protocol(request)
        if request.headers.getlist("x-folioview-contract") != [CONTRACT_VERSION]:
            raise ContractError("unsupported_contract")
        if set(request.query_params) - {"limit", "cursor"} or any(
            len(request.query_params.getlist(key)) != 1 for key in request.query_params
        ):
            raise ContractError("unsupported_query")
        value = request.query_params.get("limit", "20")
        if not value.isascii() or not value.isdigit() or len(value) > 2:
            raise ContractError("unsupported_query")
        return service.list(user.uid, limit=int(value), cursor=request.query_params.get("cursor"))

    return _invoke(read)


@router.get("/{task_id}")
def get_task(task_id: str, request: Request, user: Owner, service: Tasks):
    _invoke(lambda: (_protocol(request), transport(request)))
    return _invoke(lambda: service.get(user.uid, task_id))


@router.get("/{task_id}/versions/{version}")
def get_task_version(task_id: str, version: str, request: Request, user: Owner, service: Tasks):
    _invoke(lambda: (_protocol(request), transport(request)))

    def read():
        if not version.isascii() or not version.isdigit() or len(version) > 2:
            raise ContractError("malformed_request")
        return service.get(user.uid, task_id, int(version))

    return _invoke(read)


async def _write_request(request, user, service, *, mode, task_id=None, response=None):
    _invoke(lambda: _protocol(request, write=True))
    fields = (
        {"contractVersion", "expectedVersion", "resourceBindings", "envelope"}
        | ({"taskId"} if mode == "create" else set())
        | ({"transitionIntent"} if mode == "transition" else set())
    )
    value = await body(request, fields)

    def save():
        args = (
            (
                user.uid,
                value,
                request.headers["idempotency-key"],
                request.headers["x-folioview-author-key"],
            )
            if mode == "create"
            else (
                user.uid,
                task_id,
                value,
                request.headers["idempotency-key"],
                request.headers["x-folioview-author-key"],
            )
        )
        return getattr(service, mode)(*args)

    result, replayed = await run_in_threadpool(_invoke, save)
    if response is not None:
        response.status_code = 200 if replayed else 201
    return result


@router.post("")
async def create_task(request: Request, response: Response, user: Owner, service: Tasks):
    return await _write_request(request, user, service, mode="create", response=response)


@router.put("/{task_id}")
async def update_task(task_id: str, request: Request, user: Owner, service: Tasks):
    return await _write_request(request, user, service, mode="update", task_id=task_id)


@router.post("/{task_id}/transitions")
async def transition_task(task_id: str, request: Request, user: Owner, service: Tasks):
    return await _write_request(request, user, service, mode="transition", task_id=task_id)
