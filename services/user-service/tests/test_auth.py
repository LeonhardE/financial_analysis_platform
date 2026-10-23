"""Identity boundary tests; no real credentials or Firebase network calls."""

import os
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from firebase_admin import auth, exceptions
from google.auth.exceptions import DefaultCredentialsError, TransportError
from requests.exceptions import ConnectionError

from app.main import app
from folioview_shared import auth as app_auth

PROJECT_ID = "test-financial-analysis"
TOKEN = "test-id-token"
CLAIMS = {
    "uid": "verified-user-123",
    "email": "verified@example.com",
    "name": "Verified User",
    "picture": "https://example.com/avatar.jpg",
    "firebase": {"sign_in_provider": "google.com"},
    "aud": PROJECT_ID,
    "iss": f"https://securetoken.google.com/{PROJECT_ID}",
    "unrelated_private_claim": "never-return-this",
}


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {"FIREBASE_PROJECT_ID": PROJECT_ID, "MARKET_DATA_SOURCE": "mock"},
            clear=True,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.firebase_app = SimpleNamespace(project_id=PROJECT_ID)
        self.get_app = patch.object(
            app_auth.firebase_admin, "get_app", return_value=self.firebase_app
        )
        self.get_app_mock = self.get_app.start()
        self.addCleanup(self.get_app.stop)
        self.verifier = patch.object(
            app_auth.auth, "verify_id_token", return_value=deepcopy(CLAIMS)
        )
        self.verify_mock = self.verifier.start()
        self.addCleanup(self.verifier.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def get_me(self, **kwargs):
        return self.client.get("/api/v1/me", headers={"Authorization": f"Bearer {TOKEN}"}, **kwargs)

    def assert_no_store(self, response):
        self.assertEqual(response.headers.get("cache-control"), "no-store")

    def test_verified_identity_is_only_source_and_response_has_no_raw_claims(self):
        response = self.get_me(params={"uid": "attacker", "email": "attacker@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "uid": CLAIMS["uid"],
                "email": CLAIMS["email"],
                "displayName": CLAIMS["name"],
                "photoURL": CLAIMS["picture"],
            },
        )
        self.verify_mock.assert_called_once_with(TOKEN, app=self.firebase_app, check_revoked=True)
        self.assert_no_store(response)

    def test_profile_fields_can_be_absent(self):
        self.verify_mock.return_value = {
            "uid": "minimal-user",
            "firebase": {"sign_in_provider": "google.com"},
        }
        response = self.get_me()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"uid": "minimal-user", "email": None, "displayName": None, "photoURL": None},
        )

    def test_spoofed_identity_headers_and_query_cannot_authenticate(self):
        response = self.client.get(
            "/api/v1/me?uid=attacker&token=unverified",
            headers={"X-User-Id": "attacker", "X-User-Email": "attacker@example.com"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers.get("www-authenticate"), "Bearer")
        self.assert_no_store(response)
        self.verify_mock.assert_not_called()

    def test_missing_or_malformed_bearer_is_rejected_before_sdk(self):
        for header in ("", "Basic something", "Bearer", "Bearer ", "Bearer one two"):
            with self.subTest(header=header):
                response = self.client.get("/api/v1/me", headers={"Authorization": header})
                self.assertEqual(response.status_code, 401)
                self.assert_no_store(response)
        self.verify_mock.assert_not_called()

    def test_duplicate_authorization_headers_are_rejected(self):
        response = self.client.get(
            "/api/v1/me",
            headers=[("Authorization", f"Bearer {TOKEN}"), ("Authorization", "Bearer attacker")],
        )
        self.assertEqual(response.status_code, 401)
        self.verify_mock.assert_not_called()

    def test_bearer_scheme_is_case_insensitive(self):
        response = self.client.get("/api/v1/me", headers={"Authorization": f"bearer {TOKEN}"})
        self.assertEqual(response.status_code, 200)

    def test_sdk_rejects_invalid_expired_revoked_disabled_deleted_and_wrong_project(self):
        failures = (
            auth.InvalidIdTokenError("invalid signature"),
            auth.InvalidIdTokenError("wrong audience/project"),
            auth.ExpiredIdTokenError("expired", None),
            auth.RevokedIdTokenError("revoked"),
            auth.UserDisabledError("disabled"),
            auth.UserNotFoundError("deleted"),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__, reason=str(failure)):
                self.verify_mock.side_effect = failure
                response = self.get_me()
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json(), {"detail": "A valid Google sign-in is required"})
                self.assert_no_store(response)
                self.assertNotIn(str(failure), response.text)

    def test_non_google_or_missing_provider_and_missing_uid_are_rejected(self):
        for claims in (
            {"uid": "user", "firebase": {"sign_in_provider": "password"}},
            {"uid": "user", "firebase": {"sign_in_provider": "anonymous"}},
            {"uid": "user"},
            {"firebase": {"sign_in_provider": "google.com"}},
            {"uid": "", "firebase": {"sign_in_provider": "google.com"}},
        ):
            with self.subTest(claims=claims):
                self.verify_mock.return_value = claims
                response = self.get_me()
                self.assertEqual(response.status_code, 401)

    def test_certificate_credentials_permission_network_and_configuration_errors_are_503(self):
        failures = (
            auth.CertificateFetchError("failed fetching certificate", None),
            DefaultCredentialsError("missing ADC"),
            exceptions.PermissionDeniedError("missing firebaseauth.users.get"),
            exceptions.UnavailableError("Firebase unavailable"),
            TransportError("transport unavailable"),
            ConnectionError("network unavailable"),
            ValueError("invalid emulator configuration"),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                self.verify_mock.side_effect = failure
                response = self.get_me()
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"detail": "Sign-in is temporarily unavailable"})
                self.assert_no_store(response)

    def test_missing_project_fails_closed_but_service_health_still_works(self):
        os.environ.pop("FIREBASE_PROJECT_ID")
        response = self.get_me()
        self.assertEqual(response.status_code, 503)
        self.assert_no_store(response)
        self.get_app_mock.assert_not_called()
        self.verify_mock.assert_not_called()
        self.assertEqual(self.client.get("/health").json(), {"status": "ok", "service": "user"})
        for path in ("/api/stocks", "/api/stocks/AAPL/candles", "/api/v1/preferences"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)
        self.get_app_mock.assert_not_called()

    def test_initialized_app_must_use_explicit_configured_project(self):
        self.firebase_app.project_id = "different-project"
        response = self.get_me()
        self.assertEqual(response.status_code, 503)
        self.verify_mock.assert_not_called()

    def test_initialization_is_lazy_and_project_bound_without_private_key(self):
        self.get_app_mock.side_effect = ValueError("not initialized")
        with patch.object(
            app_auth.firebase_admin, "initialize_app", return_value=self.firebase_app
        ) as initialize:
            response = self.get_me()
        self.assertEqual(response.status_code, 200)
        initialize.assert_called_once_with(
            options={"projectId": PROJECT_ID, "httpTimeout": 10}, name="financial-analysis-api"
        )

    def test_initialization_failures_are_503(self):
        self.get_app_mock.side_effect = DefaultCredentialsError("missing ADC")
        response = self.get_me()
        self.assertEqual(response.status_code, 503)
        self.verify_mock.assert_not_called()

    def test_emulator_is_rejected_on_cloud_run_without_affecting_public_routes(self):
        os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = "127.0.0.1:9099"
        os.environ["K_SERVICE"] = "market-api"
        response = self.get_me()
        self.assertEqual(response.status_code, 503)
        self.get_app_mock.assert_not_called()
        self.verify_mock.assert_not_called()
        self.assertEqual(self.client.get("/health").status_code, 200)

    def test_official_auth_emulator_can_be_used_locally(self):
        os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = "127.0.0.1:9099"
        response = self.get_me()
        self.assertEqual(response.status_code, 200)
        self.verify_mock.assert_called_once_with(TOKEN, app=self.firebase_app, check_revoked=True)

    def test_authorization_header_is_allowed_by_existing_cors(self):
        response = self.client.options(
            "/api/v1/me",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")


if __name__ == "__main__":
    unittest.main()
