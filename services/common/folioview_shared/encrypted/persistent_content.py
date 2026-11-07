"""Opt-in persistent content envelopes and current Agent request proofs.

Root publications authorize exact task/resource ciphertext; current consumers
still supply task/resource/Run fences. No HTTP, storage, token or scheduler exists
here. Legacy P1 grammar and authorization remain unchanged.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from importlib.resources import files
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator
from jwcrypto import jwe

from .authority import VerifiedRegistry
from .constants import CONTRACT_VERSION, MAX_CARRIER_BYTES, MAX_CONTEXT_BYTES, PRIVATE_BYTE_LIMITS
from .crypto import (
    _private_key,
    _public_key,
    jwk_thumbprint,
    sign_jws,
    signing_input_fingerprint,
    verify_jws,
)
from .errors import ContractError
from .jsonutil import b64url_decode, canonical_json, strict_json_loads
from .persistent_agents import _agent_keys, _identity, _owner_context
from .private import _resource, _result, _task
from .schema import load_schema, safe_https_url, validate_schema

CONTENT_PROFILE = "folioview.persistent-content.v1"
CONTENT_JWE_HEADER = {
    "alg": "ECDH-ES+A256KW",
    "enc": "A256GCM",
    "typ": "fv-persistent-private+jwe",
    "cty": "application/json",
}
MAX_REQUEST_SECONDS = 120
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
_SCHEMA_NAMES = frozenset(
    {
        "PersistentContentRecipient",
        "PersistentTaskContext",
        "PersistentResourceContext",
        "PersistentResultContext",
        "PersistentContentContext",
        "PersistentContentProofPayload",
        "PersistentContentCarrier",
        "PersistentPrivatePayload",
        "PersistentAgentRequestPayload",
        "PersistentRunInput",
        "PersistentRunManifest",
    }
)
_ALGORITHMS = ["ECDH-ES+A256KW", "A256GCM"]


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


@lru_cache(maxsize=1)
def _document():
    extension = json.loads(files(__package__).joinpath("persistent_content.json").read_text())
    legacy = load_schema("Identifier")
    if set(extension["$defs"]) & set(legacy["$defs"]):
        raise RuntimeError("Persistent content schema collision")
    extension["$defs"] = {**legacy["$defs"], **extension["$defs"]}
    Draft202012Validator.check_schema(extension)
    return extension


def load_content_schema(name):
    if type(name) is not str or name not in _SCHEMA_NAMES:
        raise ContractError("malformed_request")
    result = copy.deepcopy(_document())
    result["$ref"] = "#/$defs/" + name
    return result


@lru_cache(maxsize=16)
def _validator(name):
    return Draft202012Validator(load_content_schema(name))


def validate_content_schema(name, value):
    try:
        maximum = (
            MAX_CARRIER_BYTES
            if name == "PersistentContentCarrier"
            else (196608 if name == "PersistentPrivatePayload" else MAX_CONTEXT_BYTES)
        )
        if len(canonical_json(value)) > maximum:
            raise ContractError("payload_too_large")
        if next(_validator(name).iter_errors(value), None) is not None:
            raise ContractError("malformed_request")
        return strict_json_loads(canonical_json(value), max_bytes=maximum)
    except (TypeError, ValueError, RecursionError) as error:
        if isinstance(error, ContractError):
            raise
        raise ContractError("malformed_request") from None


def validate_content_context(value):
    value = validate_content_schema("PersistentContentContext", value)
    if value["revision"] != value["expectedRevision"] + 1:
        raise ContractError("version_conflict")
    recipients = value["recipients"]
    ids = [r["keyId"] for r in recipients]
    if ids != sorted(set(ids)):
        raise ContractError("recipient_binding_mismatch")
    kind = value["objectType"]
    if kind == "result_revision":
        if any(r["role"] not in {"device_enc", "recovery_enc"} for r in recipients) or not any(
            r["role"] == "recovery_enc" for r in recipients
        ):
            raise ContractError("recipient_binding_mismatch")
    else:
        agent = [r for r in recipients if r["role"] == "agent_enc"]
        owner = [r for r in recipients if r["role"] == "recovery_enc"]
        if (
            len(recipients) != 2
            or len(owner) != 1
            or agent != [{"keyId": value["agentEncryptionKeyId"], "role": "agent_enc"}]
        ):
            raise ContractError("recipient_binding_mismatch")
    if kind == "task":
        if value["objectId"] != value["taskId"] or value["revision"] != value["taskVersion"]:
            raise ContractError("recipient_binding_mismatch")
        if value["authorityVersion"] != value["expectedAuthorityVersion"] + 1 or (
            (value["expectedAuthorityVersion"] == 0) != (value["expectedAuthorityDigest"] is None)
        ):
            raise ContractError("version_conflict")
        refs = [canonical_json(x["ref"]) for x in value["resourceBindings"]]
        if len(refs) != len(set(refs)) or any(
            item["ref"]["sourceService"]
            != ("portfolio" if item["ref"]["kind"] == "holdings" else "user")
            for item in value["resourceBindings"]
        ):
            raise ContractError("recipient_binding_mismatch")
    elif kind != "result_revision":
        expected = {
            "holdings_snapshot": "holdings",
            "watchlist_evidence": "watchlist",
            "channel_follows_evidence": "channel_follows",
        }[kind]
        if (
            value["ref"]["kind"] != expected
            or value["sourceRevision"] != value["revision"]
            or value["ref"]["sourceService"] != ("portfolio" if expected == "holdings" else "user")
        ):
            raise ContractError("recipient_binding_mismatch")
    return value


def validate_persistent_private(value, *, context):
    try:
        context = validate_content_context(context)
        value = validate_content_schema("PersistentPrivatePayload", value)
        if any(value[k] != context[k] for k in ("objectId", "objectType", "revision")):
            raise ContractError("private_schema_invalid")
        if len(canonical_json(value)) > PRIVATE_BYTE_LIMITS[context["objectType"]]:
            raise ContractError("private_schema_invalid")
        payload = validate_schema(
            "TaskContent"
            if value["objectType"] == "task"
            else "ResultContent"
            if value["objectType"] == "result_revision"
            else "ResourceContent",
            value["payload"],
        )
        if value["objectType"] == "task":
            _task(payload, {"resourceBindings": context["resourceBindings"]})
        elif value["objectType"] == "result_revision":
            _result(payload)
        else:
            _resource(
                payload,
                {
                    "objectType": context["objectType"],
                    "objectId": context["objectId"],
                    "binding": {"resourceRef": context["ref"]},
                },
            )
        return value
    except (ContractError, KeyError, TypeError, ValueError):
        raise ContractError("private_schema_invalid") from None


def validate_persistent_jwe(encrypted, *, context):
    context = validate_content_context(context)
    validate_schema("JWE", encrypted)
    if (
        strict_json_loads(b64url_decode(encrypted["protected"], max_bytes=1024), max_bytes=1024)
        != CONTENT_JWE_HEADER
    ):
        raise ContractError("unsupported_profile")
    if b64url_decode(encrypted["aad"], max_bytes=MAX_CONTEXT_BYTES) != canonical_json(context):
        raise ContractError("recipient_binding_mismatch")
    b64url_decode(encrypted["iv"], exact_bytes=12)
    b64url_decode(encrypted["tag"], exact_bytes=16)
    b64url_decode(encrypted["ciphertext"], max_bytes=PRIVATE_BYTE_LIMITS[context["objectType"]])
    if [r["header"]["kid"] for r in encrypted["recipients"]] != [
        r["keyId"] for r in context["recipients"]
    ]:
        raise ContractError("recipient_binding_mismatch")
    for recipient in encrypted["recipients"]:
        _public_key(recipient["header"]["epk"])
        b64url_decode(recipient["encrypted_key"], exact_bytes=40)
    return encrypted


def seal_persistent_content(
    private_payload, recipient_public_keys, *, context, signing_private_key
):
    """Trusted client only. Never expose signing/decryption as a remote API."""
    context = validate_content_context(context)
    value = validate_persistent_private(private_payload, context=context)
    expected = [r["keyId"] for r in context["recipients"]]
    if set(recipient_public_keys) != set(expected):
        raise ContractError("recipient_binding_mismatch")
    signing = _private_key(signing_private_key)
    required = (
        context["agentSigningKeyId"]
        if context["objectType"] == "result_revision"
        else context["rootKeyId"]
    )
    if signing.thumbprint() != required:
        raise ContractError("key_authorization_required")
    try:
        message = jwe.JWE(
            canonical_json(value),
            protected=canonical_json(CONTENT_JWE_HEADER).decode(),
            aad=canonical_json(context),
            algs=_ALGORITHMS,
        )
        for kid in expected:
            key = _public_key(recipient_public_keys[kid])
            if key.thumbprint() != kid:
                raise ContractError("recipient_binding_mismatch")
            message.add_recipient(key, header={"kid": kid})
        encrypted = strict_json_loads(message.serialize(compact=False), max_bytes=MAX_CARRIER_BYTES)
        if "recipients" not in encrypted:
            encrypted["recipients"] = [
                {"header": encrypted.pop("header"), "encrypted_key": encrypted.pop("encrypted_key")}
            ]
    except ContractError:
        raise
    except Exception:
        raise ContractError("invalid_envelope") from None
    validate_persistent_jwe(encrypted, context=context)
    proof = sign_jws(
        {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "artifactType": "persistent_content_publication",
            "context": context,
            "ciphertextDigest": digest(encrypted),
        },
        signing,
        typ="fv-control+jws",
    )
    return validate_content_schema(
        "PersistentContentCarrier",
        {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "proof": proof,
            "jwe": encrypted,
        },
    )


def open_persistent_content(encrypted, private_key, *, context):
    """Trusted endpoint after verifying the proof and current/historical purpose."""
    context = validate_content_context(context)
    validate_persistent_jwe(encrypted, context=context)
    key = _private_key(private_key)
    if key.thumbprint() not in {r["keyId"] for r in context["recipients"]}:
        raise ContractError("decryption_failed")
    try:
        message = jwe.JWE(algs=_ALGORITHMS)
        message.deserialize(json.dumps(encrypted))
        message.decrypt(key)
        value = strict_json_loads(
            message.payload, max_bytes=PRIVATE_BYTE_LIMITS[context["objectType"]]
        )
    except Exception:
        raise ContractError("decryption_failed") from None
    return validate_persistent_private(value, context=context)


@dataclass(frozen=True)
class PersistentEnvelopeExpectation:
    owner_subject: str
    vault_id: str
    connection_id: str
    client_id: str
    object_type: str
    object_id: str
    revision: int
    recipient_key_ids: tuple[str, ...]
    bindings: Mapping
    _bindings_bytes: bytes = field(init=False, repr=False)

    def __post_init__(self):
        object.__setattr__(self, "_bindings_bytes", canonical_json(dict(self.bindings)))
        object.__setattr__(self, "recipient_key_ids", tuple(self.recipient_key_ids))


@dataclass(frozen=True)
class VerifiedPersistentEnvelope:
    _carrier: bytes
    _context: bytes
    fingerprint: str

    @property
    def carrier(self):
        return strict_json_loads(self._carrier, max_bytes=MAX_CARRIER_BYTES)

    @property
    def context(self):
        return strict_json_loads(self._context, max_bytes=MAX_CONTEXT_BYTES)


def inspect_persistent_carrier(value):
    """Detached structural parse only; no signer or business authority claim."""
    from .crypto import _signed_parts

    value = validate_content_schema("PersistentContentCarrier", value)
    _, payload = _signed_parts(value["proof"], max_bytes=65536)
    validate_content_schema("PersistentContentProofPayload", payload)
    context = validate_content_context(payload["context"])
    if payload["ciphertextDigest"] != digest(value["jwe"]):
        raise ContractError("recipient_binding_mismatch")
    validate_persistent_jwe(value["jwe"], context=context)
    return value, context


def verify_persistent_carrier(
    value, *, registry, root_jwk, current_identity, expectation, now, purpose="new_publication"
):
    """One public integrity snapshot, not resource/Run authority or a cache.

    owner_history is trusted-client-only and requires an independently verified
    historical registry/identity and immutable owner Run/receipt expectations.
    Never select this purpose from a request or use it for a current operation.
    """
    if (
        not isinstance(registry, VerifiedRegistry)
        or not isinstance(expectation, PersistentEnvelopeExpectation)
        or purpose not in {"new_publication", "agent_read", "owner_history"}
    ):
        raise ContractError("key_authorization_required")
    if jwk_thumbprint(root_jwk) != registry.root_key_id:
        raise ContractError("recipient_binding_mismatch")
    value, context = inspect_persistent_carrier(value)
    expected = _owner_context(
        registry,
        owner_subject=expectation.owner_subject,
        vault_id=expectation.vault_id,
        connection_id=expectation.connection_id,
        client_id=expectation.client_id,
        now=now,
    )
    identity = _identity(current_identity, expected, now)
    if identity["status"] != "active":
        raise ContractError("key_authorization_required")
    bindings = strict_json_loads(expectation._bindings_bytes)
    if set(bindings) & (set(BINDING_FIELDS) | {"objectType", "objectId", "revision", "recipients"}):
        raise ContractError("malformed_request")
    task_fields = {"taskId", "taskVersion", "executionEpoch", "authorityId", "authorityVersion"}
    required = (
        task_fields
        | {
            "expectedAuthorityVersion",
            "expectedAuthorityDigest",
            "resultPolicy",
            "ownerTaskFingerprint",
            "resourceBindings",
        }
        if expectation.object_type == "task"
        else task_fields | {"runId", "manifestFingerprint"}
        if expectation.object_type == "result_revision"
        else {"ref", "sourceEpoch", "sourceRevision", "permissionId", "permissionEpoch"}
    )
    optional = (
        {"ownerEnvelopeFingerprint"}
        if expectation.object_type not in {"task", "result_revision"}
        else set()
    )
    if not required <= set(bindings) or set(bindings) - required - optional:
        raise ContractError("malformed_request")
    bound = {
        **{k: identity[k] for k in BINDING_FIELDS},
        "objectType": expectation.object_type,
        "objectId": expectation.object_id,
        "revision": expectation.revision,
        **bindings,
    }
    if any(canonical_json(context.get(k)) != canonical_json(v) for k, v in bound.items()) or [
        r["keyId"] for r in context["recipients"]
    ] != list(expectation.recipient_key_ids):
        raise ContractError("recipient_binding_mismatch")
    if (
        registry.checkpoint_history.get(context["registrySequence"]) != context["checkpointDigest"]
        or context["keyEpoch"] > registry.key_epoch
    ):
        raise ContractError("registry_conflict")
    if not identity["registeredAt"] <= context["issuedAt"] <= now:
        raise ContractError("key_authorization_required")
    if purpose == "new_publication" and (
        context["registrySequence"] != registry.registry_sequence
        or context["checkpointDigest"] != registry.checkpoint_digest
        or context["keyEpoch"] != registry.key_epoch
        or context["issuedAt"] < max(registry.issued_at, now - 300)
    ):
        raise ContractError("registry_conflict")
    # Historical owner reads pass an independently selected issuance snapshot.
    when = context["issuedAt"] if purpose == "owner_history" else now
    signing = _agent_keys(identity, registry, when)
    if context["objectType"] == "result_revision":
        if (
            "result_write" not in signing["capabilities"]
            or context["issuedAt"] < signing["notBefore"]
        ):
            raise ContractError("key_authorization_required")
        author, kid = signing["publicJwk"], signing["keyId"]
        for recipient in context["recipients"]:
            registry.cert(recipient["keyId"], role=recipient["role"], connection_id=None, now=when)
    else:
        author, kid = root_jwk, registry.root_key_id
        if purpose in {"new_publication", "owner_history"}:
            for recipient in context["recipients"]:
                if recipient["role"] == "recovery_enc":
                    registry.cert(
                        recipient["keyId"], role="recovery_enc", connection_id=None, now=when
                    )
    payload = verify_jws(value["proof"], author, typ="fv-control+jws", expected_kid=kid)
    validate_content_schema("PersistentContentProofPayload", payload)
    if payload["ciphertextDigest"] != digest(value["jwe"]):
        raise ContractError("recipient_binding_mismatch")
    validate_persistent_jwe(value["jwe"], context=context)
    return VerifiedPersistentEnvelope(
        canonical_json(value), canonical_json(context), signing_input_fingerprint(value["proof"])
    )


def verify_persistent_request(
    signed,
    *,
    registry,
    current_identity,
    owner_subject,
    vault_id,
    connection_id,
    client_id,
    audience,
    method,
    path,
    body,
    now,
):
    """Authenticate one fixed request. Writers still enforce original-op CAS.

    A signed nonce/time window is not one-use storage, task/Run/resource authority,
    current consent, or permission to derive expectations from the incoming proof.
    """
    if not safe_https_url(audience) or urlsplit(audience).query or urlsplit(audience).fragment:
        raise ContractError("authorization_unavailable")
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
    cert = _agent_keys(identity, registry, now)
    payload = verify_jws(
        signed, cert["publicJwk"], typ="fv-control+jws", expected_kid=cert["keyId"]
    )
    payload = validate_content_schema("PersistentAgentRequestPayload", payload)
    if any(payload[k] != identity[k] for k in BINDING_FIELDS) or (
        payload["audience"],
        payload["method"],
        payload["path"],
        payload["bodyDigest"],
    ) != (audience, method, path, digest(body)):
        raise ContractError("recipient_binding_mismatch")
    if (
        "//" in path
        or not max(identity["registeredAt"], cert["notBefore"])
        <= payload["issuedAt"]
        <= now
        < payload["expiresAt"]
        <= payload["issuedAt"] + MAX_REQUEST_SECONDS
    ):
        raise ContractError("key_authorization_required")
    b64url_decode(payload["nonce"], exact_bytes=32)
    return payload


def persistent_run_id(*, owner_subject, vault_id, task_id, trigger_id):
    for value in (owner_subject, vault_id, task_id):
        validate_schema("Identifier", value)
    validate_schema("OperationIdentifier", trigger_id)
    return "prun_" + digest([owner_subject, vault_id, task_id, trigger_id])


def validate_persistent_manifest(value):
    value = validate_content_schema("PersistentRunManifest", value)
    if not value["createdAt"] < value["expiresAt"] <= value["createdAt"] + 7200:
        raise ContractError("malformed_request")
    if value["runId"] != persistent_run_id(
        owner_subject=value["ownerSubject"],
        vault_id=value["vaultId"],
        task_id=value["taskId"],
        trigger_id=value["triggerId"],
    ):
        raise ContractError("recipient_binding_mismatch")
    refs = [canonical_json(item["ref"]) for item in value["inputs"]]
    if refs != sorted(set(refs)):
        raise ContractError("recipient_binding_mismatch")
    for item in value["inputs"]:
        if item["ref"]["sourceService"] != (
            "portfolio" if item["ref"]["kind"] == "holdings" else "user"
        ):
            raise ContractError("recipient_binding_mismatch")
    return value


def persistent_manifest_fingerprint(value):
    return digest(validate_persistent_manifest(value))
