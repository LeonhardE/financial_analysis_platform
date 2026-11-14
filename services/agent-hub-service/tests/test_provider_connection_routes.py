"""Owner-only closed transport and optional SDK preserve original commands."""

import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import require_owner
from app.errors import HubErrors
from app.provider_connection_routes import get_provider_service, router
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.http import PrivateResponseHeaders


class ProviderConnectionRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        app.add_middleware(HubErrors)
        app.add_middleware(PrivateResponseHeaders)
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid="synthetic_owner")
        self.calls = []

        def call(kind, *args):
            self.calls.append((kind, args))
            return {"kind": kind}

        app.dependency_overrides[get_provider_service] = lambda: SimpleNamespace(
            summary=lambda *args: call("summary", *args),
            state=lambda *args: call("state", *args),
            receipt=lambda *args: call("receipt", *args),
            command=lambda *args: call("command", *args),
        )
        self.client = TestClient(app)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.operation = "synthetic_provider_operation_0001"
        self.write_headers = {**self.headers, "Idempotency-Key": self.operation}
        self.path = "/api/v3/provider-connections/vault_A/muse"
        self.body = {"contractVersion": CONTRACT_VERSION, "command": {"approval": {}}}

    def test_summary_is_owner_only_read_transport_and_survives_disabled_write_gate(self):
        path = "/api/v3/provider-connections/vault_A/summary"
        with patch.dict(os.environ, {"HUB_PROVIDER_CONNECTION_SLOTS_ENABLED": "0"}):
            response = self.client.get(path, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.calls, [("summary", ("synthetic_owner", "vault_A"))])
        self.calls.clear()
        for suffix, headers in (
            ("?owner=other", self.headers),
            ("", {}),
            ("", {**self.headers, "X-FolioView-Delegation": "x"}),
            ("", {**self.headers, "X-FolioView-Author-Key": "x"}),
            ("", {**self.headers, "Idempotency-Key": self.operation}),
        ):
            self.assertEqual(self.client.get(path + suffix, headers=headers).status_code, 400)
        self.assertEqual(
            self.client.request(
                "GET", path, headers=self.headers, json={"owner": "other"}
            ).status_code,
            400,
        )
        self.assertEqual(self.client.post(path, headers=self.headers).status_code, 405)
        self.assertEqual(self.calls, [])

    def test_off_gate_keeps_read_and_original_receipt_available_and_does_not_write(self):
        with patch.dict(os.environ, {"HUB_PROVIDER_CONNECTION_SLOTS_ENABLED": "0"}):
            self.assertEqual(
                self.client.post(
                    self.path + "/commands", headers=self.write_headers, json=self.body
                ).status_code,
                503,
            )
            self.assertFalse(
                self.client.get(
                    "/api/v3/provider-connections/capabilities", headers=self.headers
                ).json()["enabled"]
            )
            self.assertEqual(self.calls, [])
            self.assertEqual(self.client.get(self.path, headers=self.headers).status_code, 200)
            self.assertEqual(
                self.client.get(
                    self.path + "/operations/" + self.operation, headers=self.headers
                ).status_code,
                200,
            )

    def test_explicit_write_uses_authenticated_owner_and_original_header_operation(self):
        with patch("app.provider_connection_routes.provider_slots_enabled", return_value=True):
            response = self.client.post(
                self.path + "/commands", headers=self.write_headers, json=self.body
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            self.calls,
            [
                (
                    "command",
                    ("synthetic_owner", "vault_A", "muse", self.body["command"], self.operation),
                )
            ],
        )

    def test_query_extra_owner_missing_operation_and_delegation_are_refused(self):
        with patch("app.provider_connection_routes.provider_slots_enabled", return_value=True):
            for path, headers, value in (
                (self.path + "/commands?owner=x", self.write_headers, self.body),
                (self.path + "/commands", self.headers, self.body),
                (
                    self.path + "/commands",
                    {**self.write_headers, "X-FolioView-Delegation": "x"},
                    self.body,
                ),
                (self.path + "/commands", self.write_headers, {**self.body, "ownerSubject": "x"}),
            ):
                self.assertEqual(
                    self.client.post(path, headers=headers, json=value).status_code, 400
                )
        self.assertEqual(self.calls, [])

    def test_optional_owner_sdk_has_closed_paths_and_no_automatic_write_retry(self):
        script = """
import assert from 'node:assert/strict';
import {ProviderConnectionClient} from './agent-client/owner-connections.mjs';
const calls=[];
const client=new ProviderConnectionClient(async(path,options)=>{
 calls.push({path,options});
 if(options.method==='POST')throw Error('lost_ack');
 return {ok:true};
});
const op='synthetic_provider_operation_0001', command={approval:{signature:'synthetic'}};
await client.state('vault_A','muse');
assert.equal(calls[0].options.headers['X-FolioView-Contract'],'folioview.agent-workspace.v2.0');
await assert.rejects(()=>client.submit('vault_A','muse',command,op),/lost_ack/);
assert.equal(calls.length,2);
assert.deepEqual(JSON.parse(calls[1].options.body).command,command);
await client.receipt('vault_A','muse',op);
assert.equal(calls.length,3);
for(const v of [undefined,'../vault','vault?x']) assert.throws(()=>client.path(v,'muse'));
assert.throws(()=>client.path('vault_A','claude'));
assert.throws(()=>client.receipt('vault_A','muse','../operation'));
"""
        subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=Path(__file__).resolve().parents[1],
            check=True,
            capture_output=True,
            timeout=15,
        )
