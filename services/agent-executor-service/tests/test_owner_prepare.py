"""Offline Owner boundaries; synthetic keys only, no Google or CA calls."""

import copy
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

import test_creation as creation
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from cryptography.x509.verification import VerificationError
from fixtures import Fixture
from jwcrypto import jwk
from tools import owner_prepare as owner

from app.contracts import Stopped, digest
from app.state import public
from folioview_shared.encrypted.crypto import jwk_thumbprint


class OwnerPreparationTests(Fixture):
    def offer(self):
        draft = creation.CreationTests.draft(self)
        permit = creation.CreationTests.permit(self, draft)
        pending = creation.CreationTests.create(
            self, draft, permit, creation.Objects(), creation.Wrapper()
        )
        return draft, pending.offer

    def test_offline_pending_review_requires_independent_root_and_complete_draft(self):
        draft, offer = self.offer()
        root = owner.root_key(self.value["rootJwk"], jwk_thumbprint(self.value["rootJwk"]))
        result = owner.pending(offer, root, draft_digest=digest(draft), now=self.now)
        self.assertFalse(result["hardwareProofVerified"])
        self.assertFalse(result["contentServiceEnabled"])
        with self.assertRaises(Stopped):
            owner.root_key(self.value["rootJwk"], "A" * 43)
        for field, value in [
            ("draft", {**draft, "connectionId": "foreign"}),
            ("tlsJwk", offer["agentSigningJwk"]),
            ("enrollmentId", "a" * 64),
            ("rootPrivateJwk", {"d": "private"}),
        ]:
            bad = copy.deepcopy(offer)
            bad[field] = value
            with self.assertRaises(Stopped):
                owner.pending(bad, root, draft_digest=digest(draft), now=self.now)
        with self.assertRaises(Stopped):
            owner.pending(offer, root, draft_digest=digest(draft), now=self.now + 300)

    def test_original_csr_has_exact_key_and_san_and_never_generates_a_private_key(self):
        _, offer = self.offer()
        from urllib.parse import urlsplit

        host = urlsplit(offer["draft"]["audience"]).hostname
        owner.csr(offer["certificateRequest"], offer["tlsJwk"], host)
        for key, hostname in [(offer["agentSigningJwk"], host), (offer["tlsJwk"], "wrong.example")]:
            with self.assertRaises(Stopped):
                owner.csr(offer["certificateRequest"], key, hostname)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "original.csr"
            path.write_text(offer["certificateRequest"])
            command = owner.certificate_command(
                path, offer["tlsJwk"], host, "demo-executor-alpha", output=directory
            )
            self.assertEqual(command[:3], ["certbot", "certonly", "--csr"])
            self.assertIn("--required-profile", command)
            self.assertNotIn("--key-path", command)
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_challenge_is_exact_identifier_token_bytes_and_cleanup_generation(self):
        token = "x" * 32
        environment = {
            "CERTBOT_IDENTIFIER": "192.0.2.10",
            "CERTBOT_ALL_IDENTIFIERS": "192.0.2.10",
            "CERTBOT_TOKEN": token,
            "CERTBOT_VALIDATION": token + "." + "A" * 43,
        }
        name, raw = owner.challenge(environment, "192.0.2.10")
        self.assertEqual(name, ".well-known/acme-challenge/" + token)
        self.assertEqual(raw, environment["CERTBOT_VALIDATION"].encode())
        for extra in [
            {"CERTBOT_IDENTIFIER": "wrong.example"},
            {"CERTBOT_TOKEN": "../state"},
            {"CERTBOT_ALL_IDENTIFIERS": "192.0.2.10,other.example"},
            {"CERTBOT_VALIDATION": "private key"},
        ]:
            with self.assertRaises(Stopped):
                owner.challenge({**environment, **extra}, "192.0.2.10")

    def test_upload_uses_cas_crc_no_retry_and_no_store(self):
        target = Mock()
        target.blob.return_value.generation = 123
        self.assertEqual(owner.upload(target, "executor-config/demo.json", b"{}", 9), "123")
        blob = target.blob.return_value
        self.assertEqual(blob.upload_from_string.call_args.kwargs["if_generation_match"], 9)
        self.assertEqual(blob.upload_from_string.call_args.kwargs["checksum"], "crc32c")
        self.assertIsNone(blob.upload_from_string.call_args.kwargs["retry"])
        self.assertEqual(blob.cache_control, "no-store, max-age=0")
        with self.assertRaises(Stopped):
            owner.upload(target, "executor-config/demo.json", b"{}", -1)
        with patch.dict(os.environ, {"STORAGE_EMULATOR_HOST": "http://wrong.example"}):
            with self.assertRaises(Stopped):
                owner.bucket("demo-executor-alpha", "-executor-config")

    def test_chain_rejects_self_signed_unknown_ca_wrong_key_and_wrong_san(self):
        chain = self.value["certificateChain"]
        for key, hostname in [
            (self.value["tlsJwk"], "wrong.example"),
            (public(self.keys["signing"]), "executor.example"),
        ]:
            with self.assertRaises(Stopped):
                owner.validate_chain(chain, key, hostname, now=self.now, trust_pem=chain.encode())

    def test_chain_accepts_original_spki_only_under_independent_trusted_ca(self):
        ca = serialization.load_pem_private_key(
            jwk.JWK.generate(kty="EC", crv="P-256").export_to_pem(private_key=True, password=None),
            None,
        )
        tls = serialization.load_pem_private_key(
            self.keys["tls"].export_to_pem(private_key=True, password=None),
            None,
        )
        now = datetime.fromtimestamp(self.now, UTC)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic Root CA")])
        builder = (
            x509.CertificateBuilder()
            .issuer_name(ca_name)
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(hours=1))
        )
        root = (
            builder.subject_name(ca_name)
            .public_key(ca.public_key())
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
            .add_extension(
                x509.KeyUsage(False, False, False, False, False, True, True, False, False), True
            )
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca.public_key()), False)
            .sign(ca, hashes.SHA256())
        )
        leaf = (
            builder.subject_name(x509.Name([]))
            .public_key(tls.public_key())
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("executor.example")]), True)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
            .add_extension(
                x509.KeyUsage(True, False, False, False, False, False, False, False, False), True
            )
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), False)
            .add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(ca.public_key()), False
            )
            .sign(ca, hashes.SHA256())
        )
        raw = leaf.public_bytes(serialization.Encoding.PEM).decode()
        result = owner.validate_chain(
            raw,
            self.value["tlsJwk"],
            "executor.example",
            now=self.now,
            trust_pem=root.public_bytes(serialization.Encoding.PEM),
        )
        self.assertTrue(result["rootApprovalRequired"])
        self.assertEqual(result["tlsKeyId"], jwk_thumbprint(self.value["tlsJwk"]))
        with self.assertRaises(VerificationError):
            owner.validate_chain(
                raw,
                self.value["tlsJwk"],
                "executor.example",
                now=self.now,
                trust_pem=self.value["certificateChain"].encode(),
            )
