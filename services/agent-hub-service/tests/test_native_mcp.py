"""Pinned actual MCP SDK over the bootstrap-only native credential profile."""

import os
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch

import httpx2
import test_native_transport as accounts
from fastapi import FastAPI
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from app.native_mcp import install_native_mcp


class NativeMCPTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.case = accounts.NativeTransportTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.oauth = self.case.service
        self.token = self.case.connect()["access_token"]
        env = patch.dict(
            os.environ,
            {
                "HUB_PERSISTENT_TRANSPORT_ENABLED": "1",
                "HUB_PERSISTENT_MCP_ENABLED": "1",
                "HUB_AGENT_OWNED_CREDENTIALS_ENABLED": "1",
                "HUB_AGENT_OWNER_URL": "https://owner.example/agents",
                "CORS_ORIGINS": "https://owner.example",
            },
        )
        env.start()
        self.addCleanup(env.stop)
        clock = patch(
            "mcp.server.auth.middleware.bearer_auth.time",
            SimpleNamespace(time=lambda: self.case.now),
        )
        clock.start()
        self.addCleanup(clock.stop)
        self.app = FastAPI()
        install_native_mcp(self.app, factory=lambda: self.oauth)

    @asynccontextmanager
    async def client(self, mode="auto"):
        async with self.app.router.lifespan_context(self.app):
            async with httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=self.app),
                headers={"Authorization": "Bearer " + self.token},
            ) as http:
                async with Client(
                    streamable_http_client(
                        self.oauth.config.base.issuer + "/mcp/v3", http_client=http
                    ),
                    mode=mode,
                ) as client:
                    yield client

    async def test_legacy_sdk_protocol_uses_only_current_personal_agent_tools(self):
        async with self.client("legacy") as client:
            result = await client.call_tool("agent_connection", {})
            self.assertFalse(result.is_error)
            self.assertEqual(result.structured_content["provider"], "muse")

    async def test_wrong_host_origin_ambient_authority_and_unknown_paths_are_closed(self):
        async with self.app.router.lifespan_context(self.app):
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=self.app)) as http:
                url = self.oauth.config.base.issuer + "/mcp/v3"
                good = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
                cases = [
                    await http.post(url, json={}, headers={**good, "Host": "wrong.example"}),
                    await http.post(
                        url, json={}, headers={**good, "Origin": self.oauth.config.issuer}
                    ),
                    await http.post(url + "?owner=other", json={}, headers=good),
                    await http.post(
                        url, json={}, headers={**good, "X-FolioView-Delegation": "private_marker"}
                    ),
                    await http.get(url, headers=good),
                ]
                self.assertEqual([r.status_code for r in cases], [403, 403, 400, 400, 405])
                self.assertTrue(all("private_marker" not in r.text for r in cases))

    async def test_owned_sdk_has_only_private_host_bootstrap_and_opaque_offers(self):
        from folioview_shared.encrypted.jsonutil import b64url_encode

        with patch.dict(
            os.environ,
            {
                "HUB_AGENT_OWNED_CREDENTIALS_ENABLED": "1",
                "HUB_AGENT_OWNER_URL": "https://owner.example/agents",
                "CORS_ORIGINS": "https://owner.example",
            },
        ):
            async with self.client() as client:
                tools = await client.list_tools()
                self.assertEqual(
                    {t.name for t in tools.tools},
                    {
                        "agent_connection",
                        "prepare_agent_authorization",
                        "submit_agent_offer",
                        "agent_activation",
                    },
                )
                inspected = await client.call_tool("agent_connection", {})
                self.assertFalse(inspected.is_error)
                self.assertEqual(inspected.structured_content["provider"], "muse")
                prepared = await client.call_tool("prepare_agent_authorization", {})
                self.assertFalse(prepared.is_error)
                setup = prepared.structured_content["setup"]["setupIntentId"]
                offer = await client.call_tool(
                    "submit_agent_offer",
                    {
                        "setupIntentId": setup,
                        "offer": {
                            "version": 1,
                            "iv": b64url_encode(b"i" * 12),
                            "ciphertext": b64url_encode(b"c" * 32),
                        },
                    },
                )
                self.assertFalse(offer.is_error)
                pending = await client.call_tool("agent_activation", {"setupIntentId": setup})
                self.assertFalse(pending.is_error)
                self.assertIsNone(pending.structured_content["activation"])
                for name, args in [
                    ("open_persistent_runtime", {}),
                    ("prepare_agent_authorization", {"provider": "chatgpt"}),
                    (
                        "submit_agent_offer",
                        {"setupIntentId": setup, "offer": {"privateKey": "synthetic_marker"}},
                    ),
                ]:
                    rejected = await client.call_tool(name, args)
                    self.assertTrue(rejected.is_error)
                    self.assertNotIn("synthetic_marker", str(rejected))
                self.assertNotIn(self.token, str(prepared.structured_content))

    async def test_disabled_surface_returns_closed_error_without_creating_setup(self):
        with patch.dict(os.environ, {"HUB_PERSISTENT_MCP_ENABLED": "0"}):
            async with self.app.router.lifespan_context(self.app):
                async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=self.app)) as http:
                    response = await http.post(self.oauth.config.base.issuer + "/mcp/v3", json={})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")
