"""Owner-attested encrypted preparation copies, not Run manifests or source originals.

The backend verifies public signatures and routing only. Publication is atomic;
all content encryption/decryption stays in the separately trusted client/helper.
"""

import hashlib
import os
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.envelope import (
    EnvelopeExpectation,
    parse_carrier,
    validate_write_transition,
    verify_carrier,
)
from folioview_shared.encrypted.errors import ERROR_STATUS, ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

from .api import Owner, _invoke, body, transport
from .oauth import OAuthFailure
from .oauth_routes import Service, _browser
from .store import StoreUnavailable, document_path
from .tasks import _head, _index, _response, _task_binding
from .vaults import _current, identifier

PROFILE = "folioview.agent-preparation.v1"
KINDS = {
    "holdings": "holdings_snapshot",
    "watchlist": "watchlist_evidence",
    "channel_follows": "channel_follows_evidence",
}
SCOPES = {
    "holdings": "portfolio:read",
    "watchlist": "watchlist:read",
    "channel_follows": "channel_follows:read",
}
MAX_DELIVERIES = 32
MAX_STAGE_OPERATIONS = 32


def copy(value):
    return strict_json_loads(canonical_json(value))


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def source_versions(catalogue, uid):
    """Only observed positive source revisions become encryptable evidence pointers."""
    if catalogue is None:
        raise ContractError("source_unavailable")
    result = {}
    for group in catalogue.read(uid)["groups"]:
        for row in group["items"]:
            if (
                row["ref"] is not None
                and row["state"] in {"active", "ready", "empty"}
                and type(row.get("revision")) is int
                and row["revision"] >= 1
                and type(row.get("sourceEpoch")) is int
                and row["sourceEpoch"] >= 1
            ):
                result[canonical_json(row["ref"])] = {
                    "ref": row["ref"],
                    "revision": row["revision"],
                    "sourceEpoch": row["sourceEpoch"],
                    "producerSnapshotId": row.get("snapshotId"),
                }
    return result


def preparation_id(connection, grant):
    return (
        "preparation_"
        + digest(
            [
                connection["ownerSubject"],
                connection["connectionId"],
                connection["authorizationId"],
                grant["grantId"],
                grant["grantEpoch"],
                grant["taskId"],
                grant["taskVersions"],
            ]
        )[:43]
    )


def _path(collection, owner, preparation, obj=None):
    return document_path(collection, owner, preparation, *(() if obj is None else (obj,)))


class PreparationService:
    def __init__(self, oauth):
        self.oauth, self.store = oauth, oauth.store

    def _stored(self, row, owner, prepared, state):
        conn, grant, _, _, meta = state
        try:
            if (
                set(row)
                != {
                    "ownerSubject",
                    "ownerUid",
                    "preparationId",
                    "connectionId",
                    "taskId",
                    "authorizationId",
                    "grantId",
                    "grantEpoch",
                    "operation",
                    "requestFingerprint",
                    "receipt",
                    "taskDeliveryBase",
                }
                or any(
                    row[k] != v
                    for k, v in {
                        "ownerSubject": owner,
                        "preparationId": prepared,
                        "connectionId": conn["connectionId"],
                        "taskId": meta["taskId"],
                        "authorizationId": conn["authorizationId"],
                        "grantId": grant["grantId"],
                        "grantEpoch": grant["grantEpoch"],
                    }.items()
                )
                or owner_key(row["ownerUid"]) != owner
            ):
                raise ValueError
            validate_schema("OperationIdentifier", row["operation"])
            validate_schema("Digest", row["requestFingerprint"])
            base = row["taskDeliveryBase"]
            if (
                set(base) != {"deliveryRevision", "envelopeFingerprint"}
                or type(base["deliveryRevision"]) is not int
                or not 1 <= base["deliveryRevision"] < MAX_DELIVERIES
            ):
                raise ValueError
            validate_schema("Digest", base["envelopeFingerprint"])
            if (
                base["deliveryRevision"] == 1
                and base["envelopeFingerprint"] != meta["envelopeFingerprint"]
            ):
                raise ValueError
            receipt = row["receipt"]
            if (
                set(receipt) != {"contractVersion", "profile", "preparationId", "status", "objects"}
                or any(
                    receipt[k] != v
                    for k, v in {
                        "contractVersion": CONTRACT_VERSION,
                        "profile": PROFILE,
                        "preparationId": prepared,
                        "status": "committed",
                    }.items()
                )
                or type(receipt["objects"]) is not list
                or len(receipt["objects"]) != len(grant["resourceBindings"]) + 1
            ):
                raise ValueError
            ids = set()
            for item in receipt["objects"]:
                if set(item) != {
                    "objectId",
                    "objectType",
                    "revision",
                    "deliveryRevision",
                    "priorEnvelopeFingerprint",
                    "resourceRef",
                    "sourceRevision",
                    "sourceEpoch",
                    "producerSnapshotId",
                    "provenance",
                    "envelopeFingerprint",
                    "path",
                }:
                    raise ValueError
                identifier(item["objectId"])
                validate_schema("Digest", item["envelopeFingerprint"])
                if (
                    item["objectId"] in ids
                    or item["path"]
                    != f"/agent/v2/preparations/{prepared}/objects/{item['objectId']}"
                ):
                    raise ValueError
                ids.add(item["objectId"])
                if item["objectType"] == "task":
                    expected = {
                        "objectId": meta["taskId"],
                        "revision": meta["taskVersion"],
                        "deliveryRevision": base["deliveryRevision"] + 1,
                        "priorEnvelopeFingerprint": base["envelopeFingerprint"],
                        "resourceRef": None,
                        "sourceRevision": None,
                        "sourceEpoch": None,
                        "producerSnapshotId": None,
                        "provenance": "task_reshare",
                    }
                else:
                    binding = next(
                        (b for b in grant["resourceBindings"] if b["ref"] == item["resourceRef"]),
                        None,
                    )
                    if binding is None:
                        raise ValueError
                    expected = {
                        "objectId": "copy_" + digest([prepared, binding["ref"]])[:43],
                        "objectType": KINDS[binding["ref"]["kind"]],
                        "revision": binding["selectedVersions"][0],
                        "sourceRevision": binding["selectedVersions"][0],
                        "sourceEpoch": binding["sourceEpoch"],
                        "deliveryRevision": 1,
                        "priorEnvelopeFingerprint": None,
                        "provenance": "owner_attested_copy",
                    }
                    if item["producerSnapshotId"] is not None:
                        identifier(item["producerSnapshotId"])
                if any(item[k] != v for k, v in expected.items()):
                    raise ValueError
            if (
                meta["taskId"] not in ids
                or digest(
                    [
                        {"objectId": i["objectId"], "envelopeFingerprint": i["envelopeFingerprint"]}
                        for i in receipt["objects"]
                    ]
                )
                != row["requestFingerprint"]
            ):
                raise ValueError
        except (KeyError, ValueError, TypeError, ContractError):
            raise StoreUnavailable from None
        return row

    def _object_row(self, row, owner, prepared, obj):
        if row is None:
            raise ContractError("not_found")
        try:
            if (
                set(row)
                != {
                    "ownerSubject",
                    "preparationId",
                    "descriptor",
                    "carrierJson",
                    "authorKeyId",
                    "operation",
                    "operations",
                }
                or row["ownerSubject"] != owner
                or row["preparationId"] != prepared
                or row["descriptor"]["objectId"] != obj
            ):
                raise ValueError
            validate_schema("KeyId", row["authorKeyId"])
            validate_schema("OperationIdentifier", row["operation"])
            if (
                type(row["operations"]) is not dict
                or not 1 <= len(row["operations"]) <= MAX_STAGE_OPERATIONS
                or row["operation"] not in row["operations"]
            ):
                raise ValueError
            for operation, record in row["operations"].items():
                validate_schema("OperationIdentifier", operation)
                if (
                    set(record) != {"requestFingerprint", "descriptor"}
                    or record["descriptor"]["objectId"] != obj
                ):
                    raise ValueError
                validate_schema("Digest", record["requestFingerprint"])
            current = row["operations"][row["operation"]]
            if current["descriptor"] != row["descriptor"] or current[
                "requestFingerprint"
            ] != digest(strict_json_loads(row["carrierJson"])):
                raise ValueError
        except (ValueError, KeyError, TypeError, ContractError):
            raise StoreUnavailable from None
        return row

    def _authority(self, unit, uid, connection_id, task_id, *, verify_original=True):
        owner = owner_key(uid)
        connection = unit.get(document_path("hub_oauth_connections", owner, connection_id))
        if (
            connection is None
            or connection["ownerSubject"] != owner
            or connection["status"] != "active"
            or connection["expiresAt"] <= self.oauth.now()
        ):
            raise ContractError("not_found")
        if task_id not in connection["grants"]:
            raise ContractError("not_found")
        try:
            grant = self.oauth._key_authority(unit, connection, task_id, "tasks:read")
        except OAuthFailure as error:
            raise ContractError("insufficient_scope") from error
        if grant["historyPolicy"] != "selected" or "tasks:read" not in connection["approvedScopes"]:
            raise ContractError("key_authorization_required")
        for binding in grant["resourceBindings"]:
            scope = SCOPES[binding["ref"]["kind"]]
            if scope not in connection["approvedScopes"]:
                raise ContractError("insufficient_scope")
            self.oauth._key_authority(unit, connection, task_id, scope)
            if binding["versionAccess"] != "selected" or len(binding["selectedVersions"]) != 1:
                raise ContractError("key_authorization_required")
        vault, registry = _current(unit, owner, self.oauth.now())
        meta = _head(unit, owner, vault["vaultId"], task_id, _index(unit, owner, vault["vaultId"]))[
            "metadata"
        ]
        # Validate the owner original against its retained original signing proof.
        # Metadata-only MCP enumeration needs current authority and committed
        # descriptors, but deliberately does not retrieve the owner ciphertext.
        # All content reads and publication retain the original verification.
        if verify_original:
            _response(unit, owner, vault, task_id, meta["taskVersion"])
        return connection, grant, vault, registry, meta

    def _tail(self, unit, owner, vault, meta):
        path = document_path(
            "hub_task_deliveries", owner, vault, meta["taskId"], str(meta["taskVersion"])
        )
        row = unit.get(path)
        if row is None:
            row = {"deliveryRevision": 1, "envelopeFingerprint": meta["envelopeFingerprint"]}
        if (
            type(row) is not dict
            or set(row) != {"deliveryRevision", "envelopeFingerprint"}
            or type(row["deliveryRevision"]) is not int
            or not 1 <= row["deliveryRevision"] <= MAX_DELIVERIES
        ):
            raise StoreUnavailable
        validate_schema("Digest", row["envelopeFingerprint"])
        return path, row

    def _intent(self, unit, uid, connection_id, task_id):
        conn, grant, vault, registry, meta = self._authority(unit, uid, connection_id, task_id)
        prepared = preparation_id(conn, grant)
        _, tail = self._tail(unit, owner_key(uid), vault["vaultId"], meta)
        objects = [
            {
                "objectId": task_id,
                "objectType": "task",
                "revision": meta["taskVersion"],
                "deliveryRevision": tail["deliveryRevision"] + 1,
                "priorEnvelopeFingerprint": tail["envelopeFingerprint"],
                "resourceRef": None,
                "sourceRevision": None,
                "sourceEpoch": None,
                "producerSnapshotId": None,
                "provenance": "task_reshare",
            }
        ]
        for binding in grant["resourceBindings"]:
            objects.append(
                {
                    "objectId": "copy_" + digest([prepared, binding["ref"]])[:43],
                    "objectType": KINDS[binding["ref"]["kind"]],
                    "revision": binding["selectedVersions"][0],
                    "deliveryRevision": 1,
                    "priorEnvelopeFingerprint": None,
                    "resourceRef": binding["ref"],
                    "sourceRevision": binding["selectedVersions"][0],
                    "sourceEpoch": binding["sourceEpoch"],
                    "producerSnapshotId": None,
                    "provenance": "owner_attested_copy",
                }
            )
        value = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "preparationId": prepared,
            "objects": objects,
            "taskMetadata": meta,
            "connectionId": connection_id,
            "taskId": task_id,
            "grantId": grant["grantId"],
            "grantEpoch": grant["grantEpoch"],
            "registrySequence": registry.registry_sequence,
            "checkpointDigest": registry.checkpoint_digest,
            "taskDeliveryBase": copy(tail),
            "status": "staging",
        }
        existing = unit.get(_path("hub_preparations", owner_key(uid), prepared))
        if existing is None and tail["deliveryRevision"] >= MAX_DELIVERIES:
            raise ContractError("version_conflict")
        if existing is not None:
            self._stored(existing, owner_key(uid), prepared, (conn, grant, vault, registry, meta))
            value.update(
                objects=copy(existing["receipt"]["objects"]),
                taskDeliveryBase=copy(existing["taskDeliveryBase"]),
                status="committed",
            )
        return value, (conn, grant, vault, registry, meta)

    def _fresh(self, uid, descriptors):
        resources = [row for row in descriptors if row["resourceRef"] is not None]
        if not resources:
            return {}
        observed = source_versions(self.oauth.catalogue, uid)
        for row in resources:
            source = observed.get(canonical_json(row["resourceRef"]))
            if source is None or (source["revision"], source["sourceEpoch"]) != (
                row["sourceRevision"],
                row["sourceEpoch"],
            ):
                raise ContractError("source_unavailable")
        return observed

    def intent(self, uid, connection_id, task_id):
        identifier(connection_id)
        identifier(task_id)
        before = self.store.transact(lambda u: self._intent(u, uid, connection_id, task_id)[0])
        self._fresh(uid, before["objects"])
        after = self.store.transact(lambda u: self._intent(u, uid, connection_id, task_id)[0])
        if before != after:
            raise ContractError("version_conflict")
        check_read_response(after)
        return after

    def _verify(self, carrier, descriptor, state, author, operation):
        conn, grant, vault, registry, meta = state
        kind = descriptor["objectType"]
        binding = (
            _task_binding(meta["taskId"], meta["taskVersion"])
            if kind == "task"
            else dict.fromkeys(_task_binding("x", 1))
        )
        if kind != "task":
            binding.update(
                resourceRef=descriptor["resourceRef"],
                sourceRevision=descriptor["sourceRevision"],
                sourceEpoch=descriptor["sourceEpoch"],
            )
        recipients = tuple(
            sorted([*grant["writebackRecipientKeyIds"], grant["agentEncryptionKeyId"]])
        )
        verified = verify_carrier(
            carrier,
            registry=registry,
            expectation=EnvelopeExpectation(
                conn["ownerSubject"],
                vault["vaultId"],
                descriptor["objectId"],
                kind,
                descriptor["revision"],
                descriptor["revision"] if kind == "task" else descriptor["revision"] - 1,
                "reshare_delivery"
                if kind == "task"
                else ("commit_snapshot" if kind == "holdings_snapshot" else "commit_evidence"),
                author,
                binding,
                meta["resourceBindings"] if kind == "task" else [],
                recipients,
            ),
            now=self.oauth.now(),
            contract_header=CONTRACT_VERSION,
            read_grants=[grant],
        )
        context = verified.context
        if (
            context["stableOperationId"] != operation
            or context["deliveryRevision"] != descriptor["deliveryRevision"]
            or context["priorEnvelopeFingerprint"] != descriptor["priorEnvelopeFingerprint"]
            or (
                "envelopeFingerprint" in descriptor
                and verified.fingerprint != descriptor["envelopeFingerprint"]
            )
        ):
            raise ContractError("recipient_binding_mismatch")
        return verified

    def stage(self, uid, connection_id, task_id, object_id, value, operation, author):
        validate_schema("OperationIdentifier", operation)
        validate_schema("KeyId", author)
        identifier(object_id)
        parsed = parse_carrier(value, contract_header=CONTRACT_VERSION)
        before = self.intent(uid, connection_id, task_id)
        descriptor = next((r for r in before["objects"] if r["objectId"] == object_id), None)
        if descriptor is None:
            raise ContractError("not_found")

        def run(unit):
            intent, state = self._intent(unit, uid, connection_id, task_id)
            prep = intent["preparationId"]
            existing = unit.get(_path("hub_preparations", owner_key(uid), prep))
            path = _path("hub_preparation_objects", owner_key(uid), prep, object_id)
            row = unit.get(path)
            if row is not None:
                self._object_row(row, owner_key(uid), prep, object_id)
            fingerprint = digest(parsed)
            if row and operation in row["operations"]:
                if row["operations"][operation]["requestFingerprint"] != fingerprint:
                    raise ContractError("idempotency_conflict")
                # Recheck current keys/grant even for exact retries, using original descriptor.
                self._verify(
                    parsed, row["operations"][operation]["descriptor"], state, author, operation
                )
                return copy(row["operations"][operation]["descriptor"])
            if existing is not None:
                raise ContractError("version_conflict")
            if before != intent:
                raise ContractError("version_conflict")
            if row and len(row["operations"]) >= MAX_STAGE_OPERATIONS:
                raise ContractError("version_conflict")
            verified = self._verify(parsed, descriptor, state, author, operation)
            item = descriptor | {
                "envelopeFingerprint": verified.fingerprint,
                "path": f"/agent/v2/preparations/{prep}/objects/{object_id}",
            }
            operations = copy(row["operations"]) if row else {}
            operations[operation] = {"requestFingerprint": fingerprint, "descriptor": item}
            unit.put(
                path,
                {
                    "ownerSubject": owner_key(uid),
                    "preparationId": prep,
                    "descriptor": item,
                    "carrierJson": canonical_json(parsed).decode(),
                    "authorKeyId": author,
                    "operation": operation,
                    "operations": operations,
                },
            )
            return copy(item)

        return self.store.transact(run)

    def commit(self, uid, connection_id, task_id, objects, operation):
        validate_schema("OperationIdentifier", operation)
        if type(objects) is not list or not 1 <= len(objects) <= 11:
            raise ContractError("malformed_request")
        for row in objects:
            if type(row) is not dict or set(row) != {"objectId", "envelopeFingerprint"}:
                raise ContractError("malformed_request")
            identifier(row["objectId"])
            validate_schema("Digest", row["envelopeFingerprint"])
        if len({r["objectId"] for r in objects}) != len(objects):
            raise ContractError("malformed_request")
        before = self.intent(uid, connection_id, task_id)
        observed = self._fresh(uid, before["objects"])

        def run(unit):
            intent, state = self._intent(unit, uid, connection_id, task_id)
            conn, grant, vault, registry, meta = state
            prep, owner = intent["preparationId"], owner_key(uid)
            path = _path("hub_preparations", owner, prep)
            saved = unit.get(path)
            fingerprint = digest(objects)
            if saved:
                if saved["operation"] != operation or saved["requestFingerprint"] != fingerprint:
                    raise ContractError("idempotency_conflict")
                return copy(saved["receipt"])
            if before != intent:
                raise ContractError("version_conflict")
            if intent["taskDeliveryBase"]["deliveryRevision"] >= MAX_DELIVERIES:
                raise ContractError("version_conflict")
            if {r["objectId"] for r in objects} != {r["objectId"] for r in intent["objects"]}:
                raise ContractError("malformed_request")
            descriptors = []
            for expected in objects:
                item = unit.get(_path("hub_preparation_objects", owner, prep, expected["objectId"]))
                if item is not None:
                    self._object_row(item, owner, prep, expected["objectId"])
                if (
                    item is None
                    or item["descriptor"]["envelopeFingerprint"] != expected["envelopeFingerprint"]
                ):
                    raise ContractError("version_conflict")
                current = next(
                    r for r in intent["objects"] if r["objectId"] == expected["objectId"]
                )
                self._verify(
                    strict_json_loads(item["carrierJson"]),
                    current | {"envelopeFingerprint": expected["envelopeFingerprint"]},
                    state,
                    item["authorKeyId"],
                    item["operation"],
                )
                descriptor = copy(item["descriptor"])
                if descriptor["resourceRef"] is not None:
                    descriptor["producerSnapshotId"] = observed[
                        canonical_json(descriptor["resourceRef"])
                    ]["producerSnapshotId"]
                descriptors.append(descriptor)
            receipt = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "preparationId": prep,
                "status": "committed",
                "objects": descriptors,
            }
            check_read_response(receipt)
            unit.put(
                path,
                {
                    "ownerSubject": owner,
                    "ownerUid": uid,
                    "preparationId": prep,
                    "connectionId": connection_id,
                    "taskId": task_id,
                    "authorizationId": conn["authorizationId"],
                    "grantId": grant["grantId"],
                    "grantEpoch": grant["grantEpoch"],
                    "operation": operation,
                    "requestFingerprint": fingerprint,
                    "receipt": receipt,
                    "taskDeliveryBase": intent["taskDeliveryBase"],
                },
            )
            task = next(r for r in descriptors if r["objectType"] == "task")
            tail_path, tail = self._tail(unit, owner, vault["vaultId"], meta)
            validate_write_transition(
                self._verify(
                    strict_json_loads(
                        unit.get(_path("hub_preparation_objects", owner, prep, task_id))[
                            "carrierJson"
                        ]
                    ),
                    task,
                    state,
                    unit.get(_path("hub_preparation_objects", owner, prep, task_id))["authorKeyId"],
                    unit.get(_path("hub_preparation_objects", owner, prep, task_id))["operation"],
                ).context,
                current_revision=meta["taskVersion"],
                current_delivery_revision=tail["deliveryRevision"],
                prior_envelope_fingerprint=tail["envelopeFingerprint"],
            )
            unit.put(
                tail_path,
                {
                    "deliveryRevision": task["deliveryRevision"],
                    "envelopeFingerprint": task["envelopeFingerprint"],
                },
            )
            return copy(receipt)

        return self.store.transact(run)

    def _agent(self, unit, token, *, task_id=None, prep_id=None, scope="tasks:read"):
        principal = self.oauth.authorize_in_transaction(unit, token, task_id, scope)
        if prep_id is not None:
            row = unit.get(_path("hub_preparations", principal.owner_subject, prep_id))
            if row is None:
                raise ContractError("not_found")
            task_id = row["taskId"]
            principal = self.oauth.authorize_in_transaction(unit, token, task_id, scope)
        else:
            conn = unit.get(
                document_path(
                    "hub_oauth_connections", principal.owner_subject, principal.connection_id
                )
            )
            prep_id = preparation_id(conn, principal.grant)
            row = unit.get(_path("hub_preparations", principal.owner_subject, prep_id))
        if row is None or (
            row["connectionId"],
            row["authorizationId"],
            row["grantId"],
            row["grantEpoch"],
        ) != (
            principal.connection_id,
            principal.authorization_id,
            principal.grant["grantId"],
            principal.grant["grantEpoch"],
        ):
            raise ContractError("not_found")
        return principal, row

    def _agent_read(
        self,
        token,
        task_id=None,
        prep_id=None,
        *,
        object_id=None,
        sequence=None,
        scope="tasks:read",
    ):
        def run(unit, expected=None, observe=False):
            principal, prepared = self._agent(
                unit, token, task_id=task_id, prep_id=prep_id, scope=scope
            )
            state = self._authority(
                unit, principal.owner_uid, principal.connection_id, prepared["taskId"]
            )
            conn, grant, vault, registry, meta = state
            self._stored(prepared, principal.owner_subject, prepared["preparationId"], state)
            if object_id is not None:
                item = next(
                    (r for r in prepared["receipt"]["objects"] if r["objectId"] == object_id), None
                )
                if item is None:
                    raise ContractError("not_found")
                if item["resourceRef"] is not None:
                    self.oauth.authorize_in_transaction(
                        unit, token, prepared["taskId"], SCOPES[item["resourceRef"]["kind"]]
                    )
                stored = unit.get(
                    _path(
                        "hub_preparation_objects",
                        principal.owner_subject,
                        prepared["preparationId"],
                        object_id,
                    )
                )
                self._object_row(
                    stored, principal.owner_subject, prepared["preparationId"], object_id
                )
                envelope = parse_carrier(stored["carrierJson"], contract_header=CONTRACT_VERSION)
                self._verify(envelope, item, state, stored["authorKeyId"], stored["operation"])
                value = {
                    "contractVersion": CONTRACT_VERSION,
                    "preparationId": prepared["preparationId"],
                    "objectId": object_id,
                    "envelope": envelope,
                }
            elif sequence is not None:
                if type(sequence) is not int or sequence < 1:
                    raise ContractError("malformed_request")
                if sequence > len(vault["registryHistory"]):
                    raise ContractError("not_found")
                value = {
                    "contractVersion": CONTRACT_VERSION,
                    "preparationId": prepared["preparationId"],
                    "registrySequence": sequence,
                    "registryBundle": vault["registryHistory"][sequence - 1],
                }
            else:
                signed = conn["grants"][prepared["taskId"]]["keyGrantJson"]
                value = {
                    "contractVersion": CONTRACT_VERSION,
                    "profile": PROFILE,
                    "preparationId": prepared["preparationId"],
                    "connectionId": principal.connection_id,
                    "authorizationId": principal.authorization_id,
                    "clientId": principal.client_id,
                    "taskId": prepared["taskId"],
                    "taskVersion": meta["taskVersion"],
                    "grantId": grant["grantId"],
                    "grantEpoch": grant["grantEpoch"],
                    "executionEpoch": meta["executionEpoch"],
                    "keyEpoch": registry.key_epoch,
                    "ownerSubject": principal.owner_subject,
                    "vaultId": vault["vaultId"],
                    "rootJwk": vault["rootJwk"],
                    "rootKeyId": vault["rootKeyId"],
                    "rootEpoch": registry.root_epoch,
                    "agentKeyGrant": strict_json_loads(signed),
                    "authorizationExpiresAt": conn["expiresAt"],
                    "registryProofs": [
                        {
                            "registrySequence": n,
                            "checkpointDigest": registry.checkpoint_history[n],
                            "path": (
                                f"/agent/v2/preparations/{prepared['preparationId']}/registries/{n}"
                            ),
                        }
                        for n in range(1, len(vault["registryHistory"]) + 1)
                    ],
                    "taskMetadata": meta,
                    "taskDeliveryBase": prepared["taskDeliveryBase"],
                    "objects": prepared["receipt"]["objects"],
                }
            check_read_response(value)
            if expected is not None and value != expected:
                raise ContractError("version_conflict")
            if (
                observe
                and object_id is not None
                and not conn["grants"][prepared["taskId"]]["readObserved"]
            ):
                conn["grants"][prepared["taskId"]]["readObserved"] = True
                unit.put(
                    document_path(
                        "hub_oauth_connections", principal.owner_subject, principal.connection_id
                    ),
                    conn,
                )
            return copy(value), principal.owner_uid, copy(prepared["receipt"]["objects"])

        before, uid, descriptors = self.store.transact(run)
        self._fresh(uid, descriptors)
        after, _, _ = self.store.transact(lambda unit: run(unit, before, True))
        return after

    def metadata(self, token, task_id):
        identifier(task_id)
        return self._agent_read(token, task_id=task_id)

    def object(self, token, preparation, object_id):
        identifier(preparation)
        identifier(object_id)
        return self._agent_read(token, prep_id=preparation, object_id=object_id)

    def registry(self, token, preparation, sequence):
        identifier(preparation)
        return self._agent_read(token, prep_id=preparation, sequence=sequence)


def get_preparation_service(oauth: Service):
    return PreparationService(oauth)


Preparations = Annotated[PreparationService, Depends(get_preparation_service)]


def require_adapter():
    if os.getenv("HUB_ENCRYPTED_ADAPTER_ENABLED") != "1":
        raise HTTPException(503, {"code": "authorization_unavailable"})


owner_router = APIRouter(route_class=PrivateRoute, dependencies=[Depends(require_adapter)])


@owner_router.post("/api/v2/agent-authorizations/{request_id}/prepare-encrypted")
async def prepare_encrypted(request_id: str, request: Request, user: Owner, oauth: Service):
    value = await body(
        request, {"contractVersion", "taskIds", "connectionId", "approvedScopes", "historyPolicy"}
    )
    if (
        value["historyPolicy"] != "selected"
        or type(value["approvedScopes"]) is not list
        or not value["approvedScopes"]
    ):
        raise HTTPException(400, {"code": "malformed_request"})
    browser = _invoke(lambda: _browser(request, oauth))

    def run():
        tasks = value["taskIds"]
        if type(tasks) is not list or not 1 <= len(tasks) <= 10:
            raise ContractError("malformed_request")
        for task in tasks:
            identifier(task)

        def select(unit):
            owner = owner_key(user.uid)
            vault, _ = _current(unit, owner, oauth.now())
            index = _index(unit, owner, vault["vaultId"])
            selected = []
            for task in tasks:
                head = _head(unit, owner, vault["vaultId"], task, index)
                if head is None:
                    raise ContractError("not_found")
                selected.append(head["metadata"])
            return selected

        metadata = oauth.store.transact(select)
        sources = (
            source_versions(oauth.catalogue, user.uid)
            if any(t["resourceBindings"] for t in metadata)
            else {}
        )
        return oauth.prepare(
            user.uid,
            request_id,
            browser,
            tasks,
            value["connectionId"],
            value["approvedScopes"],
            history_policy="selected",
            source_versions=sources,
        )

    return await run_in_threadpool(_invoke, run)


OWNER_BASE = "/api/v2/agent-connections/{connection_id}/tasks/{task_id}"


@owner_router.get(OWNER_BASE + "/preparation-intent")
def intent(connection_id: str, task_id: str, request: Request, user: Owner, service: Preparations):
    _invoke(lambda: transport(request))
    return _invoke(lambda: service.intent(user.uid, connection_id, task_id))


@owner_router.put(OWNER_BASE + "/preparation/objects/{object_id}")
async def stage(
    connection_id: str,
    task_id: str,
    object_id: str,
    request: Request,
    user: Owner,
    service: Preparations,
):
    _invoke(lambda: transport(request, operation=True, author=True))
    value = await body(request, {"contractVersion", "envelope"})
    return await run_in_threadpool(
        _invoke,
        lambda: service.stage(
            user.uid,
            connection_id,
            task_id,
            object_id,
            value["envelope"],
            request.headers["idempotency-key"],
            request.headers["x-folioview-author-key"],
        ),
    )


@owner_router.post(OWNER_BASE + "/preparation/commit")
async def commit(
    connection_id: str, task_id: str, request: Request, user: Owner, service: Preparations
):
    _invoke(lambda: transport(request, operation=True))
    value = await body(request, {"contractVersion", "objects"})
    return await run_in_threadpool(
        _invoke,
        lambda: service.commit(
            user.uid, connection_id, task_id, value["objects"], request.headers["idempotency-key"]
        ),
    )


class AgentRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def call(request):
            try:
                return await handler(request)
            except (ContractError, OAuthFailure, HTTPException, StoreUnavailable) as error:
                if isinstance(error, OAuthFailure):
                    code = "invalid_token" if error.status == 401 else "insufficient_scope"
                elif isinstance(error, ContractError):
                    code = {
                        "rollback_detected": "registry_conflict",
                        "untrusted_key": "recipient_binding_mismatch",
                    }.get(error.code, error.code)
                elif isinstance(error, HTTPException):
                    candidate = error.detail.get("code") if type(error.detail) is dict else None
                    code = (
                        candidate
                        if candidate in ERROR_STATUS
                        else (
                            "authorization_unavailable"
                            if error.status_code >= 500
                            else "invalid_token"
                            if error.status_code == 401
                            else "malformed_request"
                        )
                    )
                else:
                    code = "authorization_unavailable"
                failure = ContractError(code)
                headers = {"Cache-Control": "no-store"}
                if failure.status == 401:
                    try:
                        headers["WWW-Authenticate"] = (
                            'Bearer resource_metadata="'
                            + request.state.preparation_issuer
                            + '/.well-known/oauth-protected-resource/mcp/v2"'
                        )
                    except Exception:
                        pass
                return JSONResponse(
                    failure.response(uuid4().hex), status_code=failure.status, headers=headers
                )
            except Exception:
                failure = ContractError("authorization_unavailable")
                return JSONResponse(
                    failure.response(uuid4().hex),
                    status_code=503,
                    headers={"Cache-Control": "no-store"},
                )

        return call


agent_router = APIRouter(route_class=AgentRoute, dependencies=[Depends(require_adapter)])


def bearer(request, service):
    request.state.preparation_issuer = service.oauth.config.issuer
    transport(request)
    values = request.headers.getlist("authorization")
    if len(values) != 1 or not values[0].startswith("Bearer ") or values[0].count(" ") != 1:
        raise ContractError("invalid_token")
    return values[0][7:]


@agent_router.get("/agent/v2/tasks/{task_id}/preparation")
def agent_metadata(task_id: str, request: Request, service: Preparations):
    return service.metadata(bearer(request, service), task_id)


@agent_router.get("/agent/v2/preparations/{preparation_id}/objects/{object_id}")
def agent_object(preparation_id: str, object_id: str, request: Request, service: Preparations):
    return service.object(bearer(request, service), preparation_id, object_id)


@agent_router.get("/agent/v2/preparations/{preparation_id}/registries/{sequence}")
def agent_registry(preparation_id: str, sequence: str, request: Request, service: Preparations):
    if (
        len(sequence) > 2
        or not sequence.isascii()
        or not sequence.isdecimal()
        or str(int(sequence)) != sequence
    ):
        raise ContractError("malformed_request")
    return service.registry(bearer(request, service), preparation_id, int(sequence))
