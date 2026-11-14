"""One delegated discovery read retains both original metadata views and fences."""

import copy
import json
from unittest.mock import patch

from fixtures import OTHER_UID, SOURCE, UID, HoldingsFixture
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc
from test_resource_api import SignedPortfolioMetadataFixture

from app.holdings import PortfolioService
from app.resource_api import _read
from app.store import FirestorePortfolioStore, document_path
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.identity import owner_key


class SignedPortfolioDiscoveryTests(SignedPortfolioMetadataFixture):
    def read(self, *, body=None, headers=None):
        return self.client.post(
            self.discovery,
            headers=self.headers if headers is None else headers,
            json=self.body if body is None else body,
        )

    def test_both_original_views_come_from_one_metadata_call(self):
        expected = {
            "contractVersion": CONTRACT_VERSION,
            "profile": "folioview.portfolio-discovery.v1",
            "states": _read(self.service, UID, self.body["refs"], states=True),
            "projections": _read(self.service, UID, self.body["refs"], states=False),
        }
        with patch.object(self.service, "metadata_many", wraps=self.service.metadata_many) as reads:
            response = self.read()
        self.assert_private(response, 200)
        self.assertEqual(response.json(), expected)
        reads.assert_called_once_with(UID, [SOURCE])
        for private in ("carrier", "keyProofs", "ownerSubject", UID, "recipients", "rootJwk"):
            self.assertNotIn(private, response.text)

    def test_real_firestore_one_batch_for_one_two_and_ten_sources_and_zero_writes(self):
        client = firestore.Client(
            project="synthetic-portfolio", database="portfolio", credentials=AnonymousCredentials()
        )
        rpc = MemoryRpc(client)
        client._firestore_api_internal = rpc
        self.service = PortfolioService(
            FirestorePortfolioStore("synthetic-portfolio", "portfolio", client=client),
            clock=lambda: 1000,
        )
        self.fixture.install(self.service)
        self.fixture.write(self.service)
        authority_path = client.document(
            document_path("portfolio_authorities", owner_key(UID), SOURCE)
        )._document_path
        original = rpc.documents[authority_path]
        refs = [copy.deepcopy(self.fixture.resource)]
        for number in range(1, 10):
            source = f"holdings_{number}"
            row = copy.deepcopy(original)
            row["sourceId"] = source
            row["resourceRef"]["resourceId"] = source
            rpc.documents[
                client.document(
                    document_path("portfolio_authorities", owner_key(UID), source)
                )._document_path
            ] = row
            refs.append(copy.deepcopy(row["resourceRef"]))
        for count in (1, 2, 10):
            with self.subTest(count=count):
                selected = list(reversed(refs[:count]))
                body = {"contractVersion": CONTRACT_VERSION, "refs": selected}
                rpc.calls.clear()
                response = self.read(body=body)
                self.assert_private(response, 200)
                value = response.json()
                for field in ("states", "projections"):
                    self.assertEqual([item["ref"] for item in value[field]["items"]], selected)
                self.assertEqual(sum(kind == "get" for kind, _ in rpc.calls), 1)
                self.assertTrue(
                    all(not kw["request"]["writes"] for kind, kw in rpc.calls if kind == "commit")
                )
                for item in value["projections"]["items"]:
                    self.assertEqual(
                        item["snapshotId"],
                        "snapshot_1" if item["ref"]["resourceId"] == SOURCE else None,
                    )

    def test_non_active_states_remain_visible_without_a_projection(self):
        self.fixture.mutate(self.service, action="disconnect")
        for state in ("revoking", "disconnected"):
            response = self.read()
            self.assert_private(response, 200)
            self.assertEqual(response.json()["states"]["items"][0]["state"], state)
            self.assertEqual(response.json()["projections"]["items"], [])
            self.assertNotIn("snapshot_1", response.text)
            if state == "revoking":
                self.fixture.ack(self.service)
        self.fixture.mutate(
            self.service, action="delete", operation="synthetic_delete_000001", version=3, epoch=2
        )
        self.fixture.ack(self.service, operation="synthetic_delete_000001", epoch=3)
        response = self.read()
        self.assert_private(response, 200)
        self.assertEqual(response.json()["states"]["items"][0]["state"], "deleted")
        self.assertEqual(response.json()["projections"]["items"], [])

    def test_old_epoch_snapshot_is_omitted_until_a_current_epoch_upload(self):
        self.fixture.mutate(self.service)
        self.fixture.ack(self.service)
        response = self.read()
        self.assert_private(response, 200)
        self.assertEqual(response.json()["states"]["items"][0]["state"], "active")
        self.assertEqual(response.json()["states"]["items"][0]["sourceEpoch"], 2)
        self.assertEqual(response.json()["projections"]["items"], [])
        self.assertNotIn("snapshot_1", response.text)
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
        response = self.read()
        self.assert_private(response, 200)
        self.assertEqual(response.json()["projections"]["items"][0]["snapshotId"], "snapshot_2")

    def test_owner_incarnation_and_whole_batch_failures_do_not_leak_partial_views(self):
        other = HoldingsFixture(OTHER_UID)
        other.resource["incarnation"] = "incarnation_B"
        other.install(self.service)
        headers = {
            **self.headers,
            "X-FolioView-Delegation": self.auth.sign(
                self.auth.catalog(sub=OTHER_UID, resourceKinds=["holdings"])
            ),
        }
        for body, request_headers, status in (
            (self.body, headers, 404),
            (
                {**self.body, "refs": [{**self.fixture.resource, "incarnation": "old"}]},
                self.headers,
                404,
            ),
            (
                {
                    **self.body,
                    "refs": self.body["refs"]
                    + [{**self.fixture.resource, "resourceId": "missing"}],
                },
                self.headers,
                503,
            ),
        ):
            with self.subTest(status=status):
                response = self.read(body=body, headers=request_headers)
                self.assert_private(response, status)
                self.assertNotIn("snapshot_1", response.text)
                self.assertNotIn('"states"', response.text)

    def test_bad_credentials_ref_scope_and_bounded_body_fail_before_metadata(self):
        cases = [
            ({key: value for key, value in self.headers.items() if key != header}, self.body, 401)
            for header in ("Authorization", "X-FolioView-Delegation")
        ]
        cases += [
            ({**self.headers, "Authorization": "Bearer invalid"}, self.body, 401),
            (self.headers, {**self.body, "uid": UID}, 400),
            (self.headers, {**self.body, "refs": []}, 400),
            (self.headers, {**self.body, "refs": self.body["refs"] * 2}, 400),
            (self.headers, {**self.body, "refs": self.body["refs"] * 11}, 400),
            (
                self.headers,
                {
                    **self.body,
                    "refs": [
                        {**self.fixture.resource, "kind": "watchlist", "sourceService": "user"}
                    ],
                },
                403,
            ),
            (
                {**self.headers, "X-FolioView-Delegation": self.auth.sign(self.auth.run(sub=UID))},
                self.body,
                403,
            ),
        ]
        with patch.object(self.service, "metadata_many", side_effect=AssertionError("storage")):
            for headers, body, status in cases:
                with self.subTest(status=status, body=body):
                    self.assert_private(self.read(body=body, headers=headers), status)

    def test_transport_limits_apply_to_the_combined_route(self):
        requests = (
            lambda: self.client.post(
                self.discovery + "?owner=other", headers=self.headers, json=self.body
            ),
            lambda: self.client.post(
                self.discovery, headers=self.headers, content=json.dumps(self.body)
            ),
            lambda: self.client.post(
                self.discovery,
                headers={**self.headers, "Content-Type": "application/json"},
                content=b" " * 131_073,
            ),
            lambda: self.client.post(
                self.discovery,
                headers=list(self.headers.items()) + [("X-FolioView-Delegation", self.token())],
                json=self.body,
            ),
        )
        with patch.object(self.service, "metadata_many", side_effect=AssertionError("storage")):
            for request, status in zip(requests, (400, 415, 413, 401), strict=True):
                self.assert_private(request(), status)
