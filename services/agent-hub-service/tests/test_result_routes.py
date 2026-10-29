"""Real synthetic OAuth and signed ciphertext at the production result HTTP boundary."""

import copy
import os
import unittest
from unittest.mock import patch

import test_results as fixtures
from fastapi.testclient import TestClient
from test_oauth import TASK
from test_tasks import TaskFixture

from app.main import app
from app.oauth import get_oauth_service
from app.results import get_result_service
from app.store import StoreUnavailable
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, decrypt_jwe
from folioview_shared.encrypted.schema import validate_schema


class ResultRouteTests(unittest.TestCase):
    def setUp(self):
        enabled = patch.dict(os.environ, {"HUB_ENCRYPTED_ADAPTER_ENABLED": "1"})
        enabled.start()
        self.addCleanup(enabled.stop)
        self.case = fixtures.ResultTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.base = self.case.case
        app.dependency_overrides[get_oauth_service] = lambda: self.base.oauth
        app.dependency_overrides[get_result_service] = lambda: self.case.results
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app, base_url=self.base.oauth.config.issuer)
        self.addCleanup(self.client.close)
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Authorization": "Bearer " + self.case.token,
        }
        self.create_path = f"/agent/v2/runs/{self.case.run_id}/results"
        self.revise_path = f"/agent/v2/results/{self.case.result_id}/revisions"
        self.receipt_path = f"/agent/v2/runs/{self.case.run_id}/receipts/"

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:350])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())
        return response.json()["error"]["code"]

    def submit(self, carrier=None, operation=fixtures.OP, *, headers=None):
        return self.client.post(
            self.create_path,
            headers={**(headers or self.headers), "Idempotency-Key": operation},
            json=carrier if carrier is not None else self.case.make_carrier(operation),
        )

    def revise(self, carrier, operation=fixtures.REVISION_OP, expected=1, *, headers=None):
        return self.client.post(
            self.revise_path,
            headers={**(headers or self.headers), "Idempotency-Key": operation},
            json={**carrier, "expectedRevision": expected},
        )

    def test_create_replay_and_receipt_are_one_ciphertext_with_owner_recovery_decryption(self):
        absent = self.client.get(self.receipt_path + fixtures.OP, headers=self.headers)
        self.assertEqual((absent.status_code, absent.json()), (200, None))
        carrier = self.case.make_carrier()
        first = self.submit(carrier)
        self.assertEqual(first.status_code, 201, first.text)
        validate_schema("ResultReceipt", first.json())
        self.assertEqual(first.headers["cache-control"], "no-store")
        replay = self.submit(carrier)
        self.assertEqual((replay.status_code, replay.content), (200, first.content))
        recovered = self.client.get(self.receipt_path + fixtures.OP, headers=self.headers)
        self.assertEqual((recovered.status_code, recovered.content), (200, first.content))
        saved = self.case.stored_revision()
        _, message = _signed_parts(fixtures.json_carrier(saved)["signedObject"])
        for recipient in ("device_enc", "recovery_enc"):
            private = decrypt_jwe(
                message["jwe"], self.base.fix.keys[recipient], context=message["context"]
            )
            self.assertEqual(private["payload"]["title"], "Synthetic daily report")
        for packet in (carrier, first.json(), saved):
            self.assertNotIn("Synthetic daily report", str(packet))
            self.assertNotIn(self.base.fix.keys["A1_sig"]["d"], str(packet))
        self.assertNotIn("key=", first.json()["resultPath"])

    def test_revision_cas_and_lost_receipt_preserve_original_immutable_revision(self):
        original = self.submit()
        self.assertEqual(original.status_code, 201, original.text)
        old = copy.deepcopy(self.case.stored_revision())
        self.base.now += 5
        packet = self.case.make_carrier(fixtures.REVISION_OP, revision=2)
        revised = self.revise(packet)
        self.assertEqual(revised.status_code, 201, revised.text)
        self.assertEqual(revised.json()["revision"], 2)
        self.assertNotEqual(revised.json()["receivedAt"], original.json()["receivedAt"])
        replay = self.revise(packet)
        self.assertEqual((replay.status_code, replay.content), (200, revised.content))
        stale_op = "synthetic_http_stale_revision_0001"
        stale = self.revise(self.case.make_carrier(stale_op, revision=2), stale_op)
        self.assertEqual(self.failure(stale, 409), "version_conflict")
        self.assertEqual(self.case.stored_revision(), old)
        self.assertEqual(
            self.client.get(self.receipt_path + fixtures.OP, headers=self.headers).content,
            original.content,
        )
        self.assertEqual(
            self.client.get(self.receipt_path + fixtures.REVISION_OP, headers=self.headers).content,
            revised.content,
        )

    def test_closed_transport_rejects_owner_model_private_keys_queries_and_duplicate_headers(self):
        packet = self.case.make_carrier()
        for extra in (
            {"ownerSubject": "other_owner"},
            {"manifestId": "attacker_manifest"},
            {"modelName": "claimed_model"},
            {"privateKey": {"d": "synthetic_private_marker"}},
        ):
            self.failure(self.submit(packet | extra), 400)
        self.failure(self.client.post(self.create_path, headers=self.headers, json=packet), 400)
        self.failure(
            self.client.post(
                self.create_path + "?owner=other",
                headers={**self.headers, "Idempotency-Key": fixtures.OP},
                json=packet,
            ),
            400,
        )
        self.failure(
            self.client.post(
                self.create_path,
                headers=[
                    *self.headers.items(),
                    ("X-FolioView-Contract", CONTRACT_VERSION),
                    ("Idempotency-Key", fixtures.OP),
                ],
                json=packet,
            ),
            400,
        )
        self.failure(
            self.client.get(self.receipt_path + fixtures.OP + "?runId=other", headers=self.headers),
            400,
        )
        wrong_header = self.submit(packet, "synthetic_http_different_operation_1")
        self.assertEqual(self.failure(wrong_header, 422), "recipient_binding_mismatch")
        self.failure(
            self.client.post(
                self.revise_path,
                headers={**self.headers, "Idempotency-Key": fixtures.REVISION_OP},
                json=packet | {"expectedRevision": True},
            ),
            400,
        )

    def test_write_scope_does_not_implicitly_grant_receipt_or_input_read_permission(self):
        token = self.case.refresh("results:create")
        write_headers = {**self.headers, "Authorization": "Bearer " + token}
        carrier = self.case.make_carrier()
        created = self.submit(carrier, headers=write_headers)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.submit(carrier, headers=write_headers).status_code, 200)
        self.failure(self.client.get(self.receipt_path + fixtures.OP, headers=write_headers), 403)

    def test_receipt_only_scope_recovers_saved_fact_without_new_write_permission(self):
        carrier = self.case.make_carrier()
        created = self.submit(carrier)
        self.assertEqual(created.status_code, 201, created.text)
        token = self.case.refresh("receipts:read")
        receipt_headers = {**self.headers, "Authorization": "Bearer " + token}
        found = self.client.get(self.receipt_path + fixtures.OP, headers=receipt_headers)
        self.assertEqual((found.status_code, found.content), (200, created.content))
        self.failure(self.submit(carrier, headers=receipt_headers), 403)
        self.failure(
            self.revise(
                self.case.make_carrier(fixtures.REVISION_OP, revision=2), headers=receipt_headers
            ),
            403,
        )

    def test_saved_fact_survives_real_task_pause_outage_and_expiry_but_grant_revoke_denies(self):
        carrier = self.case.make_carrier()
        original = self.submit(carrier)
        self.assertEqual(original.status_code, 201, original.text)
        operation = "synthetic_http_pause_result_task_0001"
        transition = TaskFixture.body(
            self.base.fix,
            task=TASK,
            version=2,
            operation=operation,
            resources=self.base.resources,
            action="pause",
            epoch=2,
        )
        self.base.tasks.transition(
            fixtures.UID, TASK, transition, operation, self.base.fix.kid("device_sig")
        )
        self.failure(self.revise(self.case.make_carrier(fixtures.REVISION_OP, revision=2)), 403)
        self.base.sources.available = False
        self.base.now = 1501
        recovered = self.client.get(self.receipt_path + fixtures.OP, headers=self.headers)
        self.assertEqual((recovered.status_code, recovered.content), (200, original.content))
        replay = self.submit(carrier)
        self.assertEqual((replay.status_code, replay.content), (200, original.content))
        self.base.oauth.revoke_grant(
            fixtures.UID, self.base.connection, self.case.metadata["grantId"]
        )
        self.failure(self.client.get(self.receipt_path + fixtures.OP, headers=self.headers), 404)
        self.failure(self.submit(carrier), 404)

    def test_original_connection_required_and_signature_corruption_cannot_replay(self):
        carrier = self.case.make_carrier()
        original = self.submit(carrier)
        self.assertEqual(original.status_code, 201, original.text)
        corrupt = copy.deepcopy(carrier)
        corrupt["signedObject"]["signature"] = "A" * 86
        self.failure(self.submit(corrupt), 422)
        token, _ = self.base.consent(name="A2")
        foreign = {**self.headers, "Authorization": "Bearer " + token["access_token"]}
        self.failure(self.client.get(self.receipt_path + fixtures.OP, headers=foreign), 404)
        self.failure(self.submit(carrier, headers=foreign), 404)
        self.assertEqual(
            self.client.get(self.receipt_path + fixtures.OP, headers=self.headers).content,
            original.content,
        )

    def test_large_or_wrong_media_body_is_rejected_without_persistence(self):
        headers = {**self.headers, "Idempotency-Key": fixtures.OP}
        self.failure(
            self.client.post(
                self.create_path,
                headers=headers | {"Content-Type": "application/json"},
                content=b"x" * 589825,
            ),
            413,
        )
        self.failure(
            self.client.post(
                self.create_path,
                headers=headers | {"Content-Type": "text/plain"},
                content="synthetic_private_marker",
            ),
            415,
        )
        self.assertIsNone(
            self.client.get(self.receipt_path + fixtures.OP, headers=self.headers).json()
        )

    def test_unavailable_store_disabled_adapter_and_invalid_tokens_have_safe_errors(self):
        carrier = self.case.make_carrier()
        with patch.object(self.case.results.store, "transact", side_effect=StoreUnavailable):
            failed = self.submit(carrier)
            self.failure(failed, 503)
            self.assertNotIn(self.case.token, failed.text)
            self.assertNotIn(str(carrier), failed.text)
        with (
            patch.dict(os.environ, {"HUB_ENCRYPTED_ADAPTER_ENABLED": "0"}),
            patch.object(
                self.case.results, "submit", side_effect=AssertionError("must stay closed")
            ),
        ):
            self.failure(self.submit(carrier), 503)
        missing = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.failure(self.submit(carrier, headers=missing), 401)
        self.failure(self.client.get(self.receipt_path + fixtures.OP, headers=missing), 401)
