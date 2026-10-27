"""Real synthetic RSA signatures for pinned Google workload identity boundaries."""

import json
import unittest
from dataclasses import FrozenInstanceError

from jwcrypto import jwk, jws

from folioview_shared.delegated_keys import KeyCache
from folioview_shared.encrypted.jsonutil import b64url_encode
from folioview_shared.service_identity import (
    GOOGLE_JWKS_URL,
    GoogleCallerVerifier,
    IdentityVerificationUnavailable,
    InvalidIdentityToken,
    ServiceCaller,
    UntrustedServiceCaller,
    verify_signed_jwt,
)

AUDIENCE = "https://source-service.example.com"
SUBJECT = "112010400000000710080"
EMAIL = "hub@synthetic-project.iam.gserviceaccount.com"
NOW = 10_000
KID = "google_synthetic_key_1"


class GoogleIdentityFixture:
    """Keys never leave memory; transport returns public synthetic JWKS only."""

    def __init__(self, private_key, *, transport=None):
        self.key = private_key
        public = private_key.export(private_key=False, as_dict=True)
        self.public = {field: public[field] for field in ("kty", "n", "e")}
        self.public.update(kid=KID, use="sig", alg="RS256")
        self.calls = []

        def public_keys(url, **kwargs):
            self.calls.append((url, kwargs))
            return json.dumps({"keys": [self.public]}).encode()

        self.cache = KeyCache(
            GOOGLE_JWKS_URL, transport=transport or public_keys, clock=lambda: 100
        )
        self.verifier = GoogleCallerVerifier(
            AUDIENCE, {SUBJECT: EMAIL}, keys=self.cache, clock=lambda: NOW
        )

    @staticmethod
    def claims(**changes):
        return {
            "iss": "https://accounts.google.com",
            "aud": AUDIENCE,
            "sub": SUBJECT,
            "email": EMAIL,
            "email_verified": True,
            "azp": SUBJECT,
            "iat": NOW - 100,
            "exp": NOW + 3500,
            **changes,
        }

    def sign(self, claims=None, *, header=None, key=None, raw=None):
        protected = {"alg": "RS256", "kid": KID, "typ": "JWT"} if header is None else header
        payload = (
            json.dumps(self.claims() if claims is None else claims).encode() if raw is None else raw
        )
        signed = jws.JWS(payload)
        signed.add_signature(key or self.key, protected=json.dumps(protected))
        return signed.serialize(compact=True)


class SignedJwtTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = jwk.JWK.generate(kty="RSA", size=2048)
        cls.other_private = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        self.f = GoogleIdentityFixture(self.private)

    def verify(self, token):
        return verify_signed_jwt(token, keys=self.f.cache, expected_typ="JWT")

    def test_real_compact_signature_verifies_without_issuer_or_permission_inference(self):
        # The primitive authenticates bytes; higher-level verifiers reject issuer.
        claims = self.f.claims(iss="https://untrusted.example.com", purpose="not_authorized")
        self.assertEqual(self.verify(self.f.sign(claims)), claims)
        self.assertEqual(len(self.f.calls), 1)
        self.assertEqual(self.f.calls[0][0], GOOGLE_JWKS_URL)

    def test_wrong_private_key_and_modified_payload_or_truncated_signature_fail(self):
        cases = [self.f.sign(key=self.other_private)]
        token = self.f.sign()
        header, payload, signature = token.split(".")
        changed = b64url_encode(json.dumps(self.f.claims(sub="12345")).encode())
        cases.extend([f"{header}.{changed}.{signature}", f"{header}.{payload}.{signature[:-2]}"])
        for token in cases:
            with self.subTest(token_length=len(token)), self.assertRaises(InvalidIdentityToken):
                self.verify(token)

    def test_algorithms_key_urls_inline_keys_and_extensions_rejected_before_fetch(self):
        base = {"alg": "RS256", "kid": KID, "typ": "JWT"}
        headers = [
            {**base, "alg": "none"},
            {**base, "alg": "HS256"},
            {**base, "alg": "PS256"},
            {**base, "typ": "folioview-delegation+jwt"},
            {**base, "jku": "https://attacker.example.com/SyntheticSecret"},
            {**base, "x5u": "https://attacker.example.com/SyntheticSecret"},
            {**base, "jwk": self.f.public},
            {**base, "crit": []},
            {**base, "b64": False},
            {"alg": "RS256", "typ": "JWT"},
            {**base, "kid": "https://attacker.example.com/key"},
        ]
        for header in headers:
            token = ".".join(
                [
                    b64url_encode(json.dumps(header).encode()),
                    b64url_encode(b"{}"),
                    b64url_encode(b"s" * 256),
                ]
            )
            with self.subTest(header_keys=sorted(header)), self.assertRaises(InvalidIdentityToken):
                self.verify(token)
        self.assertEqual(self.f.calls, [])

    def test_duplicate_json_claims_and_headers_rejected_even_with_valid_signatures(self):
        duplicate_payload = self.f.sign(raw=b'{"sub":"owner_A","sub":"owner_B"}')
        header = b'{"alg":"RS256","alg":"RS256","kid":"google_synthetic_key_1","typ":"JWT"}'
        signed = jws.JWS(json.dumps(self.f.claims()).encode())
        signed.add_signature(self.private, protected=header.decode())
        for token in (duplicate_payload, signed.serialize(compact=True)):
            with self.assertRaises(InvalidIdentityToken):
                self.verify(token)
        self.assertEqual(self.f.calls, [])

    def test_missing_typ_needs_explicit_google_mode_and_wrong_typ_never_accepted(self):
        token = self.f.sign(header={"alg": "RS256", "kid": KID})
        with self.assertRaises(InvalidIdentityToken):
            self.verify(token)
        self.assertEqual(
            verify_signed_jwt(token, keys=self.f.cache, expected_typ="JWT", require_typ=False),
            self.f.claims(),
        )
        wrong = self.f.sign(header={"alg": "RS256", "kid": KID, "typ": "JWT+wrong"})
        with self.assertRaises(InvalidIdentityToken):
            verify_signed_jwt(wrong, keys=self.f.cache, expected_typ="JWT", require_typ=False)

    def test_malformed_compact_shapes_noncanonical_base64_and_budget_fail_before_fetch(self):
        valid = self.f.sign()
        header, payload, signature = valid.split(".")
        cases = [
            None,
            b"bytes",
            "",
            "opaque",
            "..",
            valid + ".extra",
            valid + " ",
            f"{header}=.{payload}.{signature}",
            ".".join([header, payload, ""]),
            "A" * 16_385,
            "合成数据",
        ]
        for token in cases:
            with (
                self.subTest(token_type=type(token).__name__),
                self.assertRaises(InvalidIdentityToken),
            ):
                self.verify(token)
        self.assertEqual(self.f.calls, [])

    def test_jwks_unknown_key_is401_and_unavailability_is503_without_input_diagnostics(self):
        unknown = self.f.sign(header={"alg": "RS256", "kid": "unknown_key", "typ": "JWT"})
        with self.assertRaises(InvalidIdentityToken) as invalid:
            self.verify(unknown)
        self.assertEqual(invalid.exception.status_code, 401)

        def unavailable(*args, **kwargs):
            raise TimeoutError("SyntheticSecret network diagnostic")

        fixture = GoogleIdentityFixture(self.private, transport=unavailable)
        with self.assertRaises(IdentityVerificationUnavailable) as outage:
            verify_signed_jwt(fixture.sign(), keys=fixture.cache, expected_typ="JWT")
        self.assertEqual(outage.exception.status_code, 503)
        self.assertNotIn("SyntheticSecret", str(outage.exception))


class GoogleCallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        self.f = GoogleIdentityFixture(self.private)

    def test_exact_google_service_account_identity_is_frozen_and_contains_no_token(self):
        token = self.f.sign()
        result = self.f.verifier.verify(token)
        self.assertIsInstance(result, ServiceCaller)
        self.assertEqual(
            (result.subject, result.email, result.audience), (SUBJECT, EMAIL, AUDIENCE)
        )
        self.assertEqual((result.issued_at, result.expires_at), (NOW - 100, NOW + 3500))
        self.assertNotIn(token, repr(result))
        with self.assertRaises(FrozenInstanceError):
            result.email = "different@example.com"

    def test_both_exact_google_issuers_optional_typ_and_extra_google_metadata_work(self):
        for issuer in ("https://accounts.google.com", "accounts.google.com"):
            claims = self.f.claims(
                iss=issuer, google={"compute_engine": {"project_id": "synthetic"}}
            )
            result = self.f.verifier.verify(
                self.f.sign(claims, header={"alg": "RS256", "kid": KID})
            )
            self.assertEqual(result.issuer, issuer)

    def test_self_signed_assertions_firebase_access_tokens_and_wrong_issuers_fail(self):
        for issuer in (
            EMAIL,
            "https://securetoken.google.com/project",
            "https://accounts.google.com/",
            "https://accounts.google.com.attacker.example.com",
            ["https://accounts.google.com"],
        ):
            with self.subTest(issuer=issuer), self.assertRaises(InvalidIdentityToken):
                self.f.verifier.verify(self.f.sign(self.f.claims(iss=issuer)))
        for token in ("opaque_access_token", "header.payload."):
            with self.assertRaises(InvalidIdentityToken):
                self.f.verifier.verify(token)

    def test_audience_must_be_the_single_exact_string_not_list_or_prefix(self):
        for audience in (None, [AUDIENCE], AUDIENCE + "/", AUDIENCE + "/internal", "other_target"):
            with self.subTest(audience=audience), self.assertRaises(InvalidIdentityToken):
                self.f.verifier.verify(self.f.sign(self.f.claims(aud=audience)))

    def test_subject_email_pair_is_pinned_even_after_email_recreation_or_subject_spoof(self):
        for claims in (
            self.f.claims(sub="999999999999999999999", azp="999999999999999999999"),
            self.f.claims(email="other@synthetic-project.iam.gserviceaccount.com"),
        ):
            with self.assertRaises(UntrustedServiceCaller) as refused:
                self.f.verifier.verify(self.f.sign(claims))
            self.assertEqual(refused.exception.status_code, 403)

    def test_user_identities_unverified_email_and_malformed_service_claims_are_invalid(self):
        cases = [
            self.f.claims(sub="a_user_uid", azp="a_user_uid"),
            self.f.claims(email="user@gmail.com"),
            self.f.claims(email_verified=False),
            self.f.claims(email_verified="true"),
            self.f.claims(azp="different_presenter"),
            self.f.claims(sub=123),
            self.f.claims(email=None),
        ]
        for claims in cases:
            with self.subTest(changed_fields=list(claims)), self.assertRaises(InvalidIdentityToken):
                self.f.verifier.verify(self.f.sign(claims))
        claims = self.f.claims()
        del claims["azp"]  # azp is optional, but when present it must agree.
        self.assertEqual(self.f.verifier.verify(self.f.sign(claims)).subject, SUBJECT)

    def test_numeric_times_have_strict_types_order_and_one_hour_maximum_lifetime(self):
        changes = [
            {"iat": True},
            {"exp": float(NOW + 3500)},
            {"iat": str(NOW - 100)},
            {"exp": None},
            {"iat": -1},
            {"exp": NOW - 100},
            {"iat": NOW - 100, "exp": NOW + 3501},
            {"nbf": True},
            {"nbf": NOW - 101},
            {"nbf": NOW + 3500},
            {"nbf": NOW + 31},
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(InvalidIdentityToken):
                self.f.verifier.verify(self.f.sign(self.f.claims(**change)))

    def test_expiry_and_future_issue_respect_only_the_bounded_configured_skew(self):
        accepted = [
            self.f.claims(iat=NOW - 3500, exp=NOW - 29),
            self.f.claims(iat=NOW + 30, exp=NOW + 3600),
            self.f.claims(nbf=NOW + 30),
        ]
        for claims in accepted:
            self.f.verifier.verify(self.f.sign(claims))
        rejected = [
            self.f.claims(iat=NOW - 3500, exp=NOW - 30),
            self.f.claims(iat=NOW + 31, exp=NOW + 3600),
        ]
        for claims in rejected:
            with self.assertRaises(InvalidIdentityToken):
                self.f.verifier.verify(self.f.sign(claims))
        strict = GoogleCallerVerifier(
            AUDIENCE, {SUBJECT: EMAIL}, keys=self.f.cache, clock=lambda: NOW, clock_skew_seconds=0
        )
        with self.assertRaises(InvalidIdentityToken):
            strict.verify(self.f.sign(self.f.claims(iat=NOW - 3500, exp=NOW)))

    def test_invalid_clock_is_unavailable_and_configuration_is_not_token_selected(self):
        for clock in (lambda: float("nan"), lambda: -1, lambda: True, lambda: "now"):
            verifier = GoogleCallerVerifier(
                AUDIENCE, {SUBJECT: EMAIL}, keys=self.f.cache, clock=clock
            )
            with self.assertRaises(IdentityVerificationUnavailable):
                verifier.verify(self.f.sign())
        untrusted_keys = KeyCache(
            "https://attacker.example.com/keys", transport=lambda *a, **k: b"{}"
        )
        with self.assertRaises(ValueError):
            GoogleCallerVerifier(AUDIENCE, {SUBJECT: EMAIL}, keys=untrusted_keys)
        for config in (
            {"clock_skew_seconds": 61},
            {"clock_skew_seconds": True},
            {"audience": ""},
            {"allowed_callers": {}},
            {"allowed_callers": {"not_numeric": EMAIL}},
            {"allowed_callers": {SUBJECT: "user@gmail.com"}},
        ):
            options = {"audience": AUDIENCE, "allowed_callers": {SUBJECT: EMAIL}, **config}
            with self.subTest(config=config), self.assertRaises(ValueError):
                GoogleCallerVerifier(**options)

    def test_allowlist_is_copied_and_multiple_explicit_service_pairs_can_be_trusted(self):
        allowed = {SUBJECT: EMAIL, "123456": "other@synthetic-project.iam.gserviceaccount.com"}
        verifier = GoogleCallerVerifier(AUDIENCE, allowed, keys=self.f.cache, clock=lambda: NOW)
        allowed[SUBJECT] = "attacker@synthetic-project.iam.gserviceaccount.com"
        self.assertEqual(verifier.verify(self.f.sign()).email, EMAIL)
        other = self.f.claims(
            sub="123456", azp="123456", email="other@synthetic-project.iam.gserviceaccount.com"
        )
        self.assertEqual(verifier.verify(self.f.sign(other)).subject, "123456")


if __name__ == "__main__":
    unittest.main()
