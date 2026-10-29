"""Real signed Google service identities at the narrow reverse-fence HTTP API."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from jwcrypto import jwk
from test_fences import OWNER, REF, mutation
from test_service_identity import NOW, SUBJECT, GoogleIdentityFixture

from app.api import configured_fence_verifier, get_fence_service, get_fence_verifier
from app.fences import FenceService, fence_path
from app.main import app
from app.store import SQLiteHubStore
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.service_identity import GoogleCallerVerifier

AUDIENCE = "https://synthetic-hub.example.com"
EMAIL = "portfolio@synthetic-project.iam.gserviceaccount.com"
URL = "/internal/v2/source-fences"


class FenceRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = SQLiteHubStore(Path(self.directory.name) / "hub.sqlite3")
        self.service = FenceService(self.store, clock=lambda: 1000)
        self.identity = GoogleIdentityFixture(self.key)
        self.verifier = GoogleCallerVerifier(
            AUDIENCE, {SUBJECT: EMAIL}, keys=self.identity.cache, clock=lambda: NOW
        )
        app.dependency_overrides[get_fence_service] = lambda: self.service
        app.dependency_overrides[get_fence_verifier] = lambda: self.verifier
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {
            "Authorization": "Bearer " + self.token(),
            "X-FolioView-Contract": CONTRACT_VERSION,
        }

    def token(self, **changes):
        claims = self.identity.claims(aud=AUDIENCE, email=EMAIL)
        return self.identity.sign({**claims, **changes})

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())
        for value in (self.headers["Authorization"], "synthetic-private-marker"):
            self.assertNotIn(value, response.text)

    def post(self, value=None, *, headers=None, url=URL):
        return self.client.post(
            url,
            headers=self.headers if headers is None else headers,
            json=mutation() if value is None else value,
        )

    def test_valid_workload_invalidates_only_and_returns_exact_historical_ack(self):
        with patch("app.api.get_signer", side_effect=AssertionError("No KMS needed")):
            first = self.post()
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.headers["cache-control"], "no-store")
        self.assertEqual(first.json()["acknowledgedSourceEpoch"], 2)
        self.assertNotIn("ownerSubject", first.json())
        self.assertEqual(self.post(mutation(2)).status_code, 200)
        self.assertEqual(self.post().content, first.content)
        current = self.store.transact(lambda unit: unit.get(fence_path(OWNER, REF)))
        self.assertEqual(current["sourceEpoch"], 3)
        self.failure(self.client.post("/api/v2/results", headers=self.headers, json={}), 404)

    def test_full_signed_authorization_not_forwarded_headers_or_other_token_families(self):
        invalid = [
            {},
            {"X-Serverless-Authorization": self.headers["Authorization"]},
            {"X-Owner-Uid": OWNER},
            {"Authorization": "Bearer synthetic-private-marker"},
            {"Authorization": self.headers["Authorization"][:-2]},
            {
                "Authorization": "Bearer "
                + self.token(iss="https://securetoken.google.com/synthetic")
            },
            {"Authorization": "Bearer " + self.token(exp=NOW - 60, iat=NOW - 120)},
            {"Authorization": "Bearer " + self.token(aud="https://other.example")},
        ]
        for headers in invalid:
            with self.subTest(headers=sorted(headers)):
                self.failure(
                    self.post(headers={"X-FolioView-Contract": CONTRACT_VERSION, **headers}), 401
                )
        for token in (
            self.token(sub="987654321000000000000", azp="987654321000000000000"),
            self.token(email="other@synthetic.iam.gserviceaccount.com"),
        ):
            self.failure(
                self.post(headers={**self.headers, "Authorization": "Bearer " + token}), 403
            )
        self.failure(
            self.post(
                headers={**self.headers, "X-FolioView-Delegation": "synthetic-private-marker"}
            ),
            403,
        )
        self.assertIsNone(self.store.transact(lambda unit: unit.get(fence_path(OWNER, REF))))

    def test_duplicate_authorization_and_contract_headers_cannot_select_identity(self):
        for field in ("Authorization", "X-FolioView-Contract"):
            headers = list(self.headers.items()) + [(field, self.headers[field])]
            self.failure(self.post(headers=headers), 401 if field == "Authorization" else 400)

    def test_closed_transport_and_body_reject_cross_namespace_and_unbounded_input(self):
        self.failure(self.post(url=URL + "?owner=other"), 400)
        self.failure(self.post(headers={"Authorization": self.headers["Authorization"]}), 400)
        for value in (
            {**mutation(), "uid": "synthetic-private-marker"},
            {**mutation(), "body": "synthetic-private-marker"},
            mutation(newSourceEpoch=10),
            mutation(ownerSubject="raw-firebase-uid"),
        ):
            self.failure(self.post(value), 400)
        self.failure(
            self.post(mutation(ref={**REF, "sourceService": "user", "kind": "watchlist"})), 403
        )
        self.failure(
            self.client.post(
                URL, headers={**self.headers, "Content-Type": "text/plain"}, content="{}"
            ),
            415,
        )
        self.failure(
            self.client.post(
                URL,
                headers={**self.headers, "Content-Type": "application/json"},
                content=b"x" * 8193,
            ),
            413,
        )
        duplicate = canonical_json(mutation()).decode()[:-1] + ',"reason":"deleted"}'
        self.failure(
            self.client.post(
                URL, headers={**self.headers, "Content-Type": "application/json"}, content=duplicate
            ),
            400,
        )
        self.assertIsNone(self.store.transact(lambda unit: unit.get(fence_path(OWNER, REF))))

    def test_conflicts_and_storage_faults_have_safe_no_store_errors(self):
        self.assertEqual(self.post().status_code, 200)
        for value in (
            mutation(reason="deleted"),
            mutation(mutationId="synthetic_conflicting_mutation"),
        ):
            self.failure(self.post(value), 409)
        with patch.object(
            self.store, "transact", side_effect=RuntimeError("synthetic-private-marker")
        ):
            self.failure(self.post(mutation(2)), 503)

    def test_missing_config_or_key_discovery_failure_never_falls_back(self):
        app.dependency_overrides.pop(get_fence_verifier)
        for config in (
            {},
            {
                "HUB_SERVICE_AUDIENCE": AUDIENCE,
                "HUB_PORTFOLIO_CALLER_EMAIL": EMAIL,
                "HUB_TRUSTED_PORTFOLIO_CALLERS": json.dumps(
                    {SUBJECT: "other@synthetic.iam.gserviceaccount.com"}
                ),
            },
            {
                "HUB_SERVICE_AUDIENCE": AUDIENCE,
                "HUB_PORTFOLIO_CALLER_EMAIL": EMAIL,
                "HUB_TRUSTED_PORTFOLIO_CALLERS": json.dumps({"not-numeric": EMAIL}),
            },
        ):
            configured_fence_verifier.cache_clear()
            with (
                patch.dict(os.environ, config, clear=True),
                patch("socket.create_connection", side_effect=AssertionError("No network")),
            ):
                self.failure(self.post(), 503)
        configured_fence_verifier.cache_clear()

        def unavailable(*args, **kwargs):
            raise TimeoutError("synthetic-private-marker")

        fixture = GoogleIdentityFixture(self.key, transport=unavailable)
        verifier = GoogleCallerVerifier(
            AUDIENCE, {SUBJECT: EMAIL}, keys=fixture.cache, clock=lambda: NOW
        )
        app.dependency_overrides[get_fence_verifier] = lambda: verifier
        self.failure(self.post(), 503)

    def test_production_pin_configuration_is_lazy_and_does_not_require_signer(self):
        config = (AUDIENCE, EMAIL, json.dumps({SUBJECT: EMAIL}))
        with patch("socket.create_connection", side_effect=AssertionError("No network")):
            verifier = configured_fence_verifier(config)
        verifier._keys = self.identity.cache
        verifier._clock = lambda: NOW
        app.dependency_overrides[get_fence_verifier] = lambda: verifier
        self.assertEqual(self.post().status_code, 200)
        configured_fence_verifier.cache_clear()
