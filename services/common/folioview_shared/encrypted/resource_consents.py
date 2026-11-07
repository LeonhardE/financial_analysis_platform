"""Opt-in persistent logical-resource policy; no HTTP, storage or content keys.

Current identities, policies and source states are trusted transaction inputs,
not expectations copied from an incoming request. A decision is one policy gate,
not an authenticated request or a replacement for Run/envelope authority.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from types import MappingProxyType

from jsonschema import Draft202012Validator

from .authority import VerifiedRegistry
from .constants import CONTRACT_VERSION, MAX_CONTROL_BYTES, MAX_RESOURCES, MAX_SAFE_INTEGER
from .crypto import jwk_thumbprint, signing_input_fingerprint, verify_jws
from .errors import ContractError
from .jsonutil import b64url_decode, canonical_json, strict_json_loads
from .persistent_agents import (
    MAX_OWNER_CONTROL_AGE_SECONDS,
    _agent_keys,
    _identity,
    _owner_context,
)
from .schema import load_schema, validate_schema

RESOURCE_CONSENT_PROFILE = "folioview.persistent-resource-consent.v1"
MAX_RETAINED_PERMISSIONS = 32
MAX_SELECTED_HISTORY = 50
_BINDING_FIELDS = (
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
_SCHEMAS = frozenset(
    {
        "ConsentResourceApproval",
        "ResourcePermission",
        "ResourcePermissionTarget",
        "ConsentSourceState",
        "PersistentResourceApprovalPayload",
        "PersistentResourceRevocationPayload",
        "PersistentResourceConsent",
    }
)


@lru_cache(maxsize=1)
def _document():
    extension = json.loads(
        files(__package__).joinpath("resource_consents.json").read_text(encoding="utf-8")
    )
    legacy = load_schema("ResourceRef")
    if set(extension["$defs"]) & set(legacy["$defs"]):
        raise RuntimeError("Resource consent schema name collision")
    extension["$defs"] = {**legacy["$defs"], **extension["$defs"]}
    Draft202012Validator.check_schema(extension)
    return extension


def load_resource_consent_schema(name: str) -> dict:
    if type(name) is not str or name not in _SCHEMAS:
        raise ContractError("malformed_request")
    result = copy.deepcopy(_document())
    result["$ref"] = "#/$defs/" + name
    return result


@lru_cache(maxsize=8)
def _validator(name):
    return Draft202012Validator(load_resource_consent_schema(name))


def validate_resource_consent_schema(name: str, value: object) -> dict:
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


def _integer(value, minimum=1):
    if type(value) is not int or not minimum <= value <= MAX_SAFE_INTEGER:
        raise ContractError("malformed_request")


def _match(value, expected):
    if any(
        canonical_json(value[key]) != canonical_json(wanted) for key, wanted in expected.items()
    ):
        raise ContractError("recipient_binding_mismatch")


def _history(value, from_revision):
    if value != sorted(set(value)) or any(version >= from_revision for version in value):
        raise ContractError("malformed_request")


def _record_shape(value):
    value = validate_resource_consent_schema("PersistentResourceConsent", value)
    if value["createdAt"] > value["updatedAt"]:
        raise ContractError("malformed_request")
    ids, active_refs = [], set()
    for item in value["permissions"]:
        ids.append(item["permissionId"])
        _history(item["selectedHistory"], item["fromRevision"])
        if not value["createdAt"] <= item["approvedAt"] <= value["updatedAt"]:
            raise ContractError("malformed_request")
        if item["status"] == "active":
            ref = canonical_json(item["ref"])
            if (
                item["revokedAt"] is not None
                or item["revocationFingerprint"] is not None
                or ref in active_refs
            ):
                raise ContractError("malformed_request")
            active_refs.add(ref)
        elif (
            item["permissionEpoch"] < 2
            or item["revokedAt"] is None
            or item["revocationFingerprint"] is None
            or not item["approvedAt"] <= item["revokedAt"] <= value["updatedAt"]
        ):
            raise ContractError("malformed_request")
    if ids != sorted(set(ids)) or len(active_refs) > MAX_RESOURCES:
        raise ContractError("malformed_request")
    return value


def resource_consent_digest(value: dict) -> str:
    """Canonical public-state CAS digest, not proof that the state is authorized."""
    return hashlib.sha256(canonical_json(_record_shape(value))).hexdigest()


def _context(registry, current_identity, owner_subject, vault_id, connection_id, client_id, now):
    expected = _owner_context(
        registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        connection_id=connection_id,
        client_id=client_id,
        now=now,
    )
    identity = _identity(current_identity, expected, now)
    if identity["status"] != "active":
        raise ContractError("key_authorization_required")
    return identity


def _current(value, identity, consent_id, now):
    validate_schema("Identifier", consent_id)
    if value is None:
        return None
    value = _record_shape(value)
    _match(value, {**{key: identity[key] for key in _BINDING_FIELDS}, "consentId": consent_id})
    if not identity["registeredAt"] <= value["createdAt"] <= value["updatedAt"] <= now:
        raise ContractError("key_authorization_required")
    return value


def _owner_control(signed, registry, root_jwk, name, now, *, approval):
    validate_schema("SignedObject", signed)
    if len(canonical_json(signed)) > MAX_CONTROL_BYTES:
        raise ContractError("payload_too_large")
    header = strict_json_loads(b64url_decode(signed["protected"], max_bytes=1024), max_bytes=1024)
    if type(header) is not dict or type(header.get("kid")) is not str:
        raise ContractError("invalid_signature")
    root_id = jwk_thumbprint(root_jwk)
    if root_id != registry.root_key_id:
        raise ContractError("untrusted_key")
    earliest = registry.issued_at
    if header["kid"] == root_id:
        public_key = root_jwk
    elif approval:
        # An ordinary device's bounded P1 grant delegation is not authority to
        # create indefinite resource rights, even if it has task_grant.
        raise ContractError("key_authorization_required")
    else:
        cert = registry.cert(header["kid"], role="device_sig", connection_id=None, now=now)
        if "control_write" not in cert["capabilities"]:
            raise ContractError("key_authorization_required")
        public_key = cert["publicJwk"]
        earliest = max(earliest, cert["notBefore"])
    payload = verify_jws(signed, public_key, typ="fv-control+jws", expected_kid=header["kid"])
    payload = validate_resource_consent_schema(name, payload)
    _match(payload, {"authorKeyId": header["kid"]})
    if (
        payload["registrySequence"] != registry.registry_sequence
        or payload["checkpointDigest"] != registry.checkpoint_digest
        or payload["keyEpoch"] != registry.key_epoch
    ):
        raise ContractError("registry_conflict")
    if not max(earliest, now - MAX_OWNER_CONTROL_AGE_SECONDS) <= payload["issuedAt"] <= now:
        raise ContractError("key_authorization_required")
    return payload


def _control_state(payload, identity, current, consent_id):
    _match(payload, {**{key: identity[key] for key in _BINDING_FIELDS}, "consentId": consent_id})
    version = current["version"] if current else 0
    digest = resource_consent_digest(current) if current else None
    if (
        payload["expectedVersion"] != version
        or payload["expectedConsentDigest"] != digest
        or version == MAX_SAFE_INTEGER
    ):
        raise ContractError("version_conflict")
    if payload["issuedAt"] < (current["updatedAt"] if current else identity["registeredAt"]):
        raise ContractError("version_conflict")


def _source(value, identity, ref):
    value = validate_resource_consent_schema("ConsentSourceState", value)
    _match(
        value,
        {"ownerSubject": identity["ownerSubject"], "vaultId": identity["vaultId"], "ref": ref},
    )
    if value["state"] == "unavailable":
        raise ContractError("source_unavailable")
    if value["state"] != "active":
        raise ContractError("insufficient_scope")
    if value["sourceEpoch"] is None or value["currentRevision"] is None:
        raise ContractError("source_unavailable")
    return value


def _next_record(payload, current, identity, permissions, fingerprint):
    result = {
        "contractVersion": CONTRACT_VERSION,
        "profile": RESOURCE_CONSENT_PROFILE,
        **{key: identity[key] for key in _BINDING_FIELDS},
        "consentId": payload["consentId"],
        "purpose": "analysis",
        "version": payload["expectedVersion"] + 1,
        "createdAt": current["createdAt"] if current else payload["issuedAt"],
        "updatedAt": payload["issuedAt"],
        "lastOperationId": payload["stableOperationId"],
        "lastControlFingerprint": fingerprint,
        "permissions": sorted(permissions, key=lambda item: item["permissionId"]),
    }
    return _record_shape(result)


def approve_resource_consent(
    signed: dict,
    *,
    current_consent: dict | None,
    current_identity: dict,
    source_states: Sequence[dict],
    registry: VerifiedRegistry,
    root_jwk: dict,
    owner_subject: str,
    vault_id: str,
    connection_id: str,
    client_id: str,
    consent_id: str,
    now: int,
) -> dict:
    """Apply fresh incremental root approval to trusted current public state.

    This neither persists nor authenticates the resulting aggregate to a client.
    Store/CAS the original controls, deterministic states and receipts atomically;
    trusted encrypting clients must verify/pin that control chain before auto-share.
    """
    identity = _context(
        registry, current_identity, owner_subject, vault_id, connection_id, client_id, now
    )
    current = _current(current_consent, identity, consent_id, now)
    payload = _owner_control(
        signed, registry, root_jwk, "PersistentResourceApprovalPayload", now, approval=True
    )
    _control_state(payload, identity, current, consent_id)
    _agent_keys(identity, registry, now)
    if type(source_states) not in (list, tuple) or not 1 <= len(source_states) <= MAX_RESOURCES:
        raise ContractError("malformed_request")
    sources = {}
    for state in source_states:
        state = validate_resource_consent_schema("ConsentSourceState", state)
        key = canonical_json(state["ref"])
        if key in sources:
            raise ContractError("malformed_request")
        sources[key] = state
    refs = [canonical_json(item["ref"]) for item in payload["resources"]]
    ids = [item["permissionId"] for item in payload["resources"]]
    if len(set(refs)) != len(refs) or len(set(ids)) != len(ids) or set(refs) != set(sources):
        raise ContractError("malformed_request")
    permissions = {item["permissionId"]: item for item in current["permissions"]} if current else {}
    fingerprint = signing_input_fingerprint(signed)
    for item in payload["resources"]:
        source = _source(sources[canonical_json(item["ref"])], identity, item["ref"])
        _history(item["selectedHistory"], item["fromRevision"])
        if (
            item["sourceEpoch"] != source["sourceEpoch"]
            or item["fromRevision"] > source["currentRevision"]
        ):
            raise ContractError("version_conflict")
        previous = permissions.get(item["permissionId"])
        if previous is None:
            if (
                item["expectedPermissionEpoch"] != 0
                or item["fromRevision"] != source["currentRevision"]
            ):
                raise ContractError("version_conflict")
            if any(
                p["status"] == "active" and p["ref"] == item["ref"] for p in permissions.values()
            ):
                raise ContractError("version_conflict")
            permissions[item["permissionId"]] = {
                **{
                    key: item[key]
                    for key in (
                        "permissionId",
                        "ref",
                        "sourceEpoch",
                        "fromRevision",
                        "selectedHistory",
                    )
                },
                "versionPolicy": "current_and_future",
                "permissionEpoch": 1,
                "status": "active",
                "approvedAt": payload["issuedAt"],
                "approvalFingerprint": fingerprint,
                "revokedAt": None,
                "revocationFingerprint": None,
            }
        else:
            if (
                previous["status"] != "active"
                or previous["permissionEpoch"] != item["expectedPermissionEpoch"]
            ):
                raise ContractError("version_conflict")
            _match(item, {key: previous[key] for key in ("ref", "sourceEpoch", "fromRevision")})
            if not set(previous["selectedHistory"]) <= set(item["selectedHistory"]):
                raise ContractError("insufficient_scope")
            if item["selectedHistory"] != previous["selectedHistory"]:
                if previous["permissionEpoch"] == MAX_SAFE_INTEGER:
                    raise ContractError("version_conflict")
                permissions[item["permissionId"]] = {
                    **previous,
                    "selectedHistory": item["selectedHistory"],
                    "permissionEpoch": previous["permissionEpoch"] + 1,
                    "approvedAt": payload["issuedAt"],
                    "approvalFingerprint": fingerprint,
                }
    if (
        len(permissions) > MAX_RETAINED_PERMISSIONS
        or sum(item["status"] == "active" for item in permissions.values()) > MAX_RESOURCES
    ):
        raise ContractError("version_conflict")
    return _next_record(payload, current, identity, list(permissions.values()), fingerprint)


def revoke_resource_consent(
    signed: dict,
    *,
    current_consent: dict,
    current_identity: dict,
    registry: VerifiedRegistry,
    root_jwk: dict,
    owner_subject: str,
    vault_id: str,
    connection_id: str,
    client_id: str,
    consent_id: str,
    now: int,
) -> dict:
    """Revoke named permissions only; retain their terminal IDs and audit metadata.

    Source availability and usable Agent keys are not prerequisites for narrowing
    permission. An explicit new approval needs a new ID; an old ID never revives.
    """
    identity = _context(
        registry, current_identity, owner_subject, vault_id, connection_id, client_id, now
    )
    current = _current(current_consent, identity, consent_id, now)
    if current is None:
        raise ContractError("not_found")
    payload = _owner_control(
        signed, registry, root_jwk, "PersistentResourceRevocationPayload", now, approval=False
    )
    _control_state(payload, identity, current, consent_id)
    permissions = {item["permissionId"]: item for item in current["permissions"]}
    fingerprint = signing_input_fingerprint(signed)
    seen = set()
    for target in payload["targets"]:
        if target["permissionId"] in seen:
            raise ContractError("malformed_request")
        seen.add(target["permissionId"])
        item = permissions.get(target["permissionId"])
        if item is None:
            raise ContractError("not_found")
        _match(target, {"ref": item["ref"], "expectedPermissionEpoch": item["permissionEpoch"]})
        if item["status"] != "active" or item["permissionEpoch"] == MAX_SAFE_INTEGER:
            raise ContractError("version_conflict")
        permissions[item["permissionId"]] = {
            **item,
            "status": "revoked",
            "permissionEpoch": item["permissionEpoch"] + 1,
            "revokedAt": payload["issuedAt"],
            "revocationFingerprint": fingerprint,
        }
    return _next_record(payload, current, identity, list(permissions.values()), fingerprint)


@dataclass(frozen=True)
class ResourceConsentDecision:
    """One current resource-policy check, not a token, grant or cached authority."""

    consent_id: str
    consent_version: int
    permission_id: str
    permission_epoch: int
    resource_ref: Mapping[str, str]
    source_epoch: int
    revision: int
    purpose: str

    def __post_init__(self):
        object.__setattr__(self, "resource_ref", MappingProxyType(dict(self.resource_ref)))


def check_resource_consent(
    *,
    current_consent: dict,
    current_identity: dict,
    current_source: dict,
    registry: VerifiedRegistry,
    owner_subject: str,
    vault_id: str,
    connection_id: str,
    client_id: str,
    consent_id: str,
    permission_id: str,
    permission_epoch: int,
    resource_ref: dict,
    source_epoch: int,
    revision: int,
    purpose: str,
    now: int,
) -> ResourceConsentDecision:
    """Check one revision under the current parent and per-resource fences.

    Callers must also authenticate the request and enforce actual current task,
    Run, scope, ciphertext binding and delivery authority. Aggregate version is
    CAS/audit metadata, not an execution fence that revokes unrelated resources.
    """
    identity = _context(
        registry, current_identity, owner_subject, vault_id, connection_id, client_id, now
    )
    current = _current(current_consent, identity, consent_id, now)
    validate_schema("Identifier", permission_id)
    validate_schema("ResourceRef", resource_ref)
    for value in (permission_epoch, source_epoch, revision):
        _integer(value)
    if current is None or purpose != "analysis":
        raise ContractError("insufficient_scope")
    _agent_keys(identity, registry, now)
    item = next((p for p in current["permissions"] if p["permissionId"] == permission_id), None)
    if item is None or item["status"] != "active" or item["permissionEpoch"] != permission_epoch:
        raise ContractError("insufficient_scope")
    _match(item, {"ref": resource_ref, "sourceEpoch": source_epoch})
    source = _source(current_source, identity, resource_ref)
    if source["sourceEpoch"] != source_epoch or revision > source["currentRevision"]:
        raise ContractError("insufficient_scope")
    if revision < item["fromRevision"] and revision not in item["selectedHistory"]:
        raise ContractError("insufficient_scope")
    return ResourceConsentDecision(
        current["consentId"],
        current["version"],
        permission_id,
        permission_epoch,
        resource_ref,
        source_epoch,
        revision,
        purpose,
    )
