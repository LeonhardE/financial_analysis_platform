"""Immutable formal Run inputs, with current transport/execution authority kept separate."""

import hashlib
import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.authority import (
    verify_agent_grant,
    verify_begin_intent,
    verify_registry,
)
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import (
    CONTRACT_VERSION,
    MAX_CONTROL_BYTES,
    MAX_RUN_SECONDS,
)
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.envelope import manifest_fingerprint, parse_carrier
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json, strict_json_loads
from folioview_shared.encrypted.manifests import (
    ManifestExpectation,
    validate_component_page,
    verify_component_author,
    verify_manifest,
)
from folioview_shared.encrypted.schema import validate_schema

from .api import body, transport
from .fences import require_current_bindings
from .oauth import OAuthFailure
from .oauth_routes import Service
from .preparations import (
    SCOPES,
    AgentRoute,
    PreparationService,
    bearer,
    require_adapter,
    source_versions,
)
from .store import StoreUnavailable, document_path
from .tasks import _head, _index
from .vaults import _current, identifier

PROFILE = "folioview.agent-run.v1"
MAX_RUNS_PER_GRANT = 32
MAX_PER_CONNECTION_MINUTE = 20
MAX_PER_OWNER_DAY = 200


def copy(value):
    return strict_json_loads(canonical_json(value))


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def timestamp(now):
    return datetime.fromtimestamp(now, UTC).isoformat().replace("+00:00", "Z")


def allocate(payload, fingerprint):
    namespace = [
        payload[k]
        for k in (
            "ownerSubject",
            "vaultId",
            "connectionId",
            "authorizationId",
            "grantId",
            "grantEpoch",
            "taskId",
            "stableOperationId",
        )
    ] + [fingerprint]
    return {
        "runId": "run_" + digest(["folioview.run-allocation.v1", *namespace]),
        "manifestId": "manifest_" + digest(["folioview.manifest-allocation.v1", *namespace]),
        "initialResultId": "result_" + digest(["folioview.result-allocation.v1", *namespace]),
    }


def _path(collection, owner, run, suffix=None):
    return document_path(collection, owner, run, *(() if suffix is None else (str(suffix),)))


def _expectation(row):
    run = row["run"]
    return ManifestExpectation(
        row["ownerSubject"],
        run["vaultId"],
        run["runId"],
        run["manifestId"],
        run["initialResultId"],
        run["beginIntentFingerprint"],
    )


class RunService:
    def __init__(self, oauth):
        self.oauth, self.store = oauth, oauth.store
        self.preparations = PreparationService(oauth)

    def _base(self, unit, token, scope):
        return self.oauth.authorize_in_transaction(unit, token, scope=scope)

    def _lookup_operation(self, unit, principal, task, operation):
        connection = unit.get(
            document_path("hub_oauth_connections", principal.owner_subject, principal.connection_id)
        )
        grant = connection["grants"].get(task)
        if grant is None or task not in principal.task_ids:
            raise OAuthFailure("insufficient_scope", 403)
        path = document_path(
            "hub_run_operations",
            principal.owner_subject,
            connection["vaultId"],
            principal.connection_id,
            principal.authorization_id,
            grant["grantId"],
            task,
            operation,
        )
        saved = unit.get(path)
        if saved is not None:
            try:
                if set(saved) != {"runId", "beginIntentFingerprint"}:
                    raise ValueError
                validate_schema("Identifier", saved["runId"])
                validate_schema("Digest", saved["beginIntentFingerprint"])
            except (ValueError, TypeError, KeyError, ContractError):
                raise StoreUnavailable from None
        return path, saved

    def _row(self, unit, owner, run_id):
        row = unit.get(_path("hub_runs", owner, run_id))
        if row is None:
            raise ContractError("not_found")
        try:
            if (
                set(row)
                != {
                    "ownerSubject",
                    "ownerUid",
                    "run",
                    "manifestJson",
                    "manifestFingerprint",
                    "grantJson",
                    "proofCount",
                    "authorProofs",
                    "cursors",
                    "originalTaskFingerprint",
                }
                or row["ownerSubject"] != owner
                or row["run"]["runId"] != run_id
            ):
                raise ValueError
            validate_schema("RunDescriptor", row["run"])
            manifest = strict_json_loads(row["manifestJson"])
            validate_schema("ManifestDescriptor", manifest)
            if manifest_fingerprint(manifest) != row["manifestFingerprint"]:
                raise ValueError
            validate_schema("Digest", row["originalTaskFingerprint"])
            if type(row["proofCount"]) is not int or not 1 <= row["proofCount"] <= 32:
                raise ValueError
            count = len(manifest["entries"]) + 1
            if type(row["cursors"]) is not list or len(row["cursors"]) != count - 1:
                raise ValueError
            if any(type(x) is not str or len(x) != 32 for x in row["cursors"]):
                raise ValueError
            for cursor in row["cursors"]:
                b64url_decode(cursor, exact_bytes=24)
            if len(set(row["cursors"])) != len(row["cursors"]):
                raise ValueError
            if type(row["authorProofs"]) is not list or len(row["authorProofs"]) != count:
                raise ValueError
            created = int(datetime.fromisoformat(row["run"]["createdAt"]).timestamp())
            ids = [
                manifest["taskEnvelope"]["objectId"],
                *[x["objectId"] for x in manifest["entries"]],
            ]
            for proof, obj in zip(row["authorProofs"], ids, strict=True):
                if proof != {
                    "objectId": obj,
                    "registrySequence": row["proofCount"],
                    "verifiedAt": created,
                }:
                    raise ValueError
            _, payload = _signed_parts(manifest["signedBeginIntent"])
            allocated = allocate(payload, row["run"]["beginIntentFingerprint"])
            if any(row["run"][k] != v for k, v in allocated.items()):
                raise ValueError
            if payload["registrySequence"] != row["proofCount"]:
                raise ValueError
            return row
        except (ValueError, TypeError, KeyError, ContractError):
            raise StoreUnavailable from None

    def _authority(self, unit, token, row, scope):
        principal = self._base(unit, token, scope)
        run, owner = row["run"], principal.owner_subject
        if row["ownerSubject"] != owner or row["ownerUid"] != principal.owner_uid:
            raise ContractError("not_found")
        if (
            run["connectionId"] != principal.connection_id
            or run["authorizationId"] != principal.authorization_id
        ):
            raise ContractError("not_found")
        if run["taskId"] not in principal.task_ids:
            raise OAuthFailure("insufficient_scope", 403)
        conn = unit.get(document_path("hub_oauth_connections", owner, principal.connection_id))
        current = conn["grants"][run["taskId"]]
        if current["grantId"] != run["grantId"] or current["grantEpoch"] != run["grantEpoch"]:
            raise ContractError("not_found")
        if current["keyGrantJson"] != row["grantJson"]:
            raise StoreUnavailable
        vault, registry = _current(unit, owner, self.oauth.now())
        head = _head(
            unit, owner, run["vaultId"], run["taskId"], _index(unit, owner, run["vaultId"])
        )
        if head is None or head["metadata"]["status"] != "active":
            raise OAuthFailure("insufficient_scope", 403)
        meta = head["metadata"]
        if (
            meta["executionEpoch"] != run["executionEpoch"]
            or meta["taskVersion"] < run["taskVersion"]
        ):
            raise ContractError("version_conflict")
        grant = verify_agent_grant(
            strict_json_loads(row["grantJson"]),
            registry=registry,
            owner_subject=owner,
            vault_id=run["vaultId"],
            connection_id=run["connectionId"],
            authorization_id=run["authorizationId"],
            task_id=run["taskId"],
            task_version=run["taskVersion"],
            execution_epoch=run["executionEpoch"],
            grant_id=run["grantId"],
            grant_epoch=run["grantEpoch"],
            now=self.oauth.now(),
            authorization_expires_at=conn["expiresAt"],
        )
        bindings = [
            {"ref": b["ref"], "sourceEpoch": b["sourceEpoch"]} for b in grant["resourceBindings"]
        ]
        if sorted(map(canonical_json, bindings)) != sorted(
            map(canonical_json, meta["resourceBindings"])
        ):
            raise ContractError("version_conflict")
        if "decrypt_task" not in grant["capabilities"] or (
            bindings and "decrypt_resources" not in grant["capabilities"]
        ):
            raise OAuthFailure("insufficient_scope", 403)
        if any(SCOPES[b["ref"]["kind"]] not in principal.scopes for b in bindings):
            raise OAuthFailure("insufficient_scope", 403)
        require_current_bindings(unit, owner, bindings)
        manifest = strict_json_loads(row["manifestJson"])
        checked = verify_manifest(
            manifest,
            run,
            registry=registry,
            grant=grant,
            expectation=_expectation(row),
            now=self.oauth.now(),
        )
        if run["state"] not in {"ready", "submitted"}:
            raise ContractError("version_conflict")
        return principal, vault, registry, grant, checked

    def _fresh(self, uid, manifest, *, exact):
        entries = manifest["entries"]
        if not entries:
            return
        observed = source_versions(self.oauth.catalogue, uid)
        for entry in entries:
            source = observed.get(canonical_json(entry["ref"]))
            if (
                source is None
                or source["sourceEpoch"] != entry["sourceEpoch"]
                or (
                    source["revision"] != entry["revision"]
                    if exact
                    else source["revision"] < entry["revision"]
                )
            ):
                raise ContractError("source_unavailable")

    def _proofs(self, unit, row, vault, registry):
        historical = None
        created = row["authorProofs"][0]["verifiedAt"]
        for sequence in range(1, row["proofCount"] + 1):
            proof = unit.get(
                _path("hub_run_proofs", row["ownerSubject"], row["run"]["runId"], sequence)
            )
            try:
                if proof is None or set(proof) != {
                    "ownerSubject",
                    "runId",
                    "sequence",
                    "bundleJson",
                }:
                    raise ValueError
                if (
                    proof["ownerSubject"] != row["ownerSubject"]
                    or proof["runId"] != row["run"]["runId"]
                    or proof["sequence"] != sequence
                ):
                    raise ValueError
                historical = verify_registry(
                    strict_json_loads(proof["bundleJson"]),
                    root_jwk=vault["rootJwk"],
                    pinned_root_key_id=vault["rootKeyId"],
                    owner_subject=row["ownerSubject"],
                    vault_id=row["run"]["vaultId"],
                    now=created,
                    previous=historical,
                )
                if historical.checkpoint_digest != registry.checkpoint_history.get(sequence):
                    raise ValueError
            except (ValueError, TypeError, KeyError, ContractError):
                raise StoreUnavailable from None
        return historical

    def _component(self, unit, row, checked, index, historical):
        run_id, owner = row["run"]["runId"], row["ownerSubject"]
        stored = unit.get(_path("hub_run_components", owner, run_id, index))
        try:
            if stored is None or set(stored) != {"ownerSubject", "runId", "index", "carrierJson"}:
                raise ValueError
            if (
                stored["ownerSubject"] != owner
                or stored["runId"] != run_id
                or stored["index"] != index
                or type(stored["carrierJson"]) is not str
            ):
                raise ValueError
            carrier = parse_carrier(stored["carrierJson"], contract_header=CONTRACT_VERSION)
            _, message = _signed_parts(carrier["signedObject"])
            context = message["context"]
            page = {
                "contractVersion": CONTRACT_VERSION,
                "manifest": checked.manifest,
                "manifestFingerprint": checked.fingerprint,
                "componentIndex": index,
                "component": {
                    "kind": "task" if index == 0 else "resource",
                    "objectId": context["objectId"],
                    "revision": context["revision"],
                    "deliveryRevision": context["deliveryRevision"],
                    "signedObject": carrier["signedObject"],
                },
                "nextCursor": row["cursors"][index] if index < len(row["cursors"]) else None,
            }
            bound = validate_component_page(page, manifest=checked, expected_index=index)
            cert = historical.cert(
                context["authorSigningKeyId"],
                role="device_sig",
                connection_id=None,
                now=row["authorProofs"][index]["verifiedAt"],
            )
            if "object_write" not in cert["capabilities"]:
                raise ValueError
            verify_component_author(
                bound, author_public_jwk=cert["publicJwk"], expected_author_key_id=cert["keyId"]
            )
            return page
        except (ValueError, TypeError, KeyError, ContractError):
            raise StoreUnavailable from None

    def _response(self, row, vault, registry):
        run_id = row["run"]["runId"]
        value = {
            "contractVersion": CONTRACT_VERSION,
            "profile": PROFILE,
            "run": row["run"],
            "manifest": strict_json_loads(row["manifestJson"]),
            "manifestFingerprint": row["manifestFingerprint"],
            "componentPath": f"/agent/v2/runs/{run_id}/inputs",
            "registryProofs": [
                {
                    "registrySequence": n,
                    "checkpointDigest": registry.checkpoint_history[n],
                    "path": f"/agent/v2/runs/{run_id}/registries/{n}",
                }
                for n in range(1, len(vault["registryHistory"]) + 1)
            ],
            "authorProofs": row["authorProofs"],
        }
        check_read_response(value)
        return copy(value)

    def _quota(self, unit, owner, connection, now):
        for label, period, limit in (
            ("owner", 86400, MAX_PER_OWNER_DAY),
            (connection, 60, MAX_PER_CONNECTION_MINUTE),
        ):
            path = document_path("hub_run_quotas", owner, label)
            row = unit.get(path)
            window = now // period
            if row is None:
                row = {"window": window, "count": 0}
            if (
                set(row) != {"window", "count"}
                or type(row["window"]) is not int
                or type(row["count"]) is not int
                or row["count"] < 0
                or window < row["window"]
            ):
                raise StoreUnavailable
            if window > row["window"]:
                row = {"window": window, "count": 0}
            if row["count"] >= limit:
                raise ContractError("version_conflict")
            row["count"] += 1
            unit.put(path, row)

    def begin(self, token, task_id, signed, operation):
        identifier(task_id)
        validate_schema("OperationIdentifier", operation)
        validate_schema("SignedObject", signed)
        if len(canonical_json(signed)) > MAX_CONTROL_BYTES:
            raise ContractError("payload_too_large")
        fingerprint = signing_input_fingerprint(signed)
        _, payload = _signed_parts(signed)
        validate_schema("BeginRunIntentPayload", payload)
        if payload["stableOperationId"] != operation or payload["taskId"] != task_id:
            raise ContractError("recipient_binding_mismatch")

        def existing(unit):
            principal = self._base(unit, token, "runs:create")
            op_path, record = self._lookup_operation(unit, principal, task_id, operation)
            if record is None:
                return None
            row = self._row(unit, principal.owner_subject, record["runId"])
            _, vault, registry, grant, _ = self._authority(unit, token, row, "runs:create")
            signer = registry.cert(
                grant["agentSigningKeyId"],
                role="agent_sig",
                connection_id=grant["connectionId"],
                now=self.oauth.now(),
            )
            verify_jws(
                signed, signer["publicJwk"], typ="fv-control+jws", expected_kid=signer["keyId"]
            )
            if record != {"runId": row["run"]["runId"], "beginIntentFingerprint": fingerprint}:
                raise ContractError("idempotency_conflict")
            frozen = strict_json_loads(row["manifestJson"])
            verify_begin_intent(
                signed,
                registry=registry,
                grant=grant,
                task_envelope_fingerprint=frozen["taskEnvelope"]["envelopeFingerprint"],
                resource_versions=[
                    {k: entry[k] for k in ("ref", "revision", "sourceEpoch", "envelopeFingerprint")}
                    for entry in frozen["entries"]
                ],
                now=self.oauth.now(),
                require_current_checkpoint=False,
            )
            return row, vault, registry

        replay = self.store.transact(existing)
        if replay is not None:
            row, _, _ = replay
            self._fresh(row["ownerUid"], strict_json_loads(row["manifestJson"]), exact=False)
            replay = self.store.transact(existing)
            if replay is None:
                raise StoreUnavailable
            return self._response(*replay), 200

        # This is a public metadata/source preflight, never source plaintext acquisition.
        metadata = self.preparations._agent_read(token, task_id=task_id, scope="runs:create")
        selected = {x["objectId"]: x for x in metadata["objects"]}

        def publish(unit):
            raced = existing(unit)
            if raced is not None:
                return self._response(*raced), 200
            principal = self.oauth.authorize_in_transaction(unit, token, task_id, "runs:create")
            state = self.preparations._authority(
                unit, principal.owner_uid, principal.connection_id, task_id
            )
            conn, grant, vault, registry, meta = state
            if (
                registry.registry_sequence != metadata["registryProofs"][-1]["registrySequence"]
                or registry.checkpoint_digest != metadata["registryProofs"][-1]["checkpointDigest"]
            ):
                raise ContractError("registry_conflict")
            prepared_id = metadata["preparationId"]
            prepared = unit.get(
                document_path("hub_preparations", principal.owner_subject, prepared_id)
            )
            self.preparations._stored(prepared, principal.owner_subject, prepared_id, state)
            if (
                prepared["receipt"]["objects"] != metadata["objects"]
                or meta != metadata["taskMetadata"]
            ):
                raise ContractError("version_conflict")
            task = selected[task_id]
            resource_rows = [
                next(x for x in selected.values() if x["resourceRef"] == b["ref"])
                for b in grant["resourceBindings"]
            ]
            versions = [
                {
                    "ref": x["resourceRef"],
                    "revision": x["revision"],
                    "sourceEpoch": x["sourceEpoch"],
                    "envelopeFingerprint": x["envelopeFingerprint"],
                }
                for x in resource_rows
            ]
            verify_begin_intent(
                signed,
                registry=registry,
                grant=grant,
                task_envelope_fingerprint=task["envelopeFingerprint"],
                resource_versions=versions,
                now=self.oauth.now(),
            )
            ids = allocate(payload, fingerprint)
            if unit.get(_path("hub_runs", principal.owner_subject, ids["runId"])) is not None:
                # Missing operation linkage must never rewrite a previously
                # allocated immutable Run or extend its expiry.
                raise StoreUnavailable
            now = self.oauth.now()
            access = unit.get(
                document_path("hub_oauth_access", hashlib.sha256(token.encode()).hexdigest())
            )
            family = unit.get(document_path("hub_oauth_families", access["familyId"]))
            expires = min(
                now + MAX_RUN_SECONDS, grant["expiresAt"], conn["expiresAt"], family["expiresAt"]
            )
            if expires <= now:
                raise ContractError("key_authorization_required")
            run = {
                "contractVersion": CONTRACT_VERSION,
                "vaultId": vault["vaultId"],
                **ids,
                "taskId": task_id,
                "taskVersion": meta["taskVersion"],
                "executionEpoch": meta["executionEpoch"],
                "connectionId": principal.connection_id,
                "grantId": grant["grantId"],
                "grantEpoch": grant["grantEpoch"],
                "authorizationId": principal.authorization_id,
                "keyEpoch": registry.key_epoch,
                "state": "ready",
                "beginIntentFingerprint": fingerprint,
                "createdAt": timestamp(now),
                "expiresAt": timestamp(expires),
            }
            reference_fields = (
                "objectId",
                "objectType",
                "revision",
                "deliveryRevision",
                "envelopeFingerprint",
            )
            manifest = {
                k: run[k]
                for k in (
                    "contractVersion",
                    "vaultId",
                    "runId",
                    "manifestId",
                    "taskId",
                    "taskVersion",
                    "connectionId",
                    "grantId",
                    "grantEpoch",
                    "executionEpoch",
                    "keyEpoch",
                    "beginIntentFingerprint",
                    "createdAt",
                    "expiresAt",
                )
            } | {
                "signedBeginIntent": copy(signed),
                "taskEnvelope": {k: task[k] for k in reference_fields}
                | {"keyEpoch": registry.key_epoch},
                "entries": [
                    {k: x[k] for k in reference_fields}
                    | {
                        "ref": x["resourceRef"],
                        "sourceEpoch": x["sourceEpoch"],
                        "keyEpoch": registry.key_epoch,
                    }
                    for x in resource_rows
                ],
            }
            row = {
                "ownerSubject": principal.owner_subject,
                "ownerUid": principal.owner_uid,
                "run": run,
                "manifestJson": canonical_json(manifest).decode(),
                "manifestFingerprint": manifest_fingerprint(manifest),
                "grantJson": conn["grants"][task_id]["keyGrantJson"],
                "proofCount": registry.registry_sequence,
                "authorProofs": [
                    {
                        "objectId": x["objectId"],
                        "registrySequence": registry.registry_sequence,
                        "verifiedAt": now,
                    }
                    for x in [task, *resource_rows]
                ],
                "cursors": [secrets.token_urlsafe(24) for _ in resource_rows],
                "originalTaskFingerprint": meta["envelopeFingerprint"],
            }
            verify_manifest(
                manifest,
                run,
                registry=registry,
                grant=grant,
                expectation=_expectation(row),
                now=now,
            )
            index_path = document_path(
                "hub_run_indexes",
                principal.owner_subject,
                vault["vaultId"],
                principal.connection_id,
                principal.authorization_id,
                grant["grantId"],
                task_id,
            )
            index = unit.get(index_path) or {"runIds": []}
            if (
                set(index) != {"runIds"}
                or type(index["runIds"]) is not list
                or len(set(index["runIds"])) != len(index["runIds"])
            ):
                raise StoreUnavailable
            if len(index["runIds"]) >= MAX_RUNS_PER_GRANT:
                raise ContractError("version_conflict")
            if run["runId"] in index["runIds"]:
                raise StoreUnavailable
            self._quota(unit, principal.owner_subject, principal.connection_id, now)
            for number, item in enumerate([task, *resource_rows]):
                original = unit.get(
                    document_path(
                        "hub_preparation_objects",
                        principal.owner_subject,
                        prepared_id,
                        item["objectId"],
                    )
                )
                self.preparations._object_row(
                    original, principal.owner_subject, prepared_id, item["objectId"]
                )
                self.preparations._verify(
                    parse_carrier(original["carrierJson"], contract_header=CONTRACT_VERSION),
                    item,
                    state,
                    original["authorKeyId"],
                    original["operation"],
                )
                unit.put(
                    _path("hub_run_components", principal.owner_subject, run["runId"], number),
                    {
                        "ownerSubject": principal.owner_subject,
                        "runId": run["runId"],
                        "index": number,
                        "carrierJson": original["carrierJson"],
                    },
                )
            for number, bundle in enumerate(vault["registryHistory"], 1):
                unit.put(
                    _path("hub_run_proofs", principal.owner_subject, run["runId"], number),
                    {
                        "ownerSubject": principal.owner_subject,
                        "runId": run["runId"],
                        "sequence": number,
                        "bundleJson": canonical_json(bundle).decode(),
                    },
                )
            # Reads do not depend on mutable preparation documents.
            check_read_response(self._response(row, vault, registry))
            index["runIds"].append(run["runId"])
            unit.put(index_path, index)
            unit.put(_path("hub_runs", principal.owner_subject, run["runId"]), row)
            op_path, _ = self._lookup_operation(unit, principal, task_id, operation)
            unit.put(op_path, {"runId": run["runId"], "beginIntentFingerprint": fingerprint})
            return self._response(row, vault, registry), 201

        return self.store.transact(publish)

    def _read(self, token, run_id, *, cursor=None, sequence=None, inputs=False):
        identifier(run_id)

        def read(unit, expected=None, observe=False):
            principal = self._base(unit, token, "runs:read")
            row = self._row(unit, principal.owner_subject, run_id)
            _, vault, registry, _, checked = self._authority(unit, token, row, "runs:read")
            if inputs:
                if cursor is None:
                    index = 0
                elif type(cursor) is str and cursor in row["cursors"]:
                    index = row["cursors"].index(cursor) + 1
                else:
                    raise ContractError("malformed_request")
                historical = self._proofs(unit, row, vault, registry)
                response = self._component(unit, row, checked, index, historical)
            elif sequence is not None:
                if type(sequence) is not int or not 1 <= sequence <= len(vault["registryHistory"]):
                    raise ContractError("not_found")
                if sequence <= row["proofCount"]:
                    self._proofs(unit, row, vault, registry)
                    proof = unit.get(
                        _path("hub_run_proofs", principal.owner_subject, run_id, sequence)
                    )
                    bundle = strict_json_loads(proof["bundleJson"])
                else:
                    bundle = vault["registryHistory"][sequence - 1]
                response = {
                    "contractVersion": CONTRACT_VERSION,
                    "runId": run_id,
                    "registrySequence": sequence,
                    "registryBundle": bundle,
                }
            else:
                self._proofs(unit, row, vault, registry)
                response = self._response(row, vault, registry)
            check_read_response(response)
            if expected is not None and response != expected:
                raise ContractError("version_conflict")
            if observe and inputs:
                path = document_path(
                    "hub_oauth_connections", principal.owner_subject, principal.connection_id
                )
                connection = unit.get(path)
                if not connection["grants"][row["run"]["taskId"]]["readObserved"]:
                    connection["grants"][row["run"]["taskId"]]["readObserved"] = True
                    unit.put(path, connection)
            return copy(response), row

        before, row = self.store.transact(read)
        self._fresh(row["ownerUid"], strict_json_loads(row["manifestJson"]), exact=False)
        after, _ = self.store.transact(lambda unit: read(unit, before, True))
        return after

    def get(self, token, run_id):
        return self._read(token, run_id)

    def inputs(self, token, run_id, cursor=None):
        return self._read(token, run_id, cursor=cursor, inputs=True)

    def registry(self, token, run_id, sequence):
        return self._read(token, run_id, sequence=sequence)


def get_run_service(oauth: Service):
    return RunService(oauth)


Runs = Annotated[RunService, Depends(get_run_service)]
router = APIRouter(route_class=AgentRoute, dependencies=[Depends(require_adapter)])


@router.post("/agent/v2/tasks/{task_id}/runs")
async def begin_run(task_id: str, request: Request, response: Response, service: Runs):
    token = bearer(request, service)
    transport(request, operation=True)
    value = await body(request, {"contractVersion", "signedBeginIntent"})
    result, status = await run_in_threadpool(
        service.begin,
        token,
        task_id,
        value["signedBeginIntent"],
        request.headers["idempotency-key"],
    )
    response.status_code = status
    return result


@router.get("/agent/v2/runs/{run_id}")
def get_run(run_id: str, request: Request, service: Runs):
    return service.get(bearer(request, service), run_id)


@router.get("/agent/v2/runs/{run_id}/inputs")
def get_inputs(run_id: str, request: Request, service: Runs):
    values = request.query_params.getlist("cursor")
    if (
        set(request.query_params) - {"cursor"}
        or len(values) > 1
        or (values and not 1 <= len(values[0]) <= 128)
    ):
        raise ContractError("unsupported_query")
    # The ordinary transport guard rejects every query. Validate the same exact
    # header/bearer here while allowing only the bounded opaque cursor above.
    if request.headers.getlist("x-folioview-contract") != [CONTRACT_VERSION]:
        raise ContractError("unsupported_contract")
    request.state.preparation_issuer = service.oauth.config.issuer
    values_auth = request.headers.getlist("authorization")
    if (
        len(values_auth) != 1
        or not values_auth[0].startswith("Bearer ")
        or values_auth[0].count(" ") != 1
    ):
        raise ContractError("invalid_token")
    return service.inputs(values_auth[0][7:], run_id, values[0] if values else None)


@router.get("/agent/v2/runs/{run_id}/registries/{sequence}")
def get_registry(run_id: str, sequence: str, request: Request, service: Runs):
    token = bearer(request, service)
    if (
        len(sequence) > 2
        or not sequence.isascii()
        or not sequence.isdecimal()
        or str(int(sequence)) != sequence
    ):
        raise ContractError("malformed_request")
    return service.registry(token, run_id, int(sequence))
