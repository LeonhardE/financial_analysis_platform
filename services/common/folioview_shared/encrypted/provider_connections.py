"""Opt-in Owner/provider slot contracts; no consumer, storage or migration is enabled.

All current slot/legacy/candidate inputs must be independently verified transaction
reads. Plans require an atomic consumer CAS, intent consumption and operation log.
They never authorize a Run, transfer grants or replace immutable v1 actor records.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files

from jsonschema import Draft202012Validator

from .agent_credentials import require_current_credential
from .authority import VerifiedRegistry
from .constants import CONTRACT_VERSION, MAX_CONTROL_BYTES
from .crypto import signing_input_fingerprint, verify_jws
from .errors import ContractError
from .jsonutil import b64url_decode, canonical_json, strict_json_loads
from .persistent_agents import MAX_OWNER_CONTROL_AGE_SECONDS, _agent_keys, _integer, _match
from .schema import load_schema, validate_schema

PROVIDER_CONNECTION_PROFILE = "folioview.provider-connection-slot.v1"
PROVIDERS = frozenset({"muse", "chatgpt"})
_SCHEMAS = frozenset(
    {
        "ProviderCredentialRef",
        "ProviderConnectionSlot",
        "ProviderTaskSelection",
        "ProviderConnectionReview",
        "ProviderLegacyCredential",
        "ProviderSlotApproval",
        "ProviderSlotOperation",
    }
)


@lru_cache(maxsize=1)
def _document():
    document = json.loads(files(__package__).joinpath("provider_connections.json").read_text())
    legacy = load_schema("Identifier")["$defs"]
    if set(document["$defs"]) & set(legacy):
        raise RuntimeError("Provider slot schema name collision")
    document["$defs"] = {**legacy, **document["$defs"]}
    Draft202012Validator.check_schema(document)
    return document


def load_provider_connection_schema(name):
    if type(name) is not str or name not in _SCHEMAS:
        raise ContractError("malformed_request")
    document = copy.deepcopy(_document())
    document["$ref"] = "#/$defs/" + name
    return document


@lru_cache(maxsize=8)
def _validator(name):
    return Draft202012Validator(load_provider_connection_schema(name))


def validate_provider_connection_schema(name, value):
    try:
        if len(canonical_json(value)) > MAX_CONTROL_BYTES:
            raise ContractError("payload_too_large")
        if next(_validator(name).iter_errors(value), None) is not None:
            raise ContractError("malformed_request")
        return copy.deepcopy(value)
    except ContractError:
        raise
    except (TypeError, ValueError, RecursionError):
        raise ContractError("malformed_request") from None


def provider_slot_id(owner_subject, provider):
    """A deterministic storage key, not an identity or authorization proof.

    Vault is deliberately excluded from uniqueness, but is fenced in every row
    and transition. No implicit cross-vault rebind is supported by this profile.
    """
    validate_schema("Identifier", owner_subject)
    if type(provider) is not str or provider not in PROVIDERS:
        raise ContractError("malformed_request")
    return "provider_" + hashlib.sha256(canonical_json([owner_subject, provider])).hexdigest()


def _context(owner_subject, vault_id, provider):
    validate_schema("Identifier", vault_id)
    return {
        "contractVersion": CONTRACT_VERSION,
        "profile": PROVIDER_CONNECTION_PROFILE,
        "ownerSubject": owner_subject,
        "vaultId": vault_id,
        "provider": provider,
        "slotId": provider_slot_id(owner_subject, provider),
    }


def validate_provider_slot(slot, *, owner_subject, vault_id, provider):
    slot = validate_provider_connection_schema("ProviderConnectionSlot", slot)
    _match(slot, _context(owner_subject, vault_id, provider))
    if slot["slotGeneration"] > slot["slotVersion"] or (
        slot["currentCredential"] is not None
        and slot["currentCredential"] != slot["lastCredential"]
    ):
        raise ContractError("version_conflict")
    return slot


def _ordered_refs(refs):
    keys = [r["connectionId"] for r in refs]
    if keys != sorted(set(keys)):
        raise ContractError("malformed_request")
    return refs


def provider_review_digest(review):
    """Digest the exact reviewed selection, never union old grants or task scopes."""
    review = validate_provider_connection_schema("ProviderConnectionReview", review)
    _match(review, _context(review["ownerSubject"], review["vaultId"], review["provider"]))
    _ordered_refs(review["retiredCredentials"])
    task_ids = [t["taskId"] for t in review["tasks"]]
    if task_ids != sorted(set(task_ids)) or any(
        t["resourceIds"] != sorted(set(t["resourceIds"])) for t in review["tasks"]
    ):
        raise ContractError("malformed_request")
    return hashlib.sha256(canonical_json(review)).hexdigest()


def _owner_control(signed, registry, context, action, now):
    _integer(now)
    if not isinstance(registry, VerifiedRegistry):
        raise ContractError("key_authorization_required")
    if (registry.owner_subject, registry.vault_id) != (context["ownerSubject"], context["vaultId"]):
        raise ContractError("recipient_binding_mismatch")
    validate_schema("SignedObject", signed)
    if len(canonical_json(signed)) > MAX_CONTROL_BYTES:
        raise ContractError("payload_too_large")
    header = strict_json_loads(b64url_decode(signed["protected"], max_bytes=1024), max_bytes=1024)
    if type(header) is not dict or type(header.get("kid")) is not str:
        raise ContractError("invalid_signature")
    cert = registry.cert(header["kid"], role="device_sig", connection_id=None, now=now)
    if "control_write" not in cert["capabilities"]:
        raise ContractError("key_authorization_required")
    payload = validate_provider_connection_schema(
        "ProviderSlotApproval",
        verify_jws(signed, cert["publicJwk"], typ="fv-control+jws", expected_kid=cert["keyId"]),
    )
    _match(
        payload,
        {
            **context,
            "rootKeyId": registry.root_key_id,
            "action": action,
            "deviceSigningKeyId": cert["keyId"],
        },
    )
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


def _compare(slot, payload, context):
    if slot is not None:
        slot = validate_provider_slot(
            slot,
            **{
                "owner_subject": context["ownerSubject"],
                "vault_id": context["vaultId"],
                "provider": context["provider"],
            },
        )
    previous = slot["lastCredential"]["credentialFingerprint"] if slot else None
    if (
        payload["expectedSlotVersion"],
        payload["expectedSlotGeneration"],
        payload["previousCredentialFingerprint"],
    ) != (slot["slotVersion"] if slot else 0, slot["slotGeneration"] if slot else 0, previous):
        raise ContractError("version_conflict")
    return slot


@dataclass(frozen=True)
class ProviderSlotPlan:
    """Pure transaction proposal, not a committed result or capability.

    The consumer must compare the complete legacy inventory as well as the slot
    version, then install the slot, consume intent, retire credentials and retain
    original operation/receipt in one transaction. Nothing mutates inputs here.
    """

    expected_slot_version: int
    slot: dict
    retire: tuple
    tasks: tuple
    operation: dict


def _plan(slot, payload, context, signed, *, candidate, retire, tasks, now):
    next_slot = validate_provider_slot(
        {
            **context,
            "slotVersion": (slot["slotVersion"] if slot else 0) + 1,
            "slotGeneration": (slot["slotGeneration"] if slot else 0) + (candidate is not None),
            "currentCredential": candidate,
            "lastCredential": candidate if candidate is not None else slot["lastCredential"],
        },
        owner_subject=context["ownerSubject"],
        vault_id=context["vaultId"],
        provider=context["provider"],
    )
    operation = validate_provider_connection_schema(
        "ProviderSlotOperation",
        {
            **context,
            "stableOperationId": payload["stableOperationId"],
            "operationFingerprint": signing_input_fingerprint(signed),
            "slotVersion": next_slot["slotVersion"],
            "slotGeneration": next_slot["slotGeneration"],
            "currentCredentialFingerprint": candidate["credentialFingerprint"]
            if candidate
            else None,
            "acceptedAt": now,
        },
    )
    return ProviderSlotPlan(
        payload["expectedSlotVersion"],
        next_slot,
        tuple(copy.deepcopy(retire)),
        tuple(copy.deepcopy(tasks)),
        operation,
    )


def prepare_provider_activation(
    signed,
    *,
    registry,
    owner_subject,
    vault_id,
    provider,
    current_slot,
    candidate_lease,
    candidate_identity,
    audience,
    review,
    legacy_credentials,
    now,
):
    """Verify exact Owner approval and propose a slot switch, without committing.

    Candidate lease/identity must already pass the existing Owner key handoff,
    approve_credential and v1 tombstone rules. Provider is preregistered native
    context, never a model/caller claim. legacy_credentials is the authoritative
    complete current inventory for this provider, read within the same CAS.
    Explicit task/resource selections still need fresh grants and ciphertext;
    this plan creates none and never treats a resource ID as consent.
    """
    context = _context(owner_subject, vault_id, provider)
    payload = _owner_control(signed, registry, context, "activate", now)
    slot = _compare(current_slot, payload, context)
    review = validate_provider_connection_schema("ProviderConnectionReview", review)
    _match(review, context)
    _match(payload, {"reviewDigest": provider_review_digest(review)})
    if type(legacy_credentials) not in (list, tuple) or len(legacy_credentials) > 32:
        raise ContractError("malformed_request")
    expected = []
    for record in legacy_credentials:
        record = validate_provider_connection_schema("ProviderLegacyCredential", record)
        _match(record, {k: context[k] for k in ("ownerSubject", "vaultId", "provider")})
        expected.append(record["reference"])
    expected.sort(key=lambda r: r["connectionId"])
    _ordered_refs(expected)
    if expected != review["retiredCredentials"] or (
        slot and slot["currentCredential"] is not None and slot["currentCredential"] not in expected
    ):
        raise ContractError("version_conflict")
    lease = require_current_credential(
        candidate_lease, identity=candidate_identity, audience=audience, now=now
    )
    _match(
        lease,
        {"ownerSubject": owner_subject, "vaultId": vault_id, "rootKeyId": registry.root_key_id},
    )
    signing = _agent_keys(candidate_identity, registry, now)
    encryption = registry.cert(
        lease["agentEncryptionKeyId"],
        role="agent_enc",
        connection_id=lease["connectionId"],
        now=now,
    )
    if lease["expiresAt"] > min(signing["expiresAt"], encryption["expiresAt"]):
        raise ContractError("key_authorization_required")
    if signing["keyEpoch"] != encryption["keyEpoch"]:
        raise ContractError("recipient_binding_mismatch")
    candidate = {k: lease[k] for k in ("connectionId", "clientId", "credentialFingerprint")}
    candidate["credentialGeneration"] = lease["generation"]
    _match(
        payload,
        {
            "candidateCredentialFingerprint": lease["credentialFingerprint"],
            "setupIntentId": lease["setupIntentId"],
        },
    )
    priors = [*expected, *([slot["lastCredential"]] if slot else [])]
    same_connection = [p for p in priors if p["connectionId"] == candidate["connectionId"]]
    if any(p["credentialFingerprint"] == candidate["credentialFingerprint"] for p in priors):
        raise ContractError("version_conflict")
    generation = max((p["credentialGeneration"] for p in same_connection), default=0) + 1
    if candidate["credentialGeneration"] != generation or any(
        p["clientId"] != candidate["clientId"] for p in same_connection
    ):
        raise ContractError("version_conflict")
    previous = (
        max(same_connection, key=lambda p: p["credentialGeneration"]) if same_connection else None
    )
    if lease["previousCredentialFingerprint"] != (
        previous["credentialFingerprint"] if previous else None
    ):
        raise ContractError("version_conflict")
    return _plan(
        slot,
        payload,
        context,
        signed,
        candidate=candidate,
        retire=expected,
        tasks=review["tasks"],
        now=now,
    )


def prepare_provider_disconnect(
    signed, *, registry, owner_subject, vault_id, provider, current_slot, now
):
    context = _context(owner_subject, vault_id, provider)
    payload = _owner_control(signed, registry, context, "disconnect", now)
    slot = _compare(current_slot, payload, context)
    if slot is None or slot["currentCredential"] is None:
        raise ContractError("version_conflict")
    _match(
        payload,
        {"candidateCredentialFingerprint": None, "reviewDigest": None, "setupIntentId": None},
    )
    return _plan(
        slot,
        payload,
        context,
        signed,
        candidate=None,
        retire=[slot["currentCredential"]],
        tasks=[],
        now=now,
    )


def require_current_provider_credential(
    slot, lease, *, identity, owner_subject, vault_id, provider, audience, now
):
    """An additional live slot fence; retain PoP, grants, source and Run checks."""
    slot = validate_provider_slot(
        slot, owner_subject=owner_subject, vault_id=vault_id, provider=provider
    )
    lease = require_current_credential(lease, identity=identity, audience=audience, now=now)
    _match(lease, {"ownerSubject": owner_subject, "vaultId": vault_id})
    reference = {k: lease[k] for k in ("connectionId", "clientId", "credentialFingerprint")}
    reference["credentialGeneration"] = lease["generation"]
    if slot["currentCredential"] != reference:
        raise ContractError("key_authorization_required")
    return lease


def check_provider_operation_replay(
    stored, *, owner_subject, vault_id, provider, stable_operation_id, fingerprint
):
    """Compare a trusted original operation after independent current Owner auth.

    This does not verify a signature, revive a credential, return Agent authority
    or write state. Consumer returns its original immutable receipt separately.
    """
    context = _context(owner_subject, vault_id, provider)
    validate_schema("OperationIdentifier", stable_operation_id)
    validate_schema("Digest", fingerprint)
    if stored is None:
        return None
    stored = validate_provider_connection_schema("ProviderSlotOperation", stored)
    _match(stored, {**context, "stableOperationId": stable_operation_id})
    if stored["operationFingerprint"] != fingerprint:
        raise ContractError("idempotency_conflict")
    return stored
