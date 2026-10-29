"""Synthetic Hub-to-Portfolio authority replication; no production credentials."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from fixtures import OTHER_UID, SOURCE, UID, HoldingsFixture

from app.api import get_service
from app.authority_sync import HubAuthorityClient, configured_client, get_authority_client
from app.holdings import PortfolioService
from app.main import app
from app.store import SQLitePortfolioStore, StoreUnavailable, document_path
from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

TOKEN = ".".join(["synthetic", "workload", "signature"])
DELEGATION = ".".join(["synthetic", "delegation", "signature"])


def projection(fixture, *, version=1, history=None, epoch=1):
    return {
        "version": version,
        "ownerSubject": fixture.owner,
        "sourceId": fixture.source,
        "vaultId": fixture.vault,
        "rootJwk": fixture.root_public,
        "rootKeyId": fixture.root_id,
        "registryHistory": history or [fixture.bundle],
        "resourceRef": fixture.resource,
        "sourceEpoch": epoch,
        "active": True,
        "writerKeyIds": [fixture.kid("device_sig")],
        "recipientKeyIds": sorted([fixture.kid("device_enc"), fixture.kid("recovery_enc")]),
    }


class AuthorityReplicationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.service = PortfolioService(
            SQLitePortfolioStore(Path(directory.name) / "store.sqlite3"), clock=lambda: 1000
        )
        self.fixture = HoldingsFixture()

    def code(self, expected, action):
        with self.assertRaises(ContractError) as error:
            action()
        self.assertEqual(error.exception.code, expected)

    def test_initial_current_hub_history_and_duplicate_sync_do_not_use_hub_version_as_local_cas(
        self,
    ):
        f = self.fixture
        second = f.make_bundle(previous=f.registry)
        document = projection(f, version=77, history=[f.bundle, second])
        first = self.service.synchronize_authority(UID, SOURCE, document)
        self.assertEqual(first["authorityVersion"], 1)
        self.assertEqual(first, self.service.synchronize_authority(UID, SOURCE, document))
        document["version"] = 78
        self.assertEqual(first, self.service.synchronize_authority(UID, SOURCE, document))
        self.assertEqual(self.service.metadata(UID, SOURCE)["authorityVersion"], 1)

    def test_current_owner_source_and_root_are_independent_of_projection_claims(self):
        f = self.fixture
        self.service.synchronize_authority(UID, SOURCE, projection(f))
        other = HoldingsFixture(OTHER_UID)
        with self.assertRaises(StoreUnavailable):
            self.service.synchronize_authority(UID, SOURCE, projection(other))
        for changes in (
            {
                "rootJwk": other.root_public,
                "rootKeyId": other.root_id,
                "registryHistory": [other.bundle],
            },
            {"resourceRef": {**f.resource, "incarnation": "changed"}},
            {"sourceEpoch": 2},
        ):
            value = {**projection(f), **changes}
            with self.assertRaises((ContractError, StoreUnavailable)):
                self.service.synchronize_authority(UID, SOURCE, value)
        self.assertEqual(self.service.metadata(UID, SOURCE)["authorityVersion"], 1)

    def test_registry_progresses_and_cannot_roll_back_or_replace_previous_history(self):
        f = self.fixture
        initial = projection(f)
        self.service.synchronize_authority(UID, SOURCE, initial)
        second = f.make_bundle(previous=f.registry)
        result = self.service.synchronize_authority(
            UID, SOURCE, projection(f, history=[f.bundle, second], version=2)
        )
        self.assertEqual(result["authorityVersion"], 2)
        self.code(
            "registry_conflict", lambda: self.service.synchronize_authority(UID, SOURCE, initial)
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["authorityVersion"], 2)

    def test_locked_replica_and_locally_advanced_fence_cannot_be_reactivated_by_sync(self):
        f = self.fixture
        f.install(self.service, active=False)
        self.code(
            "insufficient_scope",
            lambda: self.service.synchronize_authority(UID, SOURCE, projection(f)),
        )
        f.install(self.service, version=1, active=True)
        f.mutate(self.service, action="disconnect", version=2)
        self.code(
            "recipient_binding_mismatch",
            lambda: self.service.synchronize_authority(UID, SOURCE, projection(f)),
        )
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "revoking")

    def test_sync_does_not_overwrite_ciphertext_or_rewrite_old_receipts(self):
        f = self.fixture
        self.service.synchronize_authority(UID, SOURCE, projection(f))
        saved = f.write(self.service)
        second = f.make_bundle(previous=f.registry)
        self.service.synchronize_authority(UID, SOURCE, projection(f, history=[f.bundle, second]))
        self.assertEqual(self.service.snapshot(UID, SOURCE)["receipt"], saved)

    def test_agent_signing_or_agent_recipient_keys_cannot_become_owner_authority(self):
        f = self.fixture
        for changes in (
            {"writerKeyIds": [f.kid("A1_sig")]},
            {"recipientKeyIds": sorted([f.kid("A1_enc"), f.kid("recovery_enc")])},
        ):
            self.code(
                "key_authorization_required",
                lambda changes=changes: self.service.synchronize_authority(
                    UID, SOURCE, {**projection(f), **changes}
                ),
            )


class FixedHubTransportTests(unittest.TestCase):
    def setUp(self):
        self.fixture = HoldingsFixture()

    def client(self, response):
        self.calls = []

        def handler(request):
            self.calls.append(request)
            return response(request)

        return HubAuthorityClient(
            "https://hub.example.test",
            token_factory=lambda aud: TOKEN,
            transport=httpx.MockTransport(handler),
        )

    def test_only_fixed_read_endpoint_and_two_credentials_are_sent_without_user_body_or_keys(self):
        f = self.fixture
        client = self.client(
            lambda _: httpx.Response(
                200, json={"contractVersion": CONTRACT_VERSION, "authority": projection(f)}
            )
        )
        self.assertEqual(client.read(UID, SOURCE, DELEGATION), projection(f))
        request = self.calls[0]
        self.assertEqual(
            str(request.url), "https://hub.example.test/internal/v2/portfolio-authorities/read"
        )
        self.assertEqual(request.headers["authorization"], "Bearer " + TOKEN)
        self.assertEqual(request.headers["x-folioview-delegation"], DELEGATION)
        self.assertEqual(
            json.loads(request.content), {"contractVersion": CONTRACT_VERSION, "sourceId": SOURCE}
        )

    def test_configuration_and_bearer_validation_fail_before_network(self):
        for origin in (
            "",
            "http://hub.example.test",
            "https://x@y.test",
            "https://hub.test/",
            "https://hub.test?url=x",
            "https://hu\nb.test",
            "https://hub.test\\evil",
        ):
            with self.subTest(origin=origin), self.assertRaises(ContractError):
                HubAuthorityClient(origin)
        client = self.client(lambda _: self.fail("Unexpected network"))
        for token in ("", "invalid", DELEGATION + "\n", "a" * 16_385):
            with self.assertRaises(ContractError):
                client.read(UID, SOURCE, token)
        self.assertEqual(self.calls, [])

    def test_workload_and_stream_are_subject_to_overall_deadline(self):
        moments = iter([100, 113])
        client = HubAuthorityClient(
            "https://hub.example.test",
            token_factory=lambda _: TOKEN,
            clock=lambda: next(moments),
            transport=httpx.MockTransport(lambda _: self.fail("Unexpected network")),
        )
        with self.assertRaises(ContractError) as error:
            client.read(UID, SOURCE, DELEGATION)
        self.assertEqual(error.exception.code, "source_unavailable")
        moments = iter([100, 101, 113])
        client = HubAuthorityClient(
            "https://hub.example.test",
            token_factory=lambda _: TOKEN,
            clock=lambda: next(moments),
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={
                        "contractVersion": CONTRACT_VERSION,
                        "authority": projection(self.fixture),
                    },
                )
            ),
        )
        with self.assertRaises(ContractError) as error:
            client.read(UID, SOURCE, DELEGATION)
        self.assertEqual(error.exception.code, "source_unavailable")

    def test_hub_redirect_failure_oversize_wrong_owner_and_unversioned_response_fail_closed(self):
        other = HoldingsFixture(OTHER_UID)
        cases = (
            lambda _: httpx.Response(302, headers={"location": "https://attacker.example"}),
            lambda _: httpx.Response(503, text="sensitive diagnostics"),
            lambda _: httpx.Response(
                200, headers={"content-type": "application/json"}, content=b" " * 1_048_577
            ),
            lambda _: httpx.Response(
                200, json={"contractVersion": CONTRACT_VERSION, "authority": projection(other)}
            ),
            lambda _: httpx.Response(200, json={"authority": projection(self.fixture)}),
        )
        for response in cases:
            with self.subTest(response=response):
                client = self.client(response)
                with self.assertRaises(ContractError):
                    client.read(UID, SOURCE, DELEGATION)
                self.assertEqual(len(self.calls), 1)


class OwnerSynchronizationRoutes(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.f = HoldingsFixture()
        self.service = PortfolioService(
            SQLitePortfolioStore(Path(directory.name) / "s.sqlite3"), clock=lambda: 1000
        )
        app.dependency_overrides[require_google_user] = lambda: CurrentUser(
            uid=UID, email=None, displayName=None, photoURL=None
        )
        app.dependency_overrides[get_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "X-FolioView-Authority-Delegation": DELEGATION,
        }
        self.path = f"/api/v2/holdings/sources/{SOURCE}/authority-sync"

    def test_public_request_supplies_only_version_while_client_fetches_trusted_projection(self):
        f = self.f

        class Adapter:
            def read(self, uid, source, delegation):
                if (uid, source, delegation) != (UID, SOURCE, DELEGATION):
                    raise AssertionError("Wrong delegated owner")
                return projection(f)

        app.dependency_overrides[get_authority_client] = Adapter
        result = self.client.post(
            self.path, headers=self.headers, json={"contractVersion": CONTRACT_VERSION}
        )
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["authorityVersion"], 1)
        self.assertEqual(result.headers["cache-control"], "no-store")
        supplied = self.client.post(
            self.path,
            headers=self.headers,
            json={"contractVersion": CONTRACT_VERSION, "rootJwk": f.root_public},
        )
        self.assertEqual(supplied.status_code, 400)
        validate_schema("Error", supplied.json())

    def test_default_configuration_refuses_before_credentials_or_storage(self):
        configured_client.cache_clear()
        self.addCleanup(configured_client.cache_clear)
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            result = self.client.post(
                self.path, headers=self.headers, json={"contractVersion": CONTRACT_VERSION}
            )
        self.assertEqual(result.status_code, 503)
        validate_schema("Error", result.json())
        stored = self.service.store.transact(
            lambda unit: unit.get(document_path("portfolio_authorities", owner_key(UID), SOURCE))
        )
        self.assertIsNone(stored)
