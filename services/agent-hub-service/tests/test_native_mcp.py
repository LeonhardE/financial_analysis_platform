"""Pinned actual MCP SDK over the bootstrap-only native credential profile."""

import os
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch

import httpx2
import test_runtime_setup as setups
from fastapi import FastAPI
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from app.mcp_transport import install_mcp
from app.native_mcp import install_native_mcp


class NativeMCPTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.case = setups.RuntimeSetupTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.oauth = self.case.a.service
        self.token = self.case.tokens["access_token"]
        env = patch.dict(
            os.environ, HUB_PERSISTENT_TRANSPORT_ENABLED="1", HUB_PERSISTENT_MCP_ENABLED="1"
        )
        env.start()
        self.addCleanup(env.stop)
        clock = patch(
            "mcp.server.auth.middleware.bearer_auth.time",
            SimpleNamespace(time=lambda: self.case.a.now),
        )
        clock.start()
        self.addCleanup(clock.stop)
        self.app = FastAPI()
        install_native_mcp(self.app, factory=lambda: self.oauth)
        install_mcp(self.app)

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

    async def test_real_sdk_lists_only_bootstrap_tools_and_never_returns_credentials(self):
        async with self.client() as client:
            tools = await client.list_tools()
            self.assertEqual(
                {t.name for t in tools.tools}, {"open_persistent_runtime", "confirm_runtime_offer"}
            )
            result = await client.call_tool("open_persistent_runtime", {})
            self.assertFalse(result.is_error, result)
            value = result.structured_content
            self.assertEqual(value["mode"], "setup")
            self.assertEqual(value["setup"]["intentId"], self.case.intent)
            self.assertNotIn(self.token, str(value))
            self.assertNotIn("ownerUid", str(value))
            offer = self.case.offer()
            result = await client.call_tool(
                "confirm_runtime_offer",
                {"setupIntentId": self.case.intent, "offerFingerprint": offer["offerFingerprint"]},
            )
            self.assertFalse(result.is_error, result)
            self.assertFalse(result.structured_content["protectedHostAttested"])

    async def test_legacy_sdk_can_discover_same_narrow_native_surface(self):
        async with self.client("legacy") as client:
            result = await client.call_tool("open_persistent_runtime", {})
            self.assertFalse(result.is_error, result)
            self.assertEqual(result.structured_content["mode"], "setup")

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

    async def test_disabled_surface_returns_closed_error_without_creating_setup(self):
        with patch.dict(os.environ, {"HUB_PERSISTENT_MCP_ENABLED": "0"}):
            async with self.app.router.lifespan_context(self.app):
                async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=self.app)) as http:
                    response = await http.post(self.oauth.config.base.issuer + "/mcp/v3", json={})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")
