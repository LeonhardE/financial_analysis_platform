"""Fixed ES256 KMS policy signer and fixed-purpose recovery-key unwrapping."""

import hashlib

from folioview_shared.encrypted.crypto import jwk_thumbprint, verify_jws
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json

from .contracts import Unavailable


def integer(value):
    return int(value.value if hasattr(value, "value") else value)


class KMS:
    def __init__(self, config, *, client=None):
        self.config, self.client = config, client

    def api(self):
        if self.client is None:
            from google.cloud import kms_v1

            self.client = kms_v1.KeyManagementServiceClient()
        return self.client

    def sign(self, payload):
        import google_crc32c
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

        try:
            name = self.config.public["kmsSigningKeyVersion"]
            response = self.api().get_public_key(request={"name": name}, timeout=4, retry=None)
            algorithm = getattr(response.algorithm, "name", response.algorithm)
            if (
                response.name != name
                or algorithm != "EC_SIGN_P256_SHA256"
                or len(response.pem) > 4096
                or google_crc32c.value(response.pem.encode()) != integer(response.pem_crc32c)
            ):
                raise Unavailable
            key = serialization.load_pem_public_key(response.pem.encode())
            if not isinstance(key, ec.EllipticCurvePublicKey) or key.curve.name != "secp256r1":
                raise Unavailable
            point = key.public_numbers()
            public = {
                "kty": "EC",
                "crv": "P-256",
                "x": b64url_encode(point.x.to_bytes(32, "big")),
                "y": b64url_encode(point.y.to_bytes(32, "big")),
            }
            kid = jwk_thumbprint(public)
            if public != self.config.policy_jwk:
                raise Unavailable
            protected = b64url_encode(
                canonical_json(
                    {"alg": "ES256", "kid": kid, "typ": "fv-control+jws", "cty": "application/json"}
                )
            )
            encoded = b64url_encode(canonical_json(payload))
            fingerprint = hashlib.sha256((protected + "." + encoded).encode()).digest()
            reply = self.api().asymmetric_sign(
                request={
                    "name": name,
                    "digest": {"sha256": fingerprint},
                    "digest_crc32c": google_crc32c.value(fingerprint),
                },
                timeout=4,
                retry=None,
            )
            if (
                reply.name != name
                or not reply.verified_digest_crc32c
                or google_crc32c.value(bytes(reply.signature)) != integer(reply.signature_crc32c)
            ):
                raise Unavailable
            r, s = decode_dss_signature(bytes(reply.signature))
            signed = {
                "protected": protected,
                "payload": encoded,
                "signature": b64url_encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")),
            }
            verify_jws(signed, public, typ="fv-control+jws")
            return signed
        except Exception:
            raise Unavailable from None

    def unwrap_recovery_key(self, encrypted, aad_digest):
        """Only the Root-approved stored ciphertext under the configured key/AAD."""
        import google_crc32c

        try:
            ciphertext = b64url_decode(encrypted, max_bytes=8192)
            aad = aad_digest.encode("ascii")
            name = self.config.public["kmsRecoveryKey"]
            reply = self.api().decrypt(
                request={
                    "name": name,
                    "ciphertext": ciphertext,
                    "additional_authenticated_data": aad,
                    "ciphertext_crc32c": google_crc32c.value(ciphertext),
                    "additional_authenticated_data_crc32c": google_crc32c.value(aad),
                },
                timeout=4,
                retry=None,
            )
            secret = bytes(reply.plaintext)
            if len(secret) != 32 or google_crc32c.value(secret) != integer(reply.plaintext_crc32c):
                raise Unavailable
            return secret
        except Exception:
            raise Unavailable from None
