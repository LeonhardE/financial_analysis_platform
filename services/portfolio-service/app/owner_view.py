"""Combine owner reads only when a fresh client's public preconditions match.

Expected values can only narrow an existing owner read. They never install or
update an authority, root, key, source epoch, lifecycle or snapshot. Mismatches
must resume the original metadata-first recovery/synchronization protocol.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

from .api import _invoke, _read_json, _transport, get_service
from .holdings import (
    PortfolioService,
    _current_authority,
    _head,
    _identifier,
    _key_ids,
    _metadata_response,
    _positive,
    _ReadSnapshot,
)
from .lifecycle import source_state, state_path
from .store import StoreUnavailable, document_path

PROFILE = "folioview.owner-holdings-view.v1"
MAX_VIEW_BODY_BYTES = 16_384
router = APIRouter(prefix="/api/v3/holdings/sources", route_class=PrivateRoute)
Owner = Annotated[CurrentUser, Depends(require_google_user)]
Service = Annotated[PortfolioService, Depends(get_service)]


def expectation(value, source):
    _identifier(source)
    if (
        type(value) is not dict
        or set(value) != {"contractVersion", "expected"}
        or value["contractVersion"] != CONTRACT_VERSION
        or type(value["expected"]) is not dict
        or set(value["expected"])
        != {
            "vaultId",
            "rootJwk",
            "rootKeyId",
            "registrySequence",
            "checkpointDigest",
            "keyEpoch",
            "resourceRef",
            "sourceEpoch",
            "recipientKeyIds",
        }
    ):
        raise ContractError("malformed_request")
    result = value["expected"]
    _identifier(result["vaultId"])
    validate_schema("PublicJWK", result["rootJwk"])
    validate_schema("KeyId", result["rootKeyId"])
    if jwk_thumbprint(result["rootJwk"]) != result["rootKeyId"]:
        raise ContractError("recipient_binding_mismatch")
    for name in ("registrySequence", "keyEpoch", "sourceEpoch"):
        _positive(result[name])
    validate_schema("Digest", result["checkpointDigest"])
    validate_schema("ResourceRef", result["resourceRef"])
    if (
        result["resourceRef"]["kind"] != "holdings"
        or result["resourceRef"]["sourceService"] != "portfolio"
        or result["resourceRef"]["resourceId"] != source
    ):
        raise ContractError("insufficient_scope")
    keys = result["recipientKeyIds"]
    if (
        type(keys) is not list
        or not 1 <= len(keys) <= 8
        or any(type(key) is not str for key in keys)
        or keys != sorted(set(keys))
    ):
        raise ContractError("malformed_request")
    _key_ids(keys)
    return result


def _owner_selection(registry, now):
    # Same live device/recovery projection as Hub authority synchronization.
    writers, recipients, roles = [], [], set()
    for kid in sorted(registry.active_key_ids):
        try:
            certificate = registry.cert(kid, connection_id=None, now=now)
        except ContractError:
            continue
        if certificate["role"] == "device_sig" and "object_write" in certificate["capabilities"]:
            writers.append(kid)
        if certificate["role"] in {"device_enc", "recovery_enc"}:
            recipients.append(kid)
            roles.add(certificate["role"])
    if (
        not 1 <= len(writers) <= 8
        or not 2 <= len(recipients) <= 8
        or roles != {"device_enc", "recovery_enc"}
    ):
        raise ContractError("key_authorization_required")
    return writers, recipients


def read_view(service, uid, source, expected):
    owner = owner_key(uid)

    def envelope(mode, metadata=None, snapshot=None):
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "vaultId": expected["vaultId"],
            "sourceId": source,
            "mode": mode,
            "metadata": metadata,
            "snapshot": snapshot,
        }

    def read(unit):
        now = service.now()
        paths = [
            document_path("portfolio_authorities", owner, source),
            document_path("portfolio_heads", owner, source),
            state_path(owner, source),
        ]
        view = _ReadSnapshot(unit, unit.get_many(paths))
        authority = _current_authority(view, owner, source, now)
        row, registry = authority.document, authority.registry
        head = _head(view, owner, source)
        lifecycle = source_state(view, authority)
        metadata = _metadata_response(authority, head, lifecycle)
        if head.get("sourceEpoch") is not None and head["sourceEpoch"] > row["sourceEpoch"]:
            raise StoreUnavailable
        # Validate current storage before a transport hint: corrupted authority,
        # heads and lifecycle must never be hidden by caller preconditions.
        matches = (
            all(
                row[name] == expected[name]
                for name in ("vaultId", "rootKeyId", "resourceRef", "sourceEpoch")
            )
            and canonical_json(row["rootJwk"]) == canonical_json(expected["rootJwk"])
            and registry.registry_sequence == expected["registrySequence"]
            and registry.checkpoint_digest == expected["checkpointDigest"]
            and registry.key_epoch == expected["keyEpoch"]
        )
        if (
            lifecycle["state"] != "active"
            or lifecycle["pendingMutationId"] is not None
            or not matches
        ):
            return envelope("sync_required")
        try:
            writers, recipients = _owner_selection(registry, now)
        except ContractError as error:
            if error.code != "key_authorization_required":
                raise
            return envelope("sync_required")
        if (
            row["writerKeyIds"] != writers
            or row["recipientKeyIds"] != recipients
            or recipients != expected["recipientKeyIds"]
        ):
            return envelope("sync_required")
        snapshot = (
            service._snapshot_response(view, authority, owner, source, head["snapshotId"])
            if head["snapshotId"] is not None
            else None
        )
        if snapshot is not None:
            receipt = snapshot["receipt"]
            if receipt["revision"] != head["revision"] or (
                head.get("sourceEpoch") is not None
                and receipt["sourceEpoch"] != head["sourceEpoch"]
            ):
                raise StoreUnavailable
        check_read_response(metadata)
        # _snapshot_response has already enforced the original snapshot budget.
        # Only an individually valid pair that is too large together may fall back.
        result = envelope("complete", metadata, snapshot)
        try:
            check_read_response(result)
        except ContractError as error:
            if error.code != "payload_too_large":
                raise
            return envelope("separate")
        return result

    return service.store.transact(read)


@router.post("/{source_id}/view/query")
async def owner_view(source_id: str, request: Request, user: Owner, service: Service):
    _invoke(lambda: _transport(request))
    for name in (
        "x-folioview-delegation",
        "x-folioview-authority-delegation",
        "x-folioview-author-key",
        "idempotency-key",
    ):
        if request.headers.getlist(name):
            raise HTTPException(400, {"code": "malformed_request"})
    # Cloud Run authenticates the BFF with X-Serverless-Authorization. As with
    # existing Portfolio routes, it never selects the owner: require_google_user
    # independently verifies the end user's Authorization header.
    if request.headers.getlist("content-type") != ["application/json"]:
        raise HTTPException(415, {"code": "unsupported_media_type"})
    value = await _read_json(request, max_bytes=MAX_VIEW_BODY_BYTES)
    expected = _invoke(lambda: expectation(value, source_id))
    return await run_in_threadpool(
        _invoke, lambda: read_view(service, user.uid, source_id, expected)
    )
