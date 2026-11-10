"""Actual TLS peer identity; request headers never establish provider provenance."""

import hashlib
import ssl
import time
from dataclasses import dataclass
from pathlib import Path

from cryptography import x509
from cryptography.x509.oid import ExtendedKeyUsageOID
from uvicorn.protocols.http.h11_impl import H11Protocol

from .contracts import require, safe
from .native_config import PROVIDER

PEER_SCOPE = "folioview.verified_provider_peer"
DNS_NAME = "mtls.prod.connectors.openai.com"
TRUST = Path(__file__).parent / "public-trust"
CA_HASHES = {
    "openai-root-ca.public.pem": "3a565b5c83c83ba2de085de28733e3c6af01af9b347322b93caf3a03d42c5cbe",
    "openai-connectors-mtls-ca.public.pem": (
        "7485f98dfbb7db119ca99d5748ac7a86baa73ddede878d3263a50cba2c4f6dd8"
    ),
}


@dataclass(frozen=True)
class ProviderPeer:
    provider: str
    certificate_digest: str
    valid_from: int
    valid_until: int

    def current(self, now):
        require(self.provider == PROVIDER and self.valid_from <= now < self.valid_until)


def configure_client_trust(context):
    """Trust the published Connectors intermediate, allowing managed leaf rotation."""
    certificates = {}
    now = time.time()
    for name, expected in CA_HASHES.items():
        raw = (TRUST / name).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == expected)
        cert = x509.load_pem_x509_certificate(raw)
        require(cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca is True)
        require(cert.not_valid_before_utc.timestamp() <= now < cert.not_valid_after_utc.timestamp())
        certificates[name] = cert
    root = certificates["openai-root-ca.public.pem"]
    root.verify_directly_issued_by(root)
    certificates["openai-connectors-mtls-ca.public.pem"].verify_directly_issued_by(root)
    context.load_verify_locations(cafile=str(TRUST / "openai-connectors-mtls-ca.public.pem"))
    context.verify_mode = ssl.CERT_REQUIRED
    context.verify_flags |= ssl.VERIFY_X509_STRICT | ssl.VERIFY_X509_PARTIAL_CHAIN


def authenticated_peer(ssl_object, *, now=None):
    def verify():
        require(ssl_object is not None and ssl_object.version() == "TLSv1.3")
        require(ssl_object.context.verify_mode == ssl.CERT_REQUIRED)
        raw = ssl_object.getpeercert(binary_form=True)
        require(type(raw) is bytes and 1 <= len(raw) <= 16384)
        cert = x509.load_der_x509_certificate(raw)
        require(not cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        require(DNS_NAME in san.get_values_for_type(x509.DNSName))
        eku = cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
        require(ExtendedKeyUsageOID.CLIENT_AUTH in eku)
        peer = ProviderPeer(
            PROVIDER,
            hashlib.sha256(raw).hexdigest(),
            int(cert.not_valid_before_utc.timestamp()),
            int(cert.not_valid_after_utc.timestamp()),
        )
        peer.current(int(time.time()) if now is None else now)
        return peer

    return safe(verify)


class ProviderProtocol(H11Protocol):
    def connection_made(self, transport):
        super().connection_made(transport)
        try:
            peer = authenticated_peer(transport.get_extra_info("ssl_object"))
        except Exception:
            transport.close()
            return
        original = self.app

        async def verified(scope, receive, send):
            await original({**scope, PEER_SCOPE: peer}, receive, send)

        self.app = verified
