"""P1 JOSE primitives for trusted clients and public-only server verification.

No network, storage, key generation or key resolution is performed here. Private
operations are library calls for trusted endpoints, never agent tool/HTTP APIs.
JOSE implements ECDH Concat KDF, AES key wrap, GCM, randomness and ES256.
"""

import hashlib
import json
from collections.abc import Mapping
from typing import Any

from cryptography.hazmat.primitives.asymmetric import ec
from jwcrypto import jwe, jwk, jws

from .constants import (
    JWE_HEADER,
    MAX_CARRIER_BYTES,
    MAX_CONTEXT_BYTES,
    MAX_CONTROL_BYTES,
    PRIVATE_BYTE_LIMITS,
)
from .errors import ContractError
from .jsonutil import b64url_decode, canonical_json, strict_json_loads
from .schema import validate_schema

_TYPES = frozenset({"fv-object+jws", "fv-control+jws"})
_ALGORITHMS = ["ECDH-ES+A256KW", "A256GCM"]


def _public_key(value: dict) -> jwk.JWK:
    try:
        if type(value) is not dict or set(value) != {"kty", "crv", "x", "y"}:
            raise ValueError
        if value["kty"] != "EC" or value["crv"] != "P-256":
            raise ValueError
        x = b64url_decode(value["x"], exact_bytes=32)
        y = b64url_decode(value["y"], exact_bytes=32)
        ec.EllipticCurvePublicNumbers(
            int.from_bytes(x, "big"), int.from_bytes(y, "big"), ec.SECP256R1()
        ).public_key()
        return jwk.JWK(**value)
    except Exception:
        raise ContractError("invalid_envelope") from None


def jwk_thumbprint(public_jwk: dict) -> str:
    """RFC 7638 SHA-256 thumbprint; reject private fields and invalid curve points."""
    return _public_key(public_jwk).thumbprint()


def _private_key(value: jwk.JWK | dict) -> jwk.JWK:
    try:
        key = value if isinstance(value, jwk.JWK) else jwk.JWK(**value)
        if key.get("kty") != "EC" or key.get("crv") != "P-256" or not key.has_private:
            raise ValueError
        public = key.export(private_key=False, as_dict=True)
        _public_key({k: public[k] for k in ("kty", "crv", "x", "y")})
        return key
    except Exception:
        raise ContractError("untrusted_key") from None


def _signed_parts(signed: dict, *, max_bytes: int = MAX_CARRIER_BYTES) -> tuple:
    if type(signed) is not dict or set(signed) != {"protected", "payload", "signature"}:
        raise ContractError("invalid_envelope")
    if len(canonical_json(signed)) > max_bytes:
        raise ContractError("payload_too_large")
    header = strict_json_loads(b64url_decode(signed["protected"], max_bytes=1024), max_bytes=1024)
    if type(header) is not dict or set(header) != {"alg", "kid", "typ", "cty"}:
        raise ContractError("invalid_envelope")
    if (
        header["alg"] != "ES256"
        or header["typ"] not in _TYPES
        or header["cty"] != "application/json"
    ):
        raise ContractError("unsupported_profile")
    b64url_decode(header["kid"], exact_bytes=32)
    b64url_decode(signed["signature"], exact_bytes=64)
    raw = b64url_decode(signed["payload"], max_bytes=max_bytes)
    payload = strict_json_loads(raw, max_bytes=max_bytes)
    if canonical_json(payload) != raw or type(payload) is not dict:
        raise ContractError("invalid_envelope")
    return header, payload


def verify_jws(
    signed: dict, public_jwk: dict, *, typ: str, expected_kid: str | None = None
) -> dict:
    """Verify a flattened ES256 JWS against a caller-selected, independently trusted key."""
    if typ not in _TYPES:
        raise ContractError("unsupported_profile")
    maximum = MAX_CONTROL_BYTES if typ == "fv-control+jws" else MAX_CARRIER_BYTES
    header, payload = _signed_parts(signed, max_bytes=maximum)
    key = _public_key(public_jwk)
    kid = key.thumbprint()
    if header["typ"] != typ or header["kid"] != kid or expected_kid not in (None, kid):
        raise ContractError("invalid_signature")
    try:
        message = jws.JWS()
        message.allowed_algs = ["ES256"]
        message.deserialize(json.dumps(signed))
        message.verify(key, alg="ES256")
    except Exception:
        raise ContractError("invalid_signature") from None
    return payload


def sign_jws(payload: dict, private_key: jwk.JWK | dict, *, typ: str) -> dict:
    """Trusted-endpoint primitive. Never expose this function as a remote capability."""
    if typ not in _TYPES:
        raise ContractError("unsupported_profile")
    key = _private_key(private_key)
    maximum = MAX_CONTROL_BYTES if typ == "fv-control+jws" else MAX_CARRIER_BYTES
    raw = canonical_json(payload)
    if type(payload) is not dict or len(raw) > maximum:
        raise ContractError("payload_too_large")
    header = {"alg": "ES256", "kid": key.thumbprint(), "typ": typ, "cty": "application/json"}
    try:
        message = jws.JWS(raw)
        message.allowed_algs = ["ES256"]
        message.add_signature(key, protected=canonical_json(header).decode("utf-8"))
        result = strict_json_loads(message.serialize(compact=False), max_bytes=maximum)
    except ContractError:
        raise
    except Exception:
        raise ContractError("invalid_signature") from None
    _signed_parts(result, max_bytes=maximum)
    return result


def signing_input_fingerprint(signed: dict) -> str:
    """Ciphertext operation identity, not signature identity or proof of authorization.

    Consumers must verify the JWS before trusting this value. Signature bytes are
    excluded so valid ES256 high/low-S variants have the same operation identity.
    """
    _signed_parts(signed)
    return hashlib.sha256(
        (signed["protected"] + "." + signed["payload"]).encode("ascii")
    ).hexdigest()


def validate_jwe(encrypted: dict, *, context: dict) -> dict:
    """Structural public checks only. This does not validate an AEAD tag or plaintext."""
    validate_schema("Context", context)
    validate_schema("JWE", encrypted)
    encoded_context = canonical_json(context)
    if len(encoded_context) > MAX_CONTEXT_BYTES:
        raise ContractError("payload_too_large")
    header = strict_json_loads(
        b64url_decode(encrypted["protected"], max_bytes=1024), max_bytes=1024
    )
    if header != dict(JWE_HEADER):
        raise ContractError("unsupported_profile")
    if b64url_decode(encrypted["aad"], max_bytes=MAX_CONTEXT_BYTES) != encoded_context:
        raise ContractError("recipient_binding_mismatch")
    b64url_decode(encrypted["iv"], exact_bytes=12)
    b64url_decode(encrypted["tag"], exact_bytes=16)
    b64url_decode(encrypted["ciphertext"], max_bytes=PRIVATE_BYTE_LIMITS[context["objectType"]])
    expected = [r["keyId"] for r in context["recipients"]]
    if expected != sorted(set(expected)):
        raise ContractError("recipient_binding_mismatch")
    if [r["header"]["kid"] for r in encrypted["recipients"]] != expected:
        raise ContractError("recipient_binding_mismatch")
    for recipient in encrypted["recipients"]:
        _public_key(recipient["header"]["epk"])
        b64url_decode(recipient["encrypted_key"], exact_bytes=40)
    return encrypted


def encrypt_jwe(
    private_payload: dict, recipient_public_keys: Mapping[str, dict], *, context: dict
) -> dict:
    """Trusted client encryption using fresh library-managed CEK/IV/ephemeral keys."""
    from .private import validate_private_payload

    validate_private_payload(private_payload, context=context)
    validate_schema("Context", context)
    expected = [r["keyId"] for r in context["recipients"]]
    if expected != sorted(set(expected)) or set(expected) != set(recipient_public_keys):
        raise ContractError("recipient_binding_mismatch")
    raw = canonical_json(private_payload)
    aad = canonical_json(context)
    if len(raw) > PRIVATE_BYTE_LIMITS[context["objectType"]] or len(aad) > MAX_CONTEXT_BYTES:
        raise ContractError("payload_too_large")
    try:
        message = jwe.JWE(
            raw, protected=canonical_json(dict(JWE_HEADER)).decode(), aad=aad, algs=_ALGORITHMS
        )
        for kid in expected:
            key = _public_key(recipient_public_keys[kid])
            if key.thumbprint() != kid:
                raise ContractError("recipient_binding_mismatch")
            message.add_recipient(key, header={"kid": kid})
        result = strict_json_loads(message.serialize(compact=False), max_bytes=MAX_CARRIER_BYTES)
        # jwcrypto serializes a single recipient in flattened form; our wire uses
        # General JSON for every cardinality, before the outer signature is made.
        if "recipients" not in result:
            result["recipients"] = [
                {"header": result.pop("header"), "encrypted_key": result.pop("encrypted_key")}
            ]
    except ContractError:
        raise
    except Exception:
        raise ContractError("invalid_envelope") from None
    return validate_jwe(result, context=context)


def decrypt_jwe(encrypted: dict, recipient_private_jwk: Any, *, context: dict) -> dict:
    """Trusted endpoint only; callers authenticate the outer JWS and authority first."""
    from .private import validate_private_payload

    validate_jwe(encrypted, context=context)
    key = _private_key(recipient_private_jwk)
    if key.thumbprint() not in {r["keyId"] for r in context["recipients"]}:
        raise ContractError("decryption_failed")
    try:
        message = jwe.JWE(algs=_ALGORITHMS)
        message.deserialize(json.dumps(encrypted))
        message.decrypt(key)
        result = strict_json_loads(
            message.payload, max_bytes=PRIVATE_BYTE_LIMITS[context["objectType"]]
        )
    except Exception:
        raise ContractError("decryption_failed") from None
    return validate_private_payload(result, context=context)
