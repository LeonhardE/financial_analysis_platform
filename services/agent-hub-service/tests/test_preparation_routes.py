"""Production HTTP preparation routes with real signatures, OAuth and SQLite state."""

import copy
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_preparations as fixtures
from fastapi.testclient import TestClient

from app.api import require_owner
from app.main import app
from app.oauth import get_oauth_service
from app.oauth_routes import COOKIE as FLOW_COOKIE
from app.preparations import get_preparation_service
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, decrypt_jwe
from folioview_shared.encrypted.schema import validate_schema


class PreparationRouteTests(unittest.TestCase):
    def setUp(self):
        enabled = patch.dict(os.environ, {"HUB_ENCRYPTED_ADAPTER_ENABLED": "1"})
        enabled.start()
        self.addCleanup(enabled.stop)
        self.case = fixtures.PreparationTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        app.dependency_overrides[get_preparation_service] = lambda: self.case.service
        app.dependency_overrides[get_oauth_service] = lambda: self.case.oauth
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=fixtures.UID)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app, base_url=fixtures.configuration().issuer)
        self.addCleanup(self.client.close)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.agent = {
            **self.headers,
            "Authorization": "Bearer " + self.case.tokens["access_token"],
        }
        self.owner_base = f"/api/v2/agent-connections/{self.case.connection}/tasks/{fixtures.TASK}"

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:300])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())
        return response.json()["error"]["code"]

    def publish_http(self):
        response = self.client.get(self.owner_base + "/preparation-intent", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        intent = response.json()
        packets = self.case.fix.envelopes(intent)
        selected = []
        for obj, (carrier, operation) in packets.items():
            response = self.client.put(
                self.owner_base + "/preparation/objects/" + obj,
                headers={
                    **self.headers,
                    "Idempotency-Key": operation,
                    "X-FolioView-Author-Key": self.case.fix.kid("device_sig"),
                },
                json={"contractVersion": CONTRACT_VERSION, "envelope": carrier},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.headers["cache-control"], "no-store")
            descriptor = response.json()
            selected.append({k: descriptor[k] for k in ("objectId", "envelopeFingerprint")})
        response = self.client.post(
            self.owner_base + "/preparation/commit",
            headers={**self.headers, "Idempotency-Key": "synthetic_http_preparation_commit"},
            json={"contractVersion": CONTRACT_VERSION, "objects": selected},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return intent, packets, selected, response.json()

    def test_actual_http_publication_proofs_cipher_reads_and_client_decryption(self):
        self.failure(
            self.client.get(f"/agent/v2/tasks/{fixtures.TASK}/preparation", headers=self.agent),
            404,
        )
        original = self.case.tasks.get(fixtures.UID, fixtures.TASK)
        intent, packets, selected, committed = self.publish_http()
        response = self.client.get(
            f"/agent/v2/tasks/{fixtures.TASK}/preparation", headers=self.agent
        )
        self.assertEqual(response.status_code, 200, response.text)
        metadata = response.json()
        self.assertFalse(
            self.case.oauth.connections(fixtures.UID)["items"][0]["grants"][0]["readObserved"]
        )
        self.assertEqual(metadata["preparationId"], committed["preparationId"])
        self.assertEqual(metadata["taskDeliveryBase"]["deliveryRevision"], 1)
        self.assertEqual(response.headers["cache-control"], "no-store")
        for proof in metadata["registryProofs"]:
            fetched = self.client.get(proof["path"], headers=self.agent)
            self.assertEqual(fetched.status_code, 200, fetched.text)
            self.assertEqual(fetched.json()["registrySequence"], proof["registrySequence"])
        for descriptor in metadata["objects"]:
            fetched = self.client.get(descriptor["path"], headers=self.agent)
            self.assertEqual(fetched.status_code, 200, fetched.text)
            carrier = fetched.json()["envelope"]
            self.assertEqual(carrier, packets[descriptor["objectId"]][0])
            _, message = _signed_parts(carrier["signedObject"])
            self.assertTrue(
                decrypt_jwe(
                    message["jwe"], self.case.fix.keys["A1_enc"], context=message["context"]
                )
            )
        self.assertEqual(self.case.tasks.get(fixtures.UID, fixtures.TASK), original)
        self.assertTrue(
            self.case.oauth.connections(fixtures.UID)["items"][0]["grants"][0]["readObserved"]
        )
        self.assertEqual(len(selected), len(intent["objects"]))
        self.assertFalse(
            self.case.oauth.connections(fixtures.UID)["items"][0]["grants"][0]["resultSaved"]
        )

    def test_unpublished_stages_are_invisible_and_commit_replay_is_original(self):
        intent, packets, selected = self.case.stage_all()
        self.failure(
            self.client.get(
                f"/agent/v2/preparations/{intent['preparationId']}/objects/{fixtures.TASK}",
                headers=self.agent,
            ),
            404,
        )
        url = self.owner_base + "/preparation/commit"
        headers = {**self.headers, "Idempotency-Key": "synthetic_http_commit_replay"}
        body = {"contractVersion": CONTRACT_VERSION, "objects": selected}
        first = self.client.post(url, headers=headers, json=body)
        self.assertEqual(first.status_code, 200, first.text)
        second = self.client.post(url, headers=headers, json=body)
        self.assertEqual(second.content, first.content)
        conflict = copy.deepcopy(body)
        conflict["objects"][0]["envelopeFingerprint"] = "0" * 64
        self.assertEqual(
            self.failure(self.client.post(url, headers=headers, json=conflict), 409),
            "idempotency_conflict",
        )

    def test_closed_owner_transport_rejects_queries_headers_uid_and_oversized_body(self):
        url = self.owner_base + "/preparation-intent"
        self.failure(self.client.get(url), 400)
        self.failure(self.client.get(url + "?ownerSubject=other", headers=self.headers), 400)
        self.failure(
            self.client.get(
                url,
                headers=[("X-FolioView-Contract", CONTRACT_VERSION)] * 2,
            ),
            400,
        )
        target = self.owner_base + "/preparation/objects/" + fixtures.TASK
        self.failure(
            self.client.put(
                target, headers=self.headers, json={"contractVersion": CONTRACT_VERSION}
            ),
            400,
        )
        headers = {
            **self.headers,
            "Idempotency-Key": "synthetic_http_malformed_stage",
            "X-FolioView-Author-Key": self.case.fix.kid("device_sig"),
        }
        self.failure(
            self.client.put(
                target,
                headers=headers,
                json={
                    "contractVersion": CONTRACT_VERSION,
                    "envelope": {},
                    "uid": fixtures.OTHER_UID,
                },
            ),
            400,
        )
        self.failure(
            self.client.put(
                target,
                headers={**headers, "Content-Type": "application/json"},
                content=b"x" * 589825,
            ),
            413,
        )

    def test_owner_foreign_identity_and_unknown_task_do_not_reveal_preparations(self):
        intent, _, _, _ = self.case.publish()
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=fixtures.OTHER_UID)
        self.failure(
            self.client.get(self.owner_base + "/preparation-intent", headers=self.headers), 404
        )
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=fixtures.UID)
        self.failure(
            self.client.get(
                self.owner_base.replace(fixtures.TASK, "missing_task") + "/preparation-intent",
                headers=self.headers,
            ),
            404,
        )
        tokens2, _ = self.case.consent(name="A2")
        self.failure(
            self.client.get(
                f"/agent/v2/preparations/{intent['preparationId']}/objects/{fixtures.TASK}",
                headers={**self.headers, "Authorization": "Bearer " + tokens2["access_token"]},
            ),
            404,
        )

    def test_agent_rejections_are_versioned_no_store_and_invalid_bearers_have_challenge(self):
        intent, _, _, _ = self.case.publish()
        url = f"/agent/v2/tasks/{fixtures.TASK}/preparation"
        for headers in (
            self.headers,
            {**self.headers, "Authorization": "Bearer not-a-token"},
            {**self.headers, "Authorization": "Bearer synthetic.firebase.jwt"},
        ):
            response = self.client.get(url, headers=headers)
            self.failure(response, 401)
            self.assertIn("/oauth-protected-resource/mcp/v2", response.headers["www-authenticate"])
        self.failure(self.client.get(url + "?uid=other", headers=self.agent), 400)
        self.failure(
            self.client.get(url, headers={"Authorization": self.agent["Authorization"]}), 400
        )
        for sequence in ("01", "0", "-1", "\uff19", "9" * 5000):
            self.failure(
                self.client.get(
                    f"/agent/v2/preparations/{intent['preparationId']}/registries/{sequence}",
                    headers=self.agent,
                ),
                400,
            )
        self.case.oauth.revoke_connection(fixtures.UID, self.case.connection)
        response = self.client.get(url, headers=self.agent)
        self.failure(response, 401)
        self.assertIn("/oauth-protected-resource/mcp/v2", response.headers["www-authenticate"])

    def test_explicit_encrypted_consent_is_separate_and_requires_selected_policy(self):
        pending = self.case.oauth.authorize(
            fixtures.authorization_params(scope="tasks:read portfolio:read"), fixtures.COOKIE
        )
        self.case.oauth.claim(fixtures.UID, pending, fixtures.COOKIE)
        self.client.cookies.set(
            FLOW_COOKIE, fixtures.COOKIE, domain="synthetic-hub.example", path="/"
        )
        url = f"/api/v2/agent-authorizations/{pending}/prepare-encrypted"
        headers = {**self.headers, "Origin": self.case.oauth.config.issuer}
        body = {
            "contractVersion": CONTRACT_VERSION,
            "taskIds": [fixtures.TASK],
            "connectionId": None,
            "approvedScopes": ["tasks:read", "portfolio:read"],
            "historyPolicy": "selected",
        }
        for invalid in (None, [], "tasks:read", [1]):
            self.failure(
                self.client.post(url, headers=headers, json=body | {"approvedScopes": invalid}),
                400,
            )
        self.failure(
            self.client.post(url, headers=headers, json=body | {"historyPolicy": "none"}), 400
        )
        response = self.client.post(url, headers=headers, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        prepared = response.json()["prepared"]
        self.assertEqual(prepared["historyPolicy"], "selected")
        self.assertEqual(prepared["tasks"][0]["selectedResourceVersions"][0]["revision"], 5)

    def test_missing_owner_and_disabled_protocol_do_not_construct_cloud_clients(self):
        app.dependency_overrides.pop(require_owner)
        self.failure(
            self.client.get(self.owner_base + "/preparation-intent", headers=self.headers), 401
        )
        app.dependency_overrides.pop(get_preparation_service)
        app.dependency_overrides.pop(get_oauth_service)
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("socket.create_connection", side_effect=AssertionError("network")),
        ):
            self.failure(
                self.client.get(f"/agent/v2/tasks/{fixtures.TASK}/preparation", headers=self.agent),
                503,
            )

    def test_public_helper_distribution_is_fixed_and_not_a_private_file_endpoint(self):
        import hashlib
        import json

        prefix = "/agent/v2/helper/"
        manifest_response = self.client.get(prefix + "integrity.json")
        self.assertEqual(manifest_response.status_code, 200, manifest_response.text)
        manifest = manifest_response.json()
        worker = self.client.get(prefix + "worker.mjs")
        self.assertEqual(worker.status_code, 200)
        self.assertEqual(
            hashlib.sha256(worker.content).hexdigest(), manifest["files"]["dist/worker.mjs"]
        )
        self.assertEqual(worker.headers["x-content-type-options"], "nosniff")
        self.assertEqual(worker.headers["cross-origin-resource-policy"], "same-origin")
        self.assertIn("connect-src 'none'", worker.headers["content-security-policy"])
        self.assertNotIn("unsafe-eval", worker.headers["content-security-policy"])
        self.assertEqual(worker.headers["cache-control"], "no-store")
        for asset in ("package-lock.json", "../app/oauth.py", "schemas.json", "missing", ".env"):
            response = self.client.get(prefix + asset)
            self.assertEqual(response.status_code, 404)
            self.assertNotIn("Traceback", response.text)
        with patch.dict(os.environ, {"HUB_ENCRYPTED_ADAPTER_ENABLED": "0"}):
            response = self.client.get(prefix + "worker.mjs")
            self.assertEqual(response.status_code, 503)
            self.assertNotEqual(response.content, worker.content)
        self.assertEqual(json.loads(manifest_response.content)["helperVersion"], "1.1.0")
