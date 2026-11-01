"""Bounded remote ACK delivery and durable recovery, using synthetic identities."""

import asyncio
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from fixtures import MUTATION_OPERATION, OTHER_UID, SOURCE, UID, HoldingsFixture

from app.api import get_service
from app.fence_sync import HubFenceClient, fence_request, synchronize, validate_ack, workload_token
from app.holdings import PortfolioService
from app.lifecycle import mutation_path
from app.main import app
from app.store import SQLitePortfolioStore, SQLiteTransaction, document_path
from folioview_shared.auth import CurrentUser, require_google_user
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

ORIGIN = "https://hub.example"
TOKEN = "synthetic.workload.signature"


def ack(request):
    return {
        "contractVersion": CONTRACT_VERSION,
        "mutationId": request["mutationId"],
        "ref": copy.deepcopy(request["ref"]),
        "acknowledgedSourceEpoch": request["newSourceEpoch"],
        "acknowledgedAt": "2026-10-31T00:00:00.123456Z",
    }


class FenceDeliveryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "portfolio.sqlite3"
        self.service = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 1000)
        self.f = HoldingsFixture()
        self.f.install(self.service)
        self.pending = self.f.mutate(self.service)
        self.packet = fence_request(self.service.fence_mutation(UID, SOURCE, MUTATION_OPERATION))
        self.calls = []
        self.audiences = []

    def client(self, handler):
        async def token(audience):
            self.audiences.append(audience)
            return TOKEN

        def transport(request):
            self.calls.append(request)
            return handler(request)

        return HubFenceClient(ORIGIN, token_factory=token, transport=httpx.MockTransport(transport))

    def deliver(self, client, service=None, operation=MUTATION_OPERATION):
        return asyncio.run(
            synchronize(service or self.service, UID, SOURCE, operation, lambda: client)
        )

    def code(self, code, action):
        with self.assertRaises(ContractError) as result:
            action()
        self.assertEqual(result.exception.code, code)

    def test_fixed_authenticated_packet_completes_and_completed_retry_needs_no_network(self):
        client = self.client(lambda r: httpx.Response(200, json=ack(json.loads(r.content))))
        result = self.deliver(client)
        request = self.calls[0]
        self.assertEqual(str(request.url), ORIGIN + "/internal/v2/source-fences")
        self.assertEqual(request.headers["authorization"], "Bearer " + TOKEN)
        self.assertEqual(request.headers["x-folioview-contract"], CONTRACT_VERSION)
        self.assertNotIn("x-folioview-delegation", request.headers)
        self.assertEqual(json.loads(request.content), self.packet)
        self.assertEqual(self.audiences, [ORIGIN])
        self.assertEqual(result["state"], "acknowledged")
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "active")
        self.assertEqual(self.service.metadata(UID, SOURCE)["authorityVersion"], 3)
        # Already committed receipts survive missing config and restarts.
        restarted = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 1001)

        def forbidden():
            raise AssertionError("No token or network after completion")

        self.assertEqual(
            asyncio.run(synchronize(restarted, UID, SOURCE, MUTATION_OPERATION, forbidden)), result
        )
        self.assertEqual(len(self.calls), 1)

    def test_lost_ack_is_replayed_exactly_after_restart_without_double_advancing(self):
        committed = {}

        def response(request):
            packet = json.loads(request.content)
            committed.setdefault(packet["mutationId"], ack(packet))
            if len(self.calls) == 1:
                raise httpx.ReadTimeout("ACK lost after Hub transaction")
            self.assertEqual(packet, self.packet)
            return httpx.Response(200, json=committed[packet["mutationId"]])

        client = self.client(response)
        self.code("source_unavailable", lambda client=client: self.deliver(client))
        self.assertEqual(self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending)
        restarted = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 1001)
        self.assertEqual(self.deliver(client, restarted)["state"], "acknowledged")
        self.assertEqual(len(committed), 1)
        self.assertEqual(restarted.metadata(UID, SOURCE)["sourceEpoch"], 2)
        self.assertEqual(restarted.metadata(UID, SOURCE)["authorityVersion"], 3)

    def test_actual_hub_producer_replays_immutable_ack_across_both_store_restarts(self):
        # A fresh isolated Hub process per delivery exercises its real immutable
        # receipt protocol; service identities remain synthetic, not cloud proof.
        services = Path(__file__).resolve().parents[2]
        environment = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join(
                [str(services / "agent-hub-service"), str(services / "common")]
            ),
        }
        hub_path = self.path.parent / "hub.sqlite3"
        script = (
            "import json,sys\n"
            "from app.fences import FenceService\n"
            "from app.store import SQLiteHubStore\n"
            "service=FenceService(SQLiteHubStore(sys.argv[1]),clock=lambda:1000)\n"
            "print(json.dumps(service.invalidate(json.load(sys.stdin),"
            "source_service='portfolio')))\n"
        )
        received = []

        def response(request):
            result = subprocess.run(
                [sys.executable, "-c", script, str(hub_path)],
                input=request.content.decode(),
                capture_output=True,
                text=True,
                cwd=services / "agent-hub-service",
                env=environment,
                timeout=15,
                check=True,
            )
            received.append(json.loads(result.stdout))
            if len(received) == 1:
                raise httpx.ReadTimeout("Lost actual Hub producer ACK")
            return httpx.Response(200, json=received[-1])

        client = self.client(response)
        self.code("source_unavailable", lambda: self.deliver(client))
        restarted = PortfolioService(SQLitePortfolioStore(self.path), clock=lambda: 1001)
        self.assertEqual(self.deliver(client, restarted)["state"], "acknowledged")
        self.assertEqual(len(received), 2)
        self.assertEqual(received[0], received[1])
        self.assertEqual(restarted.metadata(UID, SOURCE)["sourceEpoch"], 2)

    def test_real_hub_authority_resync_after_ack_allows_new_epoch_write(self):
        services = Path(__file__).resolve().parents[2]
        environment = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join(
                [str(services / "agent-hub-service"), str(services / "common")]
            ),
        }
        hub_path = self.path.parent / "authority-hub.sqlite3"
        script = """import json,sys
from app.fences import FenceService
from app.store import SQLiteHubStore
from app.vaults import VaultService
data=json.load(sys.stdin)
store=SQLiteHubStore(sys.argv[1])
vault=VaultService(store,clock=lambda:1000)
if data['action']=='initialize':
    vault.bootstrap(data['uid'],data['bootstrap'],'synthetic_bootstrap_000001')
    vault.create_source(data['uid'],data['bootstrap']['vaultId'],data['source'],
        data['command'],'synthetic_source_create_0001',data['author'])
if data['action']=='fence':
    result=FenceService(store,clock=lambda:1000).invalidate(data['request'],source_service='portfolio')
else:
    result=vault.authority(data['uid'],data['source'])['authority']
print(json.dumps(result))
"""

        def hub(data):
            result = subprocess.run(
                [sys.executable, "-c", script, str(hub_path)],
                input=json.dumps(data),
                capture_output=True,
                text=True,
                cwd=services / "agent-hub-service",
                env=environment,
                timeout=15,
                check=True,
            )
            return json.loads(result.stdout)

        f = self.f
        payload = f.base("control_command") | {
            "stableOperationId": "synthetic_source_create_0001",
            "action": "manual_source_create",
            "targetId": SOURCE,
            "expectedVersion": 0,
            "expectedSourceEpoch": None,
            "parameters": {},
            "registrySequence": f.registry.registry_sequence,
            "checkpointDigest": f.registry.checkpoint_digest,
            "keyEpoch": f.registry.key_epoch,
        }
        bootstrap = {
            "contractVersion": CONTRACT_VERSION,
            "vaultId": f.vault,
            "rootJwk": f.root_public,
            "rootKeyId": f.root_id,
            "registryBundle": f.bundle,
            "archive": {
                "profile": "folioview.passkey-vault.v1",
                "ownerSubject": f.owner,
                "vaultId": f.vault,
                "rootKeyId": f.root_id,
                "credentialId": b64url_encode(b"synthetic-credential"),
                "prfSalt": b64url_encode(b"s" * 32),
                "iv": b64url_encode(b"i" * 12),
                "ciphertext": b64url_encode(b"synthetic-opaque-ciphertext-block"),
            },
        }
        first = hub(
            {
                "action": "initialize",
                "uid": UID,
                "source": SOURCE,
                "bootstrap": bootstrap,
                "command": {"contractVersion": CONTRACT_VERSION, "command": f.sign(payload)},
                "author": f.kid("device_sig"),
            }
        )
        f.resource = first["resourceRef"]
        service = PortfolioService(
            SQLitePortfolioStore(self.path.parent / "authority-portfolio.sqlite3"),
            clock=lambda: 1000,
        )
        service.synchronize_authority(UID, SOURCE, first)
        f.mutate(service)
        client = self.client(
            lambda r: httpx.Response(
                200,
                json=hub(
                    {
                        "action": "fence",
                        "request": json.loads(r.content),
                    }
                ),
            )
        )
        self.deliver(client, service)
        current = hub({"action": "read", "uid": UID, "source": SOURCE})
        self.assertEqual(current["sourceEpoch"], 2)
        self.assertEqual(service.synchronize_authority(UID, SOURCE, current)["sourceEpoch"], 2)
        context = f.context("holdings_snapshot")
        context.update(
            objectId="snapshot_after_fence",
            revision=1,
            expectedRevision=0,
            stableOperationId="synthetic_after_fence_000001",
        )
        context["binding"].update(sourceEpoch=2, sourceRevision=1)
        result = f.write(
            service,
            snapshot="snapshot_after_fence",
            operation="synthetic_after_fence_000001",
            carrier=f.carrier(context),
        )
        self.assertEqual(result["sourceEpoch"], 2)

    def test_wrong_ack_contract_operation_ref_epoch_and_timestamp_keep_pending(self):
        valid = ack(self.packet)
        for change in [
            {"contractVersion": "wrong"},
            {"mutationId": "different_operation_000001"},
            {"ref": {**valid["ref"], "incarnation": "other_incarnation"}},
            {"acknowledgedSourceEpoch": 1},
            {"acknowledgedSourceEpoch": True},
            {"acknowledgedAt": "2026-02-30T00:00:00Z"},
            {"acknowledgedAt": "2026-10-31"},
            {"ownerSubject": owner_key(UID)},
        ]:
            with self.subTest(change=change):
                client = self.client(
                    lambda r, value={**valid, **change}: httpx.Response(200, json=value)
                )
                self.code("source_unavailable", lambda client=client: self.deliver(client))
                self.assertEqual(
                    self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending
                )

    def test_transport_redirect_bad_json_compression_status_and_bounds_fail_closed(self):
        responses = [
            httpx.Response(307, headers={"location": "https://attacker.example"}),
            httpx.Response(200, content=b"not-json", headers={"content-type": "application/json"}),
            httpx.Response(200, content=b"{}", headers={"content-type": "text/plain"}),
            httpx.Response(
                200,
                content=b"{}",
                headers={"content-type": "application/json", "content-encoding": "br"},
            ),
            httpx.Response(201, json=ack(self.packet)),
            httpx.Response(200, content=b" " * 8193, headers={"content-type": "application/json"}),
            httpx.Response(
                200,
                content=b'{"mutationId":1,"mutationId":2}',
                headers={"content-type": "application/json"},
            ),
            httpx.Response(503, json={"private": "upstream diagnostic"}),
        ]
        for response in responses:
            with self.subTest(status=response.status_code):
                client = self.client(lambda r, response=response: response)
                with self.assertRaises(ContractError):
                    self.deliver(client)
                self.assertEqual(
                    self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending
                )
        self.assertEqual(len(self.calls), len(responses))

    def test_closed_upstream_conflicts_preserve_pending_and_hide_diagnostics(self):
        for code in [
            "invalid_token",
            "insufficient_scope",
            "not_found",
            "version_conflict",
            "idempotency_conflict",
        ]:
            error = ContractError(code)
            client = self.client(
                lambda r, error=error: httpx.Response(error.status, json=error.response("test"))
            )
            self.code(code, lambda client=client: self.deliver(client))
        self.assertEqual(self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending)

    def test_invalid_origin_and_token_do_not_send_credential_bearing_requests(self):
        for origin in [
            "",
            "http://hub.example",
            ORIGIN + "/path",
            "https://user@hub.example",
            ORIGIN + "?q=1",
            ORIGIN + "#a",
            ORIGIN + ":444",
        ]:
            self.code("authorization_unavailable", lambda origin=origin: HubFenceClient(origin))
        client = self.client(lambda r: self.fail("invalid token sent"))

        async def invalid_token(audience):
            return "not-a-token"

        client.token_factory = invalid_token
        self.code("authorization_unavailable", lambda client=client: self.deliver(client))
        self.assertEqual(self.calls, [])

    def test_total_deadline_covers_token_and_empty_response(self):
        client = self.client(lambda r: httpx.Response(200, json=ack(self.packet)))
        times = iter([0, 13])
        client.clock = lambda: next(times)
        self.code("source_unavailable", lambda client=client: self.deliver(client))
        self.assertEqual(self.calls, [])
        times = iter([0, 0, 13])
        client.clock = lambda: next(times)
        self.code("source_unavailable", lambda client=client: self.deliver(client))
        self.assertEqual(self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending)

    def test_hard_deadline_cancels_hanging_identity_fetch_and_response_stream(self):
        cancelled = []

        async def token(audience):
            try:
                await asyncio.sleep(60)
            finally:
                cancelled.append("identity")

        client = self.client(lambda r: self.fail("Token fetch has not finished"))
        client.token_factory = token
        with patch("app.fence_sync.DELIVERY_TIMEOUT_SECONDS", 0.2):
            self.code("source_unavailable", lambda: self.deliver(client))
        self.assertEqual(cancelled, ["identity"])
        self.assertEqual(self.calls, [])

        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b"{"
                await asyncio.sleep(60)

            async def aclose(self):
                cancelled.append("response")

        client = self.client(
            lambda r: httpx.Response(
                200, headers={"content-type": "application/json"}, stream=Stream()
            )
        )
        with patch("app.fence_sync.DELIVERY_TIMEOUT_SECONDS", 0.2):
            self.code("source_unavailable", lambda: self.deliver(client))
        self.assertEqual(cancelled, ["identity", "response"])
        self.assertEqual(self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending)

    def test_runtime_identity_fetch_is_one_fixed_bounded_metadata_get(self):
        real_client = httpx.AsyncClient
        calls = []

        def response(request):
            calls.append(request)
            return httpx.Response(
                200, stream=httpx.ByteStream(TOKEN.encode()), headers={"metadata-flavor": "Google"}
            )

        def client(**options):
            self.assertFalse(options["follow_redirects"])
            self.assertFalse(options["trust_env"])
            self.assertEqual(options["timeout"], 4)
            return real_client(**options, transport=httpx.MockTransport(response))

        with patch("app.fence_sync.httpx.AsyncClient", new=client):
            self.assertEqual(asyncio.run(workload_token(ORIGIN)), TOKEN)
        self.assertEqual(len(calls), 1)
        request = calls[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(request.url.host, "metadata.google.internal")
        self.assertEqual(
            request.url.path,
            "/computeMetadata/v1/instance/service-accounts/default/identity",
        )
        self.assertEqual(dict(request.url.params), {"audience": ORIGIN, "format": "full"})
        self.assertEqual(request.headers["metadata-flavor"], "Google")
        self.assertNotIn("authorization", request.headers)

    def test_runtime_metadata_errors_and_oversized_identity_do_not_reach_hub(self):
        real_client = httpx.AsyncClient
        for status, headers, content in [
            (404, {"metadata-flavor": "Google"}, b"private upstream diagnostic"),
            (200, {}, TOKEN.encode()),
            (200, {"metadata-flavor": "Google"}, b"a" * 16_385),
            (200, {"metadata-flavor": "Google"}, b"\xff"),
        ]:
            calls = []

            def response(request, calls=calls, status=status, headers=headers, content=content):
                calls.append(request)
                return httpx.Response(status, headers=headers, stream=httpx.ByteStream(content))

            def client(**options):
                return real_client(**options, transport=httpx.MockTransport(response))

            with patch("app.fence_sync.httpx.AsyncClient", new=client):
                self.code(
                    "authorization_unavailable",
                    lambda: asyncio.run(workload_token(ORIGIN)),
                )
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0].url.host, "metadata.google.internal")

    def test_concurrent_completion_and_new_pending_are_not_cleared_by_old_ack(self):
        def response(request):
            first = self.f.ack(self.service)
            self.assertEqual(first["state"], "acknowledged")
            self.f.mutate(self.service, operation="synthetic_new_operation", version=3, epoch=2)
            return httpx.Response(200, json=ack(json.loads(request.content)))

        self.assertEqual(self.deliver(self.client(response))["state"], "acknowledged")
        current = self.service.metadata(UID, SOURCE)
        self.assertEqual(
            (current["state"], current["sourceEpoch"], current["pendingMutationId"]),
            ("revoking", 3, "synthetic_new_operation"),
        )

    def test_saved_command_change_during_io_is_rejected_by_commit_cas(self):
        def response(request):
            path = mutation_path(owner_key(UID), SOURCE, MUTATION_OPERATION)
            self.service.store.transact(
                lambda unit: unit.put(path, {**unit.get(path), "commandFingerprint": "a" * 64})
            )
            return httpx.Response(200, json=ack(json.loads(request.content)))

        self.code("version_conflict", lambda: self.deliver(self.client(response)))
        self.assertEqual(self.service.metadata(UID, SOURCE)["state"], "revoking")

    def test_local_failure_after_valid_remote_ack_recovers_exactly_on_retry(self):
        client = self.client(lambda r: httpx.Response(200, json=ack(json.loads(r.content))))
        original = SQLiteTransaction.put

        def fail(unit, path, value):
            if path.startswith("portfolio_source_mutations/"):
                raise RuntimeError("local write failure")
            return original(unit, path, value)

        with patch.object(SQLiteTransaction, "put", new=fail), self.assertRaises(RuntimeError):
            self.deliver(client)
        self.assertEqual(self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending)
        self.assertEqual(self.deliver(client)["state"], "acknowledged")

    def test_disconnect_and_delete_retries_remain_terminal(self):
        # Complete the initial fence before exercising terminal action mapping.
        client = self.client(lambda r: httpx.Response(200, json=ack(json.loads(r.content))))
        self.deliver(client)
        for action, version, epoch, terminal in [
            ("disconnect", 3, 2, "disconnected"),
            ("delete", 5, 3, "deleted"),
        ]:
            operation = "synthetic_" + action + "_000001"
            self.f.mutate(
                self.service, action=action, version=version, epoch=epoch, operation=operation
            )
            self.deliver(client, operation=operation)
            self.assertEqual(json.loads(self.calls[-1].content)["reason"], terminal)
            self.assertEqual(self.service.metadata(UID, SOURCE)["state"], terminal)
            self.deliver(client, operation=operation)
            self.assertEqual(self.service.metadata(UID, SOURCE)["state"], terminal)


class FenceSynchronizationRoutes(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.service = PortfolioService(
            SQLitePortfolioStore(Path(directory.name) / "p.sqlite3"), clock=lambda: 1000
        )
        self.f = HoldingsFixture()
        self.f.install(self.service)
        HoldingsFixture(OTHER_UID).install(self.service)
        self.pending = self.f.mutate(self.service)

        def user(request: Request):
            uid = {"Bearer A": UID, "Bearer B": OTHER_UID}.get(request.headers.get("authorization"))
            if not uid:
                raise HTTPException(401)
            return CurrentUser(uid=uid, email=None, displayName=None, photoURL=None)

        app.dependency_overrides[require_google_user] = user
        app.dependency_overrides[get_service] = lambda: self.service
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.path = f"/api/v2/holdings/sources/{SOURCE}/mutations/{MUTATION_OPERATION}/synchronize"
        self.headers = {"Authorization": "Bearer A", "X-FolioView-Contract": CONTRACT_VERSION}
        self.body = {"contractVersion": CONTRACT_VERSION}

    def test_owner_authentication_closed_body_and_path_validate_before_network(self):
        with patch("app.fence_sync.configured_client", side_effect=AssertionError("network")):
            for headers, url, body, status in [
                ({}, self.path, self.body, 401),
                ({**self.headers, "Authorization": "Bearer B"}, self.path, self.body, 404),
                (self.headers, self.path + "?owner=other", self.body, 400),
                (self.headers, self.path, {**self.body, "ack": True}, 400),
                (self.headers, self.path, {**self.body, "origin": ORIGIN}, 400),
                (self.headers, self.path.replace(MUTATION_OPERATION, "bad"), self.body, 400),
            ]:
                result = self.client.post(url, headers=headers, json=body)
                self.assertEqual(result.status_code, status, result.text)
                self.assertEqual(result.headers["cache-control"], "no-store")
                validate_schema("Error", result.json())
        self.assertEqual(self.service.mutation(UID, SOURCE, MUTATION_OPERATION), self.pending)

    def test_unconfigured_pending_refuses_but_valid_server_ack_can_complete(self):
        from app.fence_sync import configured_client

        configured_client.cache_clear()
        self.addCleanup(configured_client.cache_clear)
        with patch.dict(os.environ, {}, clear=True):
            result = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(result.status_code, 503)

        class Adapter:
            async def invalidate(self, request):
                return ack(request)

        with patch("app.fence_sync.configured_client", return_value=Adapter()):
            result = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["state"], "acknowledged")
        self.assertEqual(result.headers["cache-control"], "no-store")
        with patch.dict(os.environ, {}, clear=True):
            result = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(result.status_code, 200)

    def test_vault_lock_during_remote_request_dominates_ack(self):
        service, fixture = self.service, self.f

        class Adapter:
            async def invalidate(self, request):
                fixture.install(service, version=2, epoch=2, active=False)
                return ack(request)

        with patch("app.fence_sync.configured_client", return_value=Adapter()):
            result = self.client.post(self.path, headers=self.headers, json=self.body)
        self.assertEqual(result.status_code, 403, result.text)
        row = self.service.store.transact(
            lambda unit: unit.get(
                document_path(
                    "portfolio_source_mutations", owner_key(UID), SOURCE, MUTATION_OPERATION
                )
            )
        )
        self.assertEqual(row["state"], "pending")

    def test_ack_validation_does_not_accept_non_json_objects(self):
        packet = fence_request(self.service.fence_mutation(UID, SOURCE, MUTATION_OPERATION))
        for value in [None, [], {}, {**ack(packet), "acknowledgedAt": None}]:
            with self.assertRaises(ContractError):
                validate_ack(value, packet)
