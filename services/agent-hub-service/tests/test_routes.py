"""Authenticated encrypted archive routes and real two-token public-authority reads."""

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from fixtures import BOOT, OTHER_UID, SOURCE, UID, VaultFixture
from jwcrypto import jwk
from test_delegation import DelegationFixture

from app.api import get_delegation_verifier, get_service, require_owner
from app.main import app
from app.store import SQLiteHubStore
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.schema import validate_schema


class VaultRoutesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.google_key = jwk.JWK.generate(kty="RSA", size=2048)
        cls.hub_key = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.service = VaultService(
            SQLiteHubStore(Path(self.directory.name) / "hub.sqlite3"), clock=lambda: 1000
        )
        self.f = VaultFixture()
        app.dependency_overrides[get_service] = lambda: self.service
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=UID)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION, "Idempotency-Key": BOOT}

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())

    def test_owner_enrollment_source_creation_and_current_state_are_closed_no_store(self):
        self.assertIsNone(
            self.client.get("/api/v2/vaults/current", headers=self.headers).json()["vault"]
        )
        response = self.client.post("/api/v2/vaults", headers=self.headers, json=self.f.bootstrap())
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        url = f"/api/v2/vaults/{self.f.vault}/holdings-sources/{SOURCE}"
        headers = {
            **self.headers,
            "Idempotency-Key": "synthetic_source_create_0001",
            "X-FolioView-Author-Key": self.f.kid("device_sig"),
        }
        created = self.client.post(url, headers=headers, json=self.f.control())
        self.assertEqual(created.status_code, 201, created.text)
        current = self.client.get("/api/v2/vaults/current", headers=self.headers).json()
        self.assertEqual(current["sources"], [created.json()["source"]])
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=OTHER_UID)
        self.assertIsNone(
            self.client.get("/api/v2/vaults/current", headers=self.headers).json()["vault"]
        )

    def test_malformed_headers_queries_private_fields_and_body_size_are_rejected(self):
        for headers, body in (
            ({}, self.f.bootstrap()),
            (self.headers, {**self.f.bootstrap(), "owner": OTHER_UID}),
            (self.headers, {**self.f.bootstrap(), "token": "not-accepted"}),
        ):
            self.failure(self.client.post("/api/v2/vaults", headers=headers, json=body), 400)
        self.failure(self.client.get("/api/v2/vaults/current?uid=other", headers=self.headers), 400)
        self.failure(
            self.client.post(
                "/api/v2/vaults",
                headers={**self.headers, "Content-Type": "text/plain"},
                content="{}",
            ),
            415,
        )
        self.failure(
            self.client.post(
                "/api/v2/vaults",
                headers={**self.headers, "Content-Type": "application/json"},
                content=b"x" * 589825,
            ),
            413,
        )
        self.assertIsNone(self.service.current(UID)["vault"])

    def test_root_thumbprint_mismatch_has_a_fixed_public_integrity_error(self):
        foreign = VaultFixture(UID)
        value = self.f.bootstrap()
        value["rootKeyId"] = foreign.root_id
        response = self.client.post("/api/v2/vaults", headers=self.headers, json=value)
        self.failure(response, 422)
        self.assertEqual(response.json()["error"]["code"], "recipient_binding_mismatch")
        self.assertIsNone(self.service.current(UID)["vault"])

    def test_missing_owner_credentials_and_missing_kms_are_safely_rejected(self):
        app.dependency_overrides.pop(require_owner)
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            self.failure(self.client.get("/api/v2/vaults/current", headers=self.headers), 401)
            self.failure(self.client.get("/.well-known/jwks.json"), 503)

    def test_authority_token_body_cannot_select_uid_caller_audience_or_scope(self):
        self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        for extra in (
            {"uid": OTHER_UID},
            {"caller": "other"},
            {"audience": "https://other.example"},
            {"scopes": ["portfolio:write"]},
        ):
            self.failure(
                self.client.post(
                    "/api/v2/vaults/current/authority-token",
                    headers=self.headers,
                    json={"contractVersion": CONTRACT_VERSION, **extra},
                ),
                400,
            )

    def test_owner_token_and_public_jwks_http_roundtrip_use_fixed_narrow_claims(self):
        from test_delegation import ISSUER
        from test_service_identity import EMAIL, NOW
        from test_signing import KEY, KMSRpc

        from app.signing import KMSSigner
        from folioview_shared.delegated_keys import KeyCache
        from folioview_shared.delegation import DELEGATION_TYPE
        from folioview_shared.service_identity import verify_signed_jwt

        self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        signer = KMSSigner(KEY, client=KMSRpc())
        config = {"HUB_SERVICE_AUDIENCE": ISSUER, "HUB_PORTFOLIO_CALLER_EMAIL": EMAIL}
        with (
            patch.dict(os.environ, config, clear=True),
            patch("app.api.get_signer", return_value=signer),
            patch("app.signing.time.time", return_value=NOW),
        ):
            response = self.client.post(
                "/api/v2/vaults/current/authority-token",
                headers=self.headers,
                json={"contractVersion": CONTRACT_VERSION},
            )
            public = self.client.get("/.well-known/jwks.json")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(public.status_code, 200, public.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(public.headers["cache-control"], "no-store")
        self.assertEqual(set(response.json()), {"contractVersion", "token", "expiresAt"})
        keys = KeyCache(
            ISSUER + "/.well-known/jwks.json", transport=lambda *args, **kwargs: public.content
        )
        claims = verify_signed_jwt(
            response.json()["token"], keys=keys, expected_typ=DELEGATION_TYPE
        )
        self.assertEqual((claims["sub"], claims["caller"]), (UID, EMAIL))
        self.assertEqual(claims["aud"], ISSUER + "/internal/v2")
        self.assertEqual(claims["resourceKinds"], ["holdings"])
        self.assertEqual(claims["scopes"], ["resources:catalog"])
        self.assertEqual(response.json()["expiresAt"], NOW + 60)

    def test_signed_internal_read_requires_both_credentials_and_exact_owner(self):
        self.service.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.service.create_source(
            UID,
            self.f.vault,
            SOURCE,
            self.f.control(),
            "synthetic_source_create_0001",
            self.f.kid("device_sig"),
        )
        f = DelegationFixture(self.google_key, self.hub_key, source="portfolio")
        app.dependency_overrides[get_delegation_verifier] = lambda: f.verifier
        token = f.sign(f.catalog(sub=UID, resourceKinds=["holdings"]))
        headers = {
            "Authorization": "Bearer " + f.service_token(),
            "X-FolioView-Delegation": token,
            "X-FolioView-Contract": CONTRACT_VERSION,
        }
        url = "/internal/v2/portfolio-authorities/read"
        body = {"contractVersion": CONTRACT_VERSION, "sourceId": SOURCE}
        result = self.client.post(url, headers=headers, json=body)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertNotIn("archive", result.json()["authority"])
        for field in ("Authorization", "X-FolioView-Delegation"):
            self.failure(
                self.client.post(
                    url, headers={k: v for k, v in headers.items() if k != field}, json=body
                ),
                401,
            )
        self.failure(
            self.client.post(
                url,
                headers={
                    **headers,
                    "X-FolioView-Delegation": f.sign(
                        f.catalog(sub=OTHER_UID, resourceKinds=["holdings"])
                    ),
                },
                json=body,
            ),
            404,
        )
        self.failure(
            self.client.post(
                url,
                headers={
                    **headers,
                    "X-FolioView-Delegation": f.sign(
                        f.catalog(sub=UID, resourceKinds=["watchlist"])
                    ),
                },
                json=body,
            ),
            403,
        )
        self.failure(self.client.post(url, headers=headers, json={**body, "owner": UID}), 400)
        run = f.sign(f.run(sub=UID, scopes=["portfolio:read"], resources=[f.holdings.as_claim()]))
        self.failure(
            self.client.post(url, headers={**headers, "X-FolioView-Delegation": run}, json=body),
            403,
        )

    def test_unconfigured_internal_trust_fails_before_storage_or_network(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch.object(self.service, "authority", side_effect=AssertionError("storage")),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            self.failure(
                self.client.post(
                    "/internal/v2/portfolio-authorities/read",
                    headers=self.headers,
                    json={"contractVersion": CONTRACT_VERSION, "sourceId": SOURCE},
                ),
                503,
            )
