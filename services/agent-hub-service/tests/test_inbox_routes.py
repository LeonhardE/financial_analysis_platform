"""Production owner routes with synthetic Firebase verification and real signed storage."""

import copy
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_inbox as fixtures
import test_preparations as preparations
import test_results as results
import test_runs as runs
from fastapi.testclient import TestClient
from firebase_admin import auth
from fixtures import BOOT, OTHER_UID, UID
from test_oauth import TASK

from app.inbox import get_inbox_service
from app.main import app
from app.store import StoreUnavailable
from folioview_shared.encrypted.authority import verify_agent_grant, verify_registry
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import decrypt_jwe
from folioview_shared.encrypted.envelope import (
    EnvelopeExpectation,
    validate_result_receipt,
    verify_carrier,
)
from folioview_shared.encrypted.manifests import ManifestExpectation, verify_manifest
from folioview_shared.encrypted.private import validate_private_payload
from folioview_shared.encrypted.schema import validate_schema

OWNER_A = "synthetic_google_owner_A"
OWNER_B = "synthetic_google_owner_B"


class InboxRouteTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.InboxTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.base = self.case.base
        app.dependency_overrides[get_inbox_service] = lambda: self.case.inbox
        self.addCleanup(app.dependency_overrides.clear)

        def verify(token, **kwargs):
            self.assertTrue(kwargs["check_revoked"])
            if token not in (OWNER_A, OWNER_B):
                raise auth.InvalidIdTokenError("Synthetic rejected identity")
            return {
                "uid": UID if token == OWNER_A else OTHER_UID,
                "firebase": {"sign_in_provider": "google.com"},
            }

        identity = patch("folioview_shared.auth.auth.verify_id_token", side_effect=verify)
        identity.start()
        self.addCleanup(identity.stop)
        configuration = patch("folioview_shared.auth._get_firebase_app", return_value=object())
        configuration.start()
        self.addCleanup(configuration.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Authorization": "Bearer " + OWNER_A,
        }
        self.path = "/api/v2/results/" + self.case.result_id

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:350])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())
        self.assertNotIn("synthetic-private-marker", response.text)
        return response.json()["error"]["code"]

    def state(self, value=None, *, operation=fixtures.OP, headers=None):
        return self.client.patch(
            self.path + "/state",
            headers={
                **(headers or self.headers),
                "Idempotency-Key": operation,
                "X-FolioView-Author-Key": self.base.fix.kid("device_sig"),
            },
            json=value if value is not None else self.case.command(operation=operation),
        )

    def seed_other_owner(self):
        other = preparations.PreparationFixture(OTHER_UID)
        self.base.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.base.tasks.create(
            OTHER_UID,
            other.task_body(resources=self.base.resources),
            "synthetic_oauth_task_create_1",
            other.kid("device_sig"),
        )
        tokens, approved = self.base.consent(fixture=other, uid=OTHER_UID)
        connection = approved["connectionId"]
        service = self.base.service
        intent = service.intent(OTHER_UID, connection, TASK)
        staged = []
        for object_id, (carrier, operation) in other.envelopes(intent).items():
            descriptor = service.stage(
                OTHER_UID, connection, TASK, object_id, carrier, operation, other.kid("device_sig")
            )
            staged.append({key: descriptor[key] for key in ("objectId", "envelopeFingerprint")})
        service.commit(OTHER_UID, connection, TASK, staged, "synthetic_inbox_B_commit_0001")
        metadata = service.metadata(tokens["access_token"], TASK)
        builder = SimpleNamespace(metadata=metadata, case=SimpleNamespace(fix=other))
        operation = "synthetic_inbox_B_begin_run_0001"
        begin = runs.RunTests.make_intent(builder, operation)
        response, _ = self.case.case.runs.begin(tokens["access_token"], TASK, begin, operation)
        builder.runResponse = response
        operation = "synthetic_inbox_B_result_save_0001"
        carrier = results.ResultTests.make_carrier(builder, operation)
        receipt, _ = self.case.case.results.submit(
            tokens["access_token"], response["run"]["runId"], carrier, operation
        )
        return receipt

    def test_owner_http_proofs_grant_manifest_and_ciphertext_verify_and_decrypt(self):
        self.base.now += 7
        self.case.revise(2)
        response = self.client.get(self.path + "?revision=2", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        value = response.json()
        validate_schema("EncryptedResult", value)
        evidence = self.client.get(self.path + "/revisions/2/evidence", headers=self.headers)
        self.assertEqual(evidence.status_code, 200, evidence.text)
        evidence = evidence.json()
        accepted = evidence["authorProof"]["verifiedAt"]
        self.assertNotEqual(value["metadata"]["receivedAt"], evidence["receipt"]["receivedAt"])
        registry = None
        for descriptor in evidence["registryProofs"]:
            proof = self.client.get(descriptor["path"], headers=self.headers)
            self.assertEqual(proof.status_code, 200, proof.text)
            registry = verify_registry(
                proof.json(),
                root_jwk=self.base.fix.root_public,
                pinned_root_key_id=self.base.fix.root_id,
                owner_subject=self.base.fix.owner,
                vault_id=self.base.fix.vault,
                now=accepted,
                previous=registry,
            )
            self.assertEqual(registry.checkpoint_digest, descriptor["checkpointDigest"])
        run = evidence["run"]
        self.assertEqual(run["runId"], self.case.run_id)
        self.assertEqual(run["initialResultId"], self.case.result_id)
        grant = verify_agent_grant(
            evidence["agentKeyGrant"],
            registry=registry,
            owner_subject=self.base.fix.owner,
            vault_id=self.base.fix.vault,
            connection_id=run["connectionId"],
            authorization_id=run["authorizationId"],
            task_id=TASK,
            task_version=run["taskVersion"],
            execution_epoch=run["executionEpoch"],
            grant_id=run["grantId"],
            grant_epoch=run["grantEpoch"],
            now=accepted,
            authorization_expires_at=evidence["authorizationExpiresAt"],
        )
        manifest = verify_manifest(
            evidence["manifest"],
            run,
            registry=registry,
            grant=grant,
            expectation=ManifestExpectation(
                self.base.fix.owner,
                self.base.fix.vault,
                self.case.run_id,
                run["manifestId"],
                self.case.result_id,
                run["beginIntentFingerprint"],
            ),
            now=accepted,
        )
        self.assertEqual(manifest.fingerprint, evidence["manifestFingerprint"])
        binding = {
            "taskId": TASK,
            "taskVersion": run["taskVersion"],
            "runId": self.case.run_id,
            "manifestId": run["manifestId"],
            "taskEnvelopeFingerprint": evidence["manifest"]["taskEnvelope"]["envelopeFingerprint"],
            "manifestFingerprint": manifest.fingerprint,
            "connectionId": run["connectionId"],
            "grantId": run["grantId"],
            "grantEpoch": run["grantEpoch"],
            "executionEpoch": run["executionEpoch"],
            "resourceRef": None,
            "sourceRevision": None,
            "sourceEpoch": None,
        }
        verified = verify_carrier(
            {"contractVersion": CONTRACT_VERSION, "signedObject": value["signedObject"]},
            registry=registry,
            expectation=EnvelopeExpectation(
                self.base.fix.owner,
                self.base.fix.vault,
                self.case.result_id,
                "result_revision",
                2,
                1,
                "revise_result",
                grant["agentSigningKeyId"],
                binding,
                [],
                tuple(grant["writebackRecipientKeyIds"]),
            ),
            now=accepted,
            contract_header=CONTRACT_VERSION,
            grant=grant,
        )
        validate_result_receipt(
            evidence["receipt"], context=verified.context, fingerprint=verified.fingerprint
        )
        for recipient in ("device_enc", "recovery_enc"):
            private = decrypt_jwe(
                verified.jwe, self.base.fix.keys[recipient], context=verified.context
            )
            validate_private_payload(private, context=verified.context)
            self.assertEqual(private["payload"]["title"], "Synthetic daily report")
        self.assertNotIn("Synthetic daily report", response.text)
        self.assertFalse(value["metadata"]["read"])
        history = self.client.get(self.path + "/revisions?limit=1", headers=self.headers)
        validate_schema("ResultMetadataPage", history.json())
        self.assertEqual(history.json()["items"][0]["revision"], 2)
        cursor = history.json()["nextCursor"]
        prior = self.client.get(
            self.path + "/revisions", params={"limit": 1, "cursor": cursor}, headers=self.headers
        )
        self.assertEqual(prior.json()["items"][0]["revision"], 1)
        self.assertNotIn("signedObject", prior.text)

    def test_signed_state_changes_filters_counts_and_replays_original_ack(self):
        initial = self.client.get("/api/v2/results/counts", headers=self.headers)
        self.assertEqual(initial.json()["counts"]["unread"], 1)
        first = self.state(self.case.command(read=True, starred=True))
        self.assertEqual(first.status_code, 200, first.text)
        validate_schema("ResultMetadata", first.json())
        self.assertEqual(first.json()["stateVersion"], 1)
        self.assertEqual(
            self.state(self.case.command(read=True, starred=True)).json(), first.json()
        )
        self.assertEqual(
            self.client.get("/api/v2/results?filter=unread", headers=self.headers).json()["items"],
            [],
        )
        archive_op = "synthetic_http_inbox_archive_0001"
        archived = self.state(
            self.case.command(operation=archive_op, expected=1, archived=True), operation=archive_op
        )
        self.assertEqual(archived.status_code, 200, archived.text)
        self.assertEqual(
            self.client.get("/api/v2/results", headers=self.headers).json()["items"], []
        )
        archived_items = self.client.get("/api/v2/results?filter=archived", headers=self.headers)
        self.assertEqual(len(archived_items.json()["items"]), 1)
        counts = self.client.get("/api/v2/results/counts", headers=self.headers).json()["counts"]
        self.assertEqual(counts, {"all": 0, "unread": 0, "starred": 0, "archived": 1, "total": 1})
        self.assertEqual(
            self.state(self.case.command(read=True, starred=True)).json(), first.json()
        )
        latest = self.client.get(self.path, headers=self.headers).json()["metadata"]
        self.assertTrue(latest["archived"])
        self.assertEqual(latest["stateVersion"], 2)

    def test_new_body_revision_invalidates_stale_mark_read_without_implicit_reads(self):
        old_command = self.case.command(read=True)
        self.case.revise(2)
        self.assertEqual(self.failure(self.state(old_command), 409), "version_conflict")
        value = self.client.get(self.path, headers=self.headers).json()
        self.assertEqual(value["metadata"]["revision"], 2)
        self.assertFalse(value["metadata"]["read"])
        self.client.get(self.path + "/revisions/1/evidence", headers=self.headers)
        self.assertEqual(
            self.client.get("/api/v2/results/counts", headers=self.headers).json()["counts"][
                "unread"
            ],
            1,
        )
        command = self.case.command(expected=1, read=True)
        self.assertEqual(self.state(command).status_code, 200)

    def test_two_initialized_owners_cannot_borrow_results_counts_proofs_state_or_cursors(self):
        other_receipt = self.seed_other_owner()
        self.base.now += 1
        self.case.new_result("http_cursor_second")
        first = self.client.get("/api/v2/results?limit=1", headers=self.headers).json()
        foreign_headers = {**self.headers, "Authorization": "Bearer " + OWNER_B}
        own = self.client.get("/api/v2/results", headers=foreign_headers)
        self.assertEqual(own.status_code, 200, own.text)
        self.assertEqual(
            [row["resultId"] for row in own.json()["items"]], [other_receipt["resultId"]]
        )
        self.assertEqual(
            self.client.get("/api/v2/results/counts", headers=foreign_headers).json()["counts"][
                "total"
            ],
            1,
        )
        for suffix in ("", "/revisions", "/revisions/1/evidence", "/revisions/1/registries/1"):
            self.failure(self.client.get(self.path + suffix, headers=foreign_headers), 404)
        self.failure(self.state(headers=foreign_headers), 404)
        self.failure(
            self.client.get(
                "/api/v2/results",
                params={"limit": 1, "cursor": first["nextCursor"]},
                headers=foreign_headers,
            ),
            400,
        )
        reverse = "/api/v2/results/" + other_receipt["resultId"]
        self.failure(self.client.get(reverse, headers=self.headers), 404)
        empty = self.client.get("/api/v2/results?taskId=unknown_task", headers=foreign_headers)
        self.assertEqual(empty.json()["items"], [])

    def test_metadata_pagination_binds_query_and_snapshot_and_fetches_no_sources(self):
        self.base.now += 1
        second = self.case.new_result("http_page_second")
        before = self.base.sources.calls
        self.base.sources.available = False
        first = self.client.get("/api/v2/results?limit=1", headers=self.headers)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["items"][0]["resultId"], second["resultId"])
        cursor = first.json()["nextCursor"]
        for query in (
            {"limit": 2, "cursor": cursor},
            {"limit": 1, "cursor": cursor, "filter": "unread"},
        ):
            self.failure(
                self.client.get("/api/v2/results", params=query, headers=self.headers), 400
            )
        page = self.client.get(
            "/api/v2/results", params={"limit": 1, "cursor": cursor}, headers=self.headers
        )
        self.assertEqual(page.json()["items"][0]["resultId"], self.case.result_id)
        self.assertNotIn("signedObject", first.text + page.text)
        self.assertNotIn("title", first.text + page.text)
        self.assertEqual(self.state().status_code, 200)
        self.failure(
            self.client.get(
                "/api/v2/results", params={"limit": 1, "cursor": cursor}, headers=self.headers
            ),
            409,
        )
        self.assertEqual(self.base.sources.calls, before)

    def test_closed_queries_reject_search_private_periods_duplicates_and_numeric_abuse(self):
        for query in (
            "q=synthetic-private-marker",
            "sort=title",
            "period=2026-10-29",
            "owner=other",
            "limit=0",
            "limit=51",
            "limit=01",
            "limit=1&limit=2",
            "filter=unknown",
        ):
            self.failure(self.client.get("/api/v2/results?" + query, headers=self.headers), 400)
        for query in ("revision=0", "revision=01", "revision=" + "9" * 5000, "q=private"):
            self.failure(self.client.get(self.path + "?" + query, headers=self.headers), 400)
        self.failure(
            self.client.get(self.path + "/revisions/01/evidence", headers=self.headers), 400
        )
        self.failure(
            self.client.get(self.path + "/revisions/1/registries/01", headers=self.headers), 400
        )
        self.failure(self.client.get(self.path + "?deliveryRevision=2", headers=self.headers), 404)
        self.failure(
            self.client.get(
                self.path,
                headers=[*self.headers.items(), ("X-FolioView-Contract", CONTRACT_VERSION)],
            ),
            400,
        )

    def test_state_requires_closed_signed_control_and_bounded_transport(self):
        value = self.case.command()
        headers = {
            **self.headers,
            "Idempotency-Key": fixtures.OP,
            "X-FolioView-Author-Key": self.base.fix.kid("device_sig"),
        }
        for key in ("Idempotency-Key", "X-FolioView-Author-Key", "X-FolioView-Contract"):
            self.failure(
                self.client.patch(
                    self.path + "/state",
                    headers={k: v for k, v in headers.items() if k != key},
                    json=value,
                ),
                400,
            )
        self.failure(self.state(value | {"ownerSubject": OTHER_UID}), 400)
        corrupt = copy.deepcopy(value)
        corrupt["command"]["signature"] = "A" * 86
        self.failure(self.state(corrupt), 422)
        self.failure(
            self.client.patch(
                self.path + "/state",
                headers=headers | {"Content-Type": "application/json"},
                content=b"x" * 65537,
            ),
            413,
        )
        self.failure(
            self.client.patch(
                self.path + "/state",
                headers=headers | {"Content-Type": "text/plain"},
                content="synthetic-private-marker",
            ),
            415,
        )
        self.assertFalse(
            self.client.get(self.path, headers=self.headers).json()["metadata"]["read"]
        )

    def test_actual_owner_dependency_rejects_agent_workload_and_missing_identity(self):
        self.failure(
            self.client.get("/api/v2/results", headers={"X-FolioView-Contract": CONTRACT_VERSION}),
            401,
        )
        for token in (self.case.case.token, "synthetic_workload_token"):
            self.failure(
                self.client.get(
                    self.path, headers=self.headers | {"Authorization": "Bearer " + token}
                ),
                401,
            )
        for header in ("X-FolioView-Delegation", "X-Serverless-Authorization"):
            self.failure(
                self.client.get(
                    self.path, headers=self.headers | {header: "synthetic-private-marker"}
                ),
                403,
            )
        self.failure(
            self.client.get(
                self.path, headers=[*self.headers.items(), ("Authorization", "Bearer " + OWNER_B)]
            ),
            401,
        )

    def test_owner_history_survives_agent_revoke_and_outage_but_state_needs_active_device(self):
        before = self.client.get(self.path, headers=self.headers)
        self.case.advance_registry(revoked=("A1_sig", "A1_enc", "device_sig", "device_enc"))
        self.base.oauth.revoke_connection(UID, self.base.connection)
        self.base.sources.available = False
        self.base.now = 5100
        after = self.client.get(self.path, headers=self.headers)
        self.assertEqual((after.status_code, after.json()), (200, before.json()))
        self.assertEqual(
            self.client.get(self.path + "/revisions/1/evidence", headers=self.headers).status_code,
            200,
        )
        self.assertEqual(self.failure(self.state(), 403), "key_authorization_required")
        with patch.object(self.case.inbox.store, "transact", side_effect=StoreUnavailable):
            self.failure(self.client.get(self.path, headers=self.headers), 503)

    def test_production_cors_allows_configured_patch_without_authorizing_the_write(self):
        service = Path(__file__).resolve().parents[1]
        script = """
import json
from unittest.mock import patch
with patch('socket.socket.connect', side_effect=AssertionError('network forbidden')):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        base={
            'Access-Control-Request-Method':'PATCH',
            'Access-Control-Request-Headers':'authorization,x-folioview-contract',
        }
        allowed=client.options('/api/v2/results/synthetic_result/state',headers={**base,'Origin':'https://synthetic-owner.example'})
        assert allowed.status_code==200, allowed.text
        assert 'PATCH' in allowed.headers['access-control-allow-methods']
        rejected=client.options('/api/v2/results/synthetic_result/state',headers={**base,'Origin':'https://synthetic-untrusted.example'})
        assert rejected.status_code==400
        assert 'access-control-allow-origin' not in rejected.headers
        write=client.patch('/api/v2/results/synthetic_result/state',headers={'Origin':'https://synthetic-owner.example'},json={})
        assert write.status_code==401, write.text
        assert write.headers['cache-control']=='no-store'
print(json.dumps({'preflight':allowed.status_code,'untrusted':rejected.status_code,'unauthenticatedWrite':write.status_code}))
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=service,
            env={
                **os.environ,
                "PYTHONPATH": os.pathsep.join(
                    (str(service.parents[1] / "services/common"), str(service))
                ),
                "CORS_ORIGINS": "https://synthetic-owner.example",
            },
            text=True,
            capture_output=True,
            timeout=30,
            check=True,
        )
        self.assertEqual(
            json.loads(result.stdout),
            {"preflight": 200, "untrusted": 400, "unauthenticatedWrite": 401},
        )
