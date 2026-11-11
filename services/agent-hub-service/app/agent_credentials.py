"""Atomic public credential replacement; private Agent keys never enter the service."""

import secrets

from folioview_shared.encrypted.agent_credentials import (
    AGENT_CREDENTIAL_PROFILE,
    CREDENTIAL_NOTICE_SECONDS,
    DEFAULT_CREDENTIAL_SECONDS,
    approve_credential,
    credential_status,
)
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, canonical_json
from folioview_shared.encrypted.persistent_agents import (
    initial_agent_identity,
    validate_persistent_schema,
    verify_agent_identity_binding,
)
from folioview_shared.encrypted.schema import safe_https_url, validate_schema
from folioview_shared.identity import owner_key

from .native_transport import SCOPE, NativePrincipal
from .persistent_agents import (
    PersistentAgentService,
    identity_history_path,
    identity_path,
    snapshot,
    stored_identity,
)
from .store import StoreUnavailable, document_path
from .vaults import identifier

SETUP_SECONDS = 600
MAX_SETUPS_MINUTE = 5
MAX_SETUPS_DAY = 100
MAX_OFFER_BYTES = 8192


def setup_path(intent):
    validate_schema("OperationIdentifier", intent)
    return document_path("hub_agent_credential_setups", intent)


def operation_path(owner, vault, operation):
    return document_path("hub_agent_credential_operations", owner, vault, operation)


def validate_packet(offer):
    if (
        type(offer) is not dict
        or set(offer) != {"version", "iv", "ciphertext"}
        or type(offer["version"]) is not int
        or offer["version"] != 1
    ):
        raise ContractError("malformed_request")
    b64url_decode(offer["iv"], exact_bytes=12)
    ciphertext = b64url_decode(offer["ciphertext"], max_bytes=MAX_OFFER_BYTES)
    if len(ciphertext) < 16:
        raise ContractError("malformed_request")


class AgentCredentialService(PersistentAgentService):
    def __init__(self, *args, audience, **kwargs):
        super().__init__(*args, **kwargs)
        from urllib.parse import urlsplit

        if not safe_https_url(audience) or urlsplit(audience).query or urlsplit(audience).fragment:
            raise ContractError("authorization_unavailable")
        self.audience = audience

    def _native(self, unit, principal):
        if not isinstance(principal, NativePrincipal) or principal.expires_at <= self.now():
            raise ContractError("key_authorization_required")
        if owner_key(principal.owner_uid) != principal.owner_subject:
            raise ContractError("key_authorization_required")
        owner, vault, registry, conn = self._context(
            unit, principal.owner_uid, principal.vault_id, principal.connection_id, active=True
        )
        if (
            principal.client_id not in self.client_ids
            or principal.client_id != conn["clientId"]
            or principal.authorization_id != conn["authorizationId"]
            or conn.get("transportKind") != "persistent_runtime"
            or conn["approvedScopes"] != [SCOPE]
            or conn["grants"] != {}
        ):
            raise ContractError("key_authorization_required")
        return owner, vault, registry, conn

    def _setup(self, unit, intent, owner, vault, connection, conn, *, live=True):
        row = unit.get(setup_path(intent))
        if row is None or (
            row.get("ownerSubject"),
            row.get("vaultId"),
            row.get("connectionId"),
        ) != (owner, vault, connection):
            raise ContractError("not_found")
        if set(row) != {
            "setupIntentId",
            "ownerSubject",
            "vaultId",
            "connectionId",
            "clientId",
            "authorizationId",
            "issuedAt",
            "expiresAt",
            "expectedGeneration",
            "expectedCredentialFingerprint",
            "offer",
            "consumedBy",
        }:
            raise StoreUnavailable
        if (
            row["setupIntentId"] != intent
            or row["clientId"] != conn["clientId"]
            or type(row["issuedAt"]) is not int
            or type(row["expiresAt"]) is not int
            or row["expiresAt"] != row["issuedAt"] + SETUP_SECONDS
            or type(row["expectedGeneration"]) is not int
            or row["expectedGeneration"] < 0
        ):
            raise StoreUnavailable
        if live and (
            conn["status"] != "active"
            or conn["authorizationId"] != row["authorizationId"]
            or not row["issuedAt"] <= self.now() < row["expiresAt"]
            or row["consumedBy"] is not None
        ):
            raise ContractError("key_authorization_required")
        return row

    def begin_setup(self, principal):
        """Called only with a verified Native bootstrap principal, never JSON claims."""
        intent = "setup_" + secrets.token_hex(16)

        def write(unit):
            owner, _, _, conn = self._native(unit, principal)
            current = stored_identity(unit, owner, principal.vault_id, principal.connection_id)
            if current is None and conn.get("credentialMode") == "agent_owned":
                # A missing current record is not an unused slot.
                raise StoreUnavailable
            if (
                current is not None
                and "credentialLease" in current
                and conn.get("credentialMode") != "agent_owned"
            ):
                raise StoreUnavailable
            if current is not None and "credentialLease" not in current:
                # A legacy create-only slot/tombstone requires a new connection.
                raise ContractError("version_conflict")
            lease = None if current is None else current["credentialLease"]
            now = self.now()
            path = document_path("hub_agent_credential_limits", owner, principal.connection_id)
            limits = unit.get(path) or {"minute": 0, "minuteCount": 0, "day": 0, "dayCount": 0}
            if set(limits) != {"minute", "minuteCount", "day", "dayCount"} or any(
                type(value) is not int or value < 0 for value in limits.values()
            ):
                raise StoreUnavailable
            counts = {}
            for name, duration, maximum in (
                ("minute", 60, MAX_SETUPS_MINUTE),
                ("day", 86400, MAX_SETUPS_DAY),
            ):
                bucket = now // duration
                count = limits[name + "Count"] if limits[name] == bucket else 0
                if count >= maximum:
                    raise ContractError("version_conflict")
                counts.update({name: bucket, name + "Count": count + 1})
            row = {
                "setupIntentId": intent,
                "ownerSubject": owner,
                "vaultId": principal.vault_id,
                "connectionId": principal.connection_id,
                "clientId": conn["clientId"],
                "authorizationId": conn["authorizationId"],
                "issuedAt": now,
                "expiresAt": now + SETUP_SECONDS,
                "expectedGeneration": 0 if lease is None else lease["generation"],
                "expectedCredentialFingerprint": None
                if lease is None
                else lease["credentialFingerprint"],
                "offer": None,
                "consumedBy": None,
            }
            unit.put(path, counts)
            unit.put(setup_path(intent), row)
            return snapshot(row)

        return self.store.transact(write)

    def put_offer(self, principal, intent, offer):
        validate_packet(offer)

        def write(unit):
            owner, _, _, conn = self._native(unit, principal)
            row = self._setup(
                unit, intent, owner, principal.vault_id, principal.connection_id, conn
            )
            if row["offer"] is not None and row["offer"] != offer:
                raise ContractError("version_conflict")
            if row["offer"] is None:
                row["offer"] = snapshot(offer)
                unit.put(setup_path(intent), row)
            return snapshot(row)

        return self.store.transact(write)

    def owner_setup(self, uid, vault, connection, intent):
        def read(unit):
            owner, _, _, conn = self._context(unit, uid, vault, connection)
            return {
                **snapshot(self._setup(unit, intent, owner, vault, connection, conn, live=False)),
                "issuer": self.audience,
                "provider": conn["provider"],
            }

        return self.store.transact(read)

    def state(self, uid, vault, connection):
        for value in (vault, connection):
            identifier(value)

        def read(unit):
            owner, _, _, conn = self._context(unit, uid, vault, connection)
            row = stored_identity(unit, owner, vault, connection)
            lease = None if row is None else row.get("credentialLease")
            if conn.get("credentialMode") == "agent_owned" and lease is None:
                raise StoreUnavailable
            if lease is not None and conn.get("credentialMode") != "agent_owned":
                raise StoreUnavailable
            return {
                "contractVersion": CONTRACT_VERSION,
                "profile": AGENT_CREDENTIAL_PROFILE,
                "identity": None if row is None else row["identity"],
                "binding": None if row is None else row["binding"],
                "lease": lease,
                "approval": None if lease is None else row["credentialApproval"],
                "status": "reauthorization_required"
                if lease is None
                else (
                    "revoked"
                    if conn["status"] != "active"
                    else credential_status(lease, now=self.now())
                ),
                "defaultValiditySeconds": DEFAULT_CREDENTIAL_SECONDS,
                "noticeSeconds": CREDENTIAL_NOTICE_SECONDS,
            }

        return self.store.transact(read)

    def _receipt(self, saved, owner, vault, connection, operation):
        try:
            return self._checked_receipt(saved, owner, vault, connection, operation)
        except (ContractError, KeyError, TypeError):
            raise StoreUnavailable from None

    def _checked_receipt(self, saved, owner, vault, connection, operation):
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
        if saved["fingerprint"] != signing_input_fingerprint(saved["command"]["approval"]):
            raise StoreUnavailable
        result = saved["receipt"]
        if (
            type(result) is not dict
            or set(result)
            != {
                "contractVersion",
                "profile",
                "operationId",
                "fingerprint",
                "identity",
                "binding",
                "lease",
                "approval",
            }
            or result["contractVersion"] != CONTRACT_VERSION
            or result["profile"] != AGENT_CREDENTIAL_PROFILE
            or result["operationId"] != operation
            or result["fingerprint"] != saved["fingerprint"]
            or result["binding"] != saved["command"]["binding"]
            or result["approval"] != saved["command"]["approval"]
        ):
            raise StoreUnavailable
        lease = validate_persistent_schema("AgentCredentialLease", result["lease"])
        identity = validate_persistent_schema("PersistentAgentIdentity", result["identity"])
        if any(
            lease[k] != identity[k]
            for k in (
                "ownerSubject",
                "vaultId",
                "rootKeyId",
                "connectionId",
                "clientId",
                "agentId",
                "identityEpoch",
                "agentSigningKeyId",
                "agentEncryptionKeyId",
                "bindingFingerprint",
            )
        ) or identity["bindingFingerprint"] != signing_input_fingerprint(result["binding"]):
            raise StoreUnavailable
        if (
            lease["ownerSubject"],
            lease["vaultId"],
            lease["connectionId"],
            lease["credentialFingerprint"],
        ) != (owner, vault, connection, saved["fingerprint"]):
            raise StoreUnavailable
        return snapshot(result)

    def receipt(self, uid, vault, connection, operation):
        validate_schema("OperationIdentifier", operation)

        def read(unit):
            owner, _, _, _ = self._context(unit, uid, vault, connection)
            saved = unit.get(operation_path(owner, vault, operation))
            if saved is None or saved.get("connectionId") != connection:
                raise ContractError("not_found")
            return self._receipt(saved, owner, vault, connection, operation)

        return self.store.transact(read)

    def command(self, uid, vault, connection, command, operation):
        for value in (vault, connection):
            identifier(value)
        validate_schema("OperationIdentifier", operation)
        if (
            type(command) is not dict
            or set(command) not in ({"binding", "approval"}, {"binding", "approval", "activation"})
            or len(canonical_json(command)) > 32768
        ):
            raise ContractError("malformed_request")
        for field in ("binding", "approval"):
            validate_schema("SignedObject", command[field])
        if "activation" in command:
            validate_packet(command["activation"])
        _, payload = _signed_parts(command["approval"])
        validate_persistent_schema("AgentCredentialApproval", payload)
        if payload["stableOperationId"] != operation:
            raise ContractError("recipient_binding_mismatch")
        fingerprint = signing_input_fingerprint(command["approval"])

        def write(unit):
            owner, _, registry, conn = self._context(unit, uid, vault, connection)
            path = operation_path(owner, vault, operation)
            saved = unit.get(path)
            if saved is not None:
                if saved.get("command") != command or saved.get("connectionId") != connection:
                    raise ContractError("idempotency_conflict")
                return self._receipt(saved, owner, vault, connection, operation)
            if (
                conn["clientId"] not in self.client_ids
                or conn["status"] != "active"
                or conn.get("transportKind") != "persistent_runtime"
                or conn["approvedScopes"] != [SCOPE]
                or conn["grants"] != {}
            ):
                raise ContractError("key_authorization_required")
            setup = self._setup(unit, payload["setupIntentId"], owner, vault, connection, conn)
            if setup["offer"] is None:
                raise ContractError("key_authorization_required")
            current = stored_identity(unit, owner, vault, connection)
            if current is None and conn.get("credentialMode") == "agent_owned":
                # A missing current record is not an unused slot.
                raise StoreUnavailable
            if (
                current is not None
                and "credentialLease" in current
                and conn.get("credentialMode") != "agent_owned"
            ):
                raise StoreUnavailable
            if current is not None and "credentialLease" not in current:
                raise ContractError("version_conflict")
            old = None if current is None else current["credentialLease"]
            if (setup["expectedGeneration"], setup["expectedCredentialFingerprint"]) != (
                0 if old is None else old["generation"],
                None if old is None else old["credentialFingerprint"],
            ):
                raise ContractError("version_conflict")
            binding = verify_agent_identity_binding(
                command["binding"],
                registry=registry,
                owner_subject=owner,
                vault_id=vault,
                connection_id=connection,
                agent_id=payload["agentId"],
                client_id=conn["clientId"],
                now=self.now(),
            )
            identity = initial_agent_identity(binding)
            lease = approve_credential(
                command["approval"],
                registry=registry,
                identity=identity,
                current_lease=old,
                setup_intent_id=setup["setupIntentId"],
                audience=self.audience,
                now=self.now(),
            )
            predecessor = None
            previous_id = conn.get("predecessorConnectionId")
            if previous_id is not None:
                identifier(previous_id)
                predecessor = unit.get(document_path("hub_oauth_connections", owner, previous_id))
                prior_identity = stored_identity(unit, owner, vault, previous_id)
                if (
                    previous_id == connection
                    or predecessor is None
                    or any(
                        predecessor[k] != conn[k]
                        for k in ("ownerSubject", "vaultId", "clientId", "provider")
                    )
                    or predecessor["status"] != "active"
                    or predecessor.get("transportKind") != "persistent_runtime"
                    or prior_identity is None
                    or "credentialLease" in prior_identity
                ):
                    raise StoreUnavailable
            if current is not None:
                history = identity_history_path(
                    owner, vault, connection, current["identity"]["bindingFingerprint"]
                )
                if unit.get(history) is not None:
                    raise StoreUnavailable
                unit.put(history, {"record": snapshot(current), "supersededAt": self.now()})
            row = {
                "identity": identity,
                "binding": snapshot(command["binding"]),
                "revocation": None,
                "operationCount": 1,
                "credentialLease": lease,
                "credentialApproval": snapshot(command["approval"]),
            }
            result = {
                "contractVersion": CONTRACT_VERSION,
                "profile": AGENT_CREDENTIAL_PROFILE,
                "operationId": operation,
                "fingerprint": fingerprint,
                "identity": identity,
                "binding": row["binding"],
                "lease": lease,
                "approval": row["credentialApproval"],
            }
            if predecessor is not None:
                unit.put(
                    document_path("hub_oauth_connections", owner, previous_id),
                    {**predecessor, "status": "revoked", "supersededByConnectionId": connection},
                )
            next_conn = {k: v for k, v in conn.items() if k != "predecessorConnectionId"}
            unit.put(identity_path(owner, vault, connection), row)
            unit.put(
                document_path("hub_oauth_connections", owner, connection),
                {**next_conn, "credentialMode": "agent_owned"},
            )
            unit.put(setup_path(setup["setupIntentId"]), {**setup, "consumedBy": operation})
            unit.put(
                path,
                {
                    "ownerSubject": owner,
                    "vaultId": vault,
                    "connectionId": connection,
                    "operationId": operation,
                    "fingerprint": fingerprint,
                    "command": snapshot(command),
                    "receipt": snapshot(result),
                },
            )
            return snapshot(result)

        return self.store.transact(write)
