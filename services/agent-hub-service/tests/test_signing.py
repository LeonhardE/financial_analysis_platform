"""Real RSA/JOSE signatures through a bounded synthetic KMS RPC boundary."""

import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import google_crc32c
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa, utils
from fixtures import UID
from test_delegation import ISSUER
from test_service_identity import EMAIL, NOW

from app.signing import KMSSigner, get_signer, mint_authority_token, token_configuration
from folioview_shared.delegated_keys import KeyCache
from folioview_shared.delegation import DELEGATION_TYPE
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.service_identity import verify_signed_jwt

KEY = (
    "projects/synthetic-hub/locations/us-central1/keyRings/testing/"
    "cryptoKeys/delegation/cryptoKeyVersions/1"
)


class KMSRpc:
    def __init__(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.calls = []
        self.bad_crc = False
        self.bad_name = False
        self.bad_algorithm = False
        self.bad_digest = False

    def get_public_key(self, **kwargs):
        self.calls.append(("public", kwargs))
        assert kwargs["timeout"] == 4 and kwargs["retry"] is None
        raw = self.key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        return SimpleNamespace(
            name=KEY if not self.bad_name else KEY + "2",
            algorithm="RSA_SIGN_PKCS1_2048_SHA256"
            if not self.bad_algorithm
            else "RSA_SIGN_PSS_2048_SHA256",
            pem=raw.decode(),
            pem_crc32c=google_crc32c.value(raw) + int(self.bad_crc),
        )

    def asymmetric_sign(self, **kwargs):
        self.calls.append(("sign", kwargs))
        assert kwargs["timeout"] == 4 and kwargs["retry"] is None
        digest = kwargs["request"]["digest"]["sha256"]
        assert kwargs["request"]["name"] == KEY
        assert kwargs["request"]["digest_crc32c"] == google_crc32c.value(digest)
        signature = self.key.sign(digest, padding.PKCS1v15(), utils.Prehashed(hashes.SHA256()))
        return SimpleNamespace(
            name=KEY if not self.bad_name else KEY + "2",
            signature=signature,
            signature_crc32c=google_crc32c.value(signature) + int(self.bad_crc),
            verified_digest_crc32c=not self.bad_digest,
        )


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.rpc = KMSRpc()
        self.moment = 100
        self.signer = KMSSigner(KEY, client=self.rpc, clock=lambda: self.moment)

    def test_fixed_claims_and_actual_signature_match_bounded_public_jwks(self):
        result = mint_authority_token(UID, self.signer, configuration=(ISSUER, EMAIL), now=NOW)
        public = self.signer.jwks()
        cache = KeyCache(
            ISSUER + "/.well-known/jwks.json",
            transport=lambda *args, **kwargs: json.dumps(public).encode(),
        )
        claims = verify_signed_jwt(result["token"], keys=cache, expected_typ=DELEGATION_TYPE)
        self.assertEqual(claims["sub"], UID)
        self.assertEqual(claims["aud"], ISSUER + "/internal/v2")
        self.assertEqual(claims["caller"], EMAIL)
        self.assertEqual(claims["resourceKinds"], ["holdings"])
        self.assertEqual(claims["purpose"], "browser_catalog")
        self.assertEqual(claims["scopes"], ["resources:catalog"])
        self.assertEqual(claims["exp"] - claims["iat"], 60)
        self.assertEqual(result["expiresAt"], NOW + 60)
        for forbidden in ("d", "p", "q", "dp", "dq", "qi"):
            self.assertNotIn(forbidden, public["keys"][0])
        self.assertEqual(len([call for call in self.rpc.calls if call[0] == "public"]), 1)
        self.moment += 61
        self.signer.jwks()
        self.assertEqual(len([call for call in self.rpc.calls if call[0] == "public"]), 2)

    def test_kms_wrong_resource_algorithm_crc_and_digest_ack_fail_closed(self):
        for field in ("bad_crc", "bad_name", "bad_algorithm", "bad_digest"):
            with self.subTest(field=field):
                rpc = KMSRpc()
                setattr(rpc, field, True)
                signer = KMSSigner(KEY, client=rpc)
                with self.assertRaises(ContractError) as result:
                    mint_authority_token(UID, signer, configuration=(ISSUER, EMAIL), now=NOW)
                self.assertEqual(result.exception.code, "authorization_unavailable")

    def test_unconfigured_signing_or_caller_never_contacts_google(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            with self.assertRaises(ContractError):
                get_signer()
            with self.assertRaises(ContractError):
                token_configuration()
        for issuer, caller in (
            ("http://hub.example.com", EMAIL),
            (ISSUER + "/path", EMAIL),
            (ISSUER, "user@example.com"),
        ):
            with self.subTest(issuer=issuer), self.assertRaises(ContractError):
                mint_authority_token(UID, self.signer, configuration=(issuer, caller), now=NOW)
        self.assertEqual(self.rpc.calls, [])
