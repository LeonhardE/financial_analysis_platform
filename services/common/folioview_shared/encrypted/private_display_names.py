"""Owner-only encrypted source aliases; no source update, grant or registry append.

Pure compatibility foundation. Consumers supply current Owner/vault/resource
ownership and registry transaction reads and atomically store CAS + original
operation receipts. Encryption/decryption are trusted-client primitives only.
"""

from __future__ import annotations

import copy
import hashlib
import json
import unicodedata
from functools import lru_cache
from importlib.resources import files

from jsonschema import Draft202012Validator
from jwcrypto import jwe

from .authority import VerifiedRegistry
from .constants import CONTRACT_VERSION
from .crypto import _private_key, _public_key, signing_input_fingerprint
from .errors import ContractError
from .jsonutil import b64url_decode, b64url_encode, canonical_json, strict_json_loads
from .persistent_agents import _device_control, _integer, _match
from .schema import load_schema

DISPLAY_NAME_PROFILE = "folioview.private-display-name.v1"
MAX_DISPLAY_COMMAND_BYTES = 12288
MAX_DISPLAY_ENVELOPE_BYTES = 8192
MAX_DISPLAY_HTTP_BYTES = 16384
_CONTEXT_FIELDS = (
    "contractVersion",
    "profile",
    "ownerSubject",
    "vaultId",
    "rootKeyId",
    "ref",
    "purpose",
    "revision",
    "stableOperationId",
    "recipientKeyId",
)
_BASE_FIELDS = _CONTEXT_FIELDS[:6]
_NAMES = frozenset(
    {
        "DisplayNameContext",
        "DisplayNameEnvelope",
        "DisplayNameControl",
        "DisplayNameState",
        "DisplayNamePrivate",
    }
)
_HEADER = {
    "alg": "ECDH-ES+A256KW",
    "enc": "A256GCM",
    "typ": "fv-owner-display-name+jwe",
    "cty": "application/json",
}
_ALGORITHMS = ["ECDH-ES+A256KW", "A256GCM"]


@lru_cache(maxsize=1)
def _document():
    doc = json.loads(files(__package__).joinpath("private_display_names.json").read_text())
    legacy = load_schema("Identifier")["$defs"]
    if set(doc["$defs"]) & set(legacy):
        raise RuntimeError("Display-name schema collision")
    doc["$defs"] = {**legacy, **doc["$defs"]}
    Draft202012Validator.check_schema(doc)
    return doc


def load_display_name_schema(name):
    if type(name) is not str or name not in _NAMES:
        raise ContractError("malformed_request")
    doc = copy.deepcopy(_document())
    doc["$ref"] = "#/$defs/" + name
    return doc


@lru_cache(maxsize=8)
def _validator(name):
    return Draft202012Validator(load_display_name_schema(name))


def validate_display_name_schema(name, value):
    try:
        if len(canonical_json(value)) > MAX_DISPLAY_COMMAND_BYTES:
            raise ContractError("payload_too_large")
        if next(_validator(name).iter_errors(value), None) is not None:
            raise ContractError("malformed_request")
        return copy.deepcopy(value)
    except ContractError:
        raise
    except (TypeError, ValueError, RecursionError):
        raise ContractError("malformed_request") from None


def display_name_context(control):
    try:
        return validate_display_name_schema(
            "DisplayNameContext", {k: control[k] for k in _CONTEXT_FIELDS}
        )
    except (KeyError, TypeError):
        raise ContractError("malformed_request") from None


def _digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def display_name_id(context):
    """Immutable Owner/vault/ref/incarnation slot, not an authorization proof."""
    context = display_name_context(context)
    return "display_" + _digest({k: context[k] for k in _BASE_FIELDS})


def validate_display_name_state(value, *, context):
    state = validate_display_name_schema("DisplayNameState", value)
    _match(state, {k: display_name_context(context)[k] for k in _BASE_FIELDS})
    return state


def validate_display_name_envelope(value, *, context):
    context = display_name_context(context)
    value = validate_display_name_schema("DisplayNameEnvelope", value)
    if len(canonical_json(value)) > MAX_DISPLAY_ENVELOPE_BYTES:
        raise ContractError("payload_too_large")
    header = strict_json_loads(b64url_decode(value["protected"], max_bytes=1024), max_bytes=1024)
    if type(header) is not dict or {k: v for k, v in header.items() if k != "epk"} != _HEADER:
        raise ContractError("unsupported_profile")
    recipient_header = value["recipients"][0]["header"]
    # Both standard JOSE placements are interoperable; never two competing keys.
    if ("epk" in header) == ("epk" in recipient_header):
        raise ContractError("invalid_envelope")
    ephemeral = header.get("epk", recipient_header.get("epk"))
    if value["aad"] != b64url_encode(canonical_json(context)):
        raise ContractError("recipient_binding_mismatch")
    if value["recipients"][0]["header"]["kid"] != context["recipientKeyId"]:
        raise ContractError("recipient_binding_mismatch")
    # Decode all fields canonically and enforce decoded AEAD/key-wrap sizes.
    for name, maximum, length in [("iv", 12, 12), ("tag", 16, 16), ("ciphertext", 1536, None)]:
        raw = b64url_decode(value[name], max_bytes=maximum)
        if length is not None and len(raw) != length:
            raise ContractError("invalid_envelope")
    wrapped = b64url_decode(value["recipients"][0]["encrypted_key"], max_bytes=40)
    if len(wrapped) != 40:
        raise ContractError("invalid_envelope")
    _public_key(ephemeral)
    return value


def _private(value, context):
    value = validate_display_name_schema("DisplayNamePrivate", value)
    name = value["displayName"]
    if (
        value["contextDigest"] != _digest(context)
        or name != name.strip()
        or len(name.encode("utf-8")) > 320
        or any(unicodedata.category(c).startswith("C") for c in name)
    ):
        raise ContractError("private_schema_invalid")
    return value


def encrypt_display_name(name, recipient_public_jwk, *, context):
    """Trusted Owner Worker primitive; one Owner recovery recipient, never an Agent."""
    context = display_name_context(context)
    public = _public_key(recipient_public_jwk)
    if public.thumbprint() != context["recipientKeyId"]:
        raise ContractError("recipient_binding_mismatch")
    payload = _private(
        {
            "contractVersion": CONTRACT_VERSION,
            "profile": DISPLAY_NAME_PROFILE,
            "purpose": "owner_display_name",
            "contextDigest": _digest(context),
            "displayName": name,
        },
        context,
    )
    try:
        message = jwe.JWE(
            canonical_json(payload),
            protected=canonical_json(_HEADER).decode(),
            aad=canonical_json(context),
            algs=_ALGORITHMS,
        )
        message.add_recipient(public, header={"kid": context["recipientKeyId"]})
        value = strict_json_loads(
            message.serialize(compact=False), max_bytes=MAX_DISPLAY_ENVELOPE_BYTES
        )
        if "recipients" not in value:
            value["recipients"] = [
                {"header": value.pop("header"), "encrypted_key": value.pop("encrypted_key")}
            ]
        return validate_display_name_envelope(value, context=context)
    except ContractError:
        raise
    except Exception:
        raise ContractError("invalid_envelope") from None


def decrypt_display_name(value, recipient_private_jwk, *, context):
    """Authenticate original control/registry first; this primitive proves only AEAD."""
    context = display_name_context(context)
    value = validate_display_name_envelope(value, context=context)
    key = _private_key(recipient_private_jwk)
    if key.thumbprint() != context["recipientKeyId"]:
        raise ContractError("recipient_binding_mismatch")
    try:
        message = jwe.JWE(algs=_ALGORITHMS)
        message.deserialize(json.dumps(value))
        message.decrypt(key)
        payload = strict_json_loads(message.payload, max_bytes=1024)
        return _private(payload, context)["displayName"]
    except ContractError:
        raise
    except Exception:
        raise ContractError("decryption_failed") from None


def verify_display_name_control(signed, *, registry, owner_subject, vault_id, resource_ref, now):
    _integer(now)
    if not isinstance(registry, VerifiedRegistry):
        raise ContractError("key_authorization_required")
    if (registry.owner_subject, registry.vault_id) != (owner_subject, vault_id):
        raise ContractError("recipient_binding_mismatch")
    if len(canonical_json(signed)) > MAX_DISPLAY_COMMAND_BYTES:
        raise ContractError("payload_too_large")
    p = _device_control(
        signed, registry, "DisplayNameControl", now, validator=validate_display_name_schema
    )
    _match(
        p,
        {
            "ownerSubject": owner_subject,
            "vaultId": vault_id,
            "rootKeyId": registry.root_key_id,
            "ref": resource_ref,
        },
    )
    if p["revision"] != p["expectedRevision"] + 1 or (
        (p["expectedRevision"] == 0) != (p["previousFingerprint"] is None)
    ):
        raise ContractError("version_conflict")
    registry.cert(p["recipientKeyId"], role="recovery_enc", connection_id=None, now=now)
    validate_display_name_envelope(p["envelope"], context=p)
    return p


def plan_display_name_update(
    signed, *, registry, owner_subject, vault_id, resource_ref, current_state=None, now
):
    """Caller must atomically CAS this independent state and persist original receipt."""
    p = verify_display_name_control(
        signed,
        registry=registry,
        owner_subject=owner_subject,
        vault_id=vault_id,
        resource_ref=resource_ref,
        now=now,
    )
    state = (
        validate_display_name_state(current_state, context=p) if current_state is not None else None
    )
    if (p["expectedRevision"], p["previousFingerprint"]) != (
        state["revision"] if state else 0,
        state["operationFingerprint"] if state else None,
    ):
        raise ContractError("version_conflict")
    return validate_display_name_schema(
        "DisplayNameState",
        {
            **{k: p[k] for k in _BASE_FIELDS},
            "revision": p["revision"],
            "stableOperationId": p["stableOperationId"],
            "recipientKeyId": p["recipientKeyId"],
            "operationFingerprint": signing_input_fingerprint(signed),
            "acceptedAt": now,
        },
    )


def check_display_name_replay(state, signed, *, context):
    """Only compare a previously admitted receipt; never bypass current authorization."""
    state = validate_display_name_state(state, context=context)
    if any(
        state[k] != display_name_context(context)[k]
        for k in ("stableOperationId", "revision", "recipientKeyId")
    ):
        raise ContractError("idempotency_conflict")
    if state["operationFingerprint"] != signing_input_fingerprint(signed):
        raise ContractError("idempotency_conflict")
    return state
