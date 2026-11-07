"""Durable public Agent identities; transport expiry never erases owner consent.

Enrollment remains explicitly gated until trusted first pairing is available.
No bearer, execution authority or private key is stored or issued here.
"""

import math
import time

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.encrypted.persistent_agents import (
    PERSISTENT_AGENT_PROFILE,
    initial_agent_identity,
    revoke_agent_identity,
    validate_persistent_schema,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

from .oauth import MAX_CONNECTIONS, _row
from .store import StoreUnavailable, document_path
from .vaults import _current, identifier

MAX_IDENTITY_OPERATIONS = 2  # One enrollment and one terminal revocation.
_FIELDS = {"identity", "binding", "revocation", "operationCount"}
_BINDING = (
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "connectionId",
    "agentId",
    "clientId",
    "agentSigningKeyId",
    "agentEncryptionKeyId",
)


def snapshot(value):
    return strict_json_loads(canonical_json(value))


def identity_path(owner, vault, connection):
    return document_path("hub_agent_identities", owner, vault, connection)


def operation_path(owner, vault, operation):
    return document_path("hub_agent_identity_operations", owner, vault, operation)


def stored_identity(unit, owner, vault, connection):
    row = unit.get(identity_path(owner, vault, connection))
    if row is None:
        return None
    try:
        if type(row) is not dict or set(row) != _FIELDS:
            raise StoreUnavailable
        identity = validate_persistent_schema("PersistentAgentIdentity", row["identity"])
        validate_schema("SignedObject", row["binding"])
        _, binding = _signed_parts(row["binding"])
        validate_persistent_schema("PersistentAgentBindingPayload", binding)
        if (
            identity["ownerSubject"] != owner
            or identity["vaultId"] != vault
            or identity["connectionId"] != connection
            or identity["bindingFingerprint"] != signing_input_fingerprint(row["binding"])
            or any(identity[k] != binding[k] for k in _BINDING)
            or identity["registeredAt"] != binding["issuedAt"]
            or binding["identityEpoch"] != 1
            or type(row["operationCount"]) is not int
        ):
            raise StoreUnavailable
        if identity["status"] == "active":
            if (
                identity["identityEpoch"] != 1
                or row["revocation"] is not None
                or row["operationCount"] != 1
            ):
                raise StoreUnavailable
        else:
            validate_schema("SignedObject", row["revocation"])
            _, revoked = _signed_parts(row["revocation"])
            validate_persistent_schema("PersistentAgentRevocationPayload", revoked)
            if (
                identity["identityEpoch"] != 2
                or row["operationCount"] != MAX_IDENTITY_OPERATIONS
                or any(revoked[k] != identity[k] for k in _BINDING)
                or revoked["identityEpoch"] != 1
                or revoked["bindingFingerprint"] != identity["bindingFingerprint"]
                or identity["revokedAt"] < max(identity["registeredAt"], revoked["issuedAt"])
            ):
                raise StoreUnavailable
    except (ContractError, KeyError, TypeError):
        raise StoreUnavailable from None
    return row


def linked_connection(unit, owner, vault, connection, *, active=False):
    """Trust the owner-indexed original OAuth record, never just a client ID."""
    conn = _row(unit, "hub_oauth_connections", owner, connection)
    if conn is None:
        raise ContractError("not_found")
    index = _row(unit, "hub_oauth_owners", owner)
    if (
        conn.get("ownerSubject") != owner
        or conn.get("vaultId") != vault
        or conn.get("connectionId") != connection
        or conn.get("provider") != "muse"
        or conn.get("status") not in {"active", "revoked"}
        or index is None
        or index.get("ownerSubject") != owner
        or type(index.get("connectionIds")) is not list
        or len(index["connectionIds"]) > MAX_CONNECTIONS
        or connection not in index["connectionIds"]
    ):
        raise StoreUnavailable
    identifier(conn.get("clientId"))
    # OAuth's absolute transport expiry is deliberately not identity revocation.
    # The existing OAuth verifier still enforces it for all legacy access.
    if active and conn["status"] != "active":
        raise ContractError("key_authorization_required")
    return conn


class PersistentAgentService:
    def __init__(self, store, *, client_ids=(), clock=time.time):
        self.store, self.client_ids, self.clock = store, frozenset(client_ids), clock

    def now(self):
        value = self.clock()
        if (
            type(value) not in {float, int}
            or not math.isfinite(value)
            or not 0 <= value <= 253402300799
        ):
            raise StoreUnavailable
        return int(value)

    def _context(self, unit, uid, vault_id, connection, *, active=False):
        owner = owner_key(uid)
        vault, registry = _current(unit, owner, self.now(), vault_id)
        conn = linked_connection(unit, owner, vault_id, connection, active=active)
        return owner, vault, registry, conn

    def state(self, uid, vault_id, connection):
        identifier(vault_id)
        identifier(connection)

        def read(unit):
            owner, _, _, conn = self._context(unit, uid, vault_id, connection)
            row = stored_identity(unit, owner, vault_id, connection)
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": PERSISTENT_AGENT_PROFILE,
                "identity": None if row is None else row["identity"],
                "binding": None if row is None else row["binding"],
                "revocation": None if row is None else row["revocation"],
                "connectionRevoked": conn["status"] == "revoked",
            }

        return self.store.transact(read)

    def receipt(self, uid, vault_id, connection, operation):
        for value in (vault_id, connection):
            identifier(value)
        validate_schema("OperationIdentifier", operation)

        def read(unit):
            owner, _, _, _ = self._context(unit, uid, vault_id, connection)
            saved = unit.get(operation_path(owner, vault_id, operation))
            if saved is None or saved["connectionId"] != connection:
                raise ContractError("not_found")
            return self._receipt(saved, owner, vault_id, connection, operation)

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
                "identity",
            }:
                raise StoreUnavailable
            if (
                result["contractVersion"] != CONTRACT_VERSION
                or result["profile"] != PERSISTENT_AGENT_PROFILE
                or result["operationId"] != operation
                or result["fingerprint"] != saved["fingerprint"]
            ):
                raise StoreUnavailable
            identity = validate_persistent_schema("PersistentAgentIdentity", result["identity"])
            if (identity["ownerSubject"], identity["vaultId"], identity["connectionId"]) != (
                owner,
                vault,
                connection,
            ):
                raise StoreUnavailable
            return result
        except (ContractError, KeyError, TypeError):
            raise StoreUnavailable from None

    def command(self, uid, vault_id, connection, signed, operation, *, revoke=False):
        for value in (vault_id, connection):
            identifier(value)
        validate_schema("OperationIdentifier", operation)
        validate_schema("SignedObject", signed)
        _, payload = _signed_parts(signed)
        validate_persistent_schema(
            "PersistentAgentRevocationPayload" if revoke else "PersistentAgentBindingPayload",
            payload,
        )
        if payload["stableOperationId"] != operation:
            raise ContractError("recipient_binding_mismatch")
        fingerprint = signing_input_fingerprint(signed)

        def write(unit):
            owner, _, registry, conn = self._context(unit, uid, vault_id, connection)
            path = operation_path(owner, vault_id, operation)
            saved = unit.get(path)
            if saved is not None:
                # A retry returns the immutable original receipt, never reapplies
                # an old enrollment, even after revocation or command expiry.
                if saved.get("connectionId") != connection:
                    raise ContractError("idempotency_conflict")
                result = self._receipt(saved, owner, vault_id, connection, operation)
                if saved["fingerprint"] != fingerprint:
                    raise ContractError("idempotency_conflict")
                return result
            current = stored_identity(unit, owner, vault_id, connection)
            context = {
                "registry": registry,
                "owner_subject": owner,
                "vault_id": vault_id,
                "connection_id": connection,
                "client_id": conn["clientId"],
                "now": self.now(),
            }
            if revoke:
                if current is None:
                    raise ContractError("not_found")
                identity = revoke_agent_identity(
                    signed, current_identity=current["identity"], **context
                )
                row = {
                    **current,
                    "identity": identity,
                    "revocation": snapshot(signed),
                    "operationCount": 2,
                }
            else:
                if conn["status"] != "active" or conn["clientId"] not in self.client_ids:
                    raise ContractError("key_authorization_required")
                verified = verify_agent_identity_binding(
                    signed, agent_id=payload["agentId"], **context
                )
                identity = initial_agent_identity(
                    verified, current_identity=None if current is None else current["identity"]
                )
                row = {
                    "identity": identity,
                    "binding": snapshot(signed),
                    "revocation": None,
                    "operationCount": 1,
                }
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PERSISTENT_AGENT_PROFILE,
                "operationId": operation,
                "fingerprint": fingerprint,
                "identity": identity,
            }
            unit.put(identity_path(owner, vault_id, connection), row)
            unit.put(
                path,
                {
                    "ownerSubject": owner,
                    "vaultId": vault_id,
                    "connectionId": connection,
                    "operationId": operation,
                    "fingerprint": fingerprint,
                    "command": snapshot(signed),
                    "receipt": result,
                },
            )
            return result

        return self.store.transact(write)
