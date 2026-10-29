"""Owner-isolated metadata Inbox, historical ciphertext and signed logical state.

Reads never imply decryption, source synchronization or a read-state mutation.
The storage-only history adapter supplies no OAuth authorization capability.
"""

import hashlib
import secrets
import time
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.authority import verify_control_command
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import (
    CONTRACT_VERSION,
    MAX_CONTROL_BYTES,
    MAX_SAFE_INTEGER,
)
from folioview_shared.encrypted.crypto import (
    _signed_parts,
    jwk_thumbprint,
    signing_input_fingerprint,
    verify_jws,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.http import PrivateRoute
from folioview_shared.identity import owner_key

from .api import Owner, _invoke, body, transport
from .results import MAX_REVISIONS, ResultService, result_path, revision_path
from .runs import copy, timestamp
from .store import StoreUnavailable, document_path, get_store
from .vaults import _current, identifier, positive

FILTERS = frozenset({"all", "unread", "starred", "archived"})
CURSOR_SECONDS = 900
MAX_CURSORS = 32
MAX_STATE_OPERATIONS = 128


class _HistoryStore:
    """Only immutable storage is shared with the existing result verifier."""

    def __init__(self, store):
        self.store = store


def _digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


class InboxService:
    def __init__(self, store, *, clock=time.time):
        self.store, self.clock = store, clock
        self.history_reader = ResultService(_HistoryStore(store))

    def now(self):
        return int(self.clock())

    def _anchor(self, unit, owner):
        row = unit.get(document_path("hub_vaults", owner))
        if row is None:
            return None
        try:
            if row["ownerSubject"] != owner:
                raise ValueError
            identifier(row["vaultId"])
            validate_schema("PublicJWK", row["rootJwk"])
            if jwk_thumbprint(row["rootJwk"]) != row["rootKeyId"]:
                raise ValueError
            return row
        except (ValueError, KeyError, TypeError, ContractError):
            raise StoreUnavailable from None

    def _index(self, unit, owner, anchor):
        path = document_path("hub_result_indexes", owner)
        present = unit.get(path)
        if anchor is None and present is not None:
            raise StoreUnavailable
        return self.history_reader._index(unit, owner)[1]["resultIds"]

    def _head(self, unit, uid, owner, anchor, result_id, ids, *, fetched=False, value=None):
        if result_id not in ids:
            raise ContractError("not_found")
        row = value if fetched else unit.get(result_path(owner, result_id))
        try:
            if row is None or set(row) != {
                "ownerSubject",
                "ownerUid",
                "vaultId",
                "resultId",
                "runId",
                "metadata",
                "provenance",
            }:
                raise ValueError
            if (
                row["ownerSubject"] != owner
                or row["ownerUid"] != uid
                or row["vaultId"] != anchor["vaultId"]
                or row["resultId"] != result_id
            ):
                raise ValueError
            meta = validate_schema("ResultMetadata", row["metadata"])
            if (
                meta["resultId"] != result_id
                or meta["runId"] != row["runId"]
                or meta["deliveryRevision"] != 1
                or meta["revision"] > MAX_REVISIONS
            ):
                raise ValueError
            provenance = row["provenance"]
            if set(provenance) != {
                "kind",
                "provider",
                "clientId",
                "connectionId",
                "authorizationId",
                "agentPrincipalId",
            }:
                raise ValueError
            if (
                provenance["kind"] != "authorized_connection_submission"
                or provenance["provider"] != "muse"
                or provenance["connectionId"] != meta["connectionId"]
            ):
                raise ValueError
            for field in ["clientId", "connectionId", "authorizationId", "agentPrincipalId"]:
                identifier(provenance[field])
            return row
        except (ValueError, KeyError, TypeError, ContractError):
            raise StoreUnavailable from None

    def _heads(self, unit, uid, owner, anchor, ids):
        values = unit.get_many([result_path(owner, key) for key in ids])
        return [
            self._head(
                unit,
                uid,
                owner,
                anchor,
                key,
                ids,
                fetched=True,
                value=values[result_path(owner, key)],
            )["metadata"]
            for key in ids
        ]

    def _lookup(self, unit, uid, result_id):
        owner = owner_key(uid)
        anchor = self._anchor(unit, owner)
        ids = self._index(unit, owner, anchor)
        head = self._head(unit, uid, owner, anchor, result_id, ids)
        run = self.history_reader.runs._row(unit, owner, head["runId"])
        verified_head = self.history_reader._head(unit, run)
        if verified_head != head or run["ownerUid"] != uid:
            raise StoreUnavailable
        return owner, anchor, head, run

    @staticmethod
    def _select(rows, filter, task_id):
        return [
            row
            for row in rows
            if (task_id is None or row["taskId"] == task_id)
            and (
                row["archived"]
                if filter == "archived"
                else not row["archived"]
                and (
                    filter == "all"
                    or (filter == "unread" and not row["read"])
                    or (filter == "starred" and row["starred"])
                )
            )
        ]

    def _query(self, limit, cursor, filter="all", task_id=None):
        if (
            type(limit) is not int
            or not 1 <= limit <= 50
            or type(filter) is not str
            or filter not in FILTERS
        ):
            raise ContractError("unsupported_query")
        if task_id is not None:
            identifier(task_id)
        if cursor is not None:
            try:
                if type(cursor) is not str or len(cursor) != 32:
                    raise ValueError
                b64url_decode(cursor, exact_bytes=24)
            except (ValueError, TypeError, ContractError):
                raise ContractError("unsupported_query") from None

    def _page(self, unit, owner, vault, rows, *, limit, cursor, query, transform=None):
        digest = _digest({"owner": owner, "vault": vault, "query": query, "rows": rows})
        path = document_path("hub_inbox_cursors", owner, vault)
        saved = unit.get(path)
        if saved is None:
            saved = {"ownerSubject": owner, "vaultId": vault, "cursors": {}}
        try:
            if (
                set(saved) != {"ownerSubject", "vaultId", "cursors"}
                or saved["ownerSubject"] != owner
                or saved["vaultId"] != vault
                or type(saved["cursors"]) is not dict
                or len(saved["cursors"]) > MAX_CURSORS
            ):
                raise ValueError
            for token, value in saved["cursors"].items():
                b64url_decode(token, exact_bytes=24)
                if set(value) != {"snapshot", "position", "expiresAt", "limit", "query"}:
                    raise ValueError
                validate_schema("Digest", value["snapshot"])
                positive(value["position"], zero=True)
                positive(value["expiresAt"])
                if type(value["query"]) is not dict or type(value["limit"]) is not int:
                    raise ValueError
        except (ValueError, TypeError, KeyError, ContractError):
            raise StoreUnavailable from None
        now, start = self.now(), 0
        if cursor is not None:
            old = saved["cursors"].get(cursor)
            if (
                old is None
                or old["query"] != query
                or old["limit"] != limit
                or now >= old["expiresAt"]
            ):
                raise ContractError("unsupported_query")
            if old["snapshot"] != digest:
                raise ContractError("version_conflict")
            start = old["position"]
            if not 0 < start < len(rows):
                raise ContractError("unsupported_query")
        chosen = rows[start : start + limit]
        cursors = {token: row for token, row in saved["cursors"].items() if row["expiresAt"] > now}
        next_cursor = None
        if start + len(chosen) < len(rows):
            position = start + len(chosen)
            matches = [
                token
                for token, row in cursors.items()
                if row["snapshot"] == digest
                and row["position"] == position
                and row["limit"] == limit
                and row["query"] == query
            ]
            if matches:
                next_cursor = sorted(matches)[0]
            else:
                if len(cursors) >= MAX_CURSORS:
                    # Query continuations are a bounded view cache, not immutable
                    # business receipts. Retaining every page would prevent a
                    # small page size from traversing the full result directory.
                    candidates = [token for token in cursors if token != cursor] or list(cursors)
                    oldest = min(candidates, key=lambda token: (cursors[token]["expiresAt"], token))
                    del cursors[oldest]
                next_cursor = secrets.token_urlsafe(24)
                cursors[next_cursor] = {
                    "snapshot": digest,
                    "position": position,
                    "expiresAt": now + CURSOR_SECONDS,
                    "limit": limit,
                    "query": copy(query),
                }
        if cursors != saved["cursors"]:
            unit.put(path, {"ownerSubject": owner, "vaultId": vault, "cursors": cursors})
        result = {
            "contractVersion": CONTRACT_VERSION,
            "items": transform(chosen) if transform is not None else copy(chosen),
            "nextCursor": next_cursor,
        }
        validate_schema("ResultMetadataPage", result)
        check_read_response(result)
        return result

    def list(self, uid, *, limit=20, cursor=None, filter="all", task_id=None):
        self._query(limit, cursor, filter, task_id)
        owner = owner_key(uid)

        def read(unit):
            anchor = self._anchor(unit, owner)
            ids = self._index(unit, owner, anchor)
            rows = self._heads(unit, uid, owner, anchor, ids)
            selected = self._select(rows, filter, task_id)
            selected.sort(
                key=lambda row: (datetime.fromisoformat(row["receivedAt"]), row["resultId"]),
                reverse=True,
            )
            if anchor is None:
                if cursor is not None:
                    raise ContractError("unsupported_query")
                return {"contractVersion": CONTRACT_VERSION, "items": [], "nextCursor": None}
            return self._page(
                unit,
                owner,
                anchor["vaultId"],
                selected,
                limit=limit,
                cursor=cursor,
                query={"kind": "list", "filter": filter, "taskId": task_id},
            )

        return self.store.transact(read)

    def counts(self, uid, *, task_id=None):
        self._query(20, None, task_id=task_id)
        owner = owner_key(uid)

        def read(unit):
            anchor = self._anchor(unit, owner)
            ids = self._index(unit, owner, anchor)
            rows = self._heads(unit, uid, owner, anchor, ids)
            selected = [row for row in rows if task_id is None or row["taskId"] == task_id]
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": "folioview.owner-result-counts.v1",
                "asOf": timestamp(self.now()),
                "counts": {
                    **{name: len(self._select(selected, name, None)) for name in FILTERS},
                    "total": len(selected),
                },
            }
            check_read_response(result)
            return result

        return self.store.transact(read)

    def _selected(self, unit, uid, result_id, revision=None, delivery_revision=1):
        owner, anchor, head, run = self._lookup(unit, uid, result_id)
        selected = head["metadata"]["revision"] if revision is None else revision
        if selected > head["metadata"]["revision"] or delivery_revision != 1:
            raise ContractError("not_found")
        saved, registry, grant = self.history_reader._revision(unit, run, selected)
        first = saved if selected == 1 else self.history_reader._revision(unit, run, 1)[0]
        if first["receipt"]["receivedAt"] != head["metadata"]["receivedAt"]:
            raise StoreUnavailable
        meta = copy(head["metadata"])
        for key in ["revision", "deliveryRevision", "envelopeFingerprint"]:
            meta[key] = saved["receipt"][key]
        carrier = strict_json_loads(saved["carrierJson"])
        _, message = _signed_parts(carrier["signedObject"])
        meta["keyEpoch"] = message["context"]["keyEpoch"]
        validate_schema("ResultMetadata", meta)
        return owner, anchor, head, run, saved, registry, grant, meta, carrier

    def get(self, uid, result_id, revision=None, delivery_revision=1):
        identifier(result_id)
        if revision is not None:
            positive(revision)
        positive(delivery_revision)

        def read(unit):
            owner, _, _, _, saved, _, _, meta, carrier = self._selected(
                unit, uid, result_id, revision, delivery_revision
            )
            proof = saved["proof"]
            bundle = strict_json_loads(
                unit.get(
                    revision_path(
                        owner, result_id, meta["revision"], "registry", str(proof["proofCount"])
                    )
                )["bundleJson"]
            )
            key_proofs = {
                "checkpoint": bundle["checkpoint"],
                "certificates": [row["certificate"] for row in bundle["entries"]],
            }
            validate_schema("KeyProofs", key_proofs)
            result = {
                "contractVersion": CONTRACT_VERSION,
                "metadata": meta,
                "signedObject": carrier["signedObject"],
                "keyProofs": key_proofs,
            }
            validate_schema("EncryptedResult", result)
            check_read_response(result)
            return result

        return self.store.transact(read)

    def history(self, uid, result_id, *, limit=20, cursor=None):
        identifier(result_id)
        self._query(limit, cursor)

        def read(unit):
            owner, anchor, head, run = self._lookup(unit, uid, result_id)
            rows = [
                {"revision": revision, "head": head["metadata"]}
                for revision in range(head["metadata"]["revision"], 0, -1)
            ]

            def selected(chosen):
                paths = [revision_path(owner, result_id, item["revision"]) for item in chosen]
                values = unit.get_many(
                    paths, field_paths=["ownerSubject", "resultId", "revision", "receipt"]
                )
                result = []
                for item, path in zip(chosen, paths, strict=True):
                    revision, saved = item["revision"], values[path]
                    try:
                        receipt = validate_schema("ResultReceipt", saved["receipt"])
                        if (
                            saved["ownerSubject"] != owner
                            or saved["resultId"] != result_id
                            or saved["revision"] != revision
                            or receipt["revision"] != revision
                            or receipt["resultId"] != result_id
                            or receipt["runId"] != run["run"]["runId"]
                            or receipt["taskId"] != head["metadata"]["taskId"]
                            or receipt["deliveryRevision"] != 1
                        ):
                            raise ValueError
                        metadata = copy(head["metadata"])
                        for key in ["revision", "deliveryRevision", "envelopeFingerprint"]:
                            metadata[key] = receipt[key]
                        validate_schema("ResultMetadata", metadata)
                        result.append(metadata)
                    except (ValueError, TypeError, KeyError, ContractError):
                        raise StoreUnavailable from None
                return result

            return self._page(
                unit,
                owner,
                anchor["vaultId"],
                rows,
                limit=limit,
                cursor=cursor,
                query={"kind": "history", "resultId": result_id},
                transform=selected,
            )

        return self.store.transact(read)

    def evidence(self, uid, result_id, revision):
        identifier(result_id)
        positive(revision)

        def read(unit):
            owner, _, head, run, saved, registry, _, _, _ = self._selected(
                unit, uid, result_id, revision
            )
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": "folioview.owner-result-evidence.v1",
                "run": run["run"],
                "manifest": strict_json_loads(run["manifestJson"]),
                "manifestFingerprint": run["manifestFingerprint"],
                "receipt": saved["receipt"],
                "agentKeyGrant": strict_json_loads(run["grantJson"]),
                "authorizationExpiresAt": saved["proof"]["authorizationExpiresAt"],
                "provenance": head["provenance"],
                "authorProof": {
                    "registrySequence": saved["proof"]["proofCount"],
                    "verifiedAt": saved["proof"]["verifiedAt"],
                },
                "registryProofs": [
                    {
                        "registrySequence": sequence,
                        "checkpointDigest": registry.checkpoint_history[sequence],
                        "path": (
                            f"/api/v2/results/{result_id}/revisions/{revision}"
                            f"/registries/{sequence}"
                        ),
                    }
                    for sequence in range(1, saved["proof"]["proofCount"] + 1)
                ],
            }
            check_read_response(result)
            return copy(result)

        return self.store.transact(read)

    def registry(self, uid, result_id, revision, sequence):
        identifier(result_id)
        positive(revision)
        positive(sequence)

        def read(unit):
            owner, _, _, _, saved, _, _, _, _ = self._selected(unit, uid, result_id, revision)
            if sequence > saved["proof"]["proofCount"]:
                raise ContractError("not_found")
            row = unit.get(revision_path(owner, result_id, revision, "registry", str(sequence)))
            bundle = strict_json_loads(row["bundleJson"])
            validate_schema("RegistryBundle", bundle)
            check_read_response(bundle)
            return bundle

        return self.store.transact(read)

    def state(self, uid, result_id, value, operation, author):
        identifier(result_id)
        validate_schema("OperationIdentifier", operation)
        validate_schema("KeyId", author)
        if (
            type(value) is not dict
            or set(value) != {"contractVersion", "command"}
            or value["contractVersion"] != CONTRACT_VERSION
        ):
            raise ContractError("malformed_request")
        owner = owner_key(uid)

        def update(unit):
            anchor = self._anchor(unit, owner)
            ids = self._index(unit, owner, anchor)
            head = self._head(unit, uid, owner, anchor, result_id, ids)
            now = self.now()
            _, registry = _current(unit, owner, now, anchor["vaultId"])
            cert = registry.cert(author, role="device_sig", connection_id=None, now=now)
            payload = verify_jws(
                value["command"], cert["publicJwk"], typ="fv-control+jws", expected_kid=author
            )
            validate_schema("ControlCommandPayload", payload)
            positive(payload["expectedVersion"], zero=True)
            command = verify_control_command(
                value["command"],
                registry=registry,
                expected_action="result_state_update",
                expected_target_id=result_id,
                expected_version=payload["expectedVersion"],
                expected_source_epoch=None,
                expected_parameters=payload["parameters"],
                now=now,
            )

            def active_author():
                checked_at = self.now()
                if checked_at < max(now, registry.issued_at):
                    raise StoreUnavailable
                if not cert["notBefore"] <= checked_at < cert["expiresAt"]:
                    raise ContractError("key_authorization_required")

            active_author()
            if command["stableOperationId"] != operation:
                raise ContractError("idempotency_conflict")
            fingerprint = signing_input_fingerprint(value["command"])
            path = document_path("hub_result_state_operations", owner, anchor["vaultId"], result_id)
            operations = unit.get(path)
            if operations is None:
                operations = {
                    "ownerSubject": owner,
                    "vaultId": anchor["vaultId"],
                    "resultId": result_id,
                    "operations": {},
                }
            try:
                if (
                    set(operations) != {"ownerSubject", "vaultId", "resultId", "operations"}
                    or operations["ownerSubject"] != owner
                    or operations["vaultId"] != anchor["vaultId"]
                    or operations["resultId"] != result_id
                    or type(operations["operations"]) is not dict
                    or len(operations["operations"]) > MAX_STATE_OPERATIONS
                ):
                    raise ValueError
                for op, saved in operations["operations"].items():
                    validate_schema("OperationIdentifier", op)
                    if set(saved) != {"fingerprint", "authorKeyId", "metadata"}:
                        raise ValueError
                    validate_schema("Digest", saved["fingerprint"])
                    validate_schema("KeyId", saved["authorKeyId"])
                    meta = validate_schema("ResultMetadata", saved["metadata"])
                    if (
                        meta["resultId"] != result_id
                        or meta["stateVersion"] > head["metadata"]["stateVersion"]
                        or meta["revision"] > head["metadata"]["revision"]
                        or meta["deliveryRevision"] != 1
                        or any(
                            meta[key] != head["metadata"][key]
                            for key in [
                                "taskId",
                                "runId",
                                "connectionId",
                                "manifestId",
                                "keyEpoch",
                                "receivedAt",
                            ]
                        )
                    ):
                        raise ValueError
            except (ValueError, TypeError, KeyError, ContractError):
                raise StoreUnavailable from None
            old = operations["operations"].get(operation)
            if old is not None:
                if old["fingerprint"] != fingerprint or old["authorKeyId"] != author:
                    raise ContractError("idempotency_conflict")
                return copy(old["metadata"])
            if command["expectedVersion"] != head["metadata"]["stateVersion"]:
                raise ContractError("version_conflict")
            if (
                len(operations["operations"]) >= MAX_STATE_OPERATIONS
                or head["metadata"]["stateVersion"] >= MAX_SAFE_INTEGER
            ):
                raise ContractError("version_conflict")
            metadata = copy(head["metadata"])
            metadata.update(command["parameters"])
            metadata["stateVersion"] += 1
            validate_schema("ResultMetadata", metadata)
            # Recheck time before storing a control whose author may just have expired.
            active_author()
            head["metadata"] = metadata
            operations["operations"][operation] = {
                "fingerprint": fingerprint,
                "authorKeyId": author,
                "metadata": copy(metadata),
            }
            unit.put(result_path(owner, result_id), head)
            unit.put(path, operations)
            return copy(metadata)

        return self.store.transact(update)


def get_inbox_service():
    return InboxService(get_store())


Inboxes = Annotated[InboxService, Depends(get_inbox_service)]
router = APIRouter(prefix="/api/v2/results", route_class=PrivateRoute)


def _protocol(request, *, write=False, allowed=frozenset()):
    if request.headers.getlist("x-folioview-delegation") or request.headers.getlist(
        "x-serverless-authorization"
    ):
        raise ContractError("insufficient_scope")
    if write:
        transport(request, operation=True, author=True)
    else:
        if request.headers.getlist("x-folioview-contract") != [CONTRACT_VERSION]:
            raise ContractError("unsupported_contract")
        if set(request.query_params) - allowed or any(
            len(request.query_params.getlist(key)) != 1 for key in request.query_params
        ):
            raise ContractError("unsupported_query")


def _number(value, *, maximum=50, query=False):
    if (
        type(value) is not str
        or not value.isascii()
        or not value.isdecimal()
        or len(value) > len(str(maximum))
        or str(int(value)) != value
        or not 1 <= int(value) <= maximum
    ):
        raise ContractError("unsupported_query" if query else "malformed_request")
    return int(value)


@router.get("")
def list_results(request: Request, user: Owner, service: Inboxes):
    def read():
        _protocol(request, allowed={"cursor", "limit", "filter", "taskId"})
        return service.list(
            user.uid,
            limit=_number(request.query_params.get("limit", "20"), query=True),
            cursor=request.query_params.get("cursor"),
            filter=request.query_params.get("filter", "all"),
            task_id=request.query_params.get("taskId"),
        )

    return _invoke(read)


@router.get("/counts")
def result_counts(request: Request, user: Owner, service: Inboxes):
    return _invoke(
        lambda: (
            _protocol(request, allowed={"taskId"}),
            service.counts(user.uid, task_id=request.query_params.get("taskId")),
        )[1]
    )


@router.get("/{result_id}")
def get_result(result_id: str, request: Request, user: Owner, service: Inboxes):
    def read():
        _protocol(request, allowed={"revision", "deliveryRevision"})
        revision = request.query_params.get("revision")
        return service.get(
            user.uid,
            result_id,
            _number(revision, maximum=MAX_REVISIONS, query=True) if revision is not None else None,
            _number(
                request.query_params.get("deliveryRevision", "1"),
                maximum=MAX_SAFE_INTEGER,
                query=True,
            ),
        )

    return _invoke(read)


@router.get("/{result_id}/revisions")
def result_history(result_id: str, request: Request, user: Owner, service: Inboxes):
    def read():
        _protocol(request, allowed={"cursor", "limit"})
        return service.history(
            user.uid,
            result_id,
            limit=_number(request.query_params.get("limit", "20"), query=True),
            cursor=request.query_params.get("cursor"),
        )

    return _invoke(read)


@router.get("/{result_id}/revisions/{revision}/evidence")
def result_evidence(result_id: str, revision: str, request: Request, user: Owner, service: Inboxes):
    return _invoke(
        lambda: (
            _protocol(request),
            service.evidence(user.uid, result_id, _number(revision, maximum=MAX_REVISIONS)),
        )[1]
    )


@router.get("/{result_id}/revisions/{revision}/registries/{sequence}")
def result_registry(
    result_id: str, revision: str, sequence: str, request: Request, user: Owner, service: Inboxes
):
    return _invoke(
        lambda: (
            _protocol(request),
            service.registry(
                user.uid,
                result_id,
                _number(revision, maximum=MAX_REVISIONS),
                _number(sequence, maximum=32),
            ),
        )[1]
    )


@router.patch("/{result_id}/state")
async def update_result_state(result_id: str, request: Request, user: Owner, service: Inboxes):
    _invoke(lambda: _protocol(request, write=True))
    value = await body(request, {"contractVersion", "command"}, max_bytes=MAX_CONTROL_BYTES)
    return await run_in_threadpool(
        _invoke,
        lambda: service.state(
            user.uid,
            result_id,
            value,
            request.headers["idempotency-key"],
            request.headers["x-folioview-author-key"],
        ),
    )
