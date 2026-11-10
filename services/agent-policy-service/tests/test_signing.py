"""Real ECDSA/CRC32C KMS RPC boundaries and fixed-purpose key release."""

import google_crc32c
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from fixtures import PolicyFixture
from google.cloud.kms_v1 import types as kms_types

from app.contracts import Unavailable, recovery_aad
from app.signing import KMS
from folioview_shared.encrypted.crypto import verify_jws
from folioview_shared.encrypted.jsonutil import b64url_decode


class SigningTests(PolicyFixture):
    def setUp(self):
        super().setUp()
        self.private = serialization.load_pem_private_key(
            self.keys["policy"].export_to_pem(private_key=True, password=None), password=None
        )
        self.calls = []
        self.bad_name = False
        self.bad_crc = False
        self.bad_algorithm = False

        class Client:
            def get_public_key(client, **kw):
                self.calls.append(("public", kw))
                self.assertTrue(
                    kms_types.GetPublicKeyRequest(kw["request"])._pb.SerializeToString()
                )
                raw = self.private.public_key().public_bytes(
                    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
                )
                return kms_types.PublicKey(
                    name=self.value["kmsSigningKeyVersion"],
                    algorithm="RSA_SIGN_PKCS1_2048_SHA256"
                    if self.bad_algorithm
                    else "EC_SIGN_P256_SHA256",
                    pem=raw.decode(),
                    pem_crc32c=google_crc32c.value(raw),
                )

            def asymmetric_sign(client, **kw):
                self.calls.append(("sign", kw))
                self.assertTrue(
                    kms_types.AsymmetricSignRequest(kw["request"])._pb.SerializeToString()
                )
                r = kw["request"]
                raw = self.private.sign(
                    r["digest"]["sha256"], ec.ECDSA(utils.Prehashed(hashes.SHA256()))
                )
                return kms_types.AsymmetricSignResponse(
                    name="wrong" if self.bad_name else r["name"],
                    signature=raw,
                    verified_digest_crc32c=True,
                    signature_crc32c=0 if self.bad_crc else google_crc32c.value(raw),
                )

            def decrypt(client, **kw):
                self.calls.append(("decrypt", kw))
                self.assertTrue(kms_types.DecryptRequest(kw["request"])._pb.SerializeToString())
                raw = b"k" * 32
                return kms_types.DecryptResponse(
                    plaintext=raw,
                    plaintext_crc32c=0 if self.bad_crc else google_crc32c.value(raw),
                )

        self.kms = KMS(self.config, client=Client())

    def test_fixed_version_and_jose_signature_are_verified_without_private_export(self):
        claims = {"profile": "synthetic", "purpose": "checkpoint"}
        signed = self.kms.sign(claims)
        self.assertEqual(verify_jws(signed, self.config.policy_jwk, typ="fv-control+jws"), claims)
        self.assertTrue(all(c[1]["timeout"] == 4 and c[1]["retry"] is None for c in self.calls))
        request = self.calls[-1][1]["request"]
        self.assertEqual(request["name"], self.value["kmsSigningKeyVersion"])
        self.assertEqual(request["digest_crc32c"], google_crc32c.value(request["digest"]["sha256"]))

    def test_wrong_version_algorithm_or_crc_fails_closed(self):
        for field in ["bad_name", "bad_crc", "bad_algorithm"]:
            with self.subTest(field=field):
                setattr(self, field, True)
                with self.assertRaises(Unavailable):
                    self.kms.sign({"test": True})
                setattr(self, field, False)

    def test_only_root_selected_recovery_ciphertext_key_and_stable_identity_aad_are_used(self):
        aad = recovery_aad(self.binding)
        self.assertEqual(
            self.kms.unwrap_recovery_key(self.enrollment["wrappedStateKey"], aad), b"k" * 32
        )
        request = self.calls[-1][1]["request"]
        self.assertEqual(request["name"], self.value["kmsRecoveryKey"])
        self.assertEqual(request["ciphertext"], b64url_decode(self.enrollment["wrappedStateKey"]))
        self.assertEqual(request["additional_authenticated_data"], aad.encode())
        for field in ("bad_crc",):
            setattr(self, field, True)
            with self.assertRaises(Unavailable):
                self.kms.unwrap_recovery_key(self.enrollment["wrappedStateKey"], aad)
            setattr(self, field, False)
