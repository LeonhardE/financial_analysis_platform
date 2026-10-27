"""Root-authenticated public authority for encrypted workspace v2.0.

These verifiers have no network, key store, OAuth database, or decryption path.
Callers provide the authenticated owner and current resource/task state. A root
pin proves identity, not global freshness for a client without a checkpoint.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from .constants import (
    CONTRACT_VERSION,
    MAX_CONTROL_BYTES,
    MAX_GRANT_SECONDS,
    MAX_REGISTRY_BYTES,
)
from .crypto import jwk_thumbprint, verify_jws
from .errors import ContractError
from .jsonutil import b64url_decode, canonical_json, strict_json_loads
from .schema import validate_schema

_CONTROL_TYP = "fv-control+jws"
_CAPABILITIES = {
    "root_sig": frozenset(),
    "device_sig": frozenset({"object_write", "task_grant", "control_write"}),
    "agent_sig": frozenset({"run_request", "result_write"}),
    "device_enc": frozenset(),
    "agent_enc": frozenset(),
    "recovery_enc": frozenset(),
}
_UNSET = object()


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


def _digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _integer(value: int, minimum: int = 0) -> None:
    if type(value) is not int or not minimum <= value <= 9_007_199_254_740_991:
        raise ContractError("malformed_request")


def _identity(value: dict, owner: str, vault: str) -> None:
    if value.get("contractVersion") != CONTRACT_VERSION:
        raise ContractError("unsupported_contract")
    if value.get("ownerSubject") != owner or value.get("vaultId") != vault:
        raise ContractError("recipient_binding_mismatch")


def _signed_key_id(signed: dict) -> str:
    validate_schema("SignedObject", signed)
    if len(canonical_json(signed)) > MAX_CONTROL_BYTES:
        raise ContractError("payload_too_large")
    header = strict_json_loads(b64url_decode(signed["protected"], max_bytes=1024), max_bytes=1024)
    if not isinstance(header, dict) or not isinstance(header.get("kid"), str):
        raise ContractError("invalid_signature")
    return header["kid"]


@dataclass(frozen=True)
class VerifiedRegistry:
    """An immutable verified checkpoint plus public certificates and high-water state."""

    owner_subject: str
    vault_id: str
    root_key_id: str
    root_epoch: int
    registry_sequence: int
    key_epoch: int
    checkpoint_digest: str
    certificates: Mapping[str, Mapping[str, Any]]
    active_key_ids: frozenset[str]
    revoked_key_ids: frozenset[str]
    checkpoint_history: Mapping[int, str]
    local_key_epochs: Mapping[tuple[str, str, str | None], int]
    issued_at: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "certificates", _freeze(self.certificates))
        object.__setattr__(self, "checkpoint_history", _freeze(self.checkpoint_history))
        object.__setattr__(self, "local_key_epochs", _freeze(self.local_key_epochs))
        object.__setattr__(self, "active_key_ids", frozenset(self.active_key_ids))
        object.__setattr__(self, "revoked_key_ids", frozenset(self.revoked_key_ids))

    def cert(
        self,
        key_id: str,
        *,
        role: str | None = None,
        connection_id: str | None | object = _UNSET,
        now: int,
    ) -> dict:
        """Return a copy of an active, unexpired, correctly scoped certificate."""
        _integer(now)
        cert = self.certificates.get(key_id)
        if (
            cert is None
            or key_id not in self.active_key_ids
            or key_id in self.revoked_key_ids
            or not cert["notBefore"] <= now < cert["expiresAt"]
            or cert["keyEpoch"]
            != self.local_key_epochs.get((cert["principalId"], cert["role"], cert["connectionId"]))
            or (role is not None and cert["role"] != role)
            or (connection_id is not _UNSET and cert["connectionId"] != connection_id)
        ):
            raise ContractError("key_authorization_required")
        return _thaw(cert)


@dataclass(frozen=True)
class VerifiedGrant(Mapping[str, Any]):
    """A grant checked against one current registry, never an unsigned request dict."""

    payload: Mapping[str, Any]
    registry_digest: str
    task_version: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "payload", _freeze(self.payload))

    def __getitem__(self, key: str) -> Any:
        return _thaw(self.payload[key])

    def __iter__(self) -> Iterator[str]:
        return iter(self.payload)

    def __len__(self) -> int:
        return len(self.payload)

    def as_dict(self) -> dict:
        return _thaw(self.payload)


def verify_registry(
    bundle: dict,
    *,
    root_jwk: dict,
    pinned_root_key_id: str,
    owner_subject: str,
    vault_id: str,
    now: int,
    previous: VerifiedRegistry | None = None,
    root_epoch: int | None = None,
) -> VerifiedRegistry:
    """Verify a full root-signed directory, optionally advancing known state.

    A fresh caller must obtain its root/checkpoint anchor independently. This
    routine cannot detect an entirely old signed directory without prior state.
    Consecutive updates are required; services may load intermediate bundles.
    """
    _integer(now)
    root_epoch = root_epoch if root_epoch is not None else (previous.root_epoch if previous else 1)
    _integer(root_epoch, 1)
    if len(canonical_json(bundle)) > MAX_REGISTRY_BYTES:
        raise ContractError("payload_too_large")
    validate_schema("RegistryBundle", bundle)
    if jwk_thumbprint(root_jwk) != pinned_root_key_id:
        raise ContractError("untrusted_key")
    cp = verify_jws(
        bundle["checkpoint"], root_jwk, typ=_CONTROL_TYP, expected_kid=pinned_root_key_id
    )
    validate_schema("RegistryCheckpointPayload", cp)
    _identity(cp, owner_subject, vault_id)
    if cp["rootKeyId"] != pinned_root_key_id or cp["rootEpoch"] != root_epoch:
        raise ContractError("untrusted_key")
    if cp["issuedAt"] > now:
        raise ContractError("registry_conflict")
    digest = _digest(cp)
    if previous is not None:
        if (
            previous.owner_subject != owner_subject
            or previous.vault_id != vault_id
            or previous.root_key_id != pinned_root_key_id
            or previous.root_epoch != root_epoch
        ):
            raise ContractError("untrusted_key")
        if (
            cp["registrySequence"] < previous.registry_sequence
            or cp["keyEpoch"] < previous.key_epoch
        ):
            raise ContractError("rollback_detected")
        if cp["registrySequence"] == previous.registry_sequence:
            if digest != previous.checkpoint_digest:
                raise ContractError("registry_conflict")
        elif (
            cp["registrySequence"] != previous.registry_sequence + 1
            or cp["previousDigest"] != previous.checkpoint_digest
            or cp["issuedAt"] < previous.issued_at
        ):
            raise ContractError("registry_conflict")
        if not previous.revoked_key_ids <= set(cp["revokedKeyIds"]):
            raise ContractError("rollback_detected")
    elif (cp["registrySequence"] == 1) != (cp["previousDigest"] is None):
        raise ContractError("registry_conflict")
    certificates: dict[str, dict] = {}
    certificate_ids: set[str] = set()
    active_keys: set[str] = set()
    descriptions = []
    revoked = set(cp["revokedKeyIds"])
    local_epochs = dict(previous.local_key_epochs) if previous is not None else {}
    local_generations: dict[tuple[str, str, str | None, int], str] = {}
    for entry in bundle["entries"]:
        cert = verify_jws(
            entry["certificate"], root_jwk, typ=_CONTROL_TYP, expected_kid=pinned_root_key_id
        )
        validate_schema("KeyCertificatePayload", cert)
        _identity(cert, owner_subject, vault_id)
        role, kid = cert["role"], cert["keyId"]
        if (
            cert["issuerKeyId"] != pinned_root_key_id
            or kid != jwk_thumbprint(cert["publicJwk"])
            or kid in certificates
            or cert["certificateId"] in certificate_ids
            or cert["expiresAt"] <= cert["notBefore"]
            or not set(cert["capabilities"]) <= _CAPABILITIES[role]
            or role.startswith("agent_") != (cert["connectionId"] is not None)
            or (role == "root_sig" and kid != pinned_root_key_id)
            or (role != "root_sig" and kid == pinned_root_key_id)
        ):
            raise ContractError("key_authorization_required")
        if entry["active"] == (kid in revoked):
            raise ContractError("key_authorization_required")
        local_identity = (cert["principalId"], role, cert["connectionId"])
        generation = (*local_identity, cert["keyEpoch"])
        if generation in local_generations:
            raise ContractError("stale_key_epoch")
        local_generations[generation] = kid
        if previous is not None:
            old = previous.certificates.get(kid)
            if old is not None and canonical_json(_thaw(old)) != canonical_json(cert):
                raise ContractError("registry_conflict")
            if old is None and cert["keyEpoch"] <= previous.local_key_epochs.get(local_identity, 0):
                raise ContractError("stale_key_epoch")
        local_epochs[local_identity] = max(local_epochs.get(local_identity, 0), cert["keyEpoch"])
        certificates[kid] = cert
        certificate_ids.add(cert["certificateId"])
        if entry["active"]:
            active_keys.add(kid)
        descriptions.append(
            {
                "certificateId": cert["certificateId"],
                "payloadDigest": _digest(cert),
                "active": entry["active"],
            }
        )
    if _digest(sorted(descriptions, key=lambda row: row["certificateId"])) != cp["entriesDigest"]:
        raise ContractError("registry_conflict")
    history = dict(previous.checkpoint_history) if previous is not None else {}
    history[cp["registrySequence"]] = digest
    return VerifiedRegistry(
        owner_subject,
        vault_id,
        pinned_root_key_id,
        root_epoch,
        cp["registrySequence"],
        cp["keyEpoch"],
        digest,
        certificates,
        frozenset(active_keys),
        frozenset(revoked),
        history,
        local_epochs,
        cp["issuedAt"],
    )


def _registry_reference(payload: dict, registry: VerifiedRegistry, *, current: bool) -> None:
    if payload["keyEpoch"] != registry.key_epoch:
        raise ContractError("stale_key_epoch")
    if current:
        valid = (
            payload["registrySequence"] == registry.registry_sequence
            and payload["checkpointDigest"] == registry.checkpoint_digest
        )
    else:
        valid = (
            registry.checkpoint_history.get(payload["registrySequence"])
            == payload["checkpointDigest"]
        )
    if not valid:
        raise ContractError("rollback_detected")


def _device_control(signed: dict, registry: VerifiedRegistry, schema: str, now: int) -> dict:
    kid = _signed_key_id(signed)
    device = registry.cert(kid, role="device_sig", connection_id=None, now=now)
    if "control_write" not in device["capabilities"]:
        raise ContractError("key_authorization_required")
    payload = verify_jws(signed, device["publicJwk"], typ=_CONTROL_TYP, expected_kid=kid)
    validate_schema(schema, payload)
    _identity(payload, registry.owner_subject, registry.vault_id)
    _registry_reference(payload, registry, current=True)
    return payload


def verify_agent_grant(
    signed: dict,
    *,
    registry: VerifiedRegistry,
    owner_subject: str,
    vault_id: str,
    connection_id: str,
    authorization_id: str,
    task_id: str,
    task_version: int,
    execution_epoch: int,
    grant_id: str,
    grant_epoch: int,
    now: int,
    authorization_expires_at: int,
    resource_bindings: Sequence[Mapping[str, Any]] | None = None,
) -> VerifiedGrant:
    """Verify new-execution authority, separately from current OAuth token checks.

    authorization_expires_at is the caller's minimum consent/refresh-family
    absolute deadline, not the short access-token expiry. This new-write check
    must not replace the original-connection authorization for saved receipts.
    """
    for value in [now, authorization_expires_at]:
        _integer(value)
    for value in [task_version, execution_epoch, grant_epoch]:
        _integer(value, 1)
    if registry.owner_subject != owner_subject or registry.vault_id != vault_id:
        raise ContractError("recipient_binding_mismatch")
    kid = _signed_key_id(signed)
    device = registry.cert(kid, role="device_sig", connection_id=None, now=now)
    if "task_grant" not in device["capabilities"]:
        raise ContractError("key_authorization_required")
    grant = verify_jws(signed, device["publicJwk"], typ=_CONTROL_TYP, expected_kid=kid)
    validate_schema("AgentKeyGrantPayload", grant)
    _identity(grant, owner_subject, vault_id)
    expected = {
        "deviceSigningKeyId": kid,
        "connectionId": connection_id,
        "authorizationId": authorization_id,
        "taskId": task_id,
        "executionEpoch": execution_epoch,
        "grantId": grant_id,
        "grantEpoch": grant_epoch,
    }
    if any(grant[field] != value for field, value in expected.items()):
        raise ContractError("recipient_binding_mismatch")
    _registry_reference(grant, registry, current=False)
    if (
        grant["taskVersions"] != sorted(grant["taskVersions"])
        or task_version not in grant["taskVersions"]
    ):
        raise ContractError("key_authorization_required")
    sig = registry.cert(
        grant["agentSigningKeyId"], role="agent_sig", connection_id=connection_id, now=now
    )
    enc = registry.cert(
        grant["agentEncryptionKeyId"], role="agent_enc", connection_id=connection_id, now=now
    )
    if (
        sig["principalId"] != enc["principalId"]
        or sig["keyId"] == enc["keyId"]
        or sig["keyEpoch"] != grant["agentSigningKeyEpoch"]
        or enc["keyEpoch"] != grant["agentEncryptionKeyEpoch"]
        or grant["notBefore"] < max(device["notBefore"], sig["notBefore"], enc["notBefore"])
        or not grant["notBefore"] <= now < grant["expiresAt"]
        or grant["expiresAt"] - grant["notBefore"] > MAX_GRANT_SECONDS
        or grant["expiresAt"]
        > min(authorization_expires_at, device["expiresAt"], sig["expiresAt"], enc["expiresAt"])
    ):
        raise ContractError("key_authorization_required")
    refs = [canonical_json(binding["ref"]) for binding in grant["resourceBindings"]]
    if len(set(refs)) != len(refs):
        raise ContractError("recipient_binding_mismatch")
    for binding in grant["resourceBindings"]:
        if binding["selectedVersions"] != sorted(binding["selectedVersions"]):
            raise ContractError("recipient_binding_mismatch")
    if resource_bindings is not None and canonical_json(
        grant["resourceBindings"]
    ) != canonical_json(list(resource_bindings)):
        raise ContractError("recipient_binding_mismatch")
    recipient_ids = grant["writebackRecipientKeyIds"]
    if recipient_ids != sorted(recipient_ids):
        raise ContractError("recipient_binding_mismatch")
    recipients = [registry.cert(kid, connection_id=None, now=now) for kid in recipient_ids]
    if (
        not {"device_enc", "recovery_enc"} <= {cert["role"] for cert in recipients}
        or any(cert["role"] not in {"device_enc", "recovery_enc"} for cert in recipients)
        or grant["expiresAt"] > min(cert["expiresAt"] for cert in recipients)
        or grant["notBefore"] < max(cert["notBefore"] for cert in recipients)
    ):
        raise ContractError("recipient_binding_mismatch")
    return VerifiedGrant(grant, registry.checkpoint_digest, task_version)


def verify_begin_intent(
    signed: dict,
    *,
    registry: VerifiedRegistry,
    grant: VerifiedGrant,
    task_envelope_fingerprint: str,
    resource_versions: Sequence[Mapping[str, Any]],
    now: int,
    require_current_checkpoint: bool = True,
) -> dict:
    """Verify exact selected task/source versions against current grant and keys.

    New Run creation requires the default current checkpoint. Set
    require_current_checkpoint=False only to authenticate a retained immutable
    intent: its issuing checkpoint must still be known, and all relevant keys,
    grant expiry and scope are checked against current authority. This does not
    authorize execution or replace live OAuth/task/source fence checks.
    """
    _integer(now)
    if type(require_current_checkpoint) is not bool:
        raise ContractError("malformed_request")
    if not isinstance(grant, VerifiedGrant) or grant.registry_digest != registry.checkpoint_digest:
        raise ContractError("key_authorization_required")
    if (
        not grant["notBefore"] <= now < grant["expiresAt"]
        or "decrypt_task" not in grant["capabilities"]
        or (resource_versions and "decrypt_resources" not in grant["capabilities"])
    ):
        raise ContractError("key_authorization_required")
    cert = registry.cert(
        grant["agentSigningKeyId"], role="agent_sig", connection_id=grant["connectionId"], now=now
    )
    if "run_request" not in cert["capabilities"]:
        raise ContractError("key_authorization_required")
    payload = verify_jws(signed, cert["publicJwk"], typ=_CONTROL_TYP, expected_kid=cert["keyId"])
    validate_schema("BeginRunIntentPayload", payload)
    _identity(payload, registry.owner_subject, registry.vault_id)
    _registry_reference(payload, registry, current=require_current_checkpoint)
    expected = {
        "connectionId": grant["connectionId"],
        "taskId": grant["taskId"],
        "grantId": grant["grantId"],
        "grantEpoch": grant["grantEpoch"],
        "executionEpoch": grant["executionEpoch"],
        "authorizationId": grant["authorizationId"],
        "taskEnvelopeFingerprint": task_envelope_fingerprint,
    }
    if (
        any(payload[field] != value for field, value in expected.items())
        or payload["expectedTaskVersion"] != grant.task_version
    ):
        raise ContractError("recipient_binding_mismatch")
    if canonical_json(payload["resourceVersions"]) != canonical_json(list(resource_versions)):
        raise ContractError("recipient_binding_mismatch")
    seen: set[bytes] = set()
    for version in payload["resourceVersions"]:
        ref = canonical_json(version["ref"])
        binding = next(
            (b for b in grant["resourceBindings"] if canonical_json(b["ref"]) == ref), None
        )
        if (
            ref in seen
            or binding is None
            or binding["sourceEpoch"] != version["sourceEpoch"]
            or (
                binding["versionAccess"] == "selected"
                and version["revision"] not in binding["selectedVersions"]
            )
        ):
            raise ContractError("recipient_binding_mismatch")
        seen.add(ref)
    return payload


def verify_control_command(
    signed: dict,
    *,
    registry: VerifiedRegistry,
    expected_action: str,
    expected_target_id: str,
    expected_version: int | None,
    expected_source_epoch: int | None,
    expected_parameters: dict,
    now: int,
) -> dict:
    """Verify one device control against trusted current routing/CAS parameters."""
    payload = _device_control(signed, registry, "ControlCommandPayload", now)
    # Task state changes require the dedicated next-envelope/version commitment.
    if expected_action in {"task_pause", "task_resume", "task_archive"}:
        raise ContractError("malformed_request")
    expected = {
        "action": expected_action,
        "targetId": expected_target_id,
        "expectedVersion": expected_version,
        "expectedSourceEpoch": expected_source_epoch,
        "parameters": expected_parameters,
    }
    if any(
        canonical_json(payload[field]) != canonical_json(value) for field, value in expected.items()
    ):
        raise ContractError("recipient_binding_mismatch")
    if (
        expected_action == "resource_fence_request"
        and payload["targetId"] != payload["parameters"]["resourceRef"]["resourceId"]
    ):
        raise ContractError("recipient_binding_mismatch")
    return payload


def verify_task_transition(
    signed: dict,
    *,
    registry: VerifiedRegistry,
    task_id: str,
    action: str,
    expected_version: int,
    next_task_version: int,
    next_execution_epoch: int,
    next_envelope_fingerprint: str,
    now: int,
) -> dict:
    for value in [expected_version, next_task_version, next_execution_epoch]:
        _integer(value, 1)
    payload = _device_control(signed, registry, "TaskTransitionIntentPayload", now)
    expected = {
        "taskId": task_id,
        "action": action,
        "expectedVersion": expected_version,
        "nextTaskVersion": next_task_version,
        "nextExecutionEpoch": next_execution_epoch,
        "nextEnvelopeFingerprint": next_envelope_fingerprint,
    }
    if next_task_version != expected_version + 1 or any(
        payload[field] != value for field, value in expected.items()
    ):
        raise ContractError("recipient_binding_mismatch")
    return payload


def verify_resource_scope(
    signed: dict,
    *,
    registry: VerifiedRegistry,
    connection_id: str,
    expected_source_epoch: int,
    selected_resource_refs: Sequence[Mapping[str, Any]],
    now: int,
) -> dict:
    _integer(expected_source_epoch, 1)
    payload = _device_control(signed, registry, "ResourceScopeCommandPayload", now)
    if (
        payload["connectionId"] != connection_id
        or payload["expectedSourceEpoch"] != expected_source_epoch
        or canonical_json(payload["selectedResourceRefs"])
        != canonical_json(list(selected_resource_refs))
    ):
        raise ContractError("recipient_binding_mismatch")
    refs = [canonical_json(ref) for ref in payload["selectedResourceRefs"]]
    if len(set(refs)) != len(refs):
        raise ContractError("recipient_binding_mismatch")
    return payload
