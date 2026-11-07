"""Opt-in public identity/recovery contracts, independent of OAuth/content grants.

No storage, token issuance, private keys or runtime enrollment is implemented here.
All current-state arguments must come from the consumer's trusted transaction.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from types import MappingProxyType
from typing import Any
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator

from .authority import VerifiedRegistry
from .constants import CONTRACT_VERSION, MAX_SAFE_INTEGER
from .crypto import signing_input_fingerprint, verify_jws
from .errors import ContractError
from .jsonutil import b64url_decode, canonical_json, strict_json_loads
from .schema import load_schema, safe_https_url, validate_schema

PERSISTENT_AGENT_PROFILE = "folioview.persistent-agent-identity.v1"
MAX_IDENTITY_CONTROL_BYTES = 16_384
MAX_OWNER_CONTROL_AGE_SECONDS = 300
MAX_SESSION_CHALLENGE_SECONDS = 120
_IDENTITY_FIELDS = (
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "connectionId",
    "agentId",
    "clientId",
    "identityEpoch",
    "agentSigningKeyId",
    "agentEncryptionKeyId",
)


@lru_cache(maxsize=1)
def _document():
    extension = json.loads(
        files(__package__).joinpath("persistent_agents.json").read_text(encoding="utf-8")
    )
    # References are resolved locally. Do not register these DTOs in the legacy
    # validator or broaden any existing grant, envelope, certificate or route.
    legacy = load_schema("Identifier")
    if set(extension["$defs"]) & set(legacy["$defs"]):
        raise RuntimeError("Persistent identity schema name collision")
    extension["$defs"] = {**legacy["$defs"], **extension["$defs"]}
    Draft202012Validator.check_schema(extension)
    return extension


def load_persistent_schema(name: str) -> dict:
    if type(name) is not str or name not in {
        "PersistentAgentBindingPayload",
        "PersistentAgentIdentity",
        "PersistentAgentRevocationPayload",
        "AgentSessionChallenge",
        "AgentSessionProofPayload",
    }:
        raise ContractError("malformed_request")
    document = copy.deepcopy(_document())
    document["$ref"] = "#/$defs/" + name
    return document


@lru_cache(maxsize=8)
def _validator(name):
    return Draft202012Validator(load_persistent_schema(name))


def validate_persistent_schema(name: str, value: object) -> dict:
    try:
        if len(canonical_json(value)) > MAX_IDENTITY_CONTROL_BYTES:
            raise ContractError("payload_too_large")
        if next(_validator(name).iter_errors(value), None) is not None:
            raise ContractError("malformed_request")
        return copy.deepcopy(value)
    except ContractError:
        raise
    except (TypeError, ValueError, RecursionError):
        raise ContractError("malformed_request") from None


def _integer(value, minimum=0):
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        raise ContractError("malformed_request")


def _owner_context(registry, *, owner_subject, vault_id, connection_id, client_id, now):
    _integer(now)
    for value in (owner_subject, vault_id, connection_id, client_id):
        validate_schema("Identifier", value)
    if not isinstance(registry, VerifiedRegistry):
        raise ContractError("key_authorization_required")
    if registry.owner_subject != owner_subject or registry.vault_id != vault_id:
        raise ContractError("recipient_binding_mismatch")
    return {
        "ownerSubject": owner_subject,
        "vaultId": vault_id,
        "rootKeyId": registry.root_key_id,
        "connectionId": connection_id,
        "clientId": client_id,
    }


def _match(value, expected):
    if any(value[key] != wanted for key, wanted in expected.items()):
        raise ContractError("recipient_binding_mismatch")


def _device_control(signed, registry, schema, now):
    validate_schema("SignedObject", signed)
    if len(canonical_json(signed)) > MAX_IDENTITY_CONTROL_BYTES:
        raise ContractError("payload_too_large")
    header = strict_json_loads(b64url_decode(signed["protected"], max_bytes=1024), max_bytes=1024)
    if type(header) is not dict or type(header.get("kid")) is not str:
        raise ContractError("invalid_signature")
    cert = registry.cert(header["kid"], role="device_sig", connection_id=None, now=now)
    if "control_write" not in cert["capabilities"]:
        raise ContractError("key_authorization_required")
    payload = verify_jws(
        signed, cert["publicJwk"], typ="fv-control+jws", expected_kid=cert["keyId"]
    )
    payload = validate_persistent_schema(schema, payload)
    if payload["deviceSigningKeyId"] != cert["keyId"]:
        raise ContractError("recipient_binding_mismatch")
    if (
        payload["registrySequence"] != registry.registry_sequence
        or payload["checkpointDigest"] != registry.checkpoint_digest
        or payload["keyEpoch"] != registry.key_epoch
    ):
        raise ContractError("registry_conflict")
    if (
        not max(cert["notBefore"], registry.issued_at, now - MAX_OWNER_CONTROL_AGE_SECONDS)
        <= payload["issuedAt"]
        <= now
    ):
        raise ContractError("key_authorization_required")
    return payload


def _agent_keys(identity, registry, now):
    signing = registry.cert(
        identity["agentSigningKeyId"],
        role="agent_sig",
        connection_id=identity["connectionId"],
        now=now,
    )
    encryption = registry.cert(
        identity["agentEncryptionKeyId"],
        role="agent_enc",
        connection_id=identity["connectionId"],
        now=now,
    )
    if (
        signing["principalId"] != identity["agentId"]
        or encryption["principalId"] != identity["agentId"]
        or signing["keyId"] == encryption["keyId"]
        or "run_request" not in signing["capabilities"]
    ):
        raise ContractError("recipient_binding_mismatch")
    return signing


@dataclass(frozen=True)
class VerifiedAgentBinding:
    """One enrollment verification snapshot, not a content/execution capability."""

    payload: Mapping[str, Any]
    fingerprint: str

    def __post_init__(self):
        object.__setattr__(self, "payload", MappingProxyType(dict(self.payload)))


def verify_agent_identity_binding(
    signed: dict,
    *,
    registry: VerifiedRegistry,
    owner_subject: str,
    vault_id: str,
    connection_id: str,
    agent_id: str,
    client_id: str,
    now: int,
) -> VerifiedAgentBinding:
    """Verify explicit owner enrollment of an already root-certified key pair.

    The consumer must separately establish trustworthy first key provenance;
    possession or an owner signature alone does not attest a Muse runtime.
    """
    expected = _owner_context(
        registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        connection_id=connection_id,
        client_id=client_id,
        now=now,
    )
    validate_schema("Identifier", agent_id)
    payload = _device_control(signed, registry, "PersistentAgentBindingPayload", now)
    _match(payload, {**expected, "agentId": agent_id, "identityEpoch": 1})
    _agent_keys(payload, registry, now)
    return VerifiedAgentBinding(payload, signing_input_fingerprint(signed))


def initial_agent_identity(binding: VerifiedAgentBinding, *, current_identity=None) -> dict:
    """Create the public record only for an unused connection slot.

    The consumer owns atomic create-only CAS and original operation receipts.
    Neither a used active slot nor a revoked tombstone can be reactivated here.
    """
    if current_identity is not None:
        raise ContractError("version_conflict")
    if not isinstance(binding, VerifiedAgentBinding):
        raise ContractError("key_authorization_required")
    payload = validate_persistent_schema("PersistentAgentBindingPayload", dict(binding.payload))
    return validate_persistent_schema(
        "PersistentAgentIdentity",
        {
            "contractVersion": CONTRACT_VERSION,
            "profile": PERSISTENT_AGENT_PROFILE,
            **{key: payload[key] for key in _IDENTITY_FIELDS},
            "bindingFingerprint": binding.fingerprint,
            "status": "active",
            "registeredAt": payload["issuedAt"],
            "revokedAt": None,
        },
    )


def _identity(value, expected, now):
    value = validate_persistent_schema("PersistentAgentIdentity", value)
    _match(value, expected)
    if value["registeredAt"] > now:
        raise ContractError("key_authorization_required")
    if value["status"] == "active" and value["revokedAt"] is not None:
        raise ContractError("malformed_request")
    if value["status"] == "revoked" and (
        value["identityEpoch"] < 2
        or value["revokedAt"] is None
        or not value["registeredAt"] <= value["revokedAt"] <= now
    ):
        raise ContractError("malformed_request")
    return value


def revoke_agent_identity(
    signed: dict,
    *,
    current_identity: dict,
    registry: VerifiedRegistry,
    owner_subject: str,
    vault_id: str,
    connection_id: str,
    client_id: str,
    now: int,
) -> dict:
    """Verify owner revocation and derive an epoch-advanced terminal tombstone."""
    expected = _owner_context(
        registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        connection_id=connection_id,
        client_id=client_id,
        now=now,
    )
    identity = _identity(current_identity, expected, now)
    if identity["status"] != "active" or identity["identityEpoch"] == MAX_SAFE_INTEGER:
        raise ContractError("version_conflict")
    payload = _device_control(signed, registry, "PersistentAgentRevocationPayload", now)
    _match(
        payload,
        {
            **{key: identity[key] for key in _IDENTITY_FIELDS},
            "bindingFingerprint": identity["bindingFingerprint"],
        },
    )
    return {
        **identity,
        "status": "revoked",
        "identityEpoch": identity["identityEpoch"] + 1,
        "revokedAt": now,
    }


def verify_agent_session_proof(
    signed: dict,
    *,
    current_identity: dict,
    challenge: dict,
    challenge_used: bool,
    registry: VerifiedRegistry,
    owner_subject: str,
    vault_id: str,
    connection_id: str,
    client_id: str,
    audience: str,
    now: int,
) -> dict:
    """Verify recovery of this identity only; never authorize content or a Run.

    Read current identity/challenge and consume the challenge in the same storage
    transaction as any downstream session issue. This pure verifier is not a
    one-use store, issuer, OAuth refresh, encryption-key possession attestation,
    runtime trust decision or replacement for resource/task/source fences.
    """
    expected = _owner_context(
        registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        connection_id=connection_id,
        client_id=client_id,
        now=now,
    )
    identity = _identity(current_identity, expected, now)
    if type(challenge_used) is not bool:
        raise ContractError("malformed_request")
    if challenge_used or identity["status"] != "active":
        raise ContractError("key_authorization_required")
    challenge = validate_persistent_schema("AgentSessionChallenge", challenge)
    _match(
        challenge,
        {
            **{key: identity[key] for key in _IDENTITY_FIELDS},
            "bindingFingerprint": identity["bindingFingerprint"],
            "audience": audience,
        },
    )
    if not safe_https_url(audience) or urlsplit(audience).query or urlsplit(audience).fragment:
        raise ContractError("recipient_binding_mismatch")
    b64url_decode(challenge["nonce"], exact_bytes=32)
    if not (
        identity["registeredAt"]
        <= challenge["issuedAt"]
        <= now
        < challenge["expiresAt"]
        <= challenge["issuedAt"] + MAX_SESSION_CHALLENGE_SECONDS
    ):
        raise ContractError("key_authorization_required")
    cert = _agent_keys(identity, registry, now)
    validate_schema("SignedObject", signed)
    if len(canonical_json(signed)) > MAX_IDENTITY_CONTROL_BYTES:
        raise ContractError("payload_too_large")
    payload = verify_jws(
        signed, cert["publicJwk"], typ="fv-control+jws", expected_kid=cert["keyId"]
    )
    payload = validate_persistent_schema("AgentSessionProofPayload", payload)
    _match(payload, challenge)
    return payload
