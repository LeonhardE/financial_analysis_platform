"""Current proof-of-possession reads and immutable, idempotent analysis inputs."""

import re

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    PersistentEnvelopeExpectation,
    digest,
    persistent_manifest_fingerprint,
    persistent_run_id,
    validate_persistent_manifest,
    verify_persistent_carrier,
    verify_persistent_request,
)
from folioview_shared.encrypted.schema import safe_https_url, validate_schema
from folioview_shared.identity import owner_key

from .persistent_agents import snapshot
from .persistent_publications import (
    PersistentPublicationService,
    source_path,
    stored_authority,
    stored_publication,
)
from .preparations import source_versions
from .resource_consents import operation_path as consent_operation_path
from .resource_consents import stored_consent
from .store import StoreUnavailable, document_path

MAX_CONNECTION_MINUTE = 20
MAX_OWNER_DAY = 200


def run_path(owner, vault, run):
    return document_path("hub_persistent_runs", owner, vault, run)


def run_operation_path(owner, vault, connection, operation):
    return document_path("hub_persistent_run_operations", owner, vault, connection, operation)


def stored_run(unit, owner, vault, run):
    row = unit.get(run_path(owner, vault, run))
    if row is None:
        raise ContractError("not_found")
    try:
        if set(row) != {
            "manifestJson",
            "manifestFingerprint",
            "intentDigest",
            "ownerUid",
            "state",
            "resultId",
            "identity",
            "registryHistory",
        }:
            raise StoreUnavailable
        manifest = validate_persistent_manifest(strict_json_loads(row["manifestJson"]))
        if (manifest["ownerSubject"], manifest["vaultId"], manifest["runId"]) != (
            owner,
            vault,
            run,
        ) or row["manifestFingerprint"] != persistent_manifest_fingerprint(manifest):
            raise StoreUnavailable
        if (
            row["state"] not in {"ready", "submitted"}
            or ((row["resultId"] is None) != (row["state"] == "ready"))
            or owner_key(row["ownerUid"]) != owner
        ):
            raise StoreUnavailable
        if any(row["identity"][k] != manifest[k] for k in BINDING_FIELDS):
            raise StoreUnavailable
    except (ContractError, KeyError, TypeError):
        raise StoreUnavailable from None
    return row, manifest


class PersistentExecutionService(PersistentPublicationService):
    def __init__(self, store, catalogue, *, audience, **kwargs):
        super().__init__(store, catalogue, **kwargs)
        from urllib.parse import urlsplit

        if not safe_https_url(audience) or urlsplit(audience).query or urlsplit(audience).fragment:
            raise ContractError("authorization_unavailable")
        self.audience = audience

    def authenticate(self, unit, owner, vault, connection, proof, path, request):
        if type(owner) is not str or re.fullmatch(r"[a-f0-9]{64}", owner) is None:
            raise ContractError("malformed_request")
        for value in (vault, connection):
            validate_schema("Identifier", value)
        indexed = unit.get(document_path("hub_oauth_owners", owner))
        if indexed is None:
            raise ContractError("not_found")
        uid = indexed.get("ownerUid")
        if type(uid) is not str or owner_key(uid) != owner:
            raise StoreUnavailable
        actual_owner, v, registry, conn, identity = self.live(unit, uid, vault, connection)
        if actual_owner != owner or conn["clientId"] not in self.client_ids:
            raise ContractError("key_authorization_required")
        verify_persistent_request(
            proof,
            registry=registry,
            current_identity=identity,
            owner_subject=owner,
            vault_id=vault,
            connection_id=connection,
            client_id=conn["clientId"],
            audience=self.audience,
            method="POST",
            path=path,
            body=request,
            now=self.now(),
        )
        return uid, v, registry, conn, identity

    def task_authority(self, unit, owner, vault, connection, identity, task):
        row = stored_authority(unit, owner, vault, task)
        if row is None:
            raise ContractError("not_found")
        c = row["context"]
        if any(c[k] != identity[k] for k in BINDING_FIELDS) or c["connectionId"] != connection:
            raise ContractError("key_authorization_required")
        meta = self.task(unit, owner, vault, task)
        if (
            c["taskVersion"],
            c["executionEpoch"],
            c["ownerTaskFingerprint"],
            c["resourceBindings"],
        ) != (
            meta["taskVersion"],
            meta["executionEpoch"],
            meta["envelopeFingerprint"],
            meta["resourceBindings"],
        ):
            raise ContractError("version_conflict")
        return row

    def publication(
        self, unit, owner, vault, connection, identity, registry, root, publication, *, sources=None
    ):
        row = stored_publication(unit, owner, vault, publication)
        if row is None:
            raise ContractError("not_found")
        c = row["context"]
        if any(c[k] != identity[k] for k in BINDING_FIELDS):
            raise ContractError("key_authorization_required")
        if c["objectType"] == "task":
            authority = self.task_authority(unit, owner, vault, connection, identity, c["taskId"])
            if authority["publicationId"] != publication:
                raise ContractError("version_conflict")
            fields = (
                "taskId",
                "taskVersion",
                "executionEpoch",
                "authorityId",
                "authorityVersion",
                "expectedAuthorityVersion",
                "expectedAuthorityDigest",
                "resultPolicy",
                "ownerTaskFingerprint",
                "resourceBindings",
            )
        else:
            if c["objectType"] == "result_revision" or sources is None:
                raise ContractError("insufficient_scope")
            conn = {"clientId": identity["clientId"]}
            self.permit(
                unit,
                owner=owner,
                vault=vault,
                connection=connection,
                conn=conn,
                identity=identity,
                registry=registry,
                context=c,
                sources=sources,
            )
            fields = ("ref", "sourceEpoch", "sourceRevision", "permissionId", "permissionEpoch")
        verified = verify_persistent_carrier(
            strict_json_loads(row["carrierJson"], max_bytes=524288),
            registry=registry,
            root_jwk=root,
            current_identity=identity,
            expectation=PersistentEnvelopeExpectation(
                owner,
                vault,
                connection,
                identity["clientId"],
                c["objectType"],
                c["objectId"],
                c["revision"],
                tuple(r["keyId"] for r in c["recipients"]),
                {k: c[k] for k in fields},
            ),
            now=self.now(),
            purpose="agent_read",
        )
        return verified.carrier, c

    def session(self, owner, vault, connection, proof, path, request):
        if request != {}:
            raise ContractError("malformed_request")

        def read(unit):
            _, v, registry, _, identity = self.authenticate(
                unit, owner, vault, connection, proof, path, request
            )
            policy = stored_consent(unit, owner, vault, connection)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "identity": identity,
                "binding": self.state_for_binding(unit, owner, vault, connection),
                "rootJwk": v["rootJwk"],
                "registryHistory": v["registryHistory"],
                "consent": None if policy is None else policy["consent"],
                "consentOperations": [] if policy is None else policy["operations"],
                "registrySequence": registry.registry_sequence,
            }

        return self.store.transact(read)

    def state_for_binding(self, unit, owner, vault, connection):
        from .persistent_agents import stored_identity

        return stored_identity(unit, owner, vault, connection)["binding"]

    def consent_receipt(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {"operationId"}:
            raise ContractError("malformed_request")
        operation = request["operationId"]
        validate_schema("OperationIdentifier", operation)

        def read(unit):
            self.authenticate(unit, owner, vault, connection, proof, path, request)
            saved = unit.get(consent_operation_path(owner, vault, operation))
            if saved is None or saved.get("connectionId") != connection:
                raise ContractError("not_found")
            self._receipt(saved, owner, vault, connection, operation)
            return {
                **saved["receipt"],
                "command": saved["command"],
                "sourceStates": saved["sourceStates"],
            }

        return self.store.transact(read)

    def tasks(self, owner, vault, connection, proof, path, request):
        if request != {}:
            raise ContractError("malformed_request")

        def read(unit):
            from .tasks import _index

            _, _, _, _, identity = self.authenticate(
                unit, owner, vault, connection, proof, path, request
            )
            result = []
            for task, meta in _index(unit, owner, vault)["tasks"].items():
                authority = stored_authority(unit, owner, vault, task)
                if authority is None or meta["status"] != "active":
                    continue
                c = authority["context"]
                if any(c[k] != identity[k] for k in BINDING_FIELDS):
                    continue
                if (c["taskVersion"], c["executionEpoch"], c["ownerTaskFingerprint"]) != (
                    meta["taskVersion"],
                    meta["executionEpoch"],
                    meta["envelopeFingerprint"],
                ):
                    continue
                result.append(
                    {
                        "taskId": task,
                        "taskVersion": meta["taskVersion"],
                        "executionEpoch": meta["executionEpoch"],
                        "publicationId": authority["publicationId"],
                        "fingerprint": authority["fingerprint"],
                    }
                )
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "tasks": result,
            }

        return self.store.transact(read)

    def task_input(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {"taskId"}:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["taskId"])

        def read(unit):
            _, v, registry, _, identity = self.authenticate(
                unit, owner, vault, connection, proof, path, request
            )
            a = self.task_authority(unit, owner, vault, connection, identity, request["taskId"])
            carrier, _ = self.publication(
                unit, owner, vault, connection, identity, registry, v["rootJwk"], a["publicationId"]
            )
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "authority": a,
                "envelope": carrier,
            }

        return self.store.transact(read)

    def quota(self, unit, owner, connection):
        now = self.now()
        for kind, actor, bucket, limit in (
            ("minute", connection, now // 60, MAX_CONNECTION_MINUTE),
            ("day", owner, now // 86400, MAX_OWNER_DAY),
        ):
            path = document_path("hub_persistent_run_quotas", owner, kind, actor)
            row = unit.get(path)
            if row is not None and (
                set(row) != {"bucket", "count"}
                or type(row["bucket"]) is not int
                or type(row["count"]) is not int
                or row["count"] < 1
                or row["bucket"] > bucket
            ):
                raise StoreUnavailable
            count = 0 if row is None or row["bucket"] != bucket else row["count"]
            if count >= limit:
                raise ContractError("version_conflict")
            unit.put(path, {"bucket": bucket, "count": count + 1})

    def begin(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {
            "taskId",
            "triggerId",
            "operationId",
            "taskPublicationFingerprint",
        }:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["taskId"])
        for k in ("triggerId", "operationId"):
            validate_schema("OperationIdentifier", request[k])
        validate_schema("Digest", request["taskPublicationFingerprint"])
        run = persistent_run_id(
            owner_subject=owner,
            vault_id=vault,
            task_id=request["taskId"],
            trigger_id=request["triggerId"],
        )
        intent = digest(request)

        def existing(unit):
            uid, *_ = self.authenticate(unit, owner, vault, connection, proof, path, request)
            saved = unit.get(run_operation_path(owner, vault, connection, request["operationId"]))
            if saved is not None:
                if saved != {"intentDigest": intent, "runId": run}:
                    raise ContractError("idempotency_conflict")
                row, manifest = stored_run(unit, owner, vault, run)
                if manifest["connectionId"] != connection or row["intentDigest"] != intent:
                    raise ContractError("idempotency_conflict")
                return self.run_response(row, manifest), uid
            return None, uid

        prior, uid = self.store.transact(existing)
        if prior is not None:
            return prior
        sources = source_versions(self.catalogue, uid)

        def write(unit):
            uid, v, registry, conn, identity = self.authenticate(
                unit, owner, vault, connection, proof, path, request
            )
            saved = unit.get(run_path(owner, vault, run))
            if saved is not None:
                row, manifest = stored_run(unit, owner, vault, run)
                if row["intentDigest"] != intent or manifest["connectionId"] != connection:
                    raise ContractError("idempotency_conflict")
                return self.run_response(row, manifest)
            op_path = run_operation_path(owner, vault, connection, request["operationId"])
            if unit.get(op_path) is not None:
                raise ContractError("idempotency_conflict")
            a = self.task_authority(unit, owner, vault, connection, identity, request["taskId"])
            if a["fingerprint"] != request["taskPublicationFingerprint"]:
                raise ContractError("version_conflict")
            _, c = self.publication(
                unit, owner, vault, connection, identity, registry, v["rootJwk"], a["publicationId"]
            )
            inputs = []
            for b in sorted(c["resourceBindings"], key=lambda b: canonical_json(b["ref"])):
                current = sources.get(canonical_json(b["ref"]))
                head = unit.get(source_path(owner, vault, connection, b["ref"]))
                if head is None or current is None:
                    raise ContractError("source_unavailable")
                _, source = self.publication(
                    unit,
                    owner,
                    vault,
                    connection,
                    identity,
                    registry,
                    v["rootJwk"],
                    head["publicationId"],
                    sources=sources,
                )
                if (source["sourceRevision"], source["sourceEpoch"]) != (
                    current["revision"],
                    b["sourceEpoch"],
                ):
                    raise ContractError("source_unavailable")
                publication = stored_publication(unit, owner, vault, head["publicationId"])
                if head["fingerprint"] != publication["fingerprint"]:
                    raise StoreUnavailable
                inputs.append(
                    {
                        "publicationId": head["publicationId"],
                        "publicationFingerprint": publication["fingerprint"],
                        **{
                            k: source[k]
                            for k in (
                                "ref",
                                "sourceEpoch",
                                "sourceRevision",
                                "permissionId",
                                "permissionEpoch",
                                "objectId",
                            )
                        },
                    }
                )
            now = self.now()
            manifest = {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "purpose": "analysis",
                **{k: identity[k] for k in BINDING_FIELDS},
                **{
                    k: c[k]
                    for k in (
                        "taskId",
                        "taskVersion",
                        "executionEpoch",
                        "authorityId",
                        "authorityVersion",
                        "resultPolicy",
                    )
                },
                "runId": run,
                "stableOperationId": request["operationId"],
                "triggerId": request["triggerId"],
                "taskPublicationId": a["publicationId"],
                "taskPublicationFingerprint": a["fingerprint"],
                "createdAt": now,
                "expiresAt": now + 7200,
                "inputs": inputs,
            }
            validate_persistent_manifest(manifest)
            row = {
                "manifestJson": canonical_json(manifest).decode(),
                "manifestFingerprint": persistent_manifest_fingerprint(manifest),
                "intentDigest": intent,
                "ownerUid": uid,
                "state": "ready",
                "resultId": None,
                "identity": snapshot(identity),
                "registryHistory": snapshot(v["registryHistory"]),
            }
            self.quota(unit, owner, connection)
            # The source/crypto work may outlive the short request proof. Its
            # acceptance window must still hold at the committing write.
            self.authenticate(unit, owner, vault, connection, proof, path, request)
            unit.put(run_path(owner, vault, run), row)
            unit.put(op_path, {"intentDigest": intent, "runId": run})
            return self.run_response(row, manifest)

        return self.store.transact(write)

    def run_response(self, row, manifest):
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "manifest": manifest,
            "manifestFingerprint": row["manifestFingerprint"],
            "state": row["state"],
            "resultId": row["resultId"],
        }

    def run_receipt(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {"runId"}:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["runId"])

        def read(unit):
            self.authenticate(unit, owner, vault, connection, proof, path, request)
            row, manifest = stored_run(unit, owner, vault, request["runId"])
            if manifest["connectionId"] != connection:
                raise ContractError("not_found")
            return self.run_response(row, manifest)

        return self.store.transact(read)

    def current_run(self, unit, owner, vault, connection, proof, path, request, run, sources):
        uid, v, registry, conn, identity = self.authenticate(
            unit, owner, vault, connection, proof, path, request
        )
        row, m = stored_run(unit, owner, vault, run)
        if m["connectionId"] != connection or any(m[k] != identity[k] for k in BINDING_FIELDS):
            raise ContractError("key_authorization_required")
        a = self.task_authority(unit, owner, vault, connection, identity, m["taskId"])
        c = a["context"]
        if (
            a["fingerprint"] != m["taskPublicationFingerprint"]
            or a["publicationId"] != m["taskPublicationId"]
            or any(
                m[k] != c[k]
                for k in (
                    "taskVersion",
                    "executionEpoch",
                    "authorityId",
                    "authorityVersion",
                    "resultPolicy",
                )
            )
            or sorted(
                canonical_json({"ref": i["ref"], "sourceEpoch": i["sourceEpoch"]})
                for i in m["inputs"]
            )
            != sorted(map(canonical_json, c["resourceBindings"]))
            or m["createdAt"] < c["issuedAt"]
            or not m["createdAt"] <= self.now() < m["expiresAt"]
        ):
            raise ContractError("version_conflict")
        for item in m["inputs"]:
            self.permit(
                unit,
                owner=owner,
                vault=vault,
                connection=connection,
                conn=conn,
                identity=identity,
                registry=registry,
                context={
                    "ref": item["ref"],
                    **{
                        k: item[k]
                        for k in (
                            "sourceEpoch",
                            "sourceRevision",
                            "permissionId",
                            "permissionEpoch",
                        )
                    },
                },
                sources=sources,
            )
        return row, m, v, registry, identity

    def input(self, owner, vault, connection, proof, path, request):
        if type(request) is not dict or set(request) != {"runId", "publicationId"}:
            raise ContractError("malformed_request")
        validate_schema("Identifier", request["runId"])
        validate_schema("OperationIdentifier", request["publicationId"])
        uid = self.store.transact(
            lambda u: self.authenticate(u, owner, vault, connection, proof, path, request)[0]
        )
        sources = source_versions(self.catalogue, uid)

        def read(unit):
            _, m, v, registry, identity = self.current_run(
                unit, owner, vault, connection, proof, path, request, request["runId"], sources
            )
            item = next(
                (i for i in m["inputs"] if i["publicationId"] == request["publicationId"]), None
            )
            if item is None:
                raise ContractError("not_found")
            carrier, c = self.publication(
                unit,
                owner,
                vault,
                connection,
                identity,
                registry,
                v["rootJwk"],
                item["publicationId"],
                sources=sources,
            )
            saved = stored_publication(unit, owner, vault, item["publicationId"])
            if saved["fingerprint"] != item["publicationFingerprint"] or any(
                c[k] != item[k]
                for k in ("ref", "sourceEpoch", "sourceRevision", "permissionId", "permissionEpoch")
            ):
                raise StoreUnavailable
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "manifestFingerprint": persistent_manifest_fingerprint(m),
                "envelope": carrier,
            }

        return self.store.transact(read)
