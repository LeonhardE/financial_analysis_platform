"""Root-approved durable deliveries, with current task/source/consent fences.

Transport expiry does not delete a publication. A publication receipt is never
current execution authority: every consumer must recheck the live parent,
identity, task head, permission epochs and source invalidation in its transaction.
"""

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.persistent_content import (
    CONTENT_PROFILE,
    PersistentEnvelopeExpectation,
    digest,
    inspect_persistent_carrier,
    verify_persistent_carrier,
)
from folioview_shared.encrypted.resource_consents import check_resource_consent
from folioview_shared.encrypted.schema import validate_schema

from .fences import require_current_bindings
from .persistent_agents import snapshot
from .preparations import KINDS, source_versions
from .resource_consents import ResourceConsentService, stored_consent
from .store import StoreUnavailable, document_path
from .tasks import _head, _index
from .vaults import identifier


def publication_path(owner, vault, operation):
    return document_path("hub_persistent_publications", owner, vault, operation)


def authority_path(owner, vault, task):
    # One authority across ALL Agents, so reassignment fences the previous one.
    return document_path("hub_persistent_task_authorities", owner, vault, task)


def source_path(owner, vault, connection, ref):
    return document_path(
        "hub_persistent_source_publications", owner, vault, connection, digest(ref)
    )


def stored_publication(unit, owner, vault, operation):
    row = unit.get(publication_path(owner, vault, operation))
    if row is None:
        return None
    try:
        if set(row) != {"context", "carrierJson", "fingerprint", "receipt"}:
            raise StoreUnavailable
        carrier, context = inspect_persistent_carrier(
            strict_json_loads(row["carrierJson"], max_bytes=524288)
        )
        if (
            context != row["context"]
            or (context["ownerSubject"], context["vaultId"], context["stableOperationId"])
            != (owner, vault, operation)
            or signing_input_fingerprint(carrier["proof"]) != row["fingerprint"]
        ):
            raise StoreUnavailable
        if row["receipt"] != {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "publicationId": operation,
            "fingerprint": row["fingerprint"],
            "context": context,
        }:
            raise StoreUnavailable
    except (ContractError, KeyError, TypeError):
        raise StoreUnavailable from None
    return row


def stored_authority(unit, owner, vault, task):
    row = unit.get(authority_path(owner, vault, task))
    if row is None:
        return None
    try:
        if set(row) != {"context", "fingerprint", "publicationId"}:
            raise StoreUnavailable
        saved = stored_publication(unit, owner, vault, row["publicationId"])
        if (
            saved is None
            or saved["context"] != row["context"]
            or saved["fingerprint"] != row["fingerprint"]
        ):
            raise StoreUnavailable
        c = row["context"]
        if c["objectType"] != "task" or c["taskId"] != task:
            raise StoreUnavailable
    except (KeyError, TypeError):
        raise StoreUnavailable from None
    return row


class PersistentPublicationService(ResourceConsentService):
    def _check_retry_carrier(self, stored_json, carrier):
        """Optional stricter envelope-byte retries for independently opted-in adapters."""

    def _task_scope(self, unit, owner, vault, connection, metadata):
        """Optional parent scope ceiling, in addition to current task authority."""

    def live(self, unit, uid, vault, connection):
        owner, vault_row, registry, conn = self._context(unit, uid, vault, connection, active=True)
        identity = self._identity(unit, owner, vault, connection, conn, active=True)
        return owner, vault_row, registry, conn, identity

    def task(self, unit, owner, vault, task):
        head = _head(unit, owner, vault, task, _index(unit, owner, vault))
        if head is None:
            raise ContractError("not_found")
        meta = head["metadata"]
        if meta["status"] != "active":
            raise ContractError("key_authorization_required")
        return meta

    def permit(self, unit, *, owner, vault, connection, conn, identity, registry, context, sources):
        policy = stored_consent(unit, owner, vault, connection)
        if policy is None:
            raise ContractError("insufficient_scope")
        ref = context["ref"]
        source = sources.get(canonical_json(ref))
        if source is None or source["sourceEpoch"] != context["sourceEpoch"]:
            raise ContractError("source_unavailable")
        decision = check_resource_consent(
            current_consent=policy["consent"],
            current_identity=identity,
            current_source={
                "ownerSubject": owner,
                "vaultId": vault,
                "ref": ref,
                "sourceEpoch": source["sourceEpoch"],
                "currentRevision": source["revision"],
                "state": "active",
            },
            registry=registry,
            owner_subject=owner,
            vault_id=vault,
            connection_id=connection,
            client_id=conn["clientId"],
            consent_id=policy["consent"]["consentId"],
            permission_id=context["permissionId"],
            permission_epoch=context["permissionEpoch"],
            resource_ref=ref,
            source_epoch=context["sourceEpoch"],
            revision=context["sourceRevision"],
            purpose="analysis",
            now=self.now(),
        )
        require_current_bindings(unit, owner, [{"ref": ref, "sourceEpoch": context["sourceEpoch"]}])
        return decision

    def receipt(self, uid, vault, connection, operation):
        for value in (vault, connection):
            identifier(value)
        validate_schema("OperationIdentifier", operation)

        def read(unit):
            owner, _, _, _ = self._context(unit, uid, vault, connection)
            saved = stored_publication(unit, owner, vault, operation)
            if saved is None or saved["context"]["connectionId"] != connection:
                raise ContractError("not_found")
            return {
                **saved["receipt"],
                "envelope": strict_json_loads(saved["carrierJson"], max_bytes=524288),
            }

        return self.store.transact(read)

    def task_state(self, uid, vault, task):
        identifier(vault)
        identifier(task)

        def read(unit):
            from folioview_shared.identity import owner_key

            from .vaults import _current

            owner = owner_key(uid)
            _current(unit, owner, self.now(), vault)
            authority = stored_authority(unit, owner, vault, task)
            saved = (
                None
                if authority is None
                else stored_publication(unit, owner, vault, authority["publicationId"])
            )
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "authority": authority,
                "envelope": None
                if saved is None
                else strict_json_loads(saved["carrierJson"], max_bytes=524288),
            }

        return self.store.transact(read)

    def publish(self, uid, vault, connection, carrier, operation):
        for value in (vault, connection):
            identifier(value)
        validate_schema("OperationIdentifier", operation)
        carrier, context = inspect_persistent_carrier(carrier)
        if context["stableOperationId"] != operation or context["objectType"] == "result_revision":
            raise ContractError("recipient_binding_mismatch")
        fingerprint = signing_input_fingerprint(carrier["proof"])

        def duplicate(unit):
            owner, row, registry, conn = self._context(unit, uid, vault, connection)
            saved = stored_publication(unit, owner, vault, operation)
            if saved is not None:
                if (
                    saved["fingerprint"] != fingerprint
                    or saved["context"]["connectionId"] != connection
                ):
                    raise ContractError("idempotency_conflict")
                self._check_retry_carrier(saved["carrierJson"], carrier)
                return saved["receipt"], None
            return None, (row["version"], registry.checkpoint_digest, conn["clientId"])

        prior, fence = self.store.transact(duplicate)
        if prior is not None:
            return prior
        sources = source_versions(self.catalogue, uid)

        def write(unit):
            owner, row, registry, conn = self._context(unit, uid, vault, connection)
            saved = stored_publication(unit, owner, vault, operation)
            if saved is not None:
                if (
                    saved["fingerprint"] != fingerprint
                    or saved["context"]["connectionId"] != connection
                ):
                    raise ContractError("idempotency_conflict")
                self._check_retry_carrier(saved["carrierJson"], carrier)
                return saved["receipt"]
            if conn["status"] != "active":
                raise ContractError("key_authorization_required")
            identity = self._identity(unit, owner, vault, connection, conn, active=True)
            if (row["version"], registry.checkpoint_digest, conn["clientId"]) != fence:
                raise ContractError("version_conflict")
            kind = context["objectType"]
            if kind == "task":
                meta = self.task(unit, owner, vault, context["taskId"])
                self._task_scope(unit, owner, vault, connection, meta)
                old = stored_authority(unit, owner, vault, context["taskId"])
                c = None if old is None else old["context"]
                if context["expectedAuthorityVersion"] != (
                    0 if c is None else c["authorityVersion"]
                ) or context["expectedAuthorityDigest"] != (None if old is None else digest(old)):
                    raise ContractError("version_conflict")
                if c is not None and context["authorityId"] != c["authorityId"]:
                    raise ContractError("version_conflict")
                bindings = {
                    "taskId": meta["taskId"],
                    "taskVersion": meta["taskVersion"],
                    "executionEpoch": meta["executionEpoch"],
                    "authorityId": context["authorityId"],
                    "authorityVersion": context["expectedAuthorityVersion"] + 1,
                    "expectedAuthorityVersion": context["expectedAuthorityVersion"],
                    "expectedAuthorityDigest": context["expectedAuthorityDigest"],
                    "resultPolicy": context["resultPolicy"],
                    "ownerTaskFingerprint": meta["envelopeFingerprint"],
                    "resourceBindings": meta["resourceBindings"],
                }
                for b in meta["resourceBindings"]:
                    source = sources.get(canonical_json(b["ref"]))
                    if source is None or source["sourceEpoch"] != b["sourceEpoch"]:
                        raise ContractError("source_unavailable")
                require_current_bindings(unit, owner, meta["resourceBindings"])
                # The content revision is the producer task version. Authority
                # CAS also permits an explicit reassignment of that version.
                if c is not None and context["revision"] < c["revision"]:
                    raise ContractError("version_conflict")
                object_id = meta["taskId"]
            else:
                source = sources.get(canonical_json(context["ref"]))
                if source is None or source["revision"] != context["sourceRevision"]:
                    raise ContractError("source_unavailable")
                self.permit(
                    unit,
                    owner=owner,
                    vault=vault,
                    connection=connection,
                    conn=conn,
                    identity=identity,
                    registry=registry,
                    context=context,
                    sources=sources,
                )
                path = source_path(owner, vault, connection, context["ref"])
                old = unit.get(path)
                if old is not None:
                    prev = stored_publication(unit, owner, vault, old["publicationId"])
                    if prev is None or prev["fingerprint"] != old["fingerprint"]:
                        raise StoreUnavailable
                    if context["sourceRevision"] < prev["context"]["sourceRevision"]:
                        raise ContractError("version_conflict")
                bindings = {
                    k: context[k]
                    for k in (
                        "ref",
                        "sourceEpoch",
                        "sourceRevision",
                        "permissionId",
                        "permissionEpoch",
                    )
                }
                object_id = source["producerSnapshotId"] or context["ref"]["resourceId"]
                if KINDS[context["ref"]["kind"]] != kind:
                    raise ContractError("recipient_binding_mismatch")
            verified = verify_persistent_carrier(
                carrier,
                registry=registry,
                root_jwk=row["rootJwk"],
                current_identity=identity,
                expectation=PersistentEnvelopeExpectation(
                    owner,
                    vault,
                    connection,
                    conn["clientId"],
                    kind,
                    object_id,
                    context["revision"],
                    tuple(r["keyId"] for r in context["recipients"]),
                    bindings,
                ),
                now=self.now(),
            )
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "publicationId": operation,
                "fingerprint": verified.fingerprint,
                "context": verified.context,
            }
            unit.put(
                publication_path(owner, vault, operation),
                {
                    "context": verified.context,
                    "carrierJson": canonical_json(verified.carrier).decode(),
                    "fingerprint": verified.fingerprint,
                    "receipt": result,
                },
            )
            head = {
                "context": verified.context,
                "fingerprint": verified.fingerprint,
                "publicationId": operation,
            }
            if kind == "task":
                unit.put(authority_path(owner, vault, context["taskId"]), head)
            else:
                unit.put(
                    source_path(owner, vault, connection, context["ref"]),
                    {"publicationId": operation, "fingerprint": verified.fingerprint},
                )
            return result

        return snapshot(self.store.transact(write))
