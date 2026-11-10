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
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json
from folioview_shared.encrypted.schema import validate_schema

from .contracts import PROFILE, closed, digest, identity_digest, require, safe
from .state import public, seal


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


def initialize(
    draft, permit, *, root_jwk, enrollment_objects, snapshots, wrapper, attestation, now=None
):
    """No resume/replacement path: a crashed reserved creation needs an explicit new ceremony."""

    def create():
        current = int(time.time()) if now is None else now
        closed(
            draft,
            {
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
                "policyJwk",
                "recipientKeyIds",
                "scope",
                "workload",
                "kmsRecoveryKey",
                "snapshotBucket",
            },
        )
        validate_schema("PublicJWK", root_jwk)
        validate_schema("PublicJWK", draft["policyJwk"])
        p = verify_jws(permit, root_jwk, typ="fv-control+jws")
        closed(p, {"profile", "action", "draftDigest", "operationId", "issuedAt", "expiresAt"})
        validate_schema("OperationIdentifier", p["operationId"])
        require(
            p["profile"] == PROFILE
            and p["action"] == "initialize"
            and p["draftDigest"] == digest(draft)
            and type(p["issuedAt"]) is int
            and type(p["expiresAt"]) is int
            and p["issuedAt"] <= current < p["expiresAt"] <= p["issuedAt"] + 300
        )
        identity = digest(
            {k: draft[k] for k in ("ownerSubject", "vaultId", "connectionId", "identityEpoch")}
        )
        enrollment_objects.create(
            identity + "-reservation",
            {"profile": PROFILE, "permitFingerprint": signing_input_fingerprint(permit)},
        )
        keys = {
            name: jwk.JWK.generate(kty="EC", crv="P-256")
            for name in ("signing", "encryption", "tls")
        }
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
                "bindingFingerprint",
                "identityEpoch",
                "issuer",
                "audience",
                "recipientKeyIds",
            )
        }
        binding.update(
            rootKeyId=jwk_thumbprint(root_jwk),
            policySigningKeyId=jwk_thumbprint(draft["policyJwk"]),
            agentSigningKeyId=jwk_thumbprint(public(keys["signing"])),
            agentEncryptionKeyId=jwk_thumbprint(public(keys["encryption"])),
            tlsKeyId=jwk_thumbprint(public(keys["tls"])),
            scopeDigest=digest(draft["scope"]),
            workloadDigest=digest(draft["workload"]),
        )
        from folioview_shared.encrypted.executor_trust import validate_executor_schema

        validate_executor_schema("ExecutorBinding", binding)
        key = secrets.token_bytes(32)
        state = {
            "profile": PROFILE,
            "identityDigest": identity_digest(binding),
            "sequence": 1,
            "keys": {name: k.export(private_key=True, as_dict=True) for name, k in keys.items()},
            "outbox": {},
            "receipts": [],
        }
        wrapped = wrapper.wrap(key, binding)
        head = snapshots.put(seal(state, key, binding))
        from urllib.parse import urlsplit

        hostname = urlsplit(binding["audience"]).hostname
        private = serialization.load_pem_private_key(
            keys["tls"].export_to_pem(private_key=True, password=None), password=None
        )
        csr = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)]))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname)]), critical=False)
            .sign(private, hashes.SHA256())
            .public_bytes(serialization.Encoding.PEM)
            .decode()
        )
        statement = {
            "profile": PROFILE,
            "action": "initialize",
            "permitFingerprint": signing_input_fingerprint(permit),
            "binding": binding,
            "initialStateHead": head,
            "wrappedKeyDigest": digest(wrapped),
            "csrDigest": digest(csr),
        }
        # Creation attestor has a separate fixed audience/profile and is never an HTTP relay.
        evidence = attestation.issue_creation(statement)
        require(int(time.time()) < p["expiresAt"] if now is None else now < p["expiresAt"])
        offer = {
            "profile": PROFILE,
            "binding": binding,
            "agentSigningJwk": public(keys["signing"]),
            "agentEncryptionJwk": public(keys["encryption"]),
            "tlsJwk": public(keys["tls"]),
            "initialStateHead": head,
            "wrappedStateKey": wrapped,
            "certificateRequest": csr,
            "permit": permit,
            "creationAttestation": evidence,
        }
        enrollment_objects.create(identity + "-offer", offer)
        return {
            "profile": PROFILE,
            "enrollmentId": identity,
            "stateHead": head,
            "enrolled": False,
            "contentServiceEnabled": False,
        }

    return safe(create)
