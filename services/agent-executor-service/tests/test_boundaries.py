"""Original TLS, strict public pins, protocol transport and closed runtime surface."""

import hashlib
import json
import os
import socket
import ssl
import threading
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from fixtures import ACCESS, Fixture, cert_for, secret_packet

from app.attestation import Attestation
from app.config import Config
from app.contracts import Stopped, clone
from app.health_check import probe
from app.main import app
from app.policy import open_secret
from app.tls import certificate, materialize


class BoundaryTests(Fixture):
    def test_public_config_rejects_private_keys_added_fields_changed_scope_and_runtime(self):
        mutations = [
            lambda v: v.update(extra=True),
            lambda v: v.update(rootJwk=self.keys["root"].export(private_key=True, as_dict=True)),
            lambda v: v["binding"].update(providerClientId="wrong_provider"),
            lambda v: v["scope"].update(purpose="export"),
            lambda v: v["workload"].update(args=["sh", "-c", "unsafe"]),
            lambda v: v["workload"].update(environment={"DEBUG": "1"}),
            lambda v: v.update(policyJwk=v["agentSigningJwk"]),
        ]
        for change in mutations:
            v = clone(self.value)
            change(v)
            with self.assertRaises(Stopped):
                Config.parse(v, now=self.now)

    def test_certificate_requires_original_key_exact_hostname_and_fresh_validity(self):
        for replacement in [
            cert_for(self.keys["signing"]),
            cert_for(self.keys["tls"], "other.example"),
            cert_for(self.keys["tls"], "*.example"),
            cert_for(self.keys["tls"], start=-120, end=-1),
            cert_for(self.keys["tls"], start=3600, end=7200),
        ]:
            config = Config.parse({**self.value, "certificateChain": replacement}, now=self.now)
            with self.assertRaises(Stopped):
                certificate(config, now=self.now)

    def test_same_original_tls_key_accepts_only_policy_approved_certificate_replacement(self):
        new = Config.parse(
            {**self.value, "certificateChain": cert_for(self.keys["tls"])}, now=self.now
        )
        self.assertNotEqual(certificate(new, now=self.now), certificate(self.config, now=self.now))
        with self.assertRaises(Stopped):
            self.new_runtime(new).restore()
        self.authority.config = new
        self.assertEqual(self.new_runtime(new).restore()["tlsJwk"], self.value["tlsJwk"])

    def test_real_tls13_handshake_uses_original_key_and_cleans_private_files(self):
        self.runtime.restore()
        errors = []
        with materialize(
            self.config,
            self.runtime._keys["tls"],
            now=self.now,
            directory=str(self.directory),
            require_tmpfs=False,
        ) as (context, chain, keyfile):
            keypath = Path(keyfile)
            self.assertEqual(keypath.stat().st_mode & 0o777, 0o600)
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            listener.settimeout(5)
            self.addCleanup(listener.close)

            def serve():
                try:
                    stream, _ = listener.accept()
                    with context.wrap_socket(stream, server_side=True) as tls:
                        self.assertEqual(tls.recv(4), b"ping")
                        tls.sendall(b"pong")
                except Exception as e:
                    errors.append(e)

            worker = threading.Thread(target=serve)
            worker.start()
            client = ssl.create_default_context(cadata=self.value["certificateChain"])
            client.minimum_version = ssl.TLSVersion.TLSv1_3
            with socket.create_connection(listener.getsockname(), timeout=5) as stream:
                with client.wrap_socket(stream, server_hostname="executor.example") as tls:
                    self.assertEqual(tls.version(), "TLSv1.3")
                    tls.sendall(b"ping")
                    self.assertEqual(tls.recv(4), b"pong")
            worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(errors, [])
            self.assertTrue(Path(chain).exists())
        self.assertFalse(keypath.exists())

    def test_secret_context_header_and_recipient_cannot_be_changed(self):
        packet = secret_packet(b"a" * 32, self.value["agentEncryptionJwk"], {"scope": "synthetic"})
        self.assertEqual(
            open_secret(packet, self.keys["encryption"], {"scope": "synthetic"}), b"a" * 32
        )
        for key, context in [
            (self.keys["signing"], {"scope": "synthetic"}),
            (self.keys["encryption"], {"scope": "wrong"}),
        ]:
            with self.assertRaises(Stopped):
                open_secret(packet, key, context)
        packet["extra"] = True
        with self.assertRaises(Stopped):
            open_secret(packet, self.keys["encryption"], {"scope": "synthetic"})

    def test_attestation_requests_bind_complete_statement_and_fixed_audience(self):
        self.runtime.restore()
        statement = self.attestor.statements[0]
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200, text="synthetic.attestation.token")

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            attestor = Attestation(self.config, client=client)
            attestor.issue(statement)
            request = seen[0]
            body = json.loads(request.content)
            self.assertEqual(str(request.url), "http://localhost/v1/token")
            self.assertEqual(
                body,
                {
                    "audience": "https://policy.example/attestation",
                    "token_type": "OIDC",
                    "nonces": [
                        hashlib.sha256(
                            __import__(
                                "folioview_shared.encrypted.jsonutil", fromlist=["canonical_json"]
                            ).canonical_json(statement)
                        ).hexdigest()
                    ],
                },
            )
            with self.assertRaises(Stopped):
                attestor.issue({**statement, "arbitraryNonce": "caller_input"})
            self.assertEqual(len(seen), 1)

    def test_redirects_oversized_responses_and_unexpected_content_are_closed(self):
        for response in [
            httpx.Response(302, headers={"location": "https://attacker.example"}),
            httpx.Response(200, text="not JSON"),
            httpx.Response(200, json={"profile": "wrong"}),
            httpx.Response(
                200, headers={"content-type": "application/json"}, content=b"x" * 131073
            ),
        ]:
            with httpx.Client(
                transport=httpx.MockTransport(lambda r, response=response: response)
            ) as client:
                from app.policy import PolicyClient

                p = PolicyClient(self.config, client=client, clock=lambda: self.now)
                with self.assertRaises(Stopped):
                    p.call("checkpoint", {}, self.keys["signing"], access=ACCESS)

    def test_offline_probe_never_touches_cloud_or_runtime_initialization(self):
        with (
            patch.dict(os.environ, {"FOLIOVIEW_EXECUTION_MODE": "offline_probe"}, clear=True),
            patch("app.main.GCSSnapshots") as storage,
            patch("app.runtime.Executor.restore") as restore,
        ):
            self.assertEqual(
                probe(),
                {
                    "profile": "confidential_vm_offline_probe.v1",
                    "status": "ok",
                    "contentServiceEnabled": False,
                    "keyReleaseAttempted": False,
                    "attestationVerified": False,
                },
            )
            storage.assert_not_called()
            restore.assert_not_called()
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                probe()

    def test_default_runtime_exposes_no_crypto_proxy_or_business_tools(self):
        with TestClient(app) as client:
            self.assertEqual(client.get("/health").status_code, 503)
            self.assertFalse(client.get("/health").json()["contentServiceEnabled"])
            for path in ["/sign", "/decrypt", "/attest", "/initialize", "/mcp"]:
                self.assertIn(client.post(path).status_code, [404, 503])
            self.assertEqual(client.get("/health?nonce=caller").status_code, 400)
            self.assertEqual(client.get("/openapi.json").status_code, 404)
            self.assertEqual(client.get("/api/v1/executor/identity").status_code, 503)

    def test_production_entry_has_no_creation_or_file_snapshot_fallback(self):
        from app.main import main

        with patch.dict(os.environ, {}, clear=True), patch("app.main.GCSSnapshots") as snapshots:
            with self.assertRaises(Stopped):
                main()
            snapshots.assert_not_called()
