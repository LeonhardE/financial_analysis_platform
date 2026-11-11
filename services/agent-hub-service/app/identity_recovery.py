"""Atomic Agent proof recovery, never a content grant or bearer issuer."""

import re
import secrets
from urllib.parse import urlsplit

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_agents import (
    MAX_SESSION_CHALLENGE_SECONDS,
    PERSISTENT_AGENT_PROFILE,
    _agent_keys,
    validate_persistent_schema,
    verify_agent_session_proof,
)
from folioview_shared.encrypted.schema import safe_https_url, validate_schema
from folioview_shared.identity import owner_key

from .persistent_agents import (
    PersistentAgentService,
    linked_connection,
    require_managed_credential,
    snapshot,
    stored_identity,
)
from .store import StoreUnavailable, document_path
from .vaults import _current, identifier

RECOVERY_PROFILE = "folioview.agent-identity-recovery.v1"
MAX_RECOVERY_SECONDS = 300
RECEIPT_GRACE_SECONDS = 120
MAX_RECOVERY_ENTRIES = 8
BINDING_FIELDS = (
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "connectionId",
    "agentId",
    "clientId",
    "identityEpoch",
    "agentSigningKeyId",
    "agentEncryptionKeyId",
    "bindingFingerprint",
)


def recovery_path(owner, vault, connection):
    return document_path("hub_agent_recoveries", owner, vault, connection)


class IdentityRecoveryService(PersistentAgentService):
    def __init__(self, store, *, audience, **kwargs):
        super().__init__(store, **kwargs)
        if not safe_https_url(audience) or urlsplit(audience).query or urlsplit(audience).fragment:
            raise ContractError("authorization_unavailable")
        self.audience = audience

    def _agent_context(self, unit, owner, vault, connection, client):
        if type(owner) is not str or re.fullmatch(r"[a-f0-9]{64}", owner) is None:
            raise ContractError("malformed_request")
        for value in (vault, connection, client):
            identifier(value)
        current_vault, registry = _current(unit, owner, self.now(), vault)
        conn = linked_connection(unit, owner, vault, connection, active=True)
        indexed = unit.get(document_path("hub_oauth_owners", owner))
        if (
            indexed is None
            or type(indexed.get("ownerUid")) is not str
            or owner_key(indexed["ownerUid"]) != owner
        ):
            raise StoreUnavailable
        if client not in self.client_ids or client != conn["clientId"]:
            raise ContractError("key_authorization_required")
        row = stored_identity(unit, owner, vault, connection)
        if row is None:
            raise ContractError("key_authorization_required")
        identity = row["identity"]
        if identity["clientId"] != client or identity["rootKeyId"] != current_vault["rootKeyId"]:
            raise StoreUnavailable
        if identity["status"] != "active":
            raise ContractError("key_authorization_required")
        require_managed_credential(row, now=self.now(), audience=self.audience, connection=conn)
        _agent_keys(identity, registry, self.now())
        return identity, registry

    def _bucket(self, unit, identity):
        owner, vault, connection = (
            identity[k] for k in ("ownerSubject", "vaultId", "connectionId")
        )
        row = unit.get(recovery_path(owner, vault, connection))
        if row is None:
            return {
                "ownerSubject": owner,
                "vaultId": vault,
                "connectionId": connection,
                "entries": {},
            }
        try:
            if type(row) is not dict or set(row) != {
                "ownerSubject",
                "vaultId",
                "connectionId",
                "entries",
            }:
                raise StoreUnavailable
            if (row["ownerSubject"], row["vaultId"], row["connectionId"]) != (
                owner,
                vault,
                connection,
            ):
                raise StoreUnavailable
            if type(row["entries"]) is not dict or len(row["entries"]) > MAX_RECOVERY_ENTRIES:
                raise StoreUnavailable
            for key, entry in row["entries"].items():
                if type(entry) is not dict or set(entry) != {"challenge", "proof", "receipt"}:
                    raise StoreUnavailable
                challenge = validate_persistent_schema("AgentSessionChallenge", entry["challenge"])
                if key != challenge["challengeId"] or challenge["audience"] != self.audience:
                    raise StoreUnavailable
                if any(challenge[k] != identity[k] for k in BINDING_FIELDS):
                    raise StoreUnavailable
                if (
                    not identity["registeredAt"]
                    <= challenge["issuedAt"]
                    < challenge["expiresAt"]
                    <= challenge["issuedAt"] + MAX_SESSION_CHALLENGE_SECONDS
                ):
                    raise StoreUnavailable
                if entry["proof"] is None:
                    if entry["receipt"] is not None:
                        raise StoreUnavailable
                else:
                    validate_schema("SignedObject", entry["proof"])
                    _, payload = _signed_parts(entry["proof"])
                    validate_persistent_schema("AgentSessionProofPayload", payload)
                    if payload != {**challenge, "artifactType": "persistent_agent_session_proof"}:
                        raise StoreUnavailable
                    receipt = entry["receipt"]
                    if type(receipt) is not dict or set(receipt) != {
                        "contractVersion",
                        "profile",
                        "challengeId",
                        "identity",
                        "proofFingerprint",
                        "acceptedAt",
                        "expiresAt",
                        "authority",
                    }:
                        raise StoreUnavailable
                    if (
                        receipt["contractVersion"] != CONTRACT_VERSION
                        or receipt["profile"] != RECOVERY_PROFILE
                        or receipt["challengeId"] != key
                        or receipt["authority"] != "identity_only"
                        or receipt["identity"] != {k: identity[k] for k in BINDING_FIELDS}
                        or receipt["proofFingerprint"] != signing_input_fingerprint(entry["proof"])
                        or type(receipt["acceptedAt"]) is not int
                        or type(receipt["expiresAt"]) is not int
                        or not challenge["issuedAt"]
                        <= receipt["acceptedAt"]
                        < challenge["expiresAt"]
                        or not receipt["acceptedAt"]
                        < receipt["expiresAt"]
                        <= receipt["acceptedAt"] + MAX_RECOVERY_SECONDS
                    ):
                        raise StoreUnavailable
        except (ContractError, KeyError, TypeError):
            raise StoreUnavailable from None
        return row

    def challenge(self, owner, vault, connection, client):
        # Generate randomness once outside a retrying callback. A competing
        # unconsumed challenge wins and is reused, never replaced by a caller.
        challenge_id, nonce = "challenge_" + secrets.token_urlsafe(32), secrets.token_urlsafe(32)

        def write(unit):
            identity, _ = self._agent_context(unit, owner, vault, connection, client)
            bucket = self._bucket(unit, identity)
            now = self.now()
            retained = {}
            for key, entry in bucket["entries"].items():
                deadline = (
                    entry["challenge"]["expiresAt"]
                    if entry["receipt"] is None
                    else entry["receipt"]["expiresAt"] + RECEIPT_GRACE_SECONDS
                )
                if deadline > now:
                    retained[key] = entry
                    if entry["proof"] is None:
                        return entry["challenge"]
            if len(retained) >= MAX_RECOVERY_ENTRIES:
                raise ContractError("authorization_unavailable")
            challenge = {
                "contractVersion": CONTRACT_VERSION,
                "profile": PERSISTENT_AGENT_PROFILE,
                "purpose": "resume_session",
                **{k: identity[k] for k in BINDING_FIELDS},
                "challengeId": challenge_id,
                "audience": self.audience,
                "nonce": nonce,
                "issuedAt": now,
                "expiresAt": now + MAX_SESSION_CHALLENGE_SECONDS,
            }
            validate_persistent_schema("AgentSessionChallenge", challenge)
            retained[challenge_id] = {"challenge": challenge, "proof": None, "receipt": None}
            unit.put(recovery_path(owner, vault, connection), {**bucket, "entries": retained})
            return challenge

        return self.store.transact(write)

    def recover(self, owner, vault, connection, client, signed):
        validate_schema("SignedObject", signed)
        _, payload = _signed_parts(signed)
        validate_persistent_schema("AgentSessionProofPayload", payload)
        fingerprint = signing_input_fingerprint(signed)

        def write(unit):
            identity, registry = self._agent_context(unit, owner, vault, connection, client)
            bucket = self._bucket(unit, identity)
            entry = bucket["entries"].get(payload["challengeId"])
            if entry is None:
                raise ContractError("key_authorization_required")
            if entry["receipt"] is not None:
                # Historical retry only: authenticate the current Agent signer,
                # then return the unchanged original deadline, never renew it.
                cert = _agent_keys(identity, registry, self.now())
                verify_jws(
                    signed, cert["publicJwk"], typ="fv-control+jws", expected_kid=cert["keyId"]
                )
                if fingerprint != entry["receipt"]["proofFingerprint"]:
                    raise ContractError("idempotency_conflict")
                return entry["receipt"]
            now = self.now()
            verify_agent_session_proof(
                signed,
                current_identity=identity,
                challenge=entry["challenge"],
                challenge_used=False,
                registry=registry,
                owner_subject=owner,
                vault_id=vault,
                connection_id=connection,
                client_id=client,
                audience=self.audience,
                now=now,
            )
            signing = registry.cert(
                identity["agentSigningKeyId"], role="agent_sig", connection_id=connection, now=now
            )
            encryption = registry.cert(
                identity["agentEncryptionKeyId"],
                role="agent_enc",
                connection_id=connection,
                now=now,
            )
            receipt = {
                "contractVersion": CONTRACT_VERSION,
                "profile": RECOVERY_PROFILE,
                "challengeId": payload["challengeId"],
                "identity": {k: identity[k] for k in BINDING_FIELDS},
                "proofFingerprint": fingerprint,
                "acceptedAt": now,
                "expiresAt": min(
                    now + MAX_RECOVERY_SECONDS, signing["expiresAt"], encryption["expiresAt"]
                ),
                "authority": "identity_only",
            }
            entry.update(proof=snapshot(signed), receipt=receipt)
            unit.put(recovery_path(owner, vault, connection), bucket)
            return receipt

        return self.store.transact(write)
