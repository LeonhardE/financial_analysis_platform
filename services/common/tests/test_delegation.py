"""Synthetic signed two-credential delegation and opt-in HTTP boundaries."""

import json
import unittest
from dataclasses import FrozenInstanceError, replace
from typing import Annotated

from fastapi import Depends
from fastapi.testclient import TestClient
from jwcrypto import jwk, jws
from test_service_identity import AUDIENCE, EMAIL, NOW, SUBJECT, GoogleIdentityFixture

from folioview_shared.delegated_keys import KeyCache
from folioview_shared.delegation import (
    DELEGATION_TYPE,
    CatalogueRequirement,
    DelegatedPrincipal,
    DelegationError,
    DelegationVerifier,
    ResourceBinding,
    ResourceRef,
    RunRequirement,
    make_delegation_dependency,
    make_service_identity_dependency,
)
from folioview_shared.http import create_app
from folioview_shared.service_identity import GoogleCallerVerifier, ServiceCaller

ISSUER = "https://hub.example.com"
LOGICAL_AUDIENCE = AUDIENCE + "/internal/v2"
HUB_KID = "hub_kms_version_1"
OTHER_SUBJECT = "123456789012345678901"
OTHER_EMAIL = "other-hub@synthetic-project.iam.gserviceaccount.com"


class DelegationFixture:
    def __init__(self, google_key, hub_key, *, source="user", key_transport=None):
        self.google = GoogleIdentityFixture(google_key)
        self.hub_key = hub_key
        self.source = source
        self.calls = []
        public = hub_key.export(private_key=False, as_dict=True)
        public = {field: public[field] for field in ("kty", "n", "e")}
        public.update(kid=HUB_KID, use="sig", alg="RS256")

        def hub_keys(url, **kwargs):
            self.calls.append((url, kwargs))
            return json.dumps({"keys": [public]}).encode()

        self.keys = KeyCache(
            ISSUER + "/.well-known/jwks.json",
            transport=key_transport or hub_keys,
            clock=lambda: 100,
        )
        self.caller = GoogleCallerVerifier(
            AUDIENCE,
            {SUBJECT: EMAIL, OTHER_SUBJECT: OTHER_EMAIL},
            keys=self.google.cache,
            clock=lambda: NOW,
        )
        self.verifier = DelegationVerifier(
            issuer=ISSUER,
            audience=LOGICAL_AUDIENCE,
            source_service=source,
            caller_verifier=self.caller,
            keys=self.keys,
            clock=lambda: NOW,
        )
        self.watchlist = ResourceBinding(
            ResourceRef("watchlist", "user", "watchlist_A", "inc_A"), 3
        )
        self.follows = ResourceBinding(
            ResourceRef("channel_follows", "user", "follows_A", "inc_A"), 4
        )
        self.holdings = ResourceBinding(
            ResourceRef("holdings", "portfolio", "holdings_A", "inc_A"), 5
        )

    @staticmethod
    def base(**changes):
        return {
            "iss": ISSUER,
            "aud": LOGICAL_AUDIENCE,
            "sub": "owner_A",
            "iat": NOW - 10,
            "exp": NOW + 50,
            "jti": "operation_A",
            "caller": EMAIL,
            **changes,
        }

    def catalog(self, **changes):
        return (
            self.base(
                purpose="browser_catalog",
                scopes=["resources:catalog"],
                resourceKinds=["watchlist", "channel_follows"],
            )
            | changes
        )

    def run(self, **changes):
        return (
            self.base(
                purpose="agent_run",
                scopes=["watchlist:read", "channel_follows:read"],
                resources=[self.watchlist.as_claim(), self.follows.as_claim()],
                runId="run_A",
                taskId="task_A",
                grantId="grant_A",
                grantEpoch=2,
            )
            | changes
        )

    def requirement(self, **changes):
        values = {
            "owner_uid": "owner_A",
            "run_id": "run_A",
            "task_id": "task_A",
            "grant_id": "grant_A",
            "grant_epoch": 2,
            "resources": (self.watchlist,),
        }
        return RunRequirement(**(values | changes))

    def service_token(self, *, subject=SUBJECT, email=EMAIL):
        return self.google.sign(self.google.claims(sub=subject, azp=subject, email=email))

    def sign(self, claims, *, kid=HUB_KID, key=None):
        value = jws.JWS(json.dumps(claims).encode())
        value.add_signature(
            key or self.hub_key,
            protected=json.dumps(
                {
                    "alg": "RS256",
                    "kid": kid,
                    "typ": DELEGATION_TYPE,
                }
            ),
        )
        return value.serialize(compact=True)

    def verify(self, claims, requirement=None, **changes):
        return self.verifier.verify(
            self.service_token(),
            self.sign(claims),
            requirement=requirement or self.requirement(),
            **changes,
        )


class DelegationTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.google_key = jwk.JWK.generate(kty="RSA", size=2048)
        cls.hub_key = jwk.JWK.generate(kty="RSA", size=2048)
        cls.wrong_key = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        self.f = DelegationFixture(self.google_key, self.hub_key)

    def rejects(self, code, claims, *, requirement=None):
        with self.assertRaises(DelegationError) as result:
            self.f.verify(claims, requirement=requirement)
        self.assertEqual(result.exception.code, code)
        return result.exception


class DelegationVerificationTests(DelegationTestCase):
    def test_catalog_discovers_signed_owner_without_inventing_a_run_or_decryption_authority(self):
        expected = CatalogueRequirement(frozenset({"watchlist"}))
        result = self.f.verify(self.f.catalog(), requirement=expected)
        self.assertIsInstance(result, DelegatedPrincipal)
        self.assertEqual(result.owner_uid, "owner_A")
        self.assertEqual(result.caller.email, EMAIL)
        self.assertEqual(result.scopes, frozenset({"resources:catalog"}))
        self.assertEqual(result.resources, ())
        self.assertIsNone(result.run_id)
        self.assertEqual(self.f.calls[0][0], ISSUER + "/.well-known/jwks.json")
        result.require_owner("owner_A")
        with self.assertRaises(DelegationError):
            result.require_owner("owner_B")
        with self.assertRaises(FrozenInstanceError):
            result.owner_uid = "owner_B"

    def test_run_matches_current_trusted_context_and_nonempty_requested_resource_subset(self):
        result = self.f.verify(self.f.run())
        self.assertEqual(
            (result.owner_uid, result.run_id, result.task_id, result.grant_id, result.grant_epoch),
            ("owner_A", "run_A", "task_A", "grant_A", 2),
        )
        self.assertEqual(result.resources, (self.f.watchlist, self.f.follows))
        self.assertEqual(result.resource_kinds, frozenset({"watchlist", "channel_follows"}))
        both = self.f.requirement(resources=(self.f.watchlist, self.f.follows))
        self.f.verify(self.f.run(), requirement=both)

    def test_portfolio_accepts_only_its_own_catalog_and_holdings_run_scope(self):
        fixture = DelegationFixture(self.google_key, self.hub_key, source="portfolio")
        fixture.verify(
            fixture.catalog(resourceKinds=["holdings"]),
            requirement=CatalogueRequirement(frozenset({"holdings"})),
        )
        result = fixture.verify(
            fixture.run(resources=[fixture.holdings.as_claim()], scopes=["portfolio:read"]),
            requirement=fixture.requirement(resources=(fixture.holdings,)),
        )
        self.assertEqual(result.resources, (fixture.holdings,))

    def test_catalog_and_run_purposes_are_not_interchangeable(self):
        self.rejects("permission_denied", self.f.catalog())
        self.rejects(
            "permission_denied",
            self.f.run(),
            requirement=CatalogueRequirement(frozenset({"watchlist"})),
        )

    def test_catalog_rejects_run_fields_even_null_instead_of_downgrading_authority(self):
        expected = CatalogueRequirement(frozenset({"watchlist"}))
        for field, value in (
            ("runId", None),
            ("runId", "run_A"),
            ("grantId", "grant_A"),
            ("resources", []),
            ("grantEpoch", 2),
            ("taskId", "task_A"),
        ):
            with self.subTest(field=field):
                self.rejects(
                    "invalid_credentials", self.f.catalog(**{field: value}), requirement=expected
                )

    def test_run_requires_all_authority_fields_and_refuses_empty_null_or_duplicate_resources(self):
        for field in ("runId", "taskId", "grantId", "grantEpoch", "resources"):
            claims = self.f.run()
            del claims[field]
            with self.subTest(missing=field):
                self.rejects("invalid_credentials", claims)
        for values in ([], None, [self.f.watchlist.as_claim(), self.f.watchlist.as_claim()]):
            self.rejects("invalid_credentials", self.f.run(resources=values))
        for value in (None, ""):
            self.rejects("invalid_credentials", self.f.run(runId=value))

    def test_scopes_must_cover_selected_resources_and_cannot_cross_purpose_or_target(self):
        self.rejects("permission_denied", self.f.run(scopes=["channel_follows:read"]))
        self.rejects("permission_denied", self.f.run(scopes=["portfolio:read"]))
        self.rejects("invalid_credentials", self.f.run(scopes=["resources:catalog"]))
        self.rejects("invalid_credentials", self.f.run(scopes=["results:create"]))
        self.rejects("invalid_credentials", self.f.run(scopes=[]))
        self.rejects(
            "invalid_credentials",
            self.f.catalog(scopes=["watchlist:read"]),
            requirement=CatalogueRequirement(frozenset({"watchlist"})),
        )

    def test_source_service_and_requested_catalog_kind_are_independently_bounded(self):
        self.rejects(
            "permission_denied",
            self.f.catalog(resourceKinds=["holdings"]),
            requirement=CatalogueRequirement(frozenset({"holdings"})),
        )
        self.rejects(
            "permission_denied",
            self.f.catalog(resourceKinds=["channel_follows"]),
            requirement=CatalogueRequirement(frozenset({"watchlist"})),
        )
        holdings = self.f.run(resources=[self.f.holdings.as_claim()], scopes=["portfolio:read"])
        self.rejects(
            "permission_denied",
            holdings,
            requirement=self.f.requirement(resources=(self.f.holdings,)),
        )
        mixed = self.f.run(
            resources=[self.f.watchlist.as_claim(), self.f.holdings.as_claim()],
            scopes=["watchlist:read", "portfolio:read"],
        )
        self.rejects("permission_denied", mixed)

    def test_owner_run_task_grant_and_epoch_cannot_be_substituted(self):
        for field, value in (
            ("sub", "owner_B"),
            ("runId", "run_B"),
            ("taskId", "task_B"),
            ("grantId", "grant_B"),
            ("grantEpoch", 3),
        ):
            with self.subTest(field=field):
                self.rejects("permission_denied", self.f.run(**{field: value}))
        self.rejects(
            "permission_denied",
            self.f.catalog(sub="owner_B"),
            requirement=CatalogueRequirement(frozenset({"watchlist"}), "owner_A"),
        )
        # A separate user is valid only when current trusted routing also selects it.
        result = self.f.verify(
            self.f.run(sub="owner_B"), requirement=self.f.requirement(owner_uid="owner_B")
        )
        self.assertEqual(result.owner_uid, "owner_B")

    def test_resource_id_incarnation_kind_and_current_source_epoch_are_exact(self):
        ref = self.f.watchlist.ref
        bindings = [
            replace(self.f.watchlist, source_epoch=4),
            ResourceBinding(replace(ref, resource_id="watchlist_B"), 3),
            ResourceBinding(replace(ref, incarnation="inc_B"), 3),
            self.f.follows,
        ]
        for binding in bindings:
            with self.subTest(binding=binding):
                self.rejects(
                    "permission_denied",
                    self.f.run(
                        resources=[binding.as_claim()],
                        scopes=["watchlist:read", "channel_follows:read"],
                    ),
                )
        self.rejects(
            "permission_denied",
            self.f.run(),
            requirement=self.f.requirement(resources=(replace(self.f.watchlist, source_epoch=4),)),
        )
        invalid = self.f.watchlist.as_claim()
        invalid["ref"]["sourceService"] = "portfolio"
        self.rejects("invalid_credentials", self.f.run(resources=[invalid]))

    def test_internal_issuer_audience_and_caller_have_no_alias_or_fallback(self):
        for field, value, code in (
            ("iss", ISSUER + "/", "invalid_credentials"),
            ("iss", "https://attacker.example.com", "invalid_credentials"),
            ("aud", AUDIENCE + "/internal/v1", "invalid_credentials"),
            ("aud", [LOGICAL_AUDIENCE], "invalid_credentials"),
            ("caller", OTHER_EMAIL, "permission_denied"),
        ):
            with self.subTest(field=field, value=value):
                self.rejects(code, self.f.run(**{field: value}))
        self.assertEqual(self.f.calls[0][0], ISSUER + "/.well-known/jwks.json")

    def test_lifetime_is_at_most60_seconds_and_expiry_has_no_grace(self):
        self.f.verify(self.f.run(iat=NOW - 10, exp=NOW + 50))
        self.f.verify(self.f.run(iat=NOW + 5, exp=NOW + 60))
        for changes in (
            {"iat": NOW - 10, "exp": NOW + 51},
            {"exp": NOW},
            {"iat": NOW + 6, "exp": NOW + 60},
            {"iat": NOW + 50},
            {"iat": float(NOW - 10)},
            {"exp": float(NOW + 50)},
            {"grantEpoch": 2.0},
            {"grantEpoch": True},
        ):
            with self.subTest(changes=changes):
                self.rejects("invalid_credentials", self.f.run(**changes))
        invalid = self.f.watchlist.as_claim()
        invalid["sourceEpoch"] = 3.0
        self.rejects("invalid_credentials", self.f.run(resources=[invalid]))

    def test_closed_claims_and_resource_bindings_reject_self_reported_extensions(self):
        for extra in (
            {"ownerUid": "owner_B"},
            {"scope": "portfolio:read"},
            {"resourceKinds": ["watchlist"]},
            {"jti": "bad/id"},
        ):
            self.rejects("invalid_credentials", self.f.run(**extra))
        invalid = self.f.watchlist.as_claim()
        invalid["sourceEpoch"] = 0
        self.rejects("invalid_credentials", self.f.run(resources=[invalid]))
        invalid = self.f.watchlist.as_claim()
        invalid["ref"]["extra"] = "not routing metadata"
        self.rejects("invalid_credentials", self.f.run(resources=[invalid]))

    def test_unknown_hub_key_or_wrong_signing_key_is_unauthorized_not_scope_failure(self):
        for token in (
            self.f.sign(self.f.run(), kid="unknown_hub_key"),
            self.f.sign(self.f.run(), key=self.wrong_key),
        ):
            with self.assertRaises(DelegationError) as result:
                self.f.verifier.verify(
                    self.f.service_token(), token, requirement=self.f.requirement()
                )
            self.assertEqual(result.exception.status_code, 401)

    def test_credentials_cannot_be_swapped_or_borrow_a_different_trusted_caller(self):
        google, delegation = self.f.service_token(), self.f.sign(self.f.run())
        for first, second in ((delegation, google), (google, google), (delegation, delegation)):
            with self.assertRaises(DelegationError) as result:
                self.f.verifier.verify(first, second, requirement=self.f.requirement())
            self.assertEqual(result.exception.code, "invalid_credentials")
        other = self.f.service_token(subject=OTHER_SUBJECT, email=OTHER_EMAIL)
        with self.assertRaises(DelegationError) as result:
            self.f.verifier.verify(other, delegation, requirement=self.f.requirement())
        self.assertEqual(result.exception.code, "permission_denied")
        matching = self.f.sign(self.f.run(caller=OTHER_EMAIL))
        self.assertEqual(
            self.f.verifier.verify(other, matching, requirement=self.f.requirement()).caller.email,
            OTHER_EMAIL,
        )

    def test_hub_key_outage_and_bad_clock_fail503_without_sensitive_diagnostics(self):
        def outage(*args, **kwargs):
            raise TimeoutError("SyntheticSecret verifier backend")

        fixture = DelegationFixture(self.google_key, self.hub_key, key_transport=outage)
        with self.assertRaises(DelegationError) as result:
            fixture.verify(fixture.run())
        self.assertEqual(result.exception.code, "verification_unavailable")
        self.assertEqual(result.exception.status_code, 503)
        self.assertNotIn("SyntheticSecret", str(result.exception))
        verifier = DelegationVerifier(
            issuer=ISSUER,
            audience=LOGICAL_AUDIENCE,
            source_service="user",
            caller_verifier=self.f.caller,
            keys=self.f.keys,
            clock=lambda: float("nan"),
        )
        with self.assertRaises(DelegationError) as result:
            verifier.verify(
                self.f.service_token(), self.f.sign(self.f.run()), requirement=self.f.requirement()
            )
        self.assertEqual(result.exception.status_code, 503)

    def test_configuration_and_empty_or_duplicate_trusted_requirements_fail_before_data_access(
        self,
    ):
        options = {
            "issuer": ISSUER,
            "audience": LOGICAL_AUDIENCE,
            "source_service": "user",
            "caller_verifier": self.f.caller,
        }
        for changes in (
            {"issuer": ISSUER + "/path"},
            {"issuer": ISSUER + "/"},
            {"audience": "http://target.example.com"},
            {"source_service": "config"},
            {"clock_skew_seconds": 6},
            {"keys": KeyCache("https://attacker.example.com/keys")},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                DelegationVerifier(**(options | changes))
        for resources in ((), (self.f.watchlist, self.f.watchlist)):
            with self.assertRaises(ValueError):
                self.f.requirement(resources=resources)
        with self.assertRaises(ValueError):
            self.f.requirement(owner_uid=None)
        with self.assertRaises(ValueError):
            CatalogueRequirement(frozenset())


class DelegationHTTPTests(DelegationTestCase):
    def app(self, fixture=None, requirement=None):
        fixture = self.f if fixture is None else fixture
        app = create_app("Delegation test", private=True, private_prefixes=("/api/", "/internal/"))
        dependency = make_delegation_dependency(
            fixture.verifier,
            CatalogueRequirement(frozenset({"watchlist"})) if requirement is None else requirement,
        )

        @app.get("/internal/v2/catalog")
        def catalog(principal: Annotated[DelegatedPrincipal, Depends(dependency)]):
            return {"owner": principal.owner_uid, "purpose": principal.purpose}

        service_dependency = make_service_identity_dependency(fixture.caller)

        @app.get("/internal/v2/source-callback")
        def callback(principal: Annotated[ServiceCaller, Depends(service_dependency)]):
            return {"caller": principal.email, "hasOwner": hasattr(principal, "owner_uid")}

        return app

    def headers(self, claims=None):
        return {
            "Authorization": "Bearer " + self.f.service_token(),
            "X-FolioView-Delegation": self.f.sign(self.f.catalog() if claims is None else claims),
        }

    def test_signed_owner_wins_over_uid_header_query_and_body_on_no_store_success(self):
        headers = self.headers() | {"X-Owner-Uid": "owner_B", "X-User-Id": "owner_B"}
        with TestClient(self.app()) as client:
            response = client.request(
                "GET", "/internal/v2/catalog?uid=owner_B", headers=headers, json={"uid": "owner_B"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"owner": "owner_A", "purpose": "browser_catalog"})
        self.assertEqual(response.headers.get_list("cache-control"), ["no-store"])

    def test_both_unique_headers_are_required_and_stripped_serverless_header_is_not_fallback(self):
        headers = self.headers()
        cases = [
            ([], 401),
            ([("Authorization", headers["Authorization"])], 401),
            ([("X-FolioView-Delegation", headers["X-FolioView-Delegation"])], 401),
            (
                [
                    ("X-Serverless-Authorization", headers["Authorization"]),
                    ("X-FolioView-Delegation", headers["X-FolioView-Delegation"]),
                ],
                401,
            ),
            (list(headers.items()) + [("Authorization", headers["Authorization"])], 401),
            (
                list(headers.items())
                + [("X-FolioView-Delegation", headers["X-FolioView-Delegation"])],
                401,
            ),
            (
                [
                    ("Authorization", headers["Authorization"] + ", " + headers["Authorization"]),
                    ("X-FolioView-Delegation", headers["X-FolioView-Delegation"]),
                ],
                401,
            ),
        ]
        with TestClient(self.app()) as client:
            for request_headers, expected in cases:
                with self.subTest(header_count=len(request_headers)):
                    response = client.get("/internal/v2/catalog", headers=request_headers)
                    self.assertEqual(response.status_code, expected)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                    self.assertEqual(response.headers["www-authenticate"], "Bearer")
                    self.assertNotIn("owner_A", response.text)

    def test_http_distinguishes_invalid_permission_and_outage_and_never_echoes_tokens(self):
        denied = self.headers(self.f.catalog(sub="owner_B"))
        app = self.app(requirement=CatalogueRequirement(frozenset({"watchlist"}), "owner_A"))
        with TestClient(app) as client:
            for headers, expected in ((self.headers(self.f.catalog(exp=NOW)), 401), (denied, 403)):
                response = client.get("/internal/v2/catalog", headers=headers)
                self.assertEqual(response.status_code, expected)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn(headers["X-FolioView-Delegation"], response.text)
                self.assertNotIn("owner_B", response.text)
        fixture = DelegationFixture(
            self.google_key,
            self.hub_key,
            key_transport=lambda *a, **k: b"not a usable key set SyntheticSecret",
        )
        with TestClient(self.app(fixture)) as client:
            response = client.get("/internal/v2/catalog", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("www-authenticate", response.headers)
        self.assertNotIn("SyntheticSecret", response.text)

    def test_service_only_callback_has_no_owner_authority_and_refuses_delegation_credentials(self):
        with TestClient(self.app()) as client:
            response = client.get(
                "/internal/v2/source-callback",
                headers={"Authorization": "Bearer " + self.f.service_token()},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"caller": EMAIL, "hasOwner": False})
            self.assertEqual(response.headers["cache-control"], "no-store")
            refused = client.get("/internal/v2/source-callback", headers=self.headers())
            self.assertEqual(refused.status_code, 403)
            self.assertEqual(refused.headers["cache-control"], "no-store")

    def test_trusted_requirement_factory_can_use_current_state_and_fails_closed_on_outage(self):
        state = {"owner": "owner_A"}

        def expected(request, principal):
            if state["owner"] == "unavailable":
                raise RuntimeError("SyntheticSecret state backend")
            self.assertEqual(principal.owner_uid, "owner_A")
            return CatalogueRequirement(frozenset({"watchlist"}), state["owner"])

        with TestClient(self.app(requirement=expected)) as client:
            self.assertEqual(
                client.get("/internal/v2/catalog", headers=self.headers()).status_code, 200
            )
            state["owner"] = "owner_B"
            self.assertEqual(
                client.get("/internal/v2/catalog", headers=self.headers()).status_code, 403
            )
            state["owner"] = "unavailable"
            response = client.get("/internal/v2/catalog", headers=self.headers())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("SyntheticSecret", response.text)

    def test_requirement_factory_waits_for_both_proofs_and_uses_only_signed_owner(self):
        calls = []

        def expected(request, principal):
            calls.append(principal.owner_uid)
            return CatalogueRequirement(frozenset({"watchlist"}), principal.owner_uid)

        with TestClient(self.app(requirement=expected)) as client:
            bad_credentials = [
                {},
                self.headers(self.f.catalog(exp=NOW)),
                self.headers(self.f.catalog(caller=OTHER_EMAIL)),
                self.headers()
                | {"X-FolioView-Delegation": self.f.sign(self.f.catalog(), key=self.wrong_key)},
            ]
            for headers in bad_credentials:
                response = client.get("/internal/v2/catalog", headers=headers)
                self.assertIn(response.status_code, (401, 403))
                self.assertEqual(calls, [])
            response = client.get(
                "/internal/v2/catalog?uid=owner_B",
                headers=self.headers() | {"X-Owner-Uid": "owner_B"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, ["owner_A"])


if __name__ == "__main__":
    unittest.main()
