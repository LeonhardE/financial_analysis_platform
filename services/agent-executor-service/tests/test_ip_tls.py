"""Exact public IP SAN/CSR and real TLS hostname verification for direct TEE ingress."""

import ipaddress
import socket
import ssl
import threading
from pathlib import Path

import test_creation as creation
from cryptography import x509
from fixtures import Fixture, cert_for

from app.config import Config
from app.contracts import Stopped, clone
from app.provision import initialize
from app.tls import certificate, materialize
from folioview_shared.encrypted.crypto import sign_jws


class IpTlsTests(Fixture):
    def ip_config(self, *, certificate_ip=True, certificate_host="127.0.0.1"):
        value = clone(self.value)
        value["binding"]["audience"] = "https://127.0.0.1/mcp"
        from folioview_shared.encrypted.crypto import _signed_parts

        payload = _signed_parts(value["approval"])[1]
        payload["binding"] = value["binding"]
        value["approval"] = sign_jws(payload, self.keys["root"], typ="fv-control+jws")
        value["certificateChain"] = cert_for(self.keys["tls"], certificate_host, ip=certificate_ip)
        return Config.parse(value, now=self.now)

    def test_ip_server_certificate_uses_real_ip_san_and_original_key(self):
        config = self.ip_config()
        certificate(config, now=self.now)
        errors = []
        with materialize(
            config,
            self.keys["tls"],
            now=self.now,
            directory=str(self.directory),
            require_tmpfs=False,
        ) as (context, _, keyfile):
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            listener.settimeout(5)
            self.addCleanup(listener.close)

            def serve():
                try:
                    stream, _ = listener.accept()
                    with context.wrap_socket(stream, server_side=True) as tls:
                        tls.sendall(b"original-key")
                except Exception as error:
                    errors.append(error)

            worker = threading.Thread(target=serve, daemon=True)
            worker.start()
            client = ssl.create_default_context(cadata=config.public["certificateChain"])
            client.minimum_version = ssl.TLSVersion.TLSv1_3
            with socket.create_connection(listener.getsockname(), timeout=5) as stream:
                with client.wrap_socket(stream, server_hostname="127.0.0.1") as tls:
                    self.assertEqual(tls.version(), "TLSv1.3")
                    self.assertEqual(tls.recv(12), b"original-key")
            worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(errors, [])
        self.assertFalse(Path(keyfile).exists())
        for wrong in [
            self.ip_config(certificate_ip=False),
            self.ip_config(certificate_host="127.0.0.2"),
        ]:
            with self.assertRaises(Stopped):
                certificate(wrong, now=self.now)

    def test_first_creation_ip_csr_has_exact_ip_san_instead_of_dns_spelling(self):
        draft = creation.CreationTests.draft(self)
        draft["audience"] = "https://192.0.2.25/mcp"
        draft["creationWorkload"]["args"] = ["python", "-m", "app.main"]
        pending = initialize(
            draft,
            creation.CreationTests.permit(self, draft),
            root_jwk=self.value["rootJwk"],
            enrollment_objects=creation.Objects(),
            snapshots=self.snapshots,
            wrapper=creation.Wrapper(),
            attestation=self.attestor,
            now=self.now,
        )
        try:
            csr = x509.load_pem_x509_csr(pending.offer["certificateRequest"].encode())
            names = csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            self.assertEqual(
                names.get_values_for_type(x509.IPAddress), [ipaddress.ip_address("192.0.2.25")]
            )
            self.assertEqual(names.get_values_for_type(x509.DNSName), [])
            self.assertTrue(csr.is_signature_valid)
        finally:
            pending.stop()
