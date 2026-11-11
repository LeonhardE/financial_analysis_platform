"""Owner-approved, bounded leases over immutable v1 identity bindings.

Pure verification only. Consumers must commit replacement, setup-intent use,
operation receipt and current-generation fencing in one trusted transaction.
"""

from urllib.parse import urlsplit

from .authority import VerifiedRegistry
from .crypto import signing_input_fingerprint
from .errors import ContractError
from .persistent_agents import (
    _agent_keys,
    _device_control,
    _integer,
    _match,
    validate_persistent_schema,
)
from .schema import safe_https_url

AGENT_CREDENTIAL_PROFILE = "folioview.agent-credential.v1"
DEFAULT_CREDENTIAL_SECONDS = 90 * 24 * 60 * 60
CREDENTIAL_NOTICE_SECONDS = 7 * 24 * 60 * 60
CREDENTIAL_BINDING_FIELDS = (
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
_SLOT_FIELDS = ("ownerSubject", "vaultId", "rootKeyId", "connectionId", "clientId")


def credential_status(lease, *, now):
    """Public UI state; a missing local private file is not observable here."""
    lease = validate_persistent_schema("AgentCredentialLease", lease)
    _integer(now)
    if not lease["issuedAt"] < lease["expiresAt"] <= lease["issuedAt"] + DEFAULT_CREDENTIAL_SECONDS:
        raise ContractError("malformed_request")
    if lease["status"] == "revoked":
        return "revoked"
    if now >= lease["expiresAt"]:
        return "expired"
    if now < lease["issuedAt"]:
        raise ContractError("key_authorization_required")
    return "expiring" if lease["expiresAt"] - now <= CREDENTIAL_NOTICE_SECONDS else "active"


def require_current_credential(lease, *, identity, audience, now):
    """Additional fence, never a substitute for PoP, consent or resource checks."""
    identity = validate_persistent_schema("PersistentAgentIdentity", identity)
    if credential_status(lease, now=now) not in {"active", "expiring"}:
        raise ContractError("key_authorization_required")
    _match(lease, {key: identity[key] for key in CREDENTIAL_BINDING_FIELDS})
    if identity["status"] != "active" or lease["audience"] != audience:
        raise ContractError("key_authorization_required")
    return lease


def approve_credential(
    signed, *, registry, identity, current_lease, setup_intent_id, audience, now
):
    """Verify fresh Owner approval of a new key pair; never renew on Agent proof.

    identity is independently Owner-verified and bound to the consumed trusted
    setup intent. Its v1 create-only semantics are unchanged. Keep superseded
    bindings, revocations and operation receipts; do not erase a v1 tombstone.
    """
    if not isinstance(registry, VerifiedRegistry):
        raise ContractError("key_authorization_required")
    identity = validate_persistent_schema("PersistentAgentIdentity", identity)
    if (
        (identity["ownerSubject"], identity["vaultId"], identity["rootKeyId"])
        != (registry.owner_subject, registry.vault_id, registry.root_key_id)
        or identity["status"] != "active"
        or identity["identityEpoch"] != 1
    ):
        raise ContractError("recipient_binding_mismatch")
    if not safe_https_url(audience) or urlsplit(audience).query or urlsplit(audience).fragment:
        raise ContractError("recipient_binding_mismatch")
    payload = _device_control(signed, registry, "AgentCredentialApproval", now)
    _match(payload, {key: identity[key] for key in CREDENTIAL_BINDING_FIELDS})
    _match(payload, {"audience": audience, "setupIntentId": setup_intent_id})
    if current_lease is None:
        generation, previous = 1, None
    else:
        current = validate_persistent_schema("AgentCredentialLease", current_lease)
        _match(current, {key: identity[key] for key in _SLOT_FIELDS})
        generation, previous = current["generation"] + 1, current["credentialFingerprint"]
        if any(
            current[key] == identity[key]
            for key in (
                "agentId",
                "agentSigningKeyId",
                "agentEncryptionKeyId",
                "bindingFingerprint",
            )
        ):
            raise ContractError("key_authorization_required")
    if payload["generation"] != generation or payload["previousCredentialFingerprint"] != previous:
        raise ContractError("version_conflict")
    _agent_keys(identity, registry, now)
    sig = registry.cert(
        identity["agentSigningKeyId"],
        role="agent_sig",
        connection_id=identity["connectionId"],
        now=now,
    )
    enc = registry.cert(
        identity["agentEncryptionKeyId"],
        role="agent_enc",
        connection_id=identity["connectionId"],
        now=now,
    )
    if sig["keyEpoch"] != enc["keyEpoch"]:
        raise ContractError("recipient_binding_mismatch")
    if (
        not now
        < payload["expiresAt"]
        <= min(payload["issuedAt"] + DEFAULT_CREDENTIAL_SECONDS, sig["expiresAt"], enc["expiresAt"])
        or payload["issuedAt"] < identity["registeredAt"]
    ):
        raise ContractError("key_authorization_required")
    fields = validate_persistent_schema(
        "AgentCredentialLease",
        {
            **{
                key: payload[key]
                for key in (
                    "contractVersion",
                    "profile",
                    *CREDENTIAL_BINDING_FIELDS,
                    "generation",
                    "previousCredentialFingerprint",
                    "setupIntentId",
                    "audience",
                    "issuedAt",
                    "expiresAt",
                )
            },
            "credentialFingerprint": signing_input_fingerprint(signed),
            "status": "active",
        },
    )
    require_current_credential(fields, identity=identity, audience=audience, now=now)
    return fields
