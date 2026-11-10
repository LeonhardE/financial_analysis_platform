"""Production transport/startup paths, without asserting real cloud/hardware acceptance."""

import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import UnixStreamServer
from unittest.mock import patch

from fixtures import ACCESS, Fixture

from app.attestation import Attestation
from app.contracts import Stopped, digest
from app.tls import materialize


class StartupTests(Fixture):
    def test_fixed_tee_unix_socket_receives_only_complete_internal_statement_nonce(self):
        self.runtime.restore()
        statement = self.attestor.statements[0]
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                seen.append(
                    (self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                )
                body = b"synthetic.attestation.token"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        with tempfile.TemporaryDirectory(prefix="cs-", dir="/tmp") as directory:
            path = str(Path(directory) / "tee.sock")
            with UnixStreamServer(path, Handler) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    with patch("app.attestation.SOCKET", path):
                        attestation = Attestation(self.config)
                    try:
                        self.assertEqual(
                            attestation.issue(statement), "synthetic.attestation.token"
                        )
                    finally:
                        attestation.close()
                finally:
                    server.shutdown()
                    thread.join(5)
        self.assertEqual(
            seen,
            [
                (
                    "/v1/token",
                    {
                        "audience": "https://policy.example/attestation",
                        "token_type": "OIDC",
                        "nonces": [digest(statement)],
                    },
                )
            ],
        )

    def test_production_tls_context_loads_original_key_then_deletes_ram_files_before_serving(self):
        from app.main import main

        configpath = self.directory / "public-config.json"
        configpath.write_text(json.dumps(self.value))
        seen = []

        def ram(config, key, *, now):
            return materialize(
                config, key, now=now, directory=str(self.directory), require_tmpfs=False
            )

        class Server:
            def __init__(self, settings):
                self.settings = settings

            def run(server):
                settings = server.settings
                seen.append(settings)
                self.assertFalse(Path(settings.ssl_keyfile).exists())
                self.assertFalse(Path(settings.ssl_certfile).exists())
                self.assertFalse(settings.proxy_headers)
                self.assertFalse(settings.access_log)
                self.assertEqual(settings.port, 8443)
                import ssl

                self.assertEqual(settings.ssl.minimum_version, ssl.TLSVersion.TLSv1_3)

        with (
            patch.dict(
                os.environ,
                {"EXECUTOR_ENABLED": "1", "EXECUTOR_CONFIG": str(configpath)},
                clear=True,
            ),
            patch("app.main.PolicyClient", return_value=self.runtime.policy),
            patch(
                "app.main.Attestation",
                return_value=type(
                    "A", (), {"issue": self.attestor.issue, "close": lambda _: None}
                )(),
            ),
            patch("app.main.GCSSnapshots", return_value=self.snapshots),
            patch("app.main.materialize", side_effect=ram),
            patch("app.main.uvicorn.Server", Server),
        ):
            main()
        self.assertEqual(len(seen), 1)
        self.assertTrue(self.authority.confirmed)

    def test_lease_expiring_during_attestation_cannot_authorize_new_access(self):
        self.runtime.restore()

        def expire():
            self.now += 121

        self.authority.after_lease = expire
        with self.assertRaises(Stopped):
            self.runtime.authorize(ACCESS, "execute", self.operation(), [])
