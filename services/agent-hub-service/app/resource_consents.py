"""Root-approved logical-resource policies and immutable control-chain receipts."""

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.resource_consents import (
    RESOURCE_CONSENT_PROFILE,
    approve_resource_consent,
    resource_consent_digest,
    revoke_resource_consent,
    validate_resource_consent_schema,
)
from folioview_shared.encrypted.schema import validate_schema

from .fences import require_current_bindings
from .persistent_agents import (
    PersistentAgentService,
    require_managed_credential,
    snapshot,
    stored_identity,
)
from .preparations import source_versions
from .store import StoreUnavailable, document_path
from .vaults import identifier

MAX_CONSENT_APPROVALS = 64
MAX_CONSENT_REVOCATIONS = 32
MAX_CONSENT_OPERATIONS = MAX_CONSENT_APPROVALS + MAX_CONSENT_REVOCATIONS


def consent_path(owner, vault, connection, binding_fingerprint=None):
    parts = (owner, vault, connection)
    if binding_fingerprint is not None:
        validate_schema("Digest", binding_fingerprint)
        parts += (binding_fingerprint,)
    return document_path("hub_resource_consents", *parts)


def current_consent_path(unit, owner, vault, connection):
    identity = stored_identity(unit, owner, vault, connection)
    fingerprint = None
    if identity is not None and "credentialLease" in identity:
        fingerprint = identity["identity"]["bindingFingerprint"]
    return consent_path(owner, vault, connection, fingerprint)


def operation_path(owner, vault, operation):
    return document_path("hub_resource_consent_operations", owner, vault, operation)


def stored_consent(unit, owner, vault, connection, *, binding_fingerprint=None):
    if binding_fingerprint is None:
        path = current_consent_path(unit, owner, vault, connection)
    else:
        identity = stored_identity(
            unit, owner, vault, connection, binding_fingerprint=binding_fingerprint
        )
        if identity is None:
            raise ContractError("not_found")
        path = consent_path(
            owner, vault, connection, binding_fingerprint if "credentialLease" in identity else None
        )
    row = unit.get(path)
    if row is None:
        return None
    try:
        if type(row) is not dict or set(row) != {
            "consent",
            "operations",
            "approvalCount",
            "revocationCount",
        }:
            raise StoreUnavailable
        policy = validate_resource_consent_schema("PersistentResourceConsent", row["consent"])
        resource_consent_digest(policy)  # Include the shared semantic invariants.
        operations = row["operations"]
        if (
            (policy["ownerSubject"], policy["vaultId"], policy["connectionId"])
            != (owner, vault, connection)
            or type(operations) is not list
            or not 1 <= len(operations) <= MAX_CONSENT_OPERATIONS
            or len(set(operations)) != len(operations)
            or policy["version"] != len(operations)
            or policy["lastOperationId"] != operations[-1]
            or type(row["approvalCount"]) is not int
            or not 1 <= row["approvalCount"] <= MAX_CONSENT_APPROVALS
            or type(row["revocationCount"]) is not int
            or not 0 <= row["revocationCount"] <= MAX_CONSENT_REVOCATIONS
            or row["approvalCount"] + row["revocationCount"] != len(operations)
        ):
            raise StoreUnavailable
        for operation in operations:
            validate_schema("OperationIdentifier", operation)
    except (ContractError, TypeError, KeyError):
        raise StoreUnavailable from None
    return row


class ResourceConsentService(PersistentAgentService):
    def __init__(self, store, catalogue=None, **kwargs):
        super().__init__(store, **kwargs)
        self.catalogue = catalogue

    def _identity(self, unit, owner, vault_id, connection, conn, *, active):
        row = stored_identity(unit, owner, vault_id, connection)
        if row is None:
            raise ContractError("not_found")
        identity = row["identity"]
        if identity["clientId"] != conn["clientId"]:
            raise StoreUnavailable
        if active:
            if identity["status"] != "active" or conn["status"] != "active":
                raise ContractError("key_authorization_required")
            require_managed_credential(
                row, now=self.now(), audience=getattr(self, "audience", None), connection=conn
            )
        return identity

    def state(self, uid, vault_id, connection):
        identifier(vault_id)
        identifier(connection)

        def read(unit):
            owner, _, _, conn = self._context(unit, uid, vault_id, connection)
            identity = self._identity(unit, owner, vault_id, connection, conn, active=False)
            row = stored_consent(unit, owner, vault_id, connection)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": RESOURCE_CONSENT_PROFILE,
                "consent": None if row is None else row["consent"],
                "operations": [] if row is None else row["operations"],
                "parentRevoked": conn["status"] == "revoked" or identity["status"] == "revoked",
            }

        return self.store.transact(read)

    def _receipt(self, saved, owner, vault, connection, operation):
        try:
            if type(saved) is not dict or set(saved) != {
                "ownerSubject",
                "vaultId",
                "connectionId",
                "operationId",
                "fingerprint",
                "command",
                "sourceStates",
                "receipt",
            }:
                raise StoreUnavailable
            if (
                saved["ownerSubject"],
                saved["vaultId"],
                saved["connectionId"],
                saved["operationId"],
            ) != (owner, vault, connection, operation):
                raise StoreUnavailable
            if saved["fingerprint"] != signing_input_fingerprint(saved["command"]):
                raise StoreUnavailable
            result = saved["receipt"]
            if type(result) is not dict or set(result) != {
                "contractVersion",
                "profile",
                "operationId",
                "fingerprint",
                "priorDigest",
                "consent",
            }:
                raise StoreUnavailable
            if (
                result["contractVersion"] != CONTRACT_VERSION
                or result["profile"] != RESOURCE_CONSENT_PROFILE
                or result["operationId"] != operation
                or result["fingerprint"] != saved["fingerprint"]
            ):
                raise StoreUnavailable
            policy = validate_resource_consent_schema(
                "PersistentResourceConsent", result["consent"]
            )
            resource_consent_digest(policy)
            if (
                policy["ownerSubject"],
                policy["vaultId"],
                policy["connectionId"],
                policy["lastOperationId"],
                policy["lastControlFingerprint"],
            ) != (owner, vault, connection, operation, saved["fingerprint"]):
                raise StoreUnavailable
            if type(saved["sourceStates"]) is not list or len(saved["sourceStates"]) > 10:
                raise StoreUnavailable
            for source in saved["sourceStates"]:
                validate_resource_consent_schema("ConsentSourceState", source)
            return result
        except (ContractError, KeyError, TypeError):
            raise StoreUnavailable from None

    def receipt(self, uid, vault_id, connection, operation):
        identifier(vault_id)
        identifier(connection)
        validate_schema("OperationIdentifier", operation)

        def read(unit):
            owner, _, _, _ = self._context(unit, uid, vault_id, connection)
            saved = unit.get(operation_path(owner, vault_id, operation))
            if saved is None or saved.get("connectionId") != connection:
                raise ContractError("not_found")
            result = self._receipt(saved, owner, vault_id, connection, operation)
            # Exact signed controls support independent owner-client chain checks.
            return {**result, "command": saved["command"], "sourceStates": saved["sourceStates"]}

        return self.store.transact(read)

    def command(self, uid, vault_id, connection, signed, operation, *, revoke=False):
        for value in (vault_id, connection):
            identifier(value)
        validate_schema("OperationIdentifier", operation)
        validate_schema("SignedObject", signed)
        _, payload = _signed_parts(signed)
        validate_resource_consent_schema(
            "PersistentResourceRevocationPayload"
            if revoke
            else "PersistentResourceApprovalPayload",
            payload,
        )
        if payload["stableOperationId"] != operation:
            raise ContractError("recipient_binding_mismatch")
        fingerprint = signing_input_fingerprint(signed)

        # Resolve exact retries before any producer RPC. A source outage must not
        # force a new signature or permission ID for an already committed action.
        def existing(unit):
            owner, vault, registry, conn = self._context(unit, uid, vault_id, connection)
            saved = unit.get(operation_path(owner, vault_id, operation))
            if saved is not None:
                if (
                    saved.get("connectionId") != connection
                    or saved.get("fingerprint") != fingerprint
                ):
                    raise ContractError("idempotency_conflict")
                return self._receipt(saved, owner, vault_id, connection, operation), None
            self._identity(unit, owner, vault_id, connection, conn, active=not revoke)
            return None, (vault["version"], registry.checkpoint_digest, conn["clientId"])

        result, before = self.store.transact(existing)
        if result is not None:
            return result
        sources = []
        if not revoke:
            observed = source_versions(self.catalogue, uid)
            for selected in payload["resources"]:
                source = observed.get(canonical_json(selected["ref"]))
                if source is None:
                    raise ContractError("source_unavailable")
                sources.append(
                    {
                        "ownerSubject": payload["ownerSubject"],
                        "vaultId": vault_id,
                        "ref": source["ref"],
                        "sourceEpoch": source["sourceEpoch"],
                        "currentRevision": source["revision"],
                        "state": "active",
                    }
                )

        def write(unit):
            owner, vault, registry, conn = self._context(unit, uid, vault_id, connection)
            path = operation_path(owner, vault_id, operation)
            saved = unit.get(path)
            if saved is not None:
                if (
                    saved.get("connectionId") != connection
                    or saved.get("fingerprint") != fingerprint
                ):
                    raise ContractError("idempotency_conflict")
                return self._receipt(saved, owner, vault_id, connection, operation)
            if (vault["version"], registry.checkpoint_digest, conn["clientId"]) != before:
                raise ContractError("version_conflict")
            identity = self._identity(unit, owner, vault_id, connection, conn, active=not revoke)
            current = stored_consent(unit, owner, vault_id, connection)
            if current is not None and current[
                "revocationCount" if revoke else "approvalCount"
            ] >= (MAX_CONSENT_REVOCATIONS if revoke else MAX_CONSENT_APPROVALS):
                raise ContractError("version_conflict")
            context = {
                "current_consent": None if current is None else current["consent"],
                "current_identity": identity,
                "registry": registry,
                "root_jwk": vault["rootJwk"],
                "owner_subject": owner,
                "vault_id": vault_id,
                "connection_id": connection,
                "client_id": conn["clientId"],
                "consent_id": payload["consentId"],
                "now": self.now(),
            }
            if revoke:
                policy = revoke_resource_consent(signed, **context)
            else:
                policy = approve_resource_consent(signed, source_states=sources, **context)
                require_current_bindings(
                    unit,
                    owner,
                    [{"ref": s["ref"], "sourceEpoch": s["sourceEpoch"]} for s in sources],
                )
            operations = ([] if current is None else current["operations"]) + [operation]
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": RESOURCE_CONSENT_PROFILE,
                "operationId": operation,
                "fingerprint": fingerprint,
                "priorDigest": payload["expectedConsentDigest"],
                "consent": policy,
            }
            unit.put(
                current_consent_path(unit, owner, vault_id, connection),
                {
                    "consent": policy,
                    "operations": operations,
                    "approvalCount": (0 if current is None else current["approvalCount"])
                    + int(not revoke),
                    "revocationCount": (0 if current is None else current["revocationCount"])
                    + int(revoke),
                },
            )
            unit.put(
                path,
                {
                    "ownerSubject": owner,
                    "vaultId": vault_id,
                    "connectionId": connection,
                    "operationId": operation,
                    "fingerprint": fingerprint,
                    "command": snapshot(signed),
                    "sourceStates": sources,
                    "receipt": result,
                },
            )
            return result

        return self.store.transact(write)
