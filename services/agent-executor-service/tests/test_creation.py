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
        value = {
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
        value["creationWorkload"] = {
            **value["workload"],
            "args": ["python", "-m", "app.initialize"],
            "attestationAudience": value["issuer"] + "/enrollment",
        }
        return value

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

    def finalization(self, pending, **changes):
        return sign_jws(
            {
                "profile": PROFILE,
                "action": "finalize",
                "offerDigest": digest(pending.offer),
                "bindingFingerprint": self.config.binding["bindingFingerprint"],
                "workload": self.value["workload"],
                "operationId": "synthetic_creation_finalize_0001",
                "issuedAt": self.now,
                "expiresAt": self.now + 300,
                **changes,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )

    def test_explicit_creation_stores_only_encrypted_keys_and_public_offer_once(self):
        draft = self.draft()
        objects = Objects()
        wrapper = Wrapper()
        permit = self.permit(draft)
        pending = self.create(draft, permit, objects, wrapper)
        self.assertEqual(wrapper.calls, [])
        result = pending.finalize(self.finalization(pending))
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
        draft = self.draft()
        draft["creationWorkload"]["attestationAudience"] = draft["issuer"] + "/attestation"
        with self.assertRaises(Stopped):
            self.create(draft, self.permit(draft), objects, wrapper)
        self.assertEqual(objects.values, {})
        self.assertEqual(wrapper.calls, [])

    def test_crashed_reserved_ceremony_never_silently_regenerates(self):
        draft = self.draft()
        objects = Objects()
        wrapper = Wrapper()
        wrapper.wrap = Mock(side_effect=RuntimeError())
        permit = self.permit(draft)
        pending = self.create(draft, permit, objects, wrapper)
        with self.assertRaises(Stopped):
            pending.finalize(self.finalization(pending))
        self.assertEqual(len(objects.values), 2)
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

    def test_finalization_binds_actual_owner_device_command_after_keys_are_known(self):
        from native_fixtures import PersistentContentFixture

        from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint
        from folioview_shared.encrypted.persistent_agents import (
            PERSISTENT_AGENT_PROFILE,
            initial_agent_identity,
            verify_agent_identity_binding,
        )

        objects, wrapper = Objects(), Wrapper()
        draft = self.draft()
        pending = self.create(draft, self.permit(draft), objects, wrapper)
        f = PersistentContentFixture()
        f.root, f.root_public = self.keys["root"], self.value["rootJwk"]
        f.root_id = jwk_thumbprint(f.root_public)
        f.owner, f.vault = draft["ownerSubject"], draft["vaultId"]
        for cert in f.certificates.values():
            cert.update(
                ownerSubject=f.owner,
                vaultId=f.vault,
                issuerKeyId=f.root_id,
                notBefore=self.now - 10,
                expiresAt=self.now + 3600,
            )
        for name, field in [("A1_sig", "agentSigningJwk"), ("A1_enc", "agentEncryptionJwk")]:
            pub = pending.offer[field]
            f.certificates[name].update(
                publicJwk=pub,
                keyId=jwk_thumbprint(pub),
                connectionId=draft["connectionId"],
                principalId=draft["agentId"],
            )
        bundle = f.make_bundle(issued_at=self.now - 1)
        registry = f.verify(bundle, now=self.now)
        payload = {
            **f.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": f.root_id,
            "connectionId": draft["connectionId"],
            "agentId": draft["agentId"],
            "clientId": draft["clientId"],
            "identityEpoch": 1,
            "agentSigningKeyId": f.kid("A1_sig"),
            "agentEncryptionKeyId": f.kid("A1_enc"),
            "deviceSigningKeyId": f.kid("device_sig"),
            "stableOperationId": "synthetic_actual_owner_binding_01",
            "registrySequence": registry.registry_sequence,
            "checkpointDigest": registry.checkpoint_digest,
            "keyEpoch": registry.key_epoch,
            "issuedAt": self.now,
        }
        command = f.sign(payload)
        identity = initial_agent_identity(
            verify_agent_identity_binding(
                command,
                registry=registry,
                owner_subject=f.owner,
                vault_id=f.vault,
                connection_id=draft["connectionId"],
                agent_id=draft["agentId"],
                client_id=draft["clientId"],
                now=self.now,
            )
        )
        fingerprint = signing_input_fingerprint(command)
        workload = {
            **draft["workload"],
            "environment": {
                "EXECUTOR_NATIVE_ENABLED": "1",
                "EXECUTOR_NATIVE_CONFIG_SHA256": "e" * 64,
            },
        }
        result = pending.finalize(
            self.finalization(pending, bindingFingerprint=fingerprint, workload=workload)
        )
        secret, binding = wrapper.calls[0]
        self.assertEqual(binding["bindingFingerprint"], identity["bindingFingerprint"])
        self.assertEqual(binding["workloadDigest"], digest(workload))
        stored = unseal(self.snapshots.read(result["stateHead"]), secret, binding)
        self.assertEqual(
            public(__import__("jwcrypto", fromlist=["jwk"]).jwk.JWK(**stored["keys"]["signing"])),
            pending.offer["agentSigningJwk"],
        )
        self.assertEqual(
            pending.finalize(
                self.finalization(pending, bindingFingerprint=fingerprint, workload=workload)
            ),
            result,
        )
        self.assertEqual(len(wrapper.calls), 1)
        self.assertIsNone(pending.keys)

    def test_finalization_rejects_wrong_offer_scope_and_image_without_wrapping(self):
        draft = self.draft()
        objects = Objects()
        wrapper = Wrapper()
        pending = self.create(draft, self.permit(draft), objects, wrapper)
        for changes in [
            {"offerDigest": "f" * 64},
            {"scope": {}},
            {"workload": {**draft["workload"], "imageDigest": "sha256:" + "f" * 64}},
            {"issuedAt": self.now - 301, "expiresAt": self.now - 1},
        ]:
            with self.assertRaises(Stopped):
                pending.finalize(self.finalization(pending, **changes))
        self.assertEqual(wrapper.calls, [])
        self.assertEqual(len(objects.values), 2)

    def test_unknown_final_offer_write_retries_original_keys_head_and_ciphertext(self):
        from google.api_core.exceptions import PreconditionFailed

        objects, wrapper = Objects(), Wrapper()
        objects.read = lambda name: objects.values.get(name)
        create = objects.create

        def unknown(name, value):
            if name.endswith("-offer"):
                if name in objects.values:
                    raise PreconditionFailed("synthetic already committed")
                create(name, value)
                raise TimeoutError("synthetic lost response")
            create(name, value)

        objects.create = unknown
        draft = self.draft()
        pending = self.create(draft, self.permit(draft), objects, wrapper)
        signed = self.finalization(pending)
        with self.assertRaises(Stopped):
            pending.finalize(signed)
        original = pending.prepared_offer
        result = pending.finalize(signed)
        self.assertEqual(result["stateHead"], original["initialStateHead"])
        self.assertEqual(objects.values[pending.identity + "-offer"], original)
        self.assertEqual(len(wrapper.calls), 1)
        self.assertIsNone(pending.keys)
