"""Ciphertext-only result publication, revision CAS and historical saved receipts."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from folioview_shared.encrypted.authority import verify_agent_grant, verify_registry
from folioview_shared.encrypted.budgets import check_read_response
from folioview_shared.encrypted.constants import CONTRACT_VERSION, MAX_SAFE_INTEGER
from folioview_shared.encrypted.crypto import _signed_parts, verify_jws
from folioview_shared.encrypted.envelope import (
    EnvelopeExpectation,
    check_operation_replay,
    parse_carrier,
    validate_result_receipt,
    validate_write_transition,
    verify_carrier,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.manifests import verify_manifest
from folioview_shared.encrypted.schema import validate_schema

from .api import body, transport
from .fences import require_current_bindings
from .oauth import OAuthFailure
from .oauth_routes import Service
from .preparations import AgentRoute, bearer, require_adapter
from .runs import RunService, _expectation, copy, timestamp
from .runs import _path as run_path
from .store import StoreUnavailable, document_path
from .tasks import _head, _index
from .vaults import _current, identifier, positive

MAX_RESULTS = 1024
MAX_REVISIONS = 32


def result_path(owner, result):
    return document_path("hub_results", owner, result)


def revision_path(owner, result, revision, *suffix):
    return document_path("hub_result_revisions", owner, result, str(revision), *suffix)


def _binding(row):
    run = row["run"]
    manifest = strict_json_loads(row["manifestJson"])
    return {
        "taskId": run["taskId"],
        "taskVersion": run["taskVersion"],
        "runId": run["runId"],
        "manifestId": run["manifestId"],
        "taskEnvelopeFingerprint": manifest["taskEnvelope"]["envelopeFingerprint"],
        "manifestFingerprint": row["manifestFingerprint"],
        "connectionId": run["connectionId"],
        "grantId": run["grantId"],
        "grantEpoch": run["grantEpoch"],
        "executionEpoch": run["executionEpoch"],
        "resourceRef": None,
        "sourceRevision": None,
        "sourceEpoch": None,
    }


class ResultService:
    def __init__(self, oauth):
        self.oauth, self.store = oauth, oauth.store
        self.runs = RunService(oauth)

    def _relationship(self, unit, token, run_id, scope):
        # Deliberately omit task_id: saved facts do not invoke the new-execution guard.
        principal = self.oauth.authorize_in_transaction(unit, token, scope=scope)
        row = self.runs._row(unit, principal.owner_subject, run_id)
        run = row["run"]
        if (
            row["ownerUid"] != principal.owner_uid
            or run["connectionId"] != principal.connection_id
            or run["authorizationId"] != principal.authorization_id
            or run["taskId"] not in principal.task_ids
        ):
            raise ContractError("not_found")
        conn = unit.get(
            document_path("hub_oauth_connections", principal.owner_subject, principal.connection_id)
        )
        approved = conn["grants"].get(run["taskId"])
        if (
            conn["vaultId"] != run["vaultId"]
            or approved is None
            or approved["grantId"] != run["grantId"]
            or approved["grantEpoch"] != run["grantEpoch"]
        ):
            raise ContractError("not_found")
        if approved["keyGrantJson"] != row["grantJson"]:
            raise StoreUnavailable
        return principal, row, conn

    def _new_authority(self, unit, token, run_id, scope):
        principal, row, conn = self._relationship(unit, token, run_id, scope)
        run, owner = row["run"], principal.owner_subject
        now = self.oauth.now()
        vault, registry = _current(unit, owner, now)
        task = _head(
            unit, owner, run["vaultId"], run["taskId"], _index(unit, owner, run["vaultId"])
        )
        if task is None or task["metadata"]["status"] != "active":
            raise OAuthFailure("insufficient_scope", 403)
        meta = task["metadata"]
        if (
            meta["executionEpoch"] != run["executionEpoch"]
            or meta["taskVersion"] < run["taskVersion"]
        ):
            raise ContractError("version_conflict")
        grant = self._grant(row, registry, conn["expiresAt"], now)
        if "encrypt_result" not in grant["capabilities"]:
            raise OAuthFailure("insufficient_scope", 403)
        bindings = [
            {"ref": b["ref"], "sourceEpoch": b["sourceEpoch"]} for b in grant["resourceBindings"]
        ]
        if sorted(map(canonical_json, bindings)) != sorted(
            map(canonical_json, meta["resourceBindings"])
        ):
            raise ContractError("version_conflict")
        require_current_bindings(unit, owner, bindings)
        checked = verify_manifest(
            strict_json_loads(row["manifestJson"]),
            row["run"],
            registry=registry,
            grant=grant,
            expectation=_expectation(row),
            now=now,
        )
        if run["state"] not in {"ready", "submitted"}:
            raise ContractError("version_conflict")
        return principal, row, conn, vault, registry, grant, checked, now

    def _grant(self, row, registry, expires, now):
        run = row["run"]
        return verify_agent_grant(
            strict_json_loads(row["grantJson"]),
            registry=registry,
            owner_subject=row["ownerSubject"],
            vault_id=run["vaultId"],
            connection_id=run["connectionId"],
            authorization_id=run["authorizationId"],
            task_id=run["taskId"],
            task_version=run["taskVersion"],
            execution_epoch=run["executionEpoch"],
            grant_id=run["grantId"],
            grant_epoch=run["grantEpoch"],
            now=now,
            authorization_expires_at=expires,
        )

    def _operation_path(self, row, operation):
        run = row["run"]
        # A stricter service profile reserves one key across create/revise for a Run.
        # This makes the formal GET(runId, operation) unambiguous.
        return document_path(
            "hub_result_operations",
            row["ownerSubject"],
            run["vaultId"],
            run["connectionId"],
            run["authorizationId"],
            run["grantId"],
            str(run["grantEpoch"]),
            run["taskId"],
            run["runId"],
            operation,
        )

    def _head(self, unit, row):
        run = row["run"]
        head = unit.get(result_path(row["ownerSubject"], run["initialResultId"]))
        if head is None:
            return None
        try:
            if set(head) != {
                "ownerSubject",
                "ownerUid",
                "vaultId",
                "resultId",
                "runId",
                "metadata",
                "provenance",
            }:
                raise ValueError
            expected = {
                "ownerSubject": row["ownerSubject"],
                "ownerUid": row["ownerUid"],
                "vaultId": run["vaultId"],
                "resultId": run["initialResultId"],
                "runId": run["runId"],
            }
            if any(head[k] != v for k, v in expected.items()):
                raise ValueError
            meta = validate_schema("ResultMetadata", head["metadata"])
            if any(
                meta[k] != run[k]
                for k in [
                    "runId",
                    "taskId",
                    "taskVersion",
                    "connectionId",
                    "manifestId",
                    "keyEpoch",
                ]
            ):
                raise ValueError
            if meta["resultId"] != run["initialResultId"] or meta["revision"] > MAX_REVISIONS:
                raise ValueError
            provenance = head["provenance"]
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
                or any(provenance[k] != run[k] for k in ["connectionId", "authorizationId"])
            ):
                raise ValueError
            identifier(provenance["clientId"])
            identifier(provenance["agentPrincipalId"])
            return head
        except (ValueError, TypeError, KeyError, ContractError):
            raise StoreUnavailable from None

    def _expectation(self, row, grant, revision):
        return EnvelopeExpectation(
            row["ownerSubject"],
            row["run"]["vaultId"],
            row["run"]["initialResultId"],
            "result_revision",
            revision,
            revision - 1,
            "submit_result" if revision == 1 else "revise_result",
            grant["agentSigningKeyId"],
            _binding(row),
            [],
            tuple(grant["writebackRecipientKeyIds"]),
        )

    def _revision(self, unit, row, revision):
        run, owner = row["run"], row["ownerSubject"]
        saved = unit.get(revision_path(owner, run["initialResultId"], revision))
        try:
            if saved is None or set(saved) != {
                "ownerSubject",
                "resultId",
                "revision",
                "carrierJson",
                "receipt",
                "proof",
            }:
                raise ValueError
            if any(
                saved[k] != v
                for k, v in {
                    "ownerSubject": owner,
                    "resultId": run["initialResultId"],
                    "revision": revision,
                }.items()
            ):
                raise ValueError
            receipt = validate_schema("ResultReceipt", saved["receipt"])
            accepted = int(datetime.fromisoformat(receipt["receivedAt"]).timestamp())
            proof = saved["proof"]
            if (
                set(proof)
                != {
                    "rootJwk",
                    "rootKeyId",
                    "rootEpoch",
                    "proofCount",
                    "checkpointDigest",
                    "verifiedAt",
                    "authorizationExpiresAt",
                }
                or proof["verifiedAt"] != accepted
            ):
                raise ValueError
            if type(proof["proofCount"]) is not int or not 1 <= proof["proofCount"] <= 32:
                raise ValueError
            # The registered root identity is immutable within a vault. Read only
            # that pin, without invoking current directory/key eligibility: later
            # certificate expiry/revocation must not erase an accepted receipt.
            anchor = unit.get(document_path("hub_vaults", owner))
            if (
                anchor is None
                or anchor["vaultId"] != run["vaultId"]
                or anchor["rootKeyId"] != proof["rootKeyId"]
                or canonical_json(anchor["rootJwk"]) != canonical_json(proof["rootJwk"])
                or proof["rootEpoch"] != 1
            ):
                raise ValueError
            registry = None
            for sequence in range(1, proof["proofCount"] + 1):
                snapshot = unit.get(
                    revision_path(
                        owner, run["initialResultId"], revision, "registry", str(sequence)
                    )
                )
                if (
                    snapshot is None
                    or set(snapshot)
                    != {"ownerSubject", "resultId", "revision", "sequence", "bundleJson"}
                    or any(
                        snapshot[k] != v
                        for k, v in {
                            "ownerSubject": owner,
                            "resultId": run["initialResultId"],
                            "revision": revision,
                            "sequence": sequence,
                        }.items()
                    )
                ):
                    raise ValueError
                registry = verify_registry(
                    strict_json_loads(snapshot["bundleJson"]),
                    root_jwk=proof["rootJwk"],
                    pinned_root_key_id=proof["rootKeyId"],
                    owner_subject=owner,
                    vault_id=run["vaultId"],
                    root_epoch=proof["rootEpoch"],
                    now=accepted,
                    previous=registry,
                )
            if (
                registry.checkpoint_digest != proof["checkpointDigest"]
                or registry.issued_at > accepted
            ):
                raise ValueError
            grant = self._grant(row, registry, proof["authorizationExpiresAt"], accepted)
            verified = verify_carrier(
                saved["carrierJson"],
                registry=registry,
                expectation=self._expectation(row, grant, revision),
                now=accepted,
                contract_header=CONTRACT_VERSION,
                grant=grant,
            )
            validate_result_receipt(
                receipt, context=verified.context, fingerprint=verified.fingerprint
            )
            return saved, registry, grant
        except (ValueError, TypeError, KeyError, ContractError):
            raise StoreUnavailable from None

    def _saved_operation(self, unit, row, operation):
        record = unit.get(self._operation_path(row, operation))
        if record is None:
            return None
        try:
            if (
                set(record) != {"resultId", "revision", "operation", "fingerprint"}
                or record["resultId"] != row["run"]["initialResultId"]
                or record["operation"] != operation
            ):
                raise ValueError
            positive(record["revision"])
            if record["revision"] > MAX_REVISIONS:
                raise ValueError
            saved, registry, grant = self._revision(unit, row, record["revision"])
            if (
                saved["receipt"]["stableOperationId"] != operation
                or saved["receipt"]["envelopeFingerprint"] != record["fingerprint"]
            ):
                raise ValueError
            return saved, registry, grant
        except (ValueError, TypeError, KeyError, ContractError):
            raise StoreUnavailable from None

    def _replay(self, saved, carrier):
        stored, registry, grant = saved
        # Validate the ACTUAL incoming signature before comparing identity; raw signature
        # bytes are excluded from the formal signing-input fingerprint.
        author = registry.cert(
            grant["agentSigningKeyId"],
            role="agent_sig",
            connection_id=grant["connectionId"],
            now=stored["proof"]["verifiedAt"],
        )
        verify_jws(
            carrier["signedObject"],
            author["publicJwk"],
            typ="fv-object+jws",
            expected_kid=author["keyId"],
        )
        return check_operation_replay(
            carrier["signedObject"],
            stored_fingerprint=stored["receipt"]["envelopeFingerprint"],
            stored_receipt=stored["receipt"],
        )

    def _packet(self, carrier, operation):
        validate_schema("OperationIdentifier", operation)
        carrier = parse_carrier(carrier, contract_header=CONTRACT_VERSION)
        _, message = _signed_parts(carrier["signedObject"])
        context = message["context"]
        if (
            context["objectType"] != "result_revision"
            or context["operationType"] not in {"submit_result", "revise_result"}
            or context["stableOperationId"] != operation
        ):
            raise ContractError("recipient_binding_mismatch")
        return carrier, context

    def _index(self, unit, owner):
        path = document_path("hub_result_indexes", owner)
        index = unit.get(path)
        if index is None:
            index = {"resultIds": []}
        if (
            set(index) != {"resultIds"}
            or type(index["resultIds"]) is not list
            or len(index["resultIds"]) > MAX_RESULTS
            or len(set(index["resultIds"])) != len(index["resultIds"])
        ):
            raise StoreUnavailable
        for result in index["resultIds"]:
            identifier(result)
        return path, index

    def _write(self, token, run_id, carrier, operation, expected, *, revision_result=None):
        scope = "results:create" if expected == 0 else "results:revise"
        carrier, context = self._packet(carrier, operation)
        if context["expectedRevision"] != expected or context["operationType"] != (
            "submit_result" if expected == 0 else "revise_result"
        ):
            raise ContractError("version_conflict")

        def admit(unit, publish=False):
            started = self.oauth.now()
            principal, row, _ = self._relationship(unit, token, run_id, scope)
            if revision_result is not None and row["run"]["initialResultId"] != revision_result:
                raise ContractError("not_found")
            saved = self._saved_operation(unit, row, operation)
            if saved is not None:
                return self._replay(saved, carrier), 200, row
            principal, row, conn, vault, registry, grant, checked, validated_at = (
                self._new_authority(unit, token, run_id, scope)
            )
            verified = verify_carrier(
                carrier,
                registry=registry,
                expectation=self._expectation(row, grant, expected + 1),
                now=validated_at,
                contract_header=CONTRACT_VERSION,
                grant=grant,
            )
            head = self._head(unit, row)
            current = head["metadata"]["revision"] if head else 0
            validate_write_transition(verified.context, current_revision=current)
            if (head is None and row["run"]["state"] != "ready") or (
                head is not None and row["run"]["state"] != "submitted"
            ):
                raise StoreUnavailable
            if expected + 1 > MAX_REVISIONS:
                raise ContractError("version_conflict")
            target = revision_path(
                principal.owner_subject, row["run"]["initialResultId"], expected + 1
            )
            # An absent operation/head must never overwrite a historical immutable revision.
            if unit.get(target) is not None:
                raise StoreUnavailable
            index_path, index = self._index(unit, principal.owner_subject)
            if head is None and (
                len(index["resultIds"]) >= MAX_RESULTS
                or row["run"]["initialResultId"] in index["resultIds"]
            ):
                raise ContractError("version_conflict")
            if head is not None:
                if row["run"]["initialResultId"] not in index["resultIds"]:
                    raise StoreUnavailable
                previous_saved, _, _ = self._revision(unit, row, current)
                if any(
                    previous_saved["receipt"][key] != head["metadata"][key]
                    for key in ["envelopeFingerprint", "revision", "deliveryRevision"]
                ):
                    raise StoreUnavailable
                first_saved = previous_saved if current == 1 else self._revision(unit, row, 1)[0]
                if first_saved["receipt"]["receivedAt"] != head["metadata"]["receivedAt"]:
                    raise StoreUnavailable
            if not publish:
                return None, None, row
            # Crypto and historical checks can cross a deadline. Accept at one
            # final checked time, never after expiry under an earlier verification.
            # The verified grant deadline is bounded by every relevant certificate
            # and the consent deadline; the Run also pins its original family.
            current_principal = self.oauth.authorize_in_transaction(unit, token, scope=scope)
            now = self.oauth.now()
            if now < max(started, validated_at, registry.issued_at):
                raise StoreUnavailable
            if now >= current_principal.expires_at:
                raise OAuthFailure("invalid_token", 401)
            if (
                not grant["notBefore"] <= now < grant["expiresAt"]
                or not datetime.fromisoformat(row["run"]["createdAt"]).timestamp()
                <= now
                < datetime.fromisoformat(row["run"]["expiresAt"]).timestamp()
            ):
                raise ContractError("key_authorization_required")
            receipt = {
                "contractVersion": CONTRACT_VERSION,
                "vaultId": row["run"]["vaultId"],
                "runId": run_id,
                "taskId": row["run"]["taskId"],
                "resultId": row["run"]["initialResultId"],
                "revision": expected + 1,
                "deliveryRevision": 1,
                "stableOperationId": operation,
                "envelopeFingerprint": verified.fingerprint,
                "receivedAt": timestamp(now),
                "resultPath": f"/results/{row['run']['initialResultId']}?revision={expected + 1}",
            }
            validate_result_receipt(
                receipt, context=verified.context, fingerprint=verified.fingerprint
            )
            check_read_response(receipt)
            previous = (
                head["metadata"]
                if head
                else {"stateVersion": 0, "read": False, "starred": False, "archived": False}
            )
            if head is not None and previous["stateVersion"] >= MAX_SAFE_INTEGER:
                raise ContractError("version_conflict")
            metadata = (
                {
                    k: receipt[k]
                    for k in [
                        "resultId",
                        "taskId",
                        "runId",
                        "revision",
                        "deliveryRevision",
                        "envelopeFingerprint",
                        "receivedAt",
                    ]
                }
                | {
                    k: row["run"][k]
                    for k in ["taskVersion", "connectionId", "manifestId", "keyEpoch"]
                }
                | {
                    "stateVersion": previous["stateVersion"] + int(head is not None),
                    "read": False,
                    "starred": previous["starred"],
                    "archived": previous["archived"],
                }
            )
            if head is not None:
                metadata["receivedAt"] = head["metadata"]["receivedAt"]
            validate_schema("ResultMetadata", metadata)
            provenance = {
                "kind": "authorized_connection_submission",
                "provider": conn["provider"],
                "clientId": principal.client_id,
                "connectionId": principal.connection_id,
                "authorizationId": principal.authorization_id,
                "agentPrincipalId": registry.cert(grant["agentSigningKeyId"], now=now)[
                    "principalId"
                ],
            }
            unit.put(
                target,
                {
                    "ownerSubject": principal.owner_subject,
                    "resultId": receipt["resultId"],
                    "revision": expected + 1,
                    "carrierJson": canonical_json(verified.carrier).decode(),
                    "receipt": receipt,
                    "proof": {
                        "rootJwk": vault["rootJwk"],
                        "rootKeyId": vault["rootKeyId"],
                        "rootEpoch": registry.root_epoch,
                        "proofCount": registry.registry_sequence,
                        "checkpointDigest": registry.checkpoint_digest,
                        "verifiedAt": now,
                        "authorizationExpiresAt": conn["expiresAt"],
                    },
                },
            )
            for sequence, bundle in enumerate(vault["registryHistory"], 1):
                unit.put(
                    revision_path(
                        principal.owner_subject,
                        receipt["resultId"],
                        expected + 1,
                        "registry",
                        str(sequence),
                    ),
                    {
                        "ownerSubject": principal.owner_subject,
                        "resultId": receipt["resultId"],
                        "revision": expected + 1,
                        "sequence": sequence,
                        "bundleJson": canonical_json(bundle).decode(),
                    },
                )
            unit.put(
                result_path(principal.owner_subject, receipt["resultId"]),
                {
                    "ownerSubject": principal.owner_subject,
                    "ownerUid": principal.owner_uid,
                    "vaultId": row["run"]["vaultId"],
                    "resultId": receipt["resultId"],
                    "runId": run_id,
                    "metadata": metadata,
                    "provenance": provenance,
                },
            )
            unit.put(
                self._operation_path(row, operation),
                {
                    "resultId": receipt["resultId"],
                    "revision": expected + 1,
                    "operation": operation,
                    "fingerprint": verified.fingerprint,
                },
            )
            if head is None:
                index["resultIds"].append(receipt["resultId"])
                unit.put(index_path, index)
                row["run"]["state"] = "submitted"
                unit.put(run_path("hub_runs", principal.owner_subject, run_id), row)
            conn["grants"][row["run"]["taskId"]]["resultSaved"] = True
            unit.put(
                document_path(
                    "hub_oauth_connections", principal.owner_subject, principal.connection_id
                ),
                conn,
            )
            return copy(receipt), 201, row

        receipt, status, row = self.store.transact(admit)
        if receipt is not None:
            return receipt, status
        self.runs._fresh(row["ownerUid"], strict_json_loads(row["manifestJson"]), exact=False)
        receipt, status, _ = self.store.transact(lambda unit: admit(unit, True))
        return receipt, status

    def submit(self, token, run_id, carrier, operation):
        identifier(run_id)
        return self._write(token, run_id, carrier, operation, 0)

    def revise(self, token, result_id, expected_revision, carrier, operation):
        identifier(result_id)
        positive(expected_revision)

        def lookup(unit):
            principal = self.oauth.authorize_in_transaction(unit, token, scope="results:revise")
            head = unit.get(result_path(principal.owner_subject, result_id))
            if head is None:
                raise ContractError("not_found")
            try:
                identifier(head["runId"])
                return head["runId"]
            except (ValueError, TypeError, KeyError, ContractError):
                raise StoreUnavailable from None

        run_id = self.store.transact(lookup)
        return self._write(
            token, run_id, carrier, operation, expected_revision, revision_result=result_id
        )

    def receipt(self, token, run_id, operation):
        identifier(run_id)
        validate_schema("OperationIdentifier", operation)

        def read(unit):
            _, row, _ = self._relationship(unit, token, run_id, "receipts:read")
            saved = self._saved_operation(unit, row, operation)
            return copy(saved[0]["receipt"]) if saved is not None else None

        return self.store.transact(read)


def get_result_service(oauth: Service):
    return ResultService(oauth)


Results = Annotated[ResultService, Depends(get_result_service)]
router = APIRouter(route_class=AgentRoute, dependencies=[Depends(require_adapter)])


@router.post("/agent/v2/runs/{run_id}/results")
async def submit_result(run_id: str, request: Request, response: Response, service: Results):
    token = bearer(request, service)
    transport(request, operation=True)
    carrier = await body(request, {"contractVersion", "signedObject"})
    result, status = await run_in_threadpool(
        service.submit, token, run_id, carrier, request.headers["idempotency-key"]
    )
    response.status_code = status
    return result


@router.post("/agent/v2/results/{result_id}/revisions")
async def revise_result(result_id: str, request: Request, response: Response, service: Results):
    token = bearer(request, service)
    transport(request, operation=True)
    value = await body(request, {"contractVersion", "expectedRevision", "signedObject"})
    carrier = {"contractVersion": value["contractVersion"], "signedObject": value["signedObject"]}
    result, status = await run_in_threadpool(
        service.revise,
        token,
        result_id,
        value["expectedRevision"],
        carrier,
        request.headers["idempotency-key"],
    )
    response.status_code = status
    return result


@router.get("/agent/v2/runs/{run_id}/receipts/{operation}")
def get_receipt(run_id: str, operation: str, request: Request, service: Results):
    return service.receipt(bearer(request, service), run_id, operation)
