"""Real pinned MCP client/HTTP transport over synthetic cryptographic domain fixtures."""

import json
import os
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch

import httpx2
import test_preparations as preparation_fixtures
import test_results as result_fixtures
from fastapi import FastAPI
from fixtures import BOOT, OTHER_UID, UID
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError
from test_oauth import ISSUER, TASK
from test_task_routes import HttpTaskFixture

from app.agent_tools import INPUTS, AgentTools, input_schema
from app.mcp_transport import install_mcp
from folioview_shared.encrypted.constants import (
    CONTRACT_VERSION,
    MAX_HTTP_WRITE_BYTES,
    MAX_READ_BYTES,
)
from folioview_shared.encrypted.crypto import _signed_parts, decrypt_jwe
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json
from folioview_shared.encrypted.schema import validate_schema

OP, REVISION_OP = result_fixtures.OP, result_fixtures.REVISION_OP


class MCPTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.case = result_fixtures.ResultTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.token, self.fixture = self.case.token, self.case.case
        self.env = patch.dict(os.environ, HUB_OAUTH_ENABLED="1", HUB_ENCRYPTED_ADAPTER_ENABLED="1")
        self.env.start()
        self.addCleanup(self.env.stop)
        self.clock = patch(
            "mcp.server.auth.middleware.bearer_auth.time",
            SimpleNamespace(time=lambda: self.fixture.now),
        )
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.app = FastAPI()
        self.boundary = install_mcp(self.app, factory=lambda: self.fixture.oauth)

    @asynccontextmanager
    async def client(self, *, token=None, mode="auto"):
        async with self.app.router.lifespan_context(self.app):
            async with httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=self.app),
                headers={"Authorization": "Bearer " + (token or self.token)},
            ) as http:
                async with Client(
                    streamable_http_client(ISSUER + "/mcp/v2", http_client=http), mode=mode
                ) as client:
                    yield client

    async def tool(self, client, name, **values):
        result = await client.call_tool(name, {"contractVersion": CONTRACT_VERSION, **values})
        self.assertFalse(result.is_error, result)
        return result.structured_content

    async def test_actual_sdk_modern_seven_tools_task_preparation_run_and_encrypted_result_loop(
        self,
    ):
        async with self.client() as client:
            tools = await client.list_tools()
            self.assertEqual({t.name for t in tools.tools}, set(INPUTS))
            listed = await self.tool(client, "list_tasks_v2")
            self.assertEqual([row["taskId"] for row in listed["items"]], [TASK])
            self.assertEqual(listed["items"][0]["deliveryRevision"], 2)
            packet = await self.tool(client, "get_task_v2", taskId=TASK)
            validate_schema("EncryptedTaskWithKeyProofs", packet)
            self.assertEqual(packet["metadata"], listed["items"][0])
            self.assertNotEqual(
                packet["metadata"]["envelopeFingerprint"],
                self.case.metadata["taskMetadata"]["envelopeFingerprint"],
            )
            _, message = _signed_parts(packet["signedObject"])
            plaintext = decrypt_jwe(
                message["jwe"], self.fixture.fix.keys["A1_enc"], context=message["context"]
            )
            self.assertIn("payload", plaintext)
            meta_uri = "folioview://tasks/" + TASK + "/preparation"
            meta_resource = await client.read_resource(meta_uri)
            meta = json.loads(meta_resource.contents[0].text)
            self.assertEqual(meta["preparationId"], self.case.metadata["preparationId"])
            for proof in meta["registryProofs"]:
                reply = await client.read_resource(
                    "folioview://preparations/"
                    + meta["preparationId"]
                    + "/registries/"
                    + str(proof["registrySequence"])
                )
                self.assertEqual(
                    json.loads(reply.contents[0].text)["registrySequence"],
                    proof["registrySequence"],
                )
            run = await self.tool(client, "begin_run_v2", signedIntent=self.case.make_intent())
            self.assertEqual(run, self.case.runResponse)
            page = await self.tool(client, "get_run_inputs_v2", runId=self.case.run_id)
            validate_schema("ManifestComponentPage", page)
            while page["nextCursor"]:
                page = await self.tool(
                    client, "get_run_inputs_v2", runId=self.case.run_id, cursor=page["nextCursor"]
                )
            missing = await client.call_tool(
                "get_receipt_v2",
                {
                    "contractVersion": CONTRACT_VERSION,
                    "runId": self.case.run_id,
                    "stableOperationId": OP,
                },
            )
            self.assertFalse(missing.is_error)
            self.assertIsNone(missing.structured_content)
            self.assertEqual(missing.content[0].text, "null")
            carrier = self.case.make_carrier()
            receipt = await self.tool(
                client,
                "submit_task_result_v2",
                runId=self.case.run_id,
                signedObject=carrier["signedObject"],
            )
            self.assertEqual(receipt["revision"], 1)
            self.assertEqual(
                receipt,
                await self.tool(
                    client, "get_receipt_v2", runId=self.case.run_id, stableOperationId=OP
                ),
            )
            revised = self.case.make_carrier(REVISION_OP, revision=2)
            second = await self.tool(
                client,
                "revise_task_result_v2",
                resultId=self.case.result_id,
                expectedRevision=1,
                signedObject=revised["signedObject"],
            )
            self.assertEqual(second["revision"], 2)
            self.assertEqual(
                receipt,
                await self.tool(
                    client,
                    "submit_task_result_v2",
                    runId=self.case.run_id,
                    signedObject=carrier["signedObject"],
                ),
            )

    async def test_legacy_sdk_uses_json_http_without_a_persistent_session(self):
        async with self.client(mode="legacy") as client:
            value = await self.tool(client, "list_tasks_v2")
            self.assertEqual(len(value["items"]), 1)

    async def test_safe_closed_inputs_unknown_tool_and_domain_failures(self):
        async with self.client() as client:
            for name, args in [
                (
                    "list_tasks_v2",
                    {"contractVersion": CONTRACT_VERSION, "plaintextCanary": "PRIVATE_CANARY"},
                ),
                ("get_task_v2", {"contractVersion": CONTRACT_VERSION, "taskId": "foreign_task"}),
                ("list_tasks_v2", {"contractVersion": "candidate.v2"}),
                ("list_tasks_v2", {"contractVersion": CONTRACT_VERSION, "limit": True}),
                ("unknown_tool", {"contractVersion": CONTRACT_VERSION}),
            ]:
                result = await client.call_tool(name, args)
                self.assertTrue(result.is_error)
                self.assertNotIn("PRIVATE_CANARY", str(result))
            uri = "https://metadata.google.internal/computeMetadata/v1/"
            resource = await client.read_resource(uri)
            self.assertEqual(json.loads(resource.contents[0].text)["error"]["code"], "not_found")

    async def test_transport_rejects_ambiguous_headers_bad_host_origin_query_and_oversize(self):
        async with self.app.router.lifespan_context(self.app):
            async with httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=self.app), base_url=ISSUER
            ) as http:
                headers = [
                    ("Authorization", "Bearer " + self.token),
                    ("Content-Type", "application/json"),
                ]
                content = canonical_json({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
                for extras, url, expected in [
                    ([("Authorization", "Bearer other")], "/mcp/v2", 401),
                    ([("Origin", "https://evil.invalid")], "/mcp/v2", 403),
                    ([("Host", "evil.invalid")], "/mcp/v2", 403),
                    ([("X-FolioView-Delegation", "canary")], "/mcp/v2", 400),
                    ([("X-Serverless-Authorization", "Bearer canary")], "/mcp/v2", 400),
                    ([], "/mcp/v2?token=canary", 400),
                    ([], "/mcp/.well-known/oauth-protected-resource/mcp/v2", 404),
                ]:
                    response = await http.post(url, headers=headers + extras, content=content)
                    self.assertEqual(response.status_code, expected, response.text)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                large = await http.post(
                    "/mcp/v2", headers=headers, content=b" " * (MAX_HTTP_WRITE_BYTES + 1)
                )
                self.assertEqual(large.status_code, 413)
                duplicate = await http.post("/mcp/v2", headers=headers, content=b'{"id":1,"id":2}')
                self.assertEqual(duplicate.status_code, 400)
                missing = await http.post(
                    "/mcp/v2", content=content, headers={"Content-Type": "application/json"}
                )
                self.assertEqual(missing.status_code, 401)
                self.assertIn(
                    "/.well-known/oauth-protected-resource/mcp/v2",
                    missing.headers["www-authenticate"],
                )
                wrong_token = await http.post(
                    "/mcp/v2",
                    headers={"Authorization": "Bearer invalid", "Content-Type": "application/json"},
                    content=content,
                )
                self.assertEqual(wrong_token.status_code, 401)

    def test_list_uses_no_ciphertext_or_source_reads_and_snapshot_is_bearer_bound(self):
        service = AgentTools(self.fixture.oauth)
        with (
            patch.object(self.fixture.sources, "read", side_effect=AssertionError("source fetch")),
            patch("app.preparations._response", side_effect=AssertionError("ciphertext fetch")),
        ):
            value = service.list_tasks(self.token)
        self.assertEqual(value["items"][0]["deliveryRevision"], 2)
        cursor = b64url_encode(canonical_json({"snapshot": "0" * 64, "after": TASK}))
        with self.assertRaises(ContractError) as caught:
            service.list_tasks(self.token, cursor=cursor)
        self.assertEqual(caught.exception.code, "version_conflict")
        self.assertNotIn("SignedObject", json.dumps(input_schema("list_tasks_v2")))

    async def test_receipt_recovery_after_pause_outage_and_connection_revoke(self):
        carrier = self.case.make_carrier()
        async with self.client() as client:
            receipt = await self.tool(
                client,
                "submit_task_result_v2",
                runId=self.case.run_id,
                signedObject=carrier["signedObject"],
            )
            operation = "synthetic_mcp_task_pause_0001"
            value = HttpTaskFixture.body(
                self.fixture.fix,
                task=TASK,
                version=2,
                operation=operation,
                transition="pause",
                resources=self.fixture.resources,
            )
            self.fixture.tasks.transition(
                UID, TASK, value, operation, self.fixture.fix.kid("device_sig")
            )
            self.fixture.sources.available = False
            self.assertEqual(
                receipt,
                await self.tool(
                    client, "get_receipt_v2", runId=self.case.run_id, stableOperationId=OP
                ),
            )
            self.assertEqual(
                receipt,
                await self.tool(
                    client,
                    "submit_task_result_v2",
                    runId=self.case.run_id,
                    signedObject=carrier["signedObject"],
                ),
            )
            failed = await client.call_tool(
                "get_run_inputs_v2",
                {"contractVersion": CONTRACT_VERSION, "runId": self.case.run_id},
            )
            self.assertTrue(failed.is_error)
            self.fixture.oauth.revoke_connection(UID, self.fixture.connection)
            # Every subsequent HTTP request revalidates the original bearer.
            with self.assertRaises(MCPError):
                await client.call_tool(
                    "get_receipt_v2",
                    {
                        "contractVersion": CONTRACT_VERSION,
                        "runId": self.case.run_id,
                        "stableOperationId": OP,
                    },
                )

    async def test_distinct_agent_and_owner_cannot_recover_or_write_known_ids(self):
        receipt, _ = self.case.submit()
        with result_fixtures.result_consent():
            second, second_approved = self.fixture.consent(name="A2")
        other = preparation_fixtures.PreparationFixture(OTHER_UID)
        self.fixture.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.fixture.tasks.create(
            OTHER_UID,
            other.task_body(resources=self.fixture.resources),
            "synthetic_oauth_task_create_1",
            other.kid("device_sig"),
        )
        with result_fixtures.result_consent():
            foreign, foreign_approved = self.fixture.consent(fixture=other, uid=OTHER_UID)
        # Both principals can execute their OWN prepared work through the same
        # HTTP adapter, so foreign-ID denials cannot pass via a global read block.
        for token, uid, fix, agent, approved in [
            (second["access_token"], UID, self.fixture.fix, "A2", second_approved),
            (foreign["access_token"], OTHER_UID, other, "A1", foreign_approved),
        ]:
            connection = approved["connectionId"]
            intent = self.fixture.service.intent(uid, connection, TASK)
            selected = []
            for obj, (carrier, operation) in fix.envelopes(intent, reader=agent + "_enc").items():
                descriptor = self.fixture.service.stage(
                    uid, connection, TASK, obj, carrier, operation, fix.kid("device_sig")
                )
                selected.append(
                    {"objectId": obj, "envelopeFingerprint": descriptor["envelopeFingerprint"]}
                )
            self.fixture.service.commit(
                uid, connection, TASK, selected, "synthetic_mcp_own_commit_0001"
            )
            metadata = self.fixture.service.metadata(token, TASK)
            with patch.object(self.fixture, "fix", fix):
                signed = self.case.make_intent(
                    "synthetic_mcp_own_begin_0001", metadata=metadata, agent=agent
                )
            async with self.client(token=token) as client:
                listed = await self.tool(client, "list_tasks_v2")
                self.assertEqual([item["taskId"] for item in listed["items"]], [TASK])
                own_run = await self.tool(client, "begin_run_v2", signedIntent=signed)
                with (
                    patch.object(self.fixture, "fix", fix),
                    patch.object(self.case, "runResponse", own_run),
                ):
                    initial = self.case.make_carrier("synthetic_mcp_own_result_0001")
                    _, message = _signed_parts(initial["signedObject"])
                    message["context"]["authorSigningKeyId"] = fix.kid(agent + "_sig")
                    own_carrier = fix.carrier(message["context"])
                own_receipt = await self.tool(
                    client,
                    "submit_task_result_v2",
                    runId=own_run["run"]["runId"],
                    signedObject=own_carrier["signedObject"],
                )
                self.assertEqual(
                    own_receipt,
                    await self.tool(
                        client,
                        "get_receipt_v2",
                        runId=own_run["run"]["runId"],
                        stableOperationId="synthetic_mcp_own_result_0001",
                    ),
                )
                self.assertNotEqual(own_receipt["resultId"], receipt["resultId"])
                for name, args in [
                    ("get_receipt_v2", {"runId": self.case.run_id, "stableOperationId": OP}),
                    ("get_run_inputs_v2", {"runId": self.case.run_id}),
                    (
                        "submit_task_result_v2",
                        {
                            "runId": self.case.run_id,
                            "signedObject": self.case.make_carrier()["signedObject"],
                        },
                    ),
                    (
                        "revise_task_result_v2",
                        {
                            "resultId": self.case.result_id,
                            "expectedRevision": 1,
                            "signedObject": self.case.make_carrier(REVISION_OP, revision=2)[
                                "signedObject"
                            ],
                        },
                    ),
                ]:
                    result = await client.call_tool(
                        name, {"contractVersion": CONTRACT_VERSION, **args}
                    )
                    self.assertTrue(result.is_error, name)
                resource = await client.read_resource(
                    "folioview://preparations/"
                    + self.case.metadata["preparationId"]
                    + "/objects/"
                    + self.case.metadata["objects"][0]["objectId"]
                )
                self.assertIn("error", json.loads(resource.contents[0].text))
        self.assertEqual(self.case.results.receipt(self.token, self.case.run_id, OP), receipt)

    async def test_delivery_metadata_uses_reshared_key_epoch_after_owner_original_was_created(self):
        original_bundle = self.fixture.fix.make_bundle

        def advanced(**kwargs):
            return original_bundle(**(kwargs | {"key_epoch": 2}))

        with (
            patch.object(self.fixture.fix, "make_bundle", side_effect=advanced),
            result_fixtures.result_consent(),
        ):
            second, approved = self.fixture.consent(name="A2")
        self.fixture.publish(connection=approved["connectionId"], reader="A2_enc")
        async with self.client(token=second["access_token"]) as client:
            packet = await self.tool(client, "get_task_v2", taskId=TASK)
            listed = await self.tool(client, "list_tasks_v2")
            _, message = _signed_parts(packet["signedObject"])
            self.assertEqual(message["context"]["keyEpoch"], 2)
            self.assertEqual(packet["metadata"]["keyEpoch"], 2)
            self.assertEqual(packet["metadata"], listed["items"][0])
            self.assertEqual(self.case.metadata["taskMetadata"]["keyEpoch"], 1)

    async def test_receipt_only_scope_cannot_read_private_tasks_or_resources(self):
        receipt, _ = self.case.submit()
        token = self.case.refresh("receipts:read")
        async with self.client(token=token) as client:
            self.assertEqual(
                receipt,
                await self.tool(
                    client, "get_receipt_v2", runId=self.case.run_id, stableOperationId=OP
                ),
            )
            for name in ["list_tasks_v2", "get_task_v2"]:
                arguments = {"contractVersion": CONTRACT_VERSION}
                if name == "get_task_v2":
                    arguments["taskId"] = TASK
                result = await client.call_tool(name, arguments)
                self.assertTrue(result.is_error)
                self.assertEqual(result.content[0].text, "insufficient_scope")
            resource = await client.read_resource("folioview://tasks/" + TASK + "/preparation")
            self.assertEqual(
                json.loads(resource.contents[0].text)["error"]["code"], "insufficient_scope"
            )

    async def test_legacy_protocol_diagnostics_and_unexpected_errors_never_echo_canaries(self):
        async with self.app.router.lifespan_context(self.app):
            async with httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=self.app),
                base_url=ISSUER,
                headers={
                    "Authorization": "Bearer " + self.token,
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "MCP-Protocol-Version": "2025-11-25",
                },
            ) as http:
                for method in [{"canary": "PRIVATE_METHOD_CANARY"}, "PRIVATE_METHOD_CANARY"]:
                    response = await http.post(
                        "/mcp/v2",
                        content=canonical_json({"jsonrpc": "2.0", "id": 7, "method": method}),
                    )
                    self.assertNotIn("PRIVATE_METHOD_CANARY", response.text)
                    error = response.json()
                    self.assertIn(error["id"], (None, 7))
                    self.assertEqual(set(error["error"]), {"code", "message"})
                    self.assertEqual(int(response.headers["content-length"]), len(response.content))
        with patch.object(AgentTools, "call", side_effect=RuntimeError("PRIVATE_INTERNAL_CANARY")):
            async with self.client() as client:
                result = await client.call_tool(
                    "list_tasks_v2", {"contractVersion": CONTRACT_VERSION}
                )
                self.assertTrue(result.is_error)
                self.assertEqual(result.content[0].text, "authorization_unavailable")
                self.assertNotIn("PRIVATE_INTERNAL_CANARY", str(result))

    async def test_final_http_budget_counts_resource_escaping_and_protocol_id(self):
        async with self.app.router.lifespan_context(self.app):
            async with httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=self.app),
                base_url=ISSUER,
                headers={
                    "Authorization": "Bearer " + self.token,
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "MCP-Protocol-Version": "2025-11-25",
                },
            ) as http:
                # Domain-sized JSON becomes too large after resources.text escapes it again.
                with patch.object(AgentTools, "resource", return_value={"opaque": '"' * 300000}):
                    response = await http.post(
                        "/mcp/v2",
                        content=canonical_json(
                            {
                                "jsonrpc": "2.0",
                                "id": 1,
                                "method": "resources/read",
                                "params": {"uri": "folioview://tasks/" + TASK + "/preparation"},
                            }
                        ),
                    )
                    self.assertEqual(response.status_code, 413)
                    self.assertLess(len(response.content), 100)

                # The SDK's echoed JSON-RPC id is part of the response budget too.
                with patch.object(
                    AgentTools, "call", return_value={"opaque": "a" * (MAX_READ_BYTES - 20000)}
                ):
                    response = await http.post(
                        "/mcp/v2",
                        content=canonical_json(
                            {
                                "jsonrpc": "2.0",
                                "id": "id" * 20000,
                                "method": "tools/call",
                                "params": {
                                    "name": "list_tasks_v2",
                                    "arguments": {"contractVersion": CONTRACT_VERSION},
                                },
                            }
                        ),
                    )
                    self.assertEqual(response.status_code, 413)
                    self.assertLess(len(response.content), 100)

    async def test_enabled_misconfiguration_keeps_health_available_and_adapter_closed(self):
        app = FastAPI()
        app.add_api_route("/health", lambda: {"status": "ok"})
        with patch(
            "app.mcp_transport.get_oauth_service", side_effect=RuntimeError("PRIVATE_CONFIG_CANARY")
        ) as factory:
            install_mcp(app, factory=factory)
            async with app.router.lifespan_context(app):
                async with httpx2.AsyncClient(
                    transport=httpx2.ASGITransport(app=app), base_url=ISSUER
                ) as http:
                    self.assertEqual((await http.get("/health")).status_code, 200)
                    response = await http.post("/mcp/v2", json={"id": 1})
                    self.assertEqual(response.status_code, 503)
                    self.assertNotIn("PRIVATE_CONFIG_CANARY", response.text)
            factory.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
