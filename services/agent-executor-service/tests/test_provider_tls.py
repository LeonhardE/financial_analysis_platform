"""Real TLS chains and actual production H11 peer propagation; no managed private keys."""

import hashlib
import socket
import ssl
import threading
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from native_fixtures import NativeFixture

from app.main import app
from app.provider_tls import DNS_NAME, ProviderProtocol, configure_client_trust
from app.tls import materialize


def certificate(
    key, issuer_key, issuer_cert, name, *, ca=False, path=None, dns=None, client=True, expired=False
):
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    issuer = subject if issuer_cert is None else issuer_cert.subject
    now = datetime.now(UTC)
    b = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=2))
        .not_valid_after(now - timedelta(hours=1) if expired else now + timedelta(days=2))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=path), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=not ca,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=ca,
                crl_sign=ca,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
    )
    if not ca:
        b = b.add_extension(
            x509.SubjectAlternativeName([x509.DNSName(dns or DNS_NAME)]), critical=False
        ).add_extension(
            x509.ExtendedKeyUsage(
                [ExtendedKeyUsageOID.CLIENT_AUTH if client else ExtendedKeyUsageOID.CODE_SIGNING]
            ),
            critical=False,
        )
    return b.sign(issuer_key, hashes.SHA256())


class ProviderTlsTests(NativeFixture):
    def test_actual_mtls_chain_peer_name_rotation_and_forged_header_boundaries(self):
        root_key = ec.generate_private_key(ec.SECP256R1())
        root = certificate(root_key, root_key, None, "Synthetic Root", ca=True, path=1)
        intermediate_key = ec.generate_private_key(ec.SECP256R1())
        intermediate = certificate(
            intermediate_key, root_key, root, "Synthetic Connectors", ca=True, path=0
        )
        trust = self.directory / "provider-trust"
        trust.mkdir()
        pins = {}
        for name, cert in [
            ("openai-root-ca.public.pem", root),
            ("openai-connectors-mtls-ca.public.pem", intermediate),
        ]:
            body = cert.public_bytes(serialization.Encoding.PEM)
            (trust / name).write_bytes(body)
            pins[name] = hashlib.sha256(body).hexdigest()
        clients = {}
        for label, options in [
            ("valid", {}),
            ("rotated", {}),
            ("wrong-name", {"dns": "other.example"}),
            ("wrong-purpose", {"client": False}),
            ("expired", {"expired": True}),
        ]:
            key = ec.generate_private_key(ec.SECP256R1())
            leaf = certificate(key, intermediate_key, intermediate, "Synthetic Leaf", **options)
            certpath = self.directory / (label + ".pem")
            keypath = self.directory / (label + ".key")
            certpath.write_bytes(
                leaf.public_bytes(serialization.Encoding.PEM)
                + intermediate.public_bytes(serialization.Encoding.PEM)
            )
            keypath.write_bytes(
                key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
            )
            clients[label] = (certpath, keypath)
        listener = socket.socket()
        self.addCleanup(listener.close)
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        with (
            materialize(
                self.config,
                self.runtime._keys["tls"],
                now=self.now,
                directory=str(self.directory),
                require_tmpfs=False,
            ) as (_, chain, key),
            patch("app.main.native_engine", self.engine),
            patch("app.main.executor", self.runtime),
        ):
            settings = uvicorn.Config(
                app,
                http=ProviderProtocol,
                ssl_certfile=chain,
                ssl_keyfile=key,
                access_log=False,
                log_level="critical",
                proxy_headers=False,
                lifespan="off",
            )
            settings.load()
            settings.ssl.minimum_version = ssl.TLSVersion.TLSv1_3
            with patch("app.provider_tls.TRUST", trust), patch("app.provider_tls.CA_HASHES", pins):
                configure_client_trust(settings.ssl)
            server = uvicorn.Server(settings)
            thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
            thread.start()
            try:
                deadline = time.monotonic() + 5
                while not server.started and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(server.started)

                def request(label, forged=False):
                    context = ssl.create_default_context(cadata=self.value["certificateChain"])
                    context.minimum_version = ssl.TLSVersion.TLSv1_3
                    if label is not None:
                        context.load_cert_chain(*clients[label])
                    try:
                        with socket.create_connection(listener.getsockname(), timeout=3) as raw:
                            with context.wrap_socket(
                                raw, server_hostname="executor.example"
                            ) as tls:
                                extra = (
                                    "X-Forwarded-Client-Cert: "
                                    + DNS_NAME
                                    + "\r\nAuthorization: Bearer synthetic\r\n"
                                    if forged
                                    else ""
                                )
                                tls.sendall(
                                    (
                                        "GET /.well-known/oauth-protected-resource HTTP/1.1\r\n"
                                        "Host: executor.example\r\n"
                                        + extra
                                        + "Connection: close\r\n\r\n"
                                    ).encode()
                                )
                                result = b""
                                while True:
                                    chunk = tls.recv(65536)
                                    if not chunk:
                                        break
                                    result += chunk
                                return result
                    except (OSError, ssl.SSLError):
                        return b""

                for label in ["valid", "rotated"]:
                    with self.subTest(label=label):
                        self.assertTrue(request(label).startswith(b"HTTP/1.1 200"))
                for label in [None, "wrong-name", "wrong-purpose", "expired"]:
                    with self.subTest(label=label):
                        self.assertFalse(request(label, forged=True).startswith(b"HTTP/1.1 200"))
            finally:
                server.should_exit = True
                thread.join(5)
                self.assertFalse(thread.is_alive())
