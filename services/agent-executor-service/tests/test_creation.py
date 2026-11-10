"""Root-bound, one-time creation; actual Google SDK integrity and create-only storage."""

from unittest.mock import Mock

import google_crc32c
from fixtures import Fixture
from google.cloud.kms_v1 import types as kms_types

from app.contracts import PROFILE, Stopped, digest
from app.provision import KeyWrapper, initialize
from app.state import public, unseal
from folioview_shared.encrypted.crypto import sign_jws


class Objects:
    def __init__(self):
        self.values = {}

    def create(self, name, value):
        if name in self.values:
            raise RuntimeError("existing enrollment")
        self.values[name] = value


class Wrapper:
    def __init__(self):
        self.calls = []

    def wrap(self, secret, binding):
        from folioview_shared.encrypted.jsonutil import b64url_encode

        self.calls.append((secret, binding))
        return b64url_encode(b"synthetic-kms-ciphertext")


class CreationTests(Fixture):
    def draft(self):
        b = self.config.binding
        return {
            **{
                k: b[k]
                for k in [
                    "ownerSubject",
                    "vaultId",
                    "connectionId",
                    "agentId",
                    "clientId",
                    "provider",
                    "providerClientId",
                    "bindingFingerprint",
                    "identityEpoch",
                    "issuer",
                    "audience",
                    "recipientKeyIds",
                ]
            },
            **{
                k: self.value[k]
                for k in ["policyJwk", "scope", "workload", "kmsRecoveryKey", "snapshotBucket"]
            },
        }

    def permit(self, draft, **changes):
        return sign_jws(
            {
                "profile": PROFILE,
                "action": "initialize",
                "draftDigest": digest(draft),
                "operationId": "synthetic_creation_permit_0001",
                "issuedAt": self.now,
                "expiresAt": self.now + 300,
                **changes,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )

    def create(self, draft, permit, objects, wrapper):
        return initialize(
            draft,
            permit,
            root_jwk=self.value["rootJwk"],
            enrollment_objects=objects,
            snapshots=self.snapshots,
            wrapper=wrapper,
            attestation=self.attestor,
            now=self.now,
        )

    def test_explicit_creation_stores_only_encrypted_keys_and_public_offer_once(self):
        draft = self.draft()
        objects = Objects()
        wrapper = Wrapper()
        permit = self.permit(draft)
        result = self.create(draft, permit, objects, wrapper)
        self.assertFalse(result["enrolled"])
        self.assertFalse(result["contentServiceEnabled"])
        offer = next(v for k, v in objects.values.items() if k.endswith("-offer"))
        secret, binding = wrapper.calls[0]
        state = unseal(self.snapshots.read(offer["initialStateHead"]), secret, binding)
        self.assertEqual(
            public(__import__("jwcrypto", fromlist=["jwk"]).jwk.JWK(**state["keys"]["tls"])),
            offer["tlsJwk"],
        )
        self.assertIn("BEGIN CERTIFICATE REQUEST", offer["certificateRequest"])
        self.assertNotIn("root", state["keys"])
        with self.assertRaises(Stopped):
            self.create(draft, permit, objects, wrapper)
        self.assertEqual(len(wrapper.calls), 1)

    def test_expired_wrong_root_and_changed_draft_fail_before_reservation_or_key_generation(self):
        draft = self.draft()
        objects = Objects()
        wrapper = Wrapper()
        permit = self.permit(draft, issuedAt=self.now - 301, expiresAt=self.now - 1)
        with self.assertRaises(Stopped):
            self.create(draft, permit, objects, wrapper)
        permit = self.permit(draft)
        draft["identityEpoch"] = 2
        with self.assertRaises(Stopped):
            self.create(draft, permit, objects, wrapper)
        self.assertEqual(objects.values, {})
        self.assertEqual(wrapper.calls, [])

    def test_crashed_reserved_ceremony_never_silently_regenerates(self):
        draft = self.draft()
        objects = Objects()
        wrapper = Wrapper()
        wrapper.wrap = Mock(side_effect=RuntimeError())
        permit = self.permit(draft)
        with self.assertRaises(Stopped):
            self.create(draft, permit, objects, wrapper)
        self.assertEqual(len(objects.values), 1)
        replacement = Wrapper()
        with self.assertRaises(Stopped):
            self.create(draft, permit, objects, replacement)
        self.assertEqual(replacement.calls, [])

    def test_kms_encrypt_uses_fixed_key_and_aad_with_actual_protobuf_integrity(self):
        keyname = self.value["kmsRecoveryKey"]
        seen = []

        def encrypt(**kw):
            request = kms_types.EncryptRequest(kw["request"])
            self.assertTrue(request._pb.SerializeToString())
            seen.append(request)
            return kms_types.EncryptResponse(
                name=keyname + "/cryptoKeyVersions/1",
                ciphertext=b"synthetic-ciphertext",
                ciphertext_crc32c=google_crc32c.value(b"synthetic-ciphertext"),
                verified_plaintext_crc32c=True,
                verified_additional_authenticated_data_crc32c=True,
            )

        client = Mock()
        client.encrypt.side_effect = encrypt
        wrapper = KeyWrapper(keyname, client=client)
        wrapper.wrap(b"a" * 32, self.config.binding)
        self.assertEqual(seen[0].name, keyname)
        self.assertEqual(seen[0].plaintext_crc32c, google_crc32c.value(b"a" * 32))
        self.assertTrue(seen[0].additional_authenticated_data)
        client.decrypt.assert_not_called()
        bad = kms_types.EncryptResponse(
            name=keyname + "/cryptoKeyVersions/1",
            ciphertext=b"bad",
            ciphertext_crc32c=0,
            verified_plaintext_crc32c=True,
            verified_additional_authenticated_data_crc32c=True,
        )
        client.encrypt.side_effect = None
        client.encrypt.return_value = bad
        with self.assertRaises(Stopped):
            wrapper.wrap(b"a" * 32, self.config.binding)
