"""Independent Node/WebCrypto vectors, consumed by the Python shared contract.

The recipient scalars below are intentionally public test material. No real
account/key or private JWK is persisted in the fixture or a test artifact.
"""

import copy
import json
import os
import subprocess
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric import ec

from folioview_shared.encrypted import crypto
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json
from folioview_shared.encrypted.private import validate_private_payload
from folioview_shared.encrypted.schema import validate_schema

HERE = Path(__file__).resolve().parent


def public_test_key(scalar):
    """Reconstruct a known, non-secret P-256 test key through the crypto library."""
    numbers = ec.derive_private_key(scalar, ec.SECP256R1()).private_numbers()
    public = numbers.public_numbers
    return {
        "kty": "EC",
        "crv": "P-256",
        "x": b64url_encode(public.x.to_bytes(32, "big")),
        "y": b64url_encode(public.y.to_bytes(32, "big")),
        "d": b64url_encode(numbers.private_value.to_bytes(32, "big")),
    }


def public_part(key):
    return {name: key[name] for name in ("kty", "crv", "x", "y")}


class NodeVectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vector = json.loads((HERE / "fixtures/encrypted_v2_node.json").read_text())

    def opened_signed(self, name=None):
        carrier = self.vector["carrier"] if name is None else self.vector["variants"][name]
        return crypto.verify_jws(
            carrier["signedObject"],
            self.vector["signerPublicJwk"],
            typ="fv-object+jws",
            expected_kid=self.vector["context"]["authorSigningKeyId"],
        )

    def test_fixture_is_public_synthetic_material_from_independent_implementation(self):
        self.assertEqual(self.vector["generatedBy"]["jose"], "6.2.13")
        self.assertEqual(self.vector["generatedBy"]["canonicalize"], "5.1.0")
        self.assertFalse(self.vector["generatedBy"]["privateKeysStored"])

        def no_private_jwk(value):
            if isinstance(value, dict):
                self.assertNotIn("d", value)
                for item in value.values():
                    no_private_jwk(item)
            elif isinstance(value, list):
                for item in value:
                    no_private_jwk(item)

        no_private_jwk(self.vector)

    def test_node_webcrypto_signature_and_standard_signing_input_fingerprint(self):
        value = self.opened_signed()
        self.assertEqual(value["context"], self.vector["context"])
        self.assertEqual(
            crypto.signing_input_fingerprint(self.vector["carrier"]["signedObject"]),
            self.vector["expected"]["signingInputSha256"],
        )
        self.assertEqual(
            len(b64url_decode(self.vector["carrier"]["signedObject"]["signature"])), 64
        )

    def test_jcs_bytes_match_node_without_unicode_normalization(self):
        self.assertEqual(
            b64url_encode(canonical_json(self.vector["context"])),
            self.vector["expected"]["contextCanonicalBase64url"],
        )
        self.assertEqual(
            b64url_encode(canonical_json(self.vector["privatePayload"])),
            self.vector["expected"]["privateCanonicalBase64url"],
        )
        summary = self.vector["privatePayload"]["payload"]["summary"]
        self.assertIn("e\u0301", summary)
        self.assertNotIn("é", summary)

    def test_python_validates_private_schema_and_both_node_recipient_encryptions(self):
        value = self.opened_signed()
        validate_schema("Context", value["context"])
        for entry in self.vector["recipientKeys"]:
            with self.subTest(role=entry["role"]):
                key = public_test_key(entry["testScalar"])
                self.assertEqual(public_part(key), entry["publicJwk"])
                self.assertEqual(crypto.jwk_thumbprint(entry["publicJwk"]), entry["keyId"])
                plaintext = crypto.decrypt_jwe(value["jwe"], key, context=value["context"])
                self.assertEqual(plaintext, self.vector["privatePayload"])
                validate_private_payload(plaintext, context=value["context"])
        self.assertEqual(len(b64url_decode(value["jwe"]["iv"])), 12)
        self.assertEqual(len(b64url_decode(value["jwe"]["tag"])), 16)
        self.assertEqual(
            [len(b64url_decode(row["encrypted_key"])) for row in value["jwe"]["recipients"]],
            [40, 40],
        )

    def test_wrong_key_and_context_fail_without_plaintext_diagnostics(self):
        value = self.opened_signed()
        cases = [
            (public_test_key(3), value["context"]),
            (public_test_key(1), {**value["context"], "ownerSubject": "other_owner"}),
        ]
        for key, context in cases:
            with self.subTest(owner=context["ownerSubject"]):
                with self.assertRaises(ContractError) as result:
                    crypto.decrypt_jwe(value["jwe"], key, context=context)
                self.assertNotIn("Synthetic", str(result.exception))
                self.assertNotIn("No real holdings", str(result.exception))

    def test_public_signature_success_does_not_claim_aead_or_plaintext_validity(self):
        # The independent author signed the malformed tag: public verification
        # succeeds, while only the decrypting client can reject the GCM tag.
        value = self.opened_signed("validSignatureInvalidTag")
        self.assertEqual(value["context"], self.vector["context"])
        with self.assertRaises(ContractError):
            crypto.decrypt_jwe(value["jwe"], public_test_key(1), context=value["context"])

    def test_authenticated_wrong_aad_and_invalid_signature_are_rejected(self):
        value = self.opened_signed("validSignatureWrongAad")
        with self.assertRaises(ContractError):
            crypto.decrypt_jwe(value["jwe"], public_test_key(2), context=value["context"])
        with self.assertRaises(ContractError):
            self.opened_signed("invalidSignature")

    def test_valid_high_low_s_signature_variants_keep_operation_identity(self):
        alternate = self.opened_signed("alternateValidSignature")
        original = self.opened_signed()
        self.assertEqual(alternate, original)
        self.assertNotEqual(
            self.vector["variants"]["alternateValidSignature"]["signedObject"]["signature"],
            self.vector["carrier"]["signedObject"]["signature"],
        )
        self.assertEqual(
            crypto.signing_input_fingerprint(
                self.vector["variants"]["alternateValidSignature"]["signedObject"]
            ),
            self.vector["expected"]["signingInputSha256"],
        )

    @unittest.skipUnless(
        os.getenv("FOLIOVIEW_INTEROP_MODULES"),
        "Optional Node execution needs fixture dependencies; static vectors always run.",
    )
    def test_python_output_is_verified_and_decrypted_by_node_webcrypto(self):
        context = copy.deepcopy(self.vector["context"])
        signer = public_test_key(19)
        signer_public = public_part(signer)
        context["authorSigningKeyId"] = crypto.jwk_thumbprint(signer_public)
        context["stableOperationId"] = "test_reverse_00000000000000000000000000000001"
        plaintext = copy.deepcopy(self.vector["privatePayload"])
        plaintext["payload"]["summary"] = "Produced in Python; verified and decrypted by Node."
        recipients = {entry["keyId"]: entry["publicJwk"] for entry in self.vector["recipientKeys"]}
        encrypted = crypto.encrypt_jwe(plaintext, recipients, context=context)
        signed = crypto.sign_jws(
            {"context": context, "jwe": encrypted}, signer, typ="fv-object+jws"
        )
        request = {
            "carrier": {"contractVersion": self.vector["contractVersion"], "signedObject": signed},
            "context": context,
            "privatePayload": plaintext,
            "signerPublicJwk": signer_public,
            "recipientPrivateJwk": public_test_key(1),
        }
        result = subprocess.run(
            [
                os.getenv("FOLIOVIEW_NODE_BIN", "node"),
                str(HERE / "interop/node_vectors.mjs"),
                "--verify-python",
            ],
            input=json.dumps(request),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(result.returncode, 0, "Independent Node verification/decryption failed")
        reply = json.loads(result.stdout)
        self.assertTrue(reply)
        self.assertTrue(all(value is True for value in reply.values()))


if __name__ == "__main__":
    unittest.main()
