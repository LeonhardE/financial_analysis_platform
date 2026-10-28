"""Narrow 60-second owner delegation; production signing stays in an existing KMS key."""

import hashlib
import os
import re
import time
from functools import lru_cache
from urllib.parse import urlsplit
from uuid import uuid4

from folioview_shared.delegation import DELEGATION_TYPE
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json

_EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com\Z")
_KEY = re.compile(
    r"projects/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+/cryptoKeyVersions/[1-9][0-9]*\Z"
)


def origin(value):
    if (
        type(value) is not str
        or not 1 <= len(value) <= 2048
        or any(ord(c) < 33 or ord(c) > 126 for c in value)
        or "\\" in value
    ):
        raise ContractError("authorization_unavailable")
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
            and not parsed.path
            and not parsed.query
            and not parsed.fragment
            and not value.endswith("/")
        )
    except ValueError:
        valid = False
    if not valid:
        raise ContractError("authorization_unavailable")
    return value


def token_configuration():
    issuer = origin(os.getenv("HUB_SERVICE_AUDIENCE", ""))
    caller = os.getenv("HUB_PORTFOLIO_CALLER_EMAIL", "")
    if _EMAIL.fullmatch(caller) is None:
        raise ContractError("authorization_unavailable")
    return issuer, caller


def _number(value):
    return int(value.value if hasattr(value, "value") else value)


class KMSSigner:
    """No private material is exported or read from the environment.

    Only a fixed existing asymmetric key version may sign. Both KMS response
    resource names, SHA256/CRC32C checks and the resulting RSA signature are
    checked. RPCs have no implicit retries and a four-second timeout.
    """

    def __init__(self, key_version, *, client=None, clock=time.monotonic):
        if type(key_version) is not str or _KEY.fullmatch(key_version) is None:
            raise ContractError("authorization_unavailable")
        self.name, self.client, self.clock = key_version, client, clock
        self.kid = "kms_" + hashlib.sha256(key_version.encode()).hexdigest()[:40]
        self.cached = None

    def _client(self):
        if self.client is None:
            from google.cloud import kms_v1

            self.client = kms_v1.KeyManagementServiceClient()
        return self.client

    def _public(self):
        import google_crc32c
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        if self.cached is not None and self.clock() < self.cached[0]:
            return self.cached[1], self.cached[2]
        reply = self._client().get_public_key(request={"name": self.name}, timeout=4, retry=None)
        algorithm = getattr(reply.algorithm, "name", reply.algorithm)
        if reply.name != self.name or algorithm not in {
            "RSA_SIGN_PKCS1_2048_SHA256",
            "RSA_SIGN_PKCS1_3072_SHA256",
            "RSA_SIGN_PKCS1_4096_SHA256",
        }:
            raise ContractError("authorization_unavailable")
        raw = reply.pem.encode()
        if len(raw) > 4096 or google_crc32c.value(raw) != _number(reply.pem_crc32c):
            raise ContractError("authorization_unavailable")
        key = serialization.load_pem_public_key(raw)
        if not isinstance(key, rsa.RSAPublicKey) or key.key_size not in {2048, 3072, 4096}:
            raise ContractError("authorization_unavailable")
        numbers = key.public_numbers()

        def encoded(value):
            return b64url_encode(value.to_bytes((value.bit_length() + 7) // 8, "big"))

        public = {
            "kty": "RSA",
            "n": encoded(numbers.n),
            "e": encoded(numbers.e),
            "kid": self.kid,
            "alg": "RS256",
            "use": "sig",
        }
        self.cached = (self.clock() + 60, key, public)
        return key, public

    def jwks(self):
        try:
            _, public = self._public()
            return {"keys": [dict(public)]}
        except Exception:
            raise ContractError("authorization_unavailable") from None

    def sign(self, claims):
        import google_crc32c
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding

        try:
            key, _ = self._public()
            header = b64url_encode(
                canonical_json({"alg": "RS256", "kid": self.kid, "typ": DELEGATION_TYPE})
            )
            payload = b64url_encode(canonical_json(claims))
            data = (header + "." + payload).encode("ascii")
            digest = hashlib.sha256(data).digest()
            reply = self._client().asymmetric_sign(
                request={
                    "name": self.name,
                    "digest": {"sha256": digest},
                    "digest_crc32c": google_crc32c.value(digest),
                },
                timeout=4,
                retry=None,
            )
            signature = bytes(reply.signature)
            if (
                reply.name != self.name
                or not reply.verified_digest_crc32c
                or google_crc32c.value(signature) != _number(reply.signature_crc32c)
                or len(signature) != key.key_size // 8
            ):
                raise ContractError("authorization_unavailable")
            key.verify(signature, data, padding.PKCS1v15(), hashes.SHA256())
            return header + "." + payload + "." + b64url_encode(signature)
        except Exception:
            raise ContractError("authorization_unavailable") from None


@lru_cache(maxsize=2)
def configured_signer(key_version):
    return KMSSigner(key_version)


def get_signer():
    return configured_signer(os.getenv("HUB_KMS_SIGNING_KEY_VERSION", ""))


def mint_authority_token(uid, signer, *, configuration=None, now=None):
    issuer, caller = configuration or token_configuration()
    origin(issuer)
    if type(caller) is not str or _EMAIL.fullmatch(caller) is None:
        raise ContractError("authorization_unavailable")
    moment = int(time.time()) if now is None else now
    if type(moment) is not int or moment < 0:
        raise ContractError("authorization_unavailable")
    claims = {
        "iss": issuer,
        "aud": issuer + "/internal/v2",
        "sub": uid,
        "iat": moment,
        "exp": moment + 60,
        "jti": uuid4().hex,
        "caller": caller,
        "purpose": "browser_catalog",
        "scopes": ["resources:catalog"],
        "resourceKinds": ["holdings"],
    }
    if (
        type(uid) is not str
        or not 1 <= len(uid) <= 256
        or any(ord(c) < 32 or ord(c) == 127 for c in uid)
    ):
        raise ContractError("authorization_unavailable")
    return {
        "contractVersion": CONTRACT_VERSION,
        "token": signer.sign(claims),
        "expiresAt": moment + 60,
    }
