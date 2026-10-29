"""Formal Run HTTP lifecycle over real synthetic OAuth, preparation and SQLite state."""

import copy
import os
import unittest
from unittest.mock import patch

import test_runs as fixtures
from fastapi.testclient import TestClient

from app.main import app
from app.oauth import get_oauth_service
from app.runs import get_run_service
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, decrypt_jwe
from folioview_shared.encrypted.envelope import manifest_fingerprint
from folioview_shared.encrypted.schema import validate_schema


class RunRouteTests(unittest.TestCase):
    def setUp(self):
        enabled = patch.dict(os.environ, {"HUB_ENCRYPTED_ADAPTER_ENABLED": "1"})
        enabled.start()
        self.addCleanup(enabled.stop)
        self.case = fixtures.RunTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        app.dependency_overrides[get_oauth_service] = lambda: self.case.case.oauth
        app.dependency_overrides[get_run_service] = lambda: self.case.runs
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app, base_url=self.case.case.oauth.config.issuer)
        self.addCleanup(self.client.close)
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Authorization": "Bearer " + self.case.case.tokens["access_token"],
        }
        self.begin_path = f"/agent/v2/tasks/{fixtures.TASK}/runs"

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:350])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())
        return response.json()["error"]["code"]

    def begin_http(self, operation=fixtures.OP, signed=None):
        packet = signed or self.case.make_intent(operation)
        response = self.client.post(
            self.begin_path,
            headers={**self.headers, "Idempotency-Key": operation},
            json={"contractVersion": CONTRACT_VERSION, "signedBeginIntent": packet},
        )
        return response, packet

    def test_http_begin_manifest_pages_proofs_and_authenticated_client_decryption(self):
        created, _ = self.begin_http()
        self.assertEqual(created.status_code, 201, created.text)
        value = created.json()
        validate_schema("RunDescriptor", value["run"])
        validate_schema("ManifestDescriptor", value["manifest"])
        self.assertEqual(value["run"]["state"], "ready")
        self.assertEqual(value["manifestFingerprint"], manifest_fingerprint(value["manifest"]))
        self.assertEqual(value["manifest"]["taskEnvelope"]["deliveryRevision"], 2)
        self.assertNotEqual(
            value["manifest"]["taskEnvelope"]["envelopeFingerprint"],
            self.case.metadata["taskMetadata"]["envelopeFingerprint"],
        )
        self.assertEqual(created.headers["cache-control"], "no-store")
        read = self.client.get("/agent/v2/runs/" + value["run"]["runId"], headers=self.headers)
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual(read.json(), value)
        for proof in value["registryProofs"]:
            response = self.client.get(proof["path"], headers=self.headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["registrySequence"], proof["registrySequence"])
        first = self.client.get(value["componentPath"], headers=self.headers)
        self.assertEqual(first.status_code, 200, first.text)
        validate_schema("ManifestComponentPage", first.json())
        self.assertEqual(first.json()["componentIndex"], 0)
        self.assertIsNotNone(first.json()["nextCursor"])
        second = self.client.get(
            value["componentPath"],
            params={"cursor": first.json()["nextCursor"]},
            headers=self.headers,
        )
        self.assertEqual(second.status_code, 200, second.text)
        validate_schema("ManifestComponentPage", second.json())
        self.assertEqual(second.json()["componentIndex"], 1)
        self.assertIsNone(second.json()["nextCursor"])
        _, message = _signed_parts(second.json()["component"]["signedObject"])
        self.assertTrue(
            decrypt_jwe(
                message["jwe"], self.case.case.fix.keys["A1_enc"], context=message["context"]
            )
        )

    def test_http_exact_retry_keeps_original_response_and_changed_selection_conflicts(self):
        first, packet = self.begin_http()
        self.assertEqual(first.status_code, 201, first.text)
        second, _ = self.begin_http(signed=packet)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.content, second.content)
        changed = self.case.make_intent(taskEnvelopeFingerprint="0" * 64)
        rejected, _ = self.begin_http(signed=changed)
        self.assertEqual(self.failure(rejected, 409), "idempotency_conflict")
        invalid = copy.deepcopy(packet)
        invalid["signature"] = "A" * 86
        rejected, _ = self.begin_http(signed=invalid)
        self.failure(rejected, 422)

    def test_closed_begin_transport_cannot_select_owner_ids_keys_or_manifest(self):
        packet = self.case.make_intent()
        body = {"contractVersion": CONTRACT_VERSION, "signedBeginIntent": packet}
        for extra in (
            {"ownerSubject": "other_owner"},
            {"runId": "attacker_selected_run"},
            {"manifest": {}},
            {"privateKey": {}},
        ):
            self.failure(
                self.client.post(
                    self.begin_path,
                    headers={**self.headers, "Idempotency-Key": fixtures.OP},
                    json=body | extra,
                ),
                400,
            )
        self.failure(self.client.post(self.begin_path, headers=self.headers, json=body), 400)
        self.failure(
            self.client.post(
                self.begin_path + "?owner=other",
                headers={**self.headers, "Idempotency-Key": fixtures.OP},
                json=body,
            ),
            400,
        )
        self.failure(
            self.client.post(
                self.begin_path,
                headers={
                    **self.headers,
                    "Idempotency-Key": fixtures.OP,
                    "Content-Type": "application/json",
                },
                content=b"x" * 589825,
            ),
            413,
        )

    def test_input_cursors_are_run_bound_and_query_parameters_are_closed(self):
        first, _ = self.begin_http()
        second, _ = self.begin_http(operation="synthetic_http_second_run_0001")
        self.assertEqual(second.status_code, 201, second.text)
        path = first.json()["componentPath"]
        cursor = self.client.get(path, headers=self.headers).json()["nextCursor"]
        self.failure(
            self.client.get(
                second.json()["componentPath"], params={"cursor": cursor}, headers=self.headers
            ),
            400,
        )
        for query in (
            "cursor=unknown",
            "cursor=one&cursor=two",
            "cursor=",
            "cursor=" + "x" * 129,
            "owner=other",
            "cursor=one&limit=2",
        ):
            self.failure(self.client.get(path + "?" + query, headers=self.headers), 400)
        run_id = first.json()["run"]["runId"]
        self.failure(
            self.client.get(f"/agent/v2/runs/{run_id}/registries/0", headers=self.headers),
            404,
        )
        for sequence in ("01", "-1", "\uff19", "9" * 5000):
            self.failure(
                self.client.get(
                    f"/agent/v2/runs/{run_id}/registries/{sequence}", headers=self.headers
                ),
                400,
            )

    def test_ordinary_source_revision_advance_keeps_frozen_pages_and_source_outage_fails_closed(
        self,
    ):
        created, _ = self.begin_http()
        self.assertEqual(created.status_code, 201, created.text)
        path = created.json()["componentPath"]
        initial = self.client.get(path, headers=self.headers)
        self.case.case.sources.revision = 6
        later = self.client.get(path, headers=self.headers)
        self.assertEqual(later.status_code, 200, later.text)
        self.assertEqual(initial.content, later.content)
        self.assertEqual(created.json()["manifest"]["entries"][0]["revision"], 5)
        self.case.case.sources.available = False
        self.assertEqual(
            self.failure(self.client.get(path, headers=self.headers), 503), "source_unavailable"
        )
        self.case.case.sources.available = True
        self.assertEqual(self.client.get(path, headers=self.headers).content, initial.content)

    def test_unknown_and_other_agent_runs_are_not_disclosed(self):
        created, _ = self.begin_http()
        self.assertEqual(created.status_code, 201, created.text)
        run_id = created.json()["run"]["runId"]
        self.failure(self.client.get("/agent/v2/runs/missing_run", headers=self.headers), 404)
        other, _ = self.case.case.consent(name="A2")
        self.failure(
            self.client.get(
                "/agent/v2/runs/" + run_id,
                headers={**self.headers, "Authorization": "Bearer " + other["access_token"]},
            ),
            404,
        )
        self.failure(
            self.client.get(
                created.json()["componentPath"],
                headers={**self.headers, "Authorization": "Bearer " + other["access_token"]},
            ),
            404,
        )

    def test_missing_wrong_and_revoked_credentials_have_versioned_bearer_challenges(self):
        created, _ = self.begin_http()
        path = created.json()["componentPath"]
        for headers in (
            {"X-FolioView-Contract": CONTRACT_VERSION},
            {**self.headers, "Authorization": "Bearer synthetic.firebase.jwt"},
            {**self.headers, "Authorization": "Bearer " + "x" * 43},
        ):
            response = self.client.get(path, headers=headers)
            self.failure(response, 401)
            self.assertIn("oauth-protected-resource/mcp/v2", response.headers["www-authenticate"])
        self.case.case.oauth.revoke_connection(fixtures.UID, self.case.case.connection)
        response = self.client.get(path, headers=self.headers)
        self.failure(response, 401)
        self.assertIn("oauth-protected-resource/mcp/v2", response.headers["www-authenticate"])

    def test_disabled_adapter_does_not_construct_cloud_clients_or_a_run(self):
        app.dependency_overrides.clear()
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            response = self.client.post(
                self.begin_path,
                headers={**self.headers, "Idempotency-Key": fixtures.OP},
                json={"contractVersion": CONTRACT_VERSION, "signedBeginIntent": {}},
            )
            self.failure(response, 503)
            self.assertEqual(self.client.get("/health").status_code, 200)
