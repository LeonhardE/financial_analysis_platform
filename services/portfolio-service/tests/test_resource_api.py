"""Signed metadata producer requests; no deployed trust, broker calls or content delivery."""

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from fixtures import OTHER_UID, SOURCE, UID, HoldingsFixture
from jwcrypto import jwk
from test_delegation import DelegationFixture

from app.api import get_service
from app.holdings import PortfolioService
from app.main import app
from app.resource_api import configured_verifier, get_delegation_verifier
from app.store import SQLitePortfolioStore
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.schema import validate_schema


class SignedPortfolioMetadataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.google_key = jwk.JWK.generate(kty="RSA", size=2048)
        cls.hub_key = jwk.JWK.generate(kty="RSA", size=2048)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.service = PortfolioService(
            SQLitePortfolioStore(Path(self.directory.name) / "portfolio.sqlite3"),
            clock=lambda: 1000,
        )
        self.fixture = HoldingsFixture()
        self.fixture.install(self.service)
        self.fixture.write(self.service)
        self.auth = DelegationFixture(self.google_key, self.hub_key, source="portfolio")
        app.dependency_overrides[get_service] = lambda: self.service
        app.dependency_overrides[get_delegation_verifier] = lambda: self.auth.verifier
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {
            "Authorization": "Bearer " + self.auth.service_token(),
            "X-FolioView-Delegation": self.token(),
            "X-FolioView-Contract": CONTRACT_VERSION,
        }
        self.body = {"contractVersion": CONTRACT_VERSION, "refs": [self.fixture.resource]}
        self.url = "/internal/v2/resources/projections/read"
        self.states = "/internal/v2/resources/states/read"

    def token(self, **changes):
        return self.auth.sign(self.auth.catalog(sub=UID, resourceKinds=["holdings"], **changes))

    def assert_private(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:300])
        self.assertEqual(response.headers["cache-control"], "no-store")
        if status >= 400:
            validate_schema("Error", response.json())

    def test_real_signed_two_credentials_return_only_bounded_public_metadata(self):
        result = self.client.post(self.url, headers=self.headers, json=self.body)
        self.assert_private(result, 200)
        self.assertEqual(
            result.json()["items"],
            [
                {
                    "ref": self.fixture.resource,
                    "revision": 1,
                    "sourceEpoch": 1,
                    "state": "active",
                    "snapshotId": "snapshot_1",
                }
            ],
        )
        text = result.text
        for private in ("carrier", "keyProofs", "signedObject", "ownerSubject", UID, "recipients"):
            self.assertNotIn(private, text)
        self.assertEqual(len(self.auth.calls), 1)

    def test_default_trust_is_closed_before_storage_or_network(self):
        app.dependency_overrides.pop(get_delegation_verifier)
        configured_verifier.cache_clear()
        self.addCleanup(configured_verifier.cache_clear)
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
            patch.object(self.service, "metadata", side_effect=AssertionError("storage")),
        ):
            response = self.client.post(self.url, headers=self.headers, json=self.body)
        self.assert_private(response, 503)
        self.assertEqual(response.json()["error"]["code"], "authorization_unavailable")

    def test_either_missing_or_wrong_credential_cannot_read_metadata(self):
        cases = (
            ({key: value for key, value in self.headers.items() if key != "Authorization"}, 401),
            (
                {
                    key: value
                    for key, value in self.headers.items()
                    if key != "X-FolioView-Delegation"
                },
                401,
            ),
            ({**self.headers, "Authorization": "Bearer invalid"}, 401),
            (
                {
                    **self.headers,
                    "X-FolioView-Delegation": self.token(
                        caller="other@synthetic-project.iam.gserviceaccount.com"
                    ),
                },
                403,
            ),
        )
        for headers, status in cases:
            with (
                self.subTest(status=status),
                patch.object(
                    self.service, "metadata", side_effect=AssertionError("unauthorized storage")
                ),
            ):
                self.assert_private(
                    self.client.post(self.url, headers=headers, json=self.body), status
                )

    def test_agent_run_or_user_source_scope_cannot_use_catalogue_operation(self):
        run = self.auth.run(
            sub=UID, scopes=["portfolio:read"], resources=[self.auth.holdings.as_claim()]
        )
        for token in (
            self.auth.sign(run),
            self.auth.sign(self.auth.catalog(sub=UID, resourceKinds=["watchlist"])),
        ):
            response = self.client.post(
                self.url, headers={**self.headers, "X-FolioView-Delegation": token}, json=self.body
            )
            self.assert_private(response, 403)

    def test_other_owner_uses_own_partition_even_when_resource_ids_match(self):
        other = HoldingsFixture(OTHER_UID)
        other.resource["incarnation"] = "incarnation_B"
        other.install(self.service)
        headers = {
            **self.headers,
            "X-FolioView-Delegation": self.auth.sign(
                self.auth.catalog(sub=OTHER_UID, resourceKinds=["holdings"])
            ),
        }
        self.assert_private(self.client.post(self.url, headers=headers, json=self.body), 404)
        body = {"contractVersion": CONTRACT_VERSION, "refs": [other.resource]}
        response = self.client.post(self.url, headers=headers, json=body)
        self.assert_private(response, 200)
        self.assertEqual(response.json()["items"][0]["revision"], 0)
        self.assertIsNone(response.json()["items"][0]["snapshotId"])

    def test_ref_incarnation_kind_and_duplicate_inputs_are_checked(self):
        for ref, status in (
            ({**self.fixture.resource, "incarnation": "old_incarnation"}, 404),
            ({**self.fixture.resource, "kind": "watchlist", "sourceService": "user"}, 403),
        ):
            self.assert_private(
                self.client.post(self.url, headers=self.headers, json={**self.body, "refs": [ref]}),
                status,
            )
        for body in (
            {**self.body, "uid": OTHER_UID},
            {**self.body, "refs": self.body["refs"] * 2},
            {**self.body, "refs": self.body["refs"] * 11},
            {**self.body, "refs": []},
        ):
            self.assert_private(self.client.post(self.url, headers=self.headers, json=body), 400)

    def test_revoking_and_disconnected_states_visible_but_projection_refused(self):
        self.fixture.mutate(self.service, action="disconnect")
        for state in ("revoking", "disconnected"):
            self.assert_private(
                self.client.post(self.url, headers=self.headers, json=self.body), 403
            )
            response = self.client.post(self.states, headers=self.headers, json=self.body)
            self.assert_private(response, 200)
            self.assertEqual(response.json()["items"][0]["state"], state)
            self.assertEqual(response.json()["items"][0]["sourceEpoch"], 2)
            self.assertNotIn("snapshotId", response.text)
            if state == "revoking":
                self.fixture.ack(self.service)
        self.fixture.mutate(
            self.service, action="delete", operation="synthetic_delete_000001", version=3, epoch=2
        )
        self.fixture.ack(self.service, operation="synthetic_delete_000001", epoch=3)
        response = self.client.post(self.states, headers=self.headers, json=self.body)
        self.assert_private(response, 200)
        self.assertEqual(response.json()["items"][0]["state"], "deleted")

    def test_acknowledged_fence_requires_fresh_current_epoch_snapshot_for_projection(self):
        self.fixture.mutate(self.service)
        self.fixture.ack(self.service)
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "active")
        self.assertEqual(self.service.metadata(UID, SOURCE)["snapshotSourceEpoch"], 1)
        self.assert_private(self.client.post(self.url, headers=self.headers, json=self.body), 503)
        # The authenticated owner's historical copy remains readable.
        self.assertEqual(self.service.snapshot(UID, SOURCE)["receipt"]["sourceEpoch"], 1)
        _, context = self.fixture.message(
            snapshot="snapshot_2", revision=2, operation="synthetic_operation_000002"
        )
        context["binding"]["sourceEpoch"] = 2
        self.fixture.write(
            self.service,
            snapshot="snapshot_2",
            revision=2,
            operation="synthetic_operation_000002",
            carrier=self.fixture.carrier(context),
        )
        response = self.client.post(self.url, headers=self.headers, json=self.body)
        self.assert_private(response, 200)
        self.assertEqual(response.json()["items"][0]["sourceEpoch"], 2)
        self.assertEqual(response.json()["items"][0]["snapshotId"], "snapshot_2")
        self.assertEqual(self.service.metadata(UID, SOURCE)["snapshotSourceEpoch"], 2)

    def test_query_media_duplicate_headers_and_body_budget_are_formally_rejected(self):
        self.assert_private(
            self.client.post(self.url + "?uid=" + OTHER_UID, headers=self.headers, json=self.body),
            400,
        )
        duplicate = list(self.headers.items()) + [("X-FolioView-Delegation", self.token())]
        self.assert_private(self.client.post(self.url, headers=duplicate, json=self.body), 401)
        self.assert_private(
            self.client.post(self.url, headers=self.headers, content=json.dumps(self.body)), 415
        )
        self.assert_private(
            self.client.post(
                self.url,
                headers={**self.headers, "Content-Type": "application/json"},
                content=b" " * 131_073,
            ),
            413,
        )
        self.assert_private(
            self.client.post(
                self.url,
                headers={**self.headers, "Content-Type": "application/json"},
                content=b'{"refs":[],"refs":[]}',
            ),
            400,
        )

    def test_internal_missing_cors_and_method_failures_are_closed_errors(self):
        self.assert_private(self.client.get("/internal/v2/missing"), 404)
        self.assert_private(self.client.get(self.url), 400)
        self.assert_private(
            self.client.options(
                self.url,
                headers={
                    "Origin": "https://untrusted.example",
                    "Access-Control-Request-Method": "POST",
                },
            ),
            400,
        )

    def test_source_lookup_does_not_return_partial_metadata_on_missing_reference(self):
        body = copy.deepcopy(self.body)
        body["refs"].append({**self.fixture.resource, "resourceId": "missing_source"})
        response = self.client.post(self.url, headers=self.headers, json=body)
        self.assert_private(response, 503)
        self.assertNotIn("snapshot_1", response.text)
