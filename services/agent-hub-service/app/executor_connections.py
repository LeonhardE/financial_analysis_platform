"""Public, Root-approved executor parents, independent of Muse/OAuth transport.

This is ciphertext routing authority only. Hub neither verifies attestation nor
issues plaintext capabilities, policy leases, credentials or private keys.
"""

import os
import re

from folioview_shared.encrypted.budgets import check_size
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.executor_trust import verify_executor_approval
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json, strict_json_loads
from folioview_shared.encrypted.persistent_agents import (
    PERSISTENT_AGENT_PROFILE,
    initial_agent_identity,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.persistent_content import BINDING_FIELDS, digest
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .persistent_agents import (
    PersistentAgentService,
    identity_path,
    operation_path,
    snapshot,
    stored_identity,
)
from .store import StoreUnavailable, document_path
from .vaults import _current, _selection, identifier

PROFILE = "folioview.hub-executor-ciphertext.v1"
SCOPE_PROFILE = "folioview.hub-executor-ciphertext-scope.v1"
MAX_CONNECTIONS = 16
CONFIG_FIELDS = frozenset(
    {
        "clientId",
        "issuer",
        "audience",
        "provider",
        "providerClientId",
        "policySigningKeyId",
        "tlsKeyId",
        "workloadDigest",
    }
)


class ExecutorConfig:
    """Deployment-pinned public channel identity; never copied from an approval."""

    def __init__(self, value):
        try:
            check_size(value, 8192)
            if type(value) is not dict or set(value) != CONFIG_FIELDS | {"hubAudience"}:
                raise ValueError
            if any(
                type(value[k]) is not str or not 9 <= len(value[k]) <= 2048
                for k in ("issuer", "audience", "hubAudience")
            ):
                raise ValueError
            origin = r"https://[a-z0-9]+(?:[.-][a-z0-9]+)*"
            if not all(
                type(value[k]) is str and re.fullmatch(origin, value[k])
                for k in ("issuer", "hubAudience")
            ) or not re.fullmatch(origin + r"(?:/[A-Za-z0-9_-]+)*/?", value["audience"]):
                raise ValueError
            for k in ("clientId", "provider", "providerClientId"):
                validate_schema("Identifier", value[k])
            for k in ("policySigningKeyId", "tlsKeyId"):
                b64url_decode(value[k], exact_bytes=32)
            validate_schema("Digest", value["workloadDigest"])
            if value["policySigningKeyId"] == value["tlsKeyId"]:
                raise ValueError
        except (ContractError, TypeError, ValueError):
            raise ContractError("authorization_unavailable") from None
        self.channel = snapshot({k: value[k] for k in CONFIG_FIELDS})
        self.hub_audience = value["hubAudience"]

    @classmethod
    def environment(cls):
        # Fail closed before store creation or any source/network access.
        if os.getenv("HUB_EXECUTOR_CIPHERTEXT_ENABLED") != "1":
            raise ContractError("authorization_unavailable")
        try:
            return cls(
                strict_json_loads(os.getenv("HUB_EXECUTOR_CIPHERTEXT_CONFIG", ""), max_bytes=8192)
            )
        except ContractError:
            raise ContractError("authorization_unavailable") from None


def validate_scope(scope):
    check_size(scope, 16384)
    if (
        type(scope) is not dict
        or set(scope) != {"profile", "purpose", "resultPolicy", "resourceBindings"}
        or scope["profile"] != SCOPE_PROFILE
        or scope["purpose"] != "analysis"
        or scope["resultPolicy"] != "owner_inbox"
        or type(scope["resourceBindings"]) is not list
        or not 1 <= len(scope["resourceBindings"]) <= 10
    ):
        raise ContractError("malformed_request")
    bindings = scope["resourceBindings"]
    for binding in bindings:
        validate_schema("ResourceBindingMetadata", binding)
    refs = [canonical_json(b["ref"]) for b in bindings]
    if refs != sorted(set(refs)):
        raise ContractError("malformed_request")
    return snapshot(scope)


def connection_path(owner, vault, connection):
    return document_path("hub_executor_connections", owner, vault, connection)


def owner_index(unit, owner):
    row = unit.get(document_path("hub_executor_owners", owner))
    if row is None:
        return None
    try:
        if (
            set(row) != {"ownerSubject", "ownerUid", "connectionIds"}
            or row["ownerSubject"] != owner
            or type(row["ownerUid"]) is not str
            or owner_key(row["ownerUid"]) != owner
            or type(row["connectionIds"]) is not list
            or not 1 <= len(row["connectionIds"]) <= MAX_CONNECTIONS
            or len(set(row["connectionIds"])) != len(row["connectionIds"])
        ):
            raise StoreUnavailable
        for connection in row["connectionIds"]:
            identifier(connection)
    except (KeyError, TypeError, ContractError):
        raise StoreUnavailable from None
    return row


class ExecutorContext:
    """Shared parent checks for identity, consent, publication and execution."""

    def __init__(self, *args, config=None, **kwargs):
        self.config = config
        super().__init__(*args, **kwargs)

    def _context(self, unit, uid, vault_id, connection, *, active=False):
        owner = owner_key(uid)
        vault, registry = _current(unit, owner, self.now(), vault_id)
        parent = unit.get(connection_path(owner, vault_id, connection))
        if parent is None:
            raise ContractError("not_found")
        index = owner_index(unit, owner)
        row = stored_identity(unit, owner, vault_id, connection)
        try:
            if (
                set(parent)
                != {"binding", "scope", "approval", "registeredAt", "registrationDigest", "receipt"}
                or index is None
                or connection not in index["connectionIds"]
                or index["ownerUid"] != uid
                or row is None
                or type(parent["registeredAt"]) is not int
            ):
                raise StoreUnavailable
            scope = validate_scope(parent["scope"])
            binding = parent["binding"]
            original = {**row["identity"], "identityEpoch": 1}
            if (
                any(binding[k] != original[k] for k in BINDING_FIELDS)
                or binding["scopeDigest"] != digest(scope)
                or parent["registrationDigest"]
                != digest(
                    {"command": row["binding"], "approval": parent["approval"], "scope": scope}
                )
            ):
                raise StoreUnavailable
            approval = verify_executor_approval(
                parent["approval"],
                expected_binding=binding,
                root_jwk=vault["rootJwk"],
                now=parent["registeredAt"],
            )
            _, device_binding = _signed_parts(row["binding"])
            if approval["operationId"] != device_binding["stableOperationId"]:
                raise StoreUnavailable
            validate_schema("Digest", parent["registrationDigest"])
            receipt = parent["receipt"]
            if receipt != {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "operationId": approval["operationId"],
                "registrationDigest": parent["registrationDigest"],
                "identity": {**original, "status": "active", "revokedAt": None},
            }:
                raise StoreUnavailable
        except (ContractError, KeyError, TypeError):
            raise StoreUnavailable from None
        conn = {"clientId": binding["clientId"], "status": row["identity"]["status"], **parent}
        if active:
            self._active(vault, registry, conn)
        return owner, vault, registry, conn

    def _active(self, vault, registry, conn):
        if self.config is None or conn["status"] != "active":
            raise ContractError("key_authorization_required")
        binding = conn["binding"]
        if any(binding[k] != self.config.channel[k] for k in CONFIG_FIELDS):
            raise ContractError("key_authorization_required")
        if binding["recipientKeyIds"] != sorted(_selection(registry, self.now())[1]):
            raise ContractError("registry_conflict")
        verify_executor_approval(
            conn["approval"], expected_binding=binding, root_jwk=vault["rootJwk"], now=self.now()
        )

    def _identity(self, unit, owner, vault, connection, conn, *, active):
        identity = super()._identity(unit, owner, vault, connection, conn, active=active)
        if active:
            v, registry = _current(unit, owner, self.now(), vault)
            self._active(v, registry, conn)
        return identity

    def _scope(self, unit, owner, vault, connection, bindings):
        parent = unit.get(connection_path(owner, vault, connection))
        if parent is None:
            raise ContractError("not_found")
        allowed = set(map(canonical_json, validate_scope(parent["scope"])["resourceBindings"]))
        if any(canonical_json(b) not in allowed for b in bindings):
            raise ContractError("insufficient_scope")


class ExecutorIdentityService(ExecutorContext, PersistentAgentService):
    def register(self, uid, vault_id, connection, command, approval, scope, operation):
        for value in (vault_id, connection):
            identifier(value)
        validate_schema("OperationIdentifier", operation)
        check_size({"command": command, "approval": approval, "scope": scope}, 65536)
        command, approval = snapshot(command), snapshot(approval)
        scope = validate_scope(scope)
        registration_digest = digest({"command": command, "approval": approval, "scope": scope})

        def write(unit):
            owner = owner_key(uid)
            vault, registry = _current(unit, owner, self.now(), vault_id)
            path = connection_path(owner, vault_id, connection)
            if unit.get(path) is not None:
                _, _, _, conn = self._context(unit, uid, vault_id, connection)
                if (
                    conn["registrationDigest"] != registration_digest
                    or conn["receipt"]["operationId"] != operation
                ):
                    raise ContractError("idempotency_conflict")
                return conn["receipt"]
            if self.config is None:
                raise ContractError("authorization_unavailable")
            # Never reinterpret an OAuth/native identity or reuse its operation.
            if any(
                unit.get(p) is not None
                for p in (
                    identity_path(owner, vault_id, connection),
                    operation_path(owner, vault_id, operation),
                    document_path("hub_oauth_connections", owner, connection),
                )
            ):
                raise ContractError("idempotency_conflict")
            _, payload = _signed_parts(command)
            verified = verify_agent_identity_binding(
                command,
                registry=registry,
                owner_subject=owner,
                vault_id=vault_id,
                connection_id=connection,
                client_id=self.config.channel["clientId"],
                agent_id=payload.get("agentId"),
                now=self.now(),
            )
            if verified.payload["stableOperationId"] != operation:
                raise ContractError("recipient_binding_mismatch")
            identity = initial_agent_identity(verified, current_identity=None)
            binding = {
                **{k: identity[k] for k in BINDING_FIELDS},
                **self.config.channel,
                "recipientKeyIds": sorted(_selection(registry, self.now())[1]),
                "scopeDigest": digest(scope),
            }
            approved = verify_executor_approval(
                approval, expected_binding=binding, root_jwk=vault["rootJwk"], now=self.now()
            )
            if approved["operationId"] != operation:
                raise ContractError("recipient_binding_mismatch")
            index = owner_index(unit, owner)
            if index is None:
                index = {"ownerSubject": owner, "ownerUid": uid, "connectionIds": []}
            if (
                connection in index["connectionIds"]
                or len(index["connectionIds"]) >= MAX_CONNECTIONS
            ):
                raise ContractError("version_conflict")
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "operationId": operation,
                "registrationDigest": registration_digest,
                "identity": identity,
            }
            accepted_at = self.now()
            # Crypto work must not carry an expired control over the commit boundary.
            verify_agent_identity_binding(
                command,
                registry=registry,
                owner_subject=owner,
                vault_id=vault_id,
                connection_id=connection,
                client_id=binding["clientId"],
                agent_id=identity["agentId"],
                now=accepted_at,
            )
            verify_executor_approval(
                approval, expected_binding=binding, root_jwk=vault["rootJwk"], now=accepted_at
            )
            if sorted(_selection(registry, accepted_at)[1]) != binding["recipientKeyIds"]:
                raise ContractError("registry_conflict")
            unit.put(
                path,
                {
                    "binding": binding,
                    "scope": scope,
                    "approval": snapshot(approval),
                    "registeredAt": accepted_at,
                    "registrationDigest": registration_digest,
                    "receipt": result,
                },
            )
            unit.put(
                identity_path(owner, vault_id, connection),
                {
                    "identity": identity,
                    "binding": snapshot(command),
                    "revocation": None,
                    "operationCount": 1,
                },
            )
            fingerprint = signing_input_fingerprint(command)
            unit.put(
                operation_path(owner, vault_id, operation),
                {
                    "ownerSubject": owner,
                    "vaultId": vault_id,
                    "connectionId": connection,
                    "operationId": operation,
                    "fingerprint": fingerprint,
                    "command": snapshot(command),
                    "receipt": {
                        "contractVersion": CONTRACT_VERSION,
                        "profile": PERSISTENT_AGENT_PROFILE,
                        "operationId": operation,
                        "fingerprint": fingerprint,
                        "identity": identity,
                    },
                },
            )
            index["connectionIds"].append(connection)
            unit.put(document_path("hub_executor_owners", owner), index)
            return snapshot(result)

        return self.store.transact(write)

    def state(self, uid, vault_id, connection):
        for value in (vault_id, connection):
            identifier(value)

        def read(unit):
            owner, _, _, conn = self._context(unit, uid, vault_id, connection)
            row = stored_identity(unit, owner, vault_id, connection)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PROFILE,
                "identity": row["identity"],
                "command": row["binding"],
                "revocation": row["revocation"],
                **{k: conn[k] for k in ("binding", "scope", "approval", "receipt")},
            }

        return self.store.transact(read)

    def command(self, *args, revoke=False, **kwargs):
        if not revoke:
            raise ContractError("insufficient_scope")
        return super().command(*args, revoke=True, **kwargs)
