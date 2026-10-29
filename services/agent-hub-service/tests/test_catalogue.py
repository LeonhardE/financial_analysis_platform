"""Owner discovery over real synthetic two-token proofs and metadata-only producers."""

import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from fixtures import BOOT, OTHER_UID, SOURCE, UID, VaultFixture
from jwcrypto import jwk
from test_service_identity import EMAIL, NOW, SUBJECT, GoogleIdentityFixture
from test_signing import KEY, KMSRpc

from app.api import get_service, require_owner
from app.catalogue import (
    PROFILE,
    CatalogueService,
    CatalogueSources,
    get_sources,
    workload_token,
)
from app.fences import FenceService
from app.main import app
from app.signing import KMSSigner
from app.store import SQLiteHubStore
from app.vaults import VaultService
from folioview_shared.delegated_keys import KeyCache
from folioview_shared.delegation import CatalogueRequirement, DelegationVerifier
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.service_identity import GoogleCallerVerifier

HUB = "https://hub.synthetic.example"
USER = "https://user.synthetic.example"
PORTFOLIO = "https://portfolio.synthetic.example"
STAMP = "2026-10-29T12:00:00Z"


class CatalogueFixture:
    @classmethod
    def setUpClass(cls):
        cls.google_key = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLiteHubStore(Path(directory.name) / "hub.sqlite3")
        self.vaults = VaultService(self.store, clock=lambda: 1000)
        self.fixture = VaultFixture()
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        self.source = self.vaults.create_source(
            UID,
            self.fixture.vault,
            SOURCE,
            self.fixture.control(),
            "synthetic_source_create_0001",
            self.fixture.kid("device_sig"),
        )["source"]["resourceRef"]
        self.google = GoogleIdentityFixture(self.google_key)
        self.rpc = KMSRpc()
        self.signer = KMSSigner(KEY, client=self.rpc, clock=lambda: 100)
        self.calls, self.token_calls, self.owners = [], [], []
        self.lock = threading.Lock()
        self.fail_source = None
        self.user_change = None
        self.portfolio_change = None
        self.on_request = None
        self.epoch = 1
        self.lifecycle = "active"
        self.snapshot = "snapshot_synthetic_A"
        self.sources = self.make_sources()

    def make_sources(self, **changes):
        settings = {
            "issuer": HUB,
            "caller": EMAIL,
            "user_origin": USER,
            "portfolio_origin": PORTFOLIO,
            "signer_factory": lambda: self.signer,
            "token_factory": self.token,
            "transport": httpx.MockTransport(self.handle),
            "wall_clock": lambda: NOW,
        }
        settings.update(changes)
        return CatalogueSources(**settings)

    def token(self, audience, **kwargs):
        with self.lock:
            self.token_calls.append(audience)
        self.assertIn("deadline", kwargs)
        return self.google.sign(self.google.claims(aud=audience))

    def principal(self, request):
        service = "user" if str(request.url).startswith(USER) else "portfolio"
        origin = USER if service == "user" else PORTFOLIO
        public = self.signer.jwks()
        keys = KeyCache(
            HUB + "/.well-known/jwks.json", transport=lambda *a, **k: canonical_json(public)
        )
        verifier = DelegationVerifier(
            issuer=HUB,
            audience=origin + "/internal/v2",
            source_service=service,
            caller_verifier=GoogleCallerVerifier(
                origin, {SUBJECT: EMAIL}, keys=self.google.cache, clock=lambda: NOW
            ),
            keys=keys,
            clock=lambda: NOW,
        )
        kinds = {"watchlist", "channel_follows"} if service == "user" else {"holdings"}
        return verifier.verify(
            request.headers["authorization"].removeprefix("Bearer "),
            request.headers["x-folioview-delegation"],
            requirement=CatalogueRequirement(frozenset(kinds)),
        )

    def handle(self, request):
        principal = self.principal(request)
        with self.lock:
            self.calls.append((request.method, str(request.url), bytes(request.content)))
            self.owners.append(principal.owner_uid)
            callback, self.on_request = self.on_request, None
        self.assertEqual(request.headers["x-folioview-contract"], CONTRACT_VERSION)
        self.assertEqual(request.headers["cache-control"], "no-store")
        self.assertEqual(request.headers["accept-encoding"], "identity")
        self.assertNotIn("cookie", request.headers)
        if callback:
            callback()
        if request.url.host == "user.synthetic.example":
            self.assertEqual(request.url.path, "/internal/v2/resources/catalogue")
            self.assertEqual(request.method, "GET")
            items = []
            for kind in ("watchlist", "channel_follows"):
                row = {
                    "kind": kind,
                    "sourceService": "user",
                    "state": "empty" if kind == "watchlist" else "ready",
                    "ref": {
                        "kind": kind,
                        "sourceService": "user",
                        "resourceId": kind + "_" + principal.owner_uid,
                        "incarnation": "inc_user",
                    },
                    "revision": 0 if kind == "watchlist" else 2,
                    "sourceEpoch": 1,
                    "updatedAt": STAMP,
                }
                if self.user_change:
                    self.user_change(row)
                items.append(row)
            return httpx.Response(
                200, json={"contractVersion": CONTRACT_VERSION, "items": items, "readAt": STAMP}
            )
        body = json.loads(request.content)
        self.assertEqual(set(body), {"contractVersion", "refs"})
        ref = body["refs"][0]
        self.assertEqual(body["contractVersion"], CONTRACT_VERSION)
        if ref["resourceId"] == self.fail_source:
            return httpx.Response(404, text="synthetic-private-error-marker")
        row = {
            "ref": ref,
            "revision": 1 if self.snapshot else 0,
            "sourceEpoch": self.epoch,
            "state": self.lifecycle,
        }
        if request.url.path.endswith("states/read"):
            row["observedAt"] = STAMP
        else:
            self.assertEqual(request.url.path, "/internal/v2/resources/projections/read")
            row["snapshotId"] = self.snapshot
        if self.portfolio_change:
            self.portfolio_change(row)
        return httpx.Response(200, json={"contractVersion": CONTRACT_VERSION, "items": [row]})

    def read(self, uid=UID, sources=None):
        return CatalogueService(self.vaults, sources or self.sources).read(uid)

    def fence(self, reason="account_scope_changed"):
        return FenceService(self.store, clock=lambda: 1000).invalidate(
            {
                "contractVersion": CONTRACT_VERSION,
                "ownerSubject": self.fixture.owner,
                "mutationId": "synthetic_catalogue_fence_0001",
                "ref": self.source,
                "expectedSourceEpoch": 1,
                "newSourceEpoch": 2,
                "reason": reason,
            },
            source_service="portfolio",
        )


class CatalogueTests(CatalogueFixture, unittest.TestCase):
    def test_three_groups_use_real_narrow_proofs_and_never_return_content_or_archive(self):
        result = self.read()
        self.assertEqual(result["profile"], PROFILE)
        self.assertEqual(set(result), {"contractVersion", "profile", "readAt", "groups"})
        holdings, watchlist, follows = result["groups"]
        self.assertEqual(holdings["items"][0]["snapshotId"], self.snapshot)
        self.assertEqual(holdings["items"][0]["encryptedEvidence"], "not_checked")
        self.assertEqual(watchlist["items"][0]["state"], "empty")
        self.assertEqual(watchlist["items"][0]["revision"], 0)
        self.assertEqual(follows["items"][0]["state"], "ready")
        self.assertEqual(follows["items"][0]["encryptedEvidence"], "not_prepared")
        self.assertCountEqual(self.token_calls, [USER, PORTFOLIO])
        self.assertEqual(len(self.calls), 3)
        encoded = canonical_json(result)
        for marker in (
            b"archive",
            b"registryHistory",
            b"rootJwk",
            b"keyEpoch",
            b"fingerprint",
            b"symbols",
            b"count",
            b"Google",
            b"Bearer",
        ):
            self.assertNotIn(marker, encoded)
        with self.assertRaises(ContractError):
            validate_schema("ResourceCatalogueMetadata", result)

    def test_no_vault_does_not_hide_existing_user_lists_or_make_portfolio_requests(self):
        result = self.read(OTHER_UID)
        self.assertEqual(
            result["groups"][0],
            {
                "kind": "holdings",
                "sourceService": "portfolio",
                "status": "uninitialized",
                "items": [],
            },
        )
        self.assertEqual(result["groups"][2]["items"][0]["state"], "ready")
        self.assertEqual(self.token_calls, [USER])
        self.assertEqual(self.owners, [OTHER_UID])

    def test_user_uninitialized_is_distinct_from_empty_and_encrypted_evidence(self):
        def uninitialized(row):
            row.update(
                state="uninitialized", ref=None, revision=None, sourceEpoch=None, updatedAt=None
            )

        self.user_change = uninitialized
        result = self.read()
        for group in result["groups"][1:]:
            self.assertEqual(group["items"][0]["state"], "uninitialized")
            self.assertEqual(group["items"][0]["encryptedEvidence"], "not_prepared")

    def test_one_portfolio_failure_preserves_other_registered_sources_and_user_metadata(self):
        self.vaults.create_source(
            UID,
            self.fixture.vault,
            "holdings_csv_B",
            self.fixture.control("holdings_csv_B", "synthetic_source_create_0002"),
            "synthetic_source_create_0002",
            self.fixture.kid("device_sig"),
        )
        self.fail_source = SOURCE
        result = self.read()
        self.assertEqual(result["groups"][0]["status"], "partial")
        self.assertEqual(
            [row["state"] for row in result["groups"][0]["items"]], ["unavailable", "active"]
        )
        self.assertEqual(result["groups"][1]["status"], "available")
        self.assertNotIn("synthetic-private-error-marker", json.dumps(result))
        self.assertEqual(self.token_calls.count(PORTFOLIO), 1)
        self.assertEqual(result["groups"][0]["items"][0]["encryptedEvidence"], "not_checked")

    def test_absent_current_snapshot_is_only_known_after_successful_projection(self):
        self.snapshot = None
        row = self.read()["groups"][0]["items"][0]
        self.assertEqual(
            (row["state"], row["snapshotId"], row["encryptedEvidence"]),
            ("active", None, "not_prepared"),
        )
        self.portfolio_change = lambda row: row.update(unapprovedLabel="private")
        row = self.read()["groups"][0]["items"][0]
        self.assertEqual((row["state"], row["encryptedEvidence"]), ("unavailable", "not_checked"))

    def test_unknown_private_metadata_is_rejected_without_reflection_or_hub_writes(self):
        before = self.vaults.current(UID)
        self.user_change = lambda row: row.update(symbols=["SYNTH_PRIVATE"])
        self.portfolio_change = lambda row: row.update(accountLabel="PRIVATE_ACCOUNT")
        result = self.read()
        self.assertTrue(all(group["status"] == "unavailable" for group in result["groups"]))
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertEqual(before, self.vaults.current(UID))

    def test_foreign_ref_malformed_epoch_and_private_hash_fail_closed_per_source(self):
        for mutation in (
            lambda row: row["ref"].update(incarnation="foreign_incarnation"),
            lambda row: row.update(sourceEpoch=True),
            lambda row: row.update(contentDigest="a" * 64),
        ):
            self.portfolio_change = mutation
            self.assertEqual(self.read()["groups"][0]["status"], "unavailable")

    def test_fresh_epoch_compares_actual_fence_and_does_not_reset_to_registered_epoch_one(self):
        self.fence()
        self.epoch = 2
        result = self.read()
        self.assertEqual(result["groups"][0]["items"][0]["sourceEpoch"], 2)
        self.assertEqual(result["groups"][0]["items"][0]["state"], "active")
        self.epoch = 1
        pending = self.read()["groups"][0]["items"][0]
        self.assertEqual(pending["state"], "pending")
        self.assertEqual(pending["encryptedEvidence"], "not_checked")

    def test_terminal_fence_does_not_read_old_source_or_claim_agent_readiness(
        self,
    ):
        self.fence("disconnected")
        result = self.read()
        row = result["groups"][0]["items"][0]
        self.assertEqual(
            (row["state"], row["sourceEpoch"], row["snapshotId"]), ("disconnected", 2, None)
        )
        self.assertEqual(self.token_calls, [USER])
        self.assertEqual(row["encryptedEvidence"], "not_checked")

    def test_fence_or_vault_change_during_rpc_discards_the_entire_stale_response(self):
        self.on_request = self.fence
        with self.assertRaises(ContractError) as result:
            self.read()
        self.assertEqual(result.exception.code, "version_conflict")

    def test_registry_checkpoint_change_during_rpc_discards_stale_discovery(self):
        def update():
            bundle = self.fixture.make_bundle(previous=self.fixture.registry)
            self.vaults.update_registry(
                UID,
                self.fixture.vault,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "expectedVersion": 2,
                    "registryBundle": bundle,
                },
                "synthetic_catalogue_registry_0001",
            )

        self.on_request = update
        with self.assertRaises(ContractError) as result:
            self.read()
        self.assertEqual(result.exception.code, "version_conflict")

    def test_user_ready_revision_zero_is_refused_without_hiding_holdings(self):
        self.user_change = lambda row: row.update(state="ready", revision=0)
        result = self.read()
        self.assertEqual(result["groups"][0]["status"], "available")
        self.assertTrue(all(group["status"] == "unavailable" for group in result["groups"][1:]))

    def test_ten_sources_share_at_most_four_joined_workers_and_one_credential_per_target(self):
        for i in range(1, 10):
            operation = f"synthetic_source_parallel_{i:04}"
            source = f"holdings_parallel_{i}"
            self.vaults.create_source(
                UID,
                self.fixture.vault,
                source,
                self.fixture.control(source, operation),
                operation,
                self.fixture.kid("device_sig"),
            )
        barrier = threading.Barrier(4)
        active = peak = entered = 0
        lock = threading.Lock()

        def handler(request):
            nonlocal active, peak, entered
            with lock:
                active += 1
                peak = max(peak, active)
                first = entered < 4
                entered += 1
            try:
                if first:
                    barrier.wait(timeout=3)
                return self.handle(request)
            finally:
                with lock:
                    active -= 1

        result = self.read(sources=self.make_sources(transport=httpx.MockTransport(handler)))
        self.assertEqual(len(result["groups"][0]["items"]), 10)
        self.assertTrue(all(row["state"] == "active" for row in result["groups"][0]["items"]))
        self.assertEqual(peak, 4)
        self.assertEqual(active, 0)
        self.assertCountEqual(self.token_calls, [USER, PORTFOLIO])

    def test_missing_configuration_is_unavailable_without_credentials_or_network(self):
        with patch("socket.create_connection", side_effect=AssertionError("network")):
            result = self.read(
                sources=self.make_sources(
                    user_origin="",
                    portfolio_origin="",
                    signer_factory=lambda: self.fail("signer"),
                    token_factory=lambda *a, **k: self.fail("token"),
                )
            )
        self.assertTrue(all(group["status"] == "unavailable" for group in result["groups"]))

    def test_redirect_auth_failure_compression_and_malformed_bodies_do_not_become_owner_401(self):
        for response in (
            lambda: httpx.Response(302, headers={"Location": "https://untrusted.invalid"}),
            lambda: httpx.Response(401, text="PRIVATE"),
            lambda: httpx.Response(403, text="PRIVATE"),
            lambda: httpx.Response(
                200,
                content=b'{"contractVersion":1,"contractVersion":2}',
                headers={"Content-Type": "application/json"},
            ),
            lambda: httpx.Response(
                200, content=b"x" * 16385, headers={"Content-Type": "application/json"}
            ),
            lambda: httpx.Response(200, content=b"{}", headers={"Content-Type": "text/plain"}),
            lambda: httpx.Response(
                200,
                content=b"{}",
                headers={"Content-Type": "application/json", "Content-Encoding": "br"},
            ),
        ):
            source = self.make_sources(
                transport=httpx.MockTransport(lambda req, reply=response: reply())
            )
            result = self.read(sources=source)
            self.assertTrue(all(group["status"] == "unavailable" for group in result["groups"]))

    def test_total_deadline_expires_before_token_or_kms_or_http_can_continue(self):
        clock = [100.0]

        def expired_token(*args, **kwargs):
            clock[0] += 13
            return "a.b.c"

        result = self.read(
            sources=self.make_sources(
                clock=lambda: clock[0],
                token_factory=expired_token,
                signer_factory=lambda: self.fail("expired signer must not run"),
            )
        )
        self.assertTrue(all(group["status"] == "unavailable" for group in result["groups"]))

    def test_request_scoped_credentials_and_uid_are_not_reused_between_owners(self):
        self.read(UID)
        self.read(OTHER_UID)
        self.assertCountEqual(self.token_calls, [USER, PORTFOLIO, USER])
        self.assertIn(OTHER_UID, self.owners)


class CatalogueRoutesTests(CatalogueFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()

        def owner(request: Request):
            uid = {"Bearer synthetic-A": UID, "Bearer synthetic-B": OTHER_UID}.get(
                request.headers.get("authorization")
            )
            if not uid:
                raise HTTPException(401, "Sign-in required")
            return SimpleNamespace(uid=uid)

        app.dependency_overrides[require_owner] = owner
        app.dependency_overrides[get_service] = lambda: self.vaults
        app.dependency_overrides[get_sources] = lambda: self.sources
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {
            "Authorization": "Bearer synthetic-A",
            "X-FolioView-Contract": CONTRACT_VERSION,
        }

    def test_owner_route_is_no_store_and_rejects_query_contract_and_protocol_identity_substitution(
        self,
    ):
        response = self.client.get("/api/v2/resources/catalogue", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")
        for path, headers, status in (
            ("/api/v2/resources/catalogue?owner=" + OTHER_UID, self.headers, 400),
            ("/api/v2/resources/catalogue", {**self.headers, "X-FolioView-Contract": "v1"}, 400),
            (
                "/api/v2/resources/catalogue",
                {**self.headers, "X-FolioView-Delegation": "opaque"},
                403,
            ),
            (
                "/api/v2/resources/catalogue",
                {**self.headers, "X-Serverless-Authorization": "Bearer a.b.c"},
                403,
            ),
        ):
            failed = self.client.get(path, headers=headers)
            self.assertEqual(failed.status_code, status, failed.text[:200])
            self.assertEqual(failed.headers["cache-control"], "no-store")
            validate_schema("Error", failed.json())

    def test_owner_account_switch_uses_only_authenticated_owner_and_source_failures_stay_200(self):
        other = self.client.get(
            "/api/v2/resources/catalogue",
            headers={**self.headers, "Authorization": "Bearer synthetic-B"},
        )
        self.assertEqual(other.status_code, 200)
        self.assertEqual(other.json()["groups"][0]["status"], "uninitialized")
        self.sources = self.make_sources(user_origin="", portfolio_origin="")
        failure = self.client.get("/api/v2/resources/catalogue", headers=self.headers)
        self.assertEqual(failure.status_code, 200)
        self.assertTrue(all(group["status"] == "unavailable" for group in failure.json()["groups"]))

    def test_missing_owner_identity_fails_before_catalogue_storage_or_cloud(self):
        app.dependency_overrides.pop(require_owner)
        with patch("socket.create_connection", side_effect=AssertionError("network")):
            for headers in ({}, {"Authorization": "Bearer a", "authorization": "Bearer b"}):
                result = self.client.get("/api/v2/resources/catalogue", headers=headers)
                self.assertEqual(result.status_code, 401)


class MetadataTokenTests(unittest.TestCase):
    def test_fixed_metadata_url_and_flavor_are_bounded_and_redirects_are_refused(self):
        observed = []

        def handle(request):
            observed.append(request)
            return httpx.Response(200, text="a.b.c", headers={"Metadata-Flavor": "Google"})

        result = workload_token(
            USER, deadline=112, clock=lambda: 100, transport=httpx.MockTransport(handle)
        )
        self.assertEqual(result, "a.b.c")
        self.assertEqual(observed[0].url.host, "metadata.google.internal")
        self.assertEqual(observed[0].url.params["audience"], USER)
        self.assertEqual(observed[0].headers["metadata-flavor"], "Google")
        for response in (
            lambda: httpx.Response(302, headers={"Location": "https://evil.invalid"}),
            lambda: httpx.Response(200, text="a.b.c"),
            lambda: httpx.Response(200, text="not-a-token", headers={"Metadata-Flavor": "Google"}),
            lambda: httpx.Response(200, text="x" * 16385, headers={"Metadata-Flavor": "Google"}),
        ):
            with self.assertRaises(ContractError):
                workload_token(
                    USER,
                    deadline=112,
                    clock=lambda: 100,
                    transport=httpx.MockTransport(lambda req, reply=response: reply()),
                )
