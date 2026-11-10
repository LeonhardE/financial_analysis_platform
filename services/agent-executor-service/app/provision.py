"""Explicit create-only identity ceremony, separate from normal restore-only startup.

Run only inside the separately approved measured creation workload. The resulting
offer is public enrollment evidence, not permission to serve content. Root must
review/approve its first keys and Policy must enroll them before runtime recovery.
"""

import secrets
import time

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID
from jwcrypto import jwk

from folioview_shared.encrypted.crypto import jwk_thumbprint, signing_input_fingerprint, verify_jws
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json, strict_json_loads
from folioview_shared.encrypted.schema import validate_schema

from .contracts import PROFILE, closed, digest, identity_digest, require, safe
from .state import public, seal
from .tls import subject_alt_name


class EnrollmentObjects:
    def __init__(self, bucket, *, client=None):
        from google.cloud import storage

        self.bucket = (client or storage.Client()).bucket(bucket)

    def create(self, name, value):
        # The runtime identity has no write access to this namespace. The creation
        # identity may create but never replace/delete enrollment tombstones.
        raw = canonical_json(value)
        require(len(raw) <= 65536)
        self.bucket.blob("executor-enrollment/" + name + ".json").upload_from_string(
            raw,
            content_type="application/json",
            if_generation_match=0,
            timeout=4,
            retry=None,
            checksum="crc32c",
        )

    def read(self, name):
        from google.api_core.exceptions import NotFound

        blob = self.bucket.blob("executor-enrollment/" + name + ".json")
        try:
            blob.reload(timeout=4, retry=None)
            require(type(blob.size) is int and 1 <= blob.size <= 65536)
            raw = blob.download_as_bytes(
                if_generation_match=blob.generation, timeout=4, retry=None, checksum="crc32c"
            )
            return strict_json_loads(raw, max_bytes=65536)
        except NotFound:
            return None


class KeyWrapper:
    def __init__(self, key_name, *, client=None):
        from google.cloud import kms

        self.key_name, self.client = key_name, client or kms.KeyManagementServiceClient()

    def wrap(self, secret, binding):
        def wrap():
            import google_crc32c

            require(type(secret) is bytes and len(secret) == 32)
            aad = identity_digest(binding).encode()
            result = self.client.encrypt(
                request={
                    "name": self.key_name,
                    "plaintext": secret,
                    "additional_authenticated_data": aad,
                    "plaintext_crc32c": google_crc32c.value(secret),
                    "additional_authenticated_data_crc32c": google_crc32c.value(aad),
                },
                timeout=4,
                retry=None,
            )
            require(
                result.name.rsplit("/cryptoKeyVersions/", 1)[0] == self.key_name
                and result.verified_plaintext_crc32c is True
                and result.verified_additional_authenticated_data_crc32c is True
                and result.ciphertext_crc32c == google_crc32c.value(result.ciphertext)
                and 1 <= len(result.ciphertext) <= 8192
            )
            return b64url_encode(result.ciphertext)

        return safe(wrap)


class PendingCreation:
    """Original keys stay in measured RAM until the owner supplies the actual binding."""

    def __init__(self, draft, permit, root_jwk, objects, snapshots, wrapper, attestation, clock):
        self.draft, self.permit, self.root = draft, permit, root_jwk
        self.objects, self.snapshots, self.wrapper, self.attestation, self.clock = (
            objects,
            snapshots,
            wrapper,
            attestation,
            clock,
        )
        self.keys = self.dek = None
        self.finalization = self.final_offer = self.prepared_offer = None
        self.identity = digest(
            {k: draft[k] for k in ("ownerSubject", "vaultId", "connectionId", "identityEpoch")}
        )
        objects.create(
            self.identity + "-reservation",
            {"profile": PROFILE, "permitFingerprint": signing_input_fingerprint(permit)},
        )
        self.keys = {
            n: jwk.JWK.generate(kty="EC", crv="P-256") for n in ("signing", "encryption", "tls")
        }
        self.dek = secrets.token_bytes(32)
        from urllib.parse import urlsplit

        hostname = urlsplit(draft["audience"]).hostname
        require(type(hostname) is str and bool(hostname))
        private = serialization.load_pem_private_key(
            self.keys["tls"].export_to_pem(private_key=True, password=None), None
        )
        self.csr = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)]))
            .add_extension(
                x509.SubjectAlternativeName([subject_alt_name(hostname)]), critical=False
            )
            .sign(private, hashes.SHA256())
            .public_bytes(serialization.Encoding.PEM)
            .decode()
        )
        offer = {
            "profile": PROFILE,
            "enrollmentId": self.identity,
            "draft": draft,
            "permit": permit,
            "agentSigningJwk": public(self.keys["signing"]),
            "agentEncryptionJwk": public(self.keys["encryption"]),
            "tlsJwk": public(self.keys["tls"]),
            "certificateRequest": self.csr,
        }
        statement = {
            "profile": PROFILE,
            "action": "offer",
            "issuer": draft["issuer"],
            "permitFingerprint": signing_input_fingerprint(permit),
            "offerDigest": digest(offer),
        }
        offer["creationAttestation"] = attestation.issue_creation(statement)
        require(int(self.clock()) < verify_jws(permit, root_jwk, typ="fv-control+jws")["expiresAt"])
        self.offer = offer
        objects.create(self.identity + "-pending", offer)

    def summary(self):
        return {
            "profile": PROFILE,
            "enrollmentId": self.identity,
            "offerDigest": digest(self.offer),
            "status": "awaiting_owner_finalization",
            "enrolled": False,
            "contentServiceEnabled": False,
        }

    def finalize(self, signed):
        return safe(lambda: self._finalize(signed))

    def _finalize(self, signed):
        p = verify_jws(signed, self.root, typ="fv-control+jws")
        fingerprint = signing_input_fingerprint(signed)
        if self.final_offer is not None:
            require(fingerprint == self.finalization)
            return self.result()
        closed(
            p,
            {
                "profile",
                "action",
                "offerDigest",
                "bindingFingerprint",
                "workload",
                "operationId",
                "issuedAt",
                "expiresAt",
            },
        )
        validate_schema("OperationIdentifier", p["operationId"])
        validate_schema("Digest", p["bindingFingerprint"])
        require(
            p["profile"] == PROFILE
            and p["action"] == "finalize"
            and p["offerDigest"] == digest(self.offer)
            and type(p["issuedAt"]) is int
            and type(p["expiresAt"]) is int
            and p["issuedAt"] <= int(self.clock()) < p["expiresAt"] <= p["issuedAt"] + 300
        )
        if self.prepared_offer is not None:
            require(fingerprint == self.finalization)
            return self._publish()
        workload = p["workload"]
        original = self.draft["workload"]
        require(
            type(workload) is dict
            and set(workload) == set(original)
            and {**original, "environment": workload["environment"]} == workload
            and type(workload["environment"]) is dict
        )
        draft = self.draft
        binding = {
            k: draft[k]
            for k in (
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
            )
        }
        binding.update(
            bindingFingerprint=p["bindingFingerprint"],
            rootKeyId=jwk_thumbprint(self.root),
            policySigningKeyId=jwk_thumbprint(draft["policyJwk"]),
            agentSigningKeyId=jwk_thumbprint(public(self.keys["signing"])),
            agentEncryptionKeyId=jwk_thumbprint(public(self.keys["encryption"])),
            tlsKeyId=jwk_thumbprint(public(self.keys["tls"])),
            scopeDigest=digest(draft["scope"]),
            workloadDigest=digest(workload),
        )
        from folioview_shared.encrypted.executor_trust import validate_executor_schema

        validate_executor_schema("ExecutorBinding", binding)
        state = {
            "profile": PROFILE,
            "identityDigest": identity_digest(binding),
            "sequence": 1,
            "keys": {n: k.export(private_key=True, as_dict=True) for n, k in self.keys.items()},
            "outbox": {},
            "receipts": [],
        }
        wrapped = self.wrapper.wrap(self.dek, binding)
        head = self.snapshots.put(seal(state, self.dek, binding))
        statement = {
            "profile": PROFILE,
            "action": "finalize",
            "issuer": draft["issuer"],
            "permitFingerprint": signing_input_fingerprint(self.permit),
            "offerDigest": digest(self.offer),
            "finalizationFingerprint": fingerprint,
            "binding": binding,
            "initialStateHead": head,
            "wrappedKeyDigest": digest(wrapped),
            "csrDigest": digest(self.csr),
        }
        evidence = self.attestation.issue_creation(statement)
        require(int(self.clock()) < p["expiresAt"])
        final = {
            "profile": PROFILE,
            "binding": binding,
            "workload": workload,
            **{
                k: self.offer[k]
                for k in ("agentSigningJwk", "agentEncryptionJwk", "tlsJwk", "certificateRequest")
            },
            "initialStateHead": head,
            "wrappedStateKey": wrapped,
            "permit": self.permit,
            "offerDigest": digest(self.offer),
            "finalization": signed,
            "creationAttestation": evidence,
        }
        # Publish only after both fresh owner approval and final-bound sealing.
        self.finalization, self.prepared_offer = fingerprint, final
        return self._publish()

    def _publish(self):
        from google.api_core.exceptions import PreconditionFailed

        try:
            self.objects.create(self.identity + "-offer", self.prepared_offer)
        except PreconditionFailed:
            require(self.objects.read(self.identity + "-offer") == self.prepared_offer)
        self.final_offer = self.prepared_offer
        self.stop()
        return self.result()

    def result(self):
        require(self.final_offer is not None)
        return {
            "profile": PROFILE,
            "enrollmentId": self.identity,
            "stateHead": self.final_offer["initialStateHead"],
            "status": "finalized",
            "enrolled": False,
            "contentServiceEnabled": False,
        }

    def stop(self):
        self.keys = self.dek = None


def initialize(
    draft, permit, *, root_jwk, enrollment_objects, snapshots, wrapper, attestation, now=None
):
    """Prepare only. Final sealing requires the fresh second Root control."""

    def prepare():
        from .contracts import clone

        draft_value = closed(
            draft,
            {
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
                "policyJwk",
                "recipientKeyIds",
                "scope",
                "workload",
                "creationWorkload",
                "kmsRecoveryKey",
                "snapshotBucket",
            },
        )
        validate_schema("PublicJWK", root_jwk)
        validate_schema("PublicJWK", draft_value["policyJwk"])
        clock = time.time if now is None else lambda: now
        p = verify_jws(permit, root_jwk, typ="fv-control+jws")
        closed(p, {"profile", "action", "draftDigest", "operationId", "issuedAt", "expiresAt"})
        validate_schema("OperationIdentifier", p["operationId"])
        require(
            p["profile"] == PROFILE
            and p["action"] == "initialize"
            and p["draftDigest"] == digest(draft_value)
            and type(p["issuedAt"]) is int
            and type(p["expiresAt"]) is int
            and p["issuedAt"] <= int(clock()) < p["expiresAt"] <= p["issuedAt"] + 300
        )
        creation = draft_value["creationWorkload"]
        runtime = draft_value["workload"]
        require(
            type(creation) is dict
            and type(runtime) is dict
            and creation["imageDigest"] == runtime["imageDigest"]
            and creation["args"]
            in (["python", "-m", "app.main"], ["python", "-m", "app.initialize"])
            and runtime["args"] == ["python", "-m", "app.main"]
            and creation["attestationAudience"] == draft_value["issuer"] + "/enrollment"
            and runtime["attestationAudience"] == draft_value["issuer"] + "/attestation"
        )
        return PendingCreation(
            clone(draft_value),
            clone(permit),
            clone(root_jwk),
            enrollment_objects,
            snapshots,
            wrapper,
            attestation,
            clock,
        )

    return safe(prepare)
