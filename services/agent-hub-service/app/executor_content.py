"""Opt-in ciphertext adapter over the existing immutable publications/Run/report store."""

import re

from folioview_shared.encrypted.budgets import check_size
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.persistent_content import (
    CONTENT_PROFILE,
    persistent_manifest_fingerprint,
    verify_persistent_request,
)
from folioview_shared.encrypted.schema import validate_schema

from .executor_connections import ExecutorContext, owner_index
from .persistent_publications import PersistentPublicationService, stored_publication
from .persistent_results import PersistentResultService
from .preparations import source_versions
from .resource_consents import ResourceConsentService
from .store import StoreUnavailable, document_path


class ExecutorResources(ExecutorContext, ResourceConsentService):
    pass


class ExecutorContentScope(ExecutorContext):
    def _task_scope(self, unit, owner, vault, connection, metadata):
        self._scope(unit, owner, vault, connection, metadata["resourceBindings"])

    def permit(self, unit, **kwargs):
        self._scope(
            unit,
            kwargs["owner"],
            kwargs["vault"],
            kwargs["connection"],
            [{"ref": kwargs["context"]["ref"], "sourceEpoch": kwargs["context"]["sourceEpoch"]}],
        )
        return super().permit(unit, **kwargs)

    def _check_retry_carrier(self, stored_json, carrier):
        # Preserve every original JOSE/JWE string, including the proof signature.
        # A fresh HTTP request proof is permitted; re-encryption/re-signing isn't.
        original = strict_json_loads(stored_json, max_bytes=524288)
        if canonical_json(original) != canonical_json(carrier):
            raise ContractError("idempotency_conflict")


class ExecutorPublications(ExecutorContentScope, PersistentPublicationService):
    pass


class ExecutorExecution(ExecutorContentScope, PersistentResultService):
    def __init__(self, store, catalogue, *, config, **kwargs):
        super().__init__(
            store,
            catalogue,
            config=config,
            audience=config.hub_audience,
            client_ids=[config.channel["clientId"]],
            **kwargs,
        )

    def _check_result_retry(self, unit, owner, vault, result, carrier):
        blob = unit.get(document_path("hub_persistent_result_content", owner, vault, result))
        if blob is None or set(blob) != {"carrierJson"}:
            raise StoreUnavailable
        self._check_retry_carrier(blob["carrierJson"], carrier)

    def authenticate(self, unit, owner, vault, connection, proof, path, request):
        check_size(request, 540672)
        if type(owner) is not str or re.fullmatch(r"[a-f0-9]{64}", owner) is None:
            raise ContractError("malformed_request")
        for value in (vault, connection):
            validate_schema("Identifier", value)
        prefix = (
            f"/agent/v3/persistent/executor/owners/{owner}/vaults/{vault}/connections/{connection}/"
        )
        if type(path) is not str or not path.startswith(prefix):
            raise ContractError("key_authorization_required")
        indexed = owner_index(unit, owner)
        if indexed is None:
            raise ContractError("not_found")
        uid = indexed["ownerUid"]
        _, v, registry, conn, identity = self.live(unit, uid, vault, connection)
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

    def input(self, owner, vault, connection, proof, path, request):
        """Read exactly one frozen task or source, never a latest-publication alias."""
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
            if request["publicationId"] == m["taskPublicationId"]:
                expected = m["taskPublicationFingerprint"]
            else:
                item = next(
                    (i for i in m["inputs"] if i["publicationId"] == request["publicationId"]), None
                )
                if item is None:
                    raise ContractError("not_found")
                expected = item["publicationFingerprint"]
            saved = stored_publication(unit, owner, vault, request["publicationId"])
            if saved is None or saved["fingerprint"] != expected:
                raise StoreUnavailable
            if request["publicationId"] != m["taskPublicationId"] and any(
                saved["context"][k] != item[k]
                for k in ("ref", "sourceEpoch", "sourceRevision", "permissionId", "permissionEpoch")
            ):
                raise StoreUnavailable
            carrier, _ = self.publication(
                unit,
                owner,
                vault,
                connection,
                identity,
                registry,
                v["rootJwk"],
                request["publicationId"],
                sources=sources,
            )
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": CONTENT_PROFILE,
                "manifestFingerprint": persistent_manifest_fingerprint(m),
                "envelope": carrier,
            }

        return self.store.transact(read)
