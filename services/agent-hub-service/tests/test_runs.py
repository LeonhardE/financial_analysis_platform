"""Formal immutable Run inputs with synthetic owners, signatures and durable SQLite."""

import copy
import unittest
from contextlib import closing

import test_preparations as fixtures
from fixtures import BOOT, OTHER_UID, UID
from test_oauth import CLIENT, TASK

from app.oauth import OAuthFailure
from app.runs import RunService, allocate
from app.store import StoreUnavailable, document_path
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    _signed_parts,
    decrypt_jwe,
    signing_input_fingerprint,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode
from folioview_shared.encrypted.schema import validate_schema

OP = "synthetic_begin_run_operation_0001"
P256_ORDER = int("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.PreparationTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.intent, self.envelopes, _, self.prepared = self.case.publish()
        self.metadata = self.case.service.metadata(self.case.tokens["access_token"], TASK)
        self.runs = RunService(self.case.oauth)

    def make_intent(self, operation=OP, *, metadata=None, agent="A1", **changes):
        meta = metadata or self.metadata
        _, grant = _signed_parts(meta["agentKeyGrant"])
        resources = [
            next(x for x in meta["objects"] if x["resourceRef"] == b["ref"])
            for b in grant["resourceBindings"]
        ]
        task = next(x for x in meta["objects"] if x["objectType"] == "task")
        payload = self.case.fix.base("begin_run_intent") | {
            "stableOperationId": operation,
            "taskId": TASK,
            "expectedTaskVersion": meta["taskVersion"],
            "taskEnvelopeFingerprint": task["envelopeFingerprint"],
            "resourceVersions": [
                {
                    "ref": x["resourceRef"],
                    "revision": x["revision"],
                    "sourceEpoch": x["sourceEpoch"],
                    "envelopeFingerprint": x["envelopeFingerprint"],
                }
                for x in resources
            ],
            **{
                k: meta[k]
                for k in (
                    "connectionId",
                    "grantId",
                    "grantEpoch",
                    "executionEpoch",
                    "keyEpoch",
                    "authorizationId",
                )
            },
            "registrySequence": self.case.fix.registry.registry_sequence,
            "checkpointDigest": self.case.fix.registry.checkpoint_digest,
        }
        payload.update(changes)
        return self.case.fix.sign(payload, agent + "_sig")

    def begin(self, operation=OP, **kwargs):
        signed = self.make_intent(operation, **kwargs)
        response, status = self.runs.begin(
            self.case.tokens["access_token"], TASK, signed, operation
        )
        self.assertEqual(status, 201)
        return response, signed

    def fail(self, code, fn):
        with self.assertRaises(ContractError) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_begin_formal_manifest_uses_shared_task_and_exact_source_five(self):
        response, signed = self.begin()
        validate_schema("RunDescriptor", response["run"])
        validate_schema("ManifestDescriptor", response["manifest"])
        _, payload = _signed_parts(signed)
        self.assertEqual(
            allocate(payload, signing_input_fingerprint(signed))["runId"], response["run"]["runId"]
        )
        task = response["manifest"]["taskEnvelope"]
        self.assertEqual(task["deliveryRevision"], 2)
        self.assertNotEqual(
            task["envelopeFingerprint"], self.metadata["taskMetadata"]["envelopeFingerprint"]
        )
        self.assertEqual(response["manifest"]["entries"][0]["revision"], 5)
        self.assertEqual(response["run"]["state"], "ready")
        self.assertEqual(response["authorProofs"][0]["verifiedAt"], 1000)
        page = self.runs.inputs(self.case.tokens["access_token"], response["run"]["runId"])
        validate_schema("ManifestComponentPage", page)
        self.assertEqual(page["component"]["signedObject"], self.envelopes[TASK][0]["signedObject"])
        resource = self.runs.inputs(
            self.case.tokens["access_token"], response["run"]["runId"], page["nextCursor"]
        )
        self.assertEqual(resource["componentIndex"], 1)
        self.assertIsNone(resource["nextCursor"])
        _, message = _signed_parts(resource["component"]["signedObject"])
        self.assertTrue(
            decrypt_jwe(message["jwe"], self.case.fix.keys["A1_enc"], context=message["context"])
        )

    def test_exact_and_valid_high_low_s_replay_return_original_manifest(self):
        response, signed = self.begin()
        token = self.case.tokens["access_token"]
        self.assertEqual(self.runs.begin(token, TASK, signed, OP), (response, 200))
        variant = copy.deepcopy(signed)
        signature = bytearray(b64url_decode(variant["signature"]))
        s = int.from_bytes(signature[32:], "big")
        signature[32:] = (P256_ORDER - s).to_bytes(32, "big")
        variant["signature"] = b64url_encode(signature)
        self.assertNotEqual(variant, signed)
        self.assertEqual(signing_input_fingerprint(variant), signing_input_fingerprint(signed))
        replay, status = self.runs.begin(token, TASK, variant, OP)
        self.assertEqual(status, 200)
        self.assertEqual(replay, response)
        self.assertEqual(replay["manifest"]["signedBeginIntent"], signed)
        broken = copy.deepcopy(signed)
        broken["signature"] = b64url_encode(b"x" * 64)
        self.fail("invalid_signature", lambda: self.runs.begin(token, TASK, broken, OP))
        changed = self.make_intent(OP, taskEnvelopeFingerprint="0" * 64)
        self.fail("idempotency_conflict", lambda: self.runs.begin(token, TASK, changed, OP))

    def test_source_and_task_revision_advances_keep_immutable_inputs_and_retry(self):
        response, signed = self.begin()
        token, run = self.case.tokens["access_token"], response["run"]["runId"]
        original_page = self.runs.inputs(token, run)
        self.case.sources.revision = 6
        updated = self.case.fix.task_body(version=2, resources=self.case.resources)
        self.case.tasks.update(
            UID, TASK, updated, "synthetic_oauth_task_create_2", self.case.fix.kid("device_sig")
        )
        self.assertEqual(self.runs.get(token, run), response)
        self.assertEqual(self.runs.inputs(token, run), original_page)
        self.assertEqual(self.runs.begin(token, TASK, signed, OP), (response, 200))
        with self.assertRaises((OAuthFailure, ContractError)):
            self.runs.begin(
                token,
                TASK,
                self.make_intent("synthetic_begin_after_revision"),
                "synthetic_begin_after_revision",
            )

    def test_source_epoch_revocation_and_expired_run_stop_api_without_mutation(self):
        response, _ = self.begin()
        run, token = response["run"]["runId"], self.case.tokens["access_token"]
        self.case.sources.available = False
        self.fail("source_unavailable", lambda: self.runs.inputs(token, run))
        self.case.sources.available = True
        self.case.now = 1500
        self.fail("key_authorization_required", lambda: self.runs.get(token, run))
        self.case.now = 1000
        self.assertEqual(self.runs.get(token, run), response)
        self.case.oauth.revoke_connection(UID, self.case.connection)
        with self.assertRaises(OAuthFailure):
            self.runs.inputs(token, run)

    def test_published_run_survives_preparation_storage_change_and_binds_cursor(self):
        response, _ = self.begin()
        token, run = self.case.tokens["access_token"], response["run"]["runId"]
        page = self.runs.inputs(token, run)
        path = document_path(
            "hub_preparation_objects", self.case.fix.owner, self.prepared["preparationId"], TASK
        )
        self.case.store.transact(lambda u: u.put(path, {"not": "a valid preparation"}))
        self.assertEqual(self.runs.inputs(token, run), page)
        self.fail("malformed_request", lambda: self.runs.inputs(token, run, "arbitrary-cursor"))
        self.fail("not_found", lambda: self.runs.get(token, "run_unknown"))

    def test_other_connection_and_owner_cannot_borrow_run_ids(self):
        response, _ = self.begin()
        run = response["run"]["runId"]
        tokens2, _ = self.case.consent(name="A2")
        self.fail("not_found", lambda: self.runs.get(tokens2["access_token"], run))
        self.assertEqual(
            self.runs.get(self.case.tokens["access_token"], run)["run"], response["run"]
        )
        other = fixtures.PreparationFixture(OTHER_UID)
        self.case.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.case.tasks.create(
            OTHER_UID,
            other.task_body(resources=self.case.resources),
            "synthetic_oauth_task_create_1",
            other.kid("device_sig"),
        )
        other_tokens, _ = self.case.consent(uid=OTHER_UID, fixture=other)
        self.fail("not_found", lambda: self.runs.get(other_tokens["access_token"], run))

    def test_commit_rechecks_source_fence_after_preflight(self):
        token = self.case.tokens["access_token"]
        signed = self.make_intent()
        from app.fences import FenceService

        def revoke():
            FenceService(self.case.store, clock=lambda: 1000).invalidate(
                {
                    "contractVersion": CONTRACT_VERSION,
                    "ownerSubject": self.case.fix.owner,
                    "mutationId": "synthetic_run_source_revoke_0001",
                    "ref": self.case.sources.ref,
                    "expectedSourceEpoch": 1,
                    "newSourceEpoch": 2,
                    "reason": "disconnected",
                },
                source_service="portfolio",
            )

        self.case.sources.after = revoke
        self.fail("version_conflict", lambda: self.runs.begin(token, TASK, signed, OP))
        with closing(self.case.store.connect()) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) FROM hub_documents WHERE path LIKE 'hub_runs/%'"
                ).fetchone()[0],
                0,
            )

    def test_finite_quota_preserves_exact_replay_and_revocation(self):
        response, signed = self.begin()
        token = self.case.tokens["access_token"]
        quota = document_path("hub_run_quotas", self.case.fix.owner, "owner")
        self.case.store.transact(lambda u: u.put(quota, {"window": 0, "count": 200}))
        self.assertEqual(self.runs.begin(token, TASK, signed, OP), (response, 200))
        op = "synthetic_begin_quota_exhausted"
        self.fail(
            "version_conflict", lambda: self.runs.begin(token, TASK, self.make_intent(op), op)
        )
        self.case.oauth.revoke_connection(UID, self.case.connection)
        with self.assertRaises(OAuthFailure):
            self.runs.get(token, response["run"]["runId"])

    def test_retained_writer_proof_survives_expiry_but_current_agent_revocation_blocks(self):
        first, _ = self.begin()
        self.case.fix.add_key("writer2", "device_sig", "second_writer")
        self.case.fix.certificates["writer2"]["expiresAt"] = 1050
        tokens, approved = self.case.consent(name="A2")
        connection = approved["connectionId"]
        intent = self.case.service.intent(UID, connection, TASK)
        envelopes = self.case.fix.envelopes(intent, reader="A2_enc")
        selected = []
        for obj, (envelope, operation) in envelopes.items():
            _, message = _signed_parts(envelope["signedObject"])
            message["context"]["authorSigningKeyId"] = self.case.fix.kid("writer2")
            packet = self.case.fix.carrier(message["context"])
            value = self.case.service.stage(
                UID, connection, TASK, obj, packet, operation, self.case.fix.kid("writer2")
            )
            selected.append({k: value[k] for k in ("objectId", "envelopeFingerprint")})
        self.case.service.commit(UID, connection, TASK, selected, "synthetic_writer2_prep_commit")
        metadata = self.case.service.metadata(tokens["access_token"], TASK)
        op = "synthetic_writer2_begin_operation"
        signed = self.make_intent(op, metadata=metadata, agent="A2")
        response, status = self.runs.begin(tokens["access_token"], TASK, signed, op)
        self.assertEqual(status, 201)
        original = self.runs.inputs(tokens["access_token"], response["run"]["runId"])
        self.case.now = 1050
        self.assertEqual(
            self.runs.inputs(tokens["access_token"], response["run"]["runId"]), original
        )
        fixture = self.case.fix
        revoked = {"writer2", "A2_enc"}
        bundle = fixture.make_bundle(previous=fixture.registry, revoked=revoked, issued_at=1050)
        self.case.vaults.update_registry(
            UID,
            fixture.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": fixture.registry.registry_sequence,
                "registryBundle": bundle,
            },
            "synthetic_revoke_second_agent_keys",
        )
        self.fail(
            "key_authorization_required",
            lambda: self.runs.inputs(tokens["access_token"], response["run"]["runId"]),
        )
        self.assertEqual(
            self.runs.inputs(self.case.tokens["access_token"], first["run"]["runId"])["manifest"],
            first["manifest"],
        )

    def test_begin_requires_run_scope_without_unrelated_task_read_permission(self):
        form = {
            "grant_type": "refresh_token",
            "client_id": CLIENT,
            "refresh_token": self.case.tokens["refresh_token"],
            "resource": self.case.oauth.config.resource,
            "scope": "runs:create runs:read portfolio:read",
        }
        status, narrowed, _ = self.case.oauth.protocol(form, {}, "token")
        self.assertEqual(status, 200, narrowed)
        signed = self.make_intent()
        response, status = self.runs.begin(narrowed["access_token"], TASK, signed, OP)
        self.assertEqual(status, 201)
        self.assertEqual(
            self.runs.get(narrowed["access_token"], response["run"]["runId"]), response
        )
        form.update(refresh_token=narrowed["refresh_token"], scope="runs:create runs:read")
        status, withdrawn, _ = self.case.oauth.protocol(form, {}, "token")
        self.assertEqual(status, 200)
        with self.assertRaises(OAuthFailure):
            self.runs.get(withdrawn["access_token"], response["run"]["runId"])

    def test_missing_operation_cannot_overwrite_existing_run_or_extend_expiry(self):
        response, signed = self.begin()
        path = document_path(
            "hub_run_operations",
            self.case.fix.owner,
            self.case.fix.vault,
            self.case.connection,
            self.metadata["authorizationId"],
            self.metadata["grantId"],
            TASK,
            OP,
        )
        self.case.store.transact(
            lambda u: u.connection.execute("DELETE FROM hub_documents WHERE path=?", (path,))
        )
        self.case.now += 10
        with self.assertRaises(StoreUnavailable):
            self.runs.begin(self.case.tokens["access_token"], TASK, signed, OP)
        self.assertEqual(
            self.runs.get(self.case.tokens["access_token"], response["run"]["runId"]), response
        )

    def test_frozen_component_and_proof_integrity_are_independent_of_current_preparation(self):
        response, _ = self.begin()
        run, token = response["run"]["runId"], self.case.tokens["access_token"]
        path = document_path("hub_run_components", self.case.fix.owner, run, "0")
        original = self.case.store.transact(lambda u: u.get(path))
        changed = copy.deepcopy(original)
        changed["carrierJson"] = self.case.fix.carrier(self.case.fix.context("task"))
        self.case.store.transact(lambda u: u.put(path, changed))
        with self.assertRaises(StoreUnavailable):
            self.runs.inputs(token, run)
        self.case.store.transact(lambda u: u.put(path, original))
        proof_path = document_path("hub_run_proofs", self.case.fix.owner, run, "1")
        proof = self.case.store.transact(lambda u: u.get(proof_path))
        proof["sequence"] = 2
        self.case.store.transact(lambda u: u.put(proof_path, proof))
        with self.assertRaises(StoreUnavailable):
            self.runs.get(token, run)

    def test_failed_source_or_revoked_connection_never_marks_input_read(self):
        response, _ = self.begin()
        token = self.case.tokens["access_token"]

        def view():
            return self.case.oauth.connections(UID)["items"][0]["grants"][0]["readObserved"]

        self.assertFalse(view())
        self.case.sources.available = False
        self.fail("source_unavailable", lambda: self.runs.inputs(token, response["run"]["runId"]))
        self.assertFalse(view())
        self.case.sources.available = True
        self.case.sources.after = lambda: self.case.oauth.revoke_connection(
            UID, self.case.connection
        )
        with self.assertRaises(OAuthFailure):
            self.runs.inputs(token, response["run"]["runId"])
        self.assertFalse(view())

    def test_initial_refresh_family_deadline_bounds_run_lifetime(self):
        from app.oauth_config import digest

        access = self.case.store.transact(
            lambda u: u.get(
                document_path("hub_oauth_access", digest(self.case.tokens["access_token"]))
            )
        )
        path = document_path("hub_oauth_families", access["familyId"])

        def shorten(unit):
            family = unit.get(path)
            family["expiresAt"] = 1050
            unit.put(path, family)

        self.case.store.transact(shorten)
        response, _ = self.begin()
        self.assertEqual(response["run"]["expiresAt"], "1970-01-01T00:17:30Z")

    def test_resource_free_custom_task_has_one_component_and_no_upstream_read(self):
        body = self.case.fix.task_body(version=2, resources=[])
        self.case.tasks.update(
            UID, TASK, body, "synthetic_oauth_task_create_2", self.case.fix.kid("device_sig")
        )
        tokens, approved = self.case.consent(name="A2")
        self.case.sources.available = False
        before = self.case.sources.calls
        self.case.publish(connection=approved["connectionId"], reader="A2_enc")
        metadata = self.case.service.metadata(tokens["access_token"], TASK)
        op = "synthetic_zero_resource_begin_run"
        response, status = self.runs.begin(
            tokens["access_token"], TASK, self.make_intent(op, metadata=metadata, agent="A2"), op
        )
        self.assertEqual(status, 201)
        self.assertEqual(response["manifest"]["entries"], [])
        page = self.runs.inputs(tokens["access_token"], response["run"]["runId"])
        self.assertIsNone(page["nextCursor"])
        self.assertEqual(self.case.sources.calls, before)

    def test_three_source_manifest_follows_grant_order_not_commit_object_order(self):
        rows = []
        for kind in ("watchlist", "holdings", "channel_follows"):
            ref = {
                "kind": kind,
                "sourceService": "portfolio" if kind == "holdings" else "user",
                "resourceId": kind + "_multi",
                "incarnation": "multi_incarnation",
            }
            rows.append(
                {"ref": ref, "sourceEpoch": 1, "revision": 5, "state": "active", "snapshotId": None}
            )
        self.case.sources.read = lambda uid: {"groups": [{"items": copy.deepcopy(rows)}]}
        resources = [{"ref": row["ref"], "sourceEpoch": 1} for row in rows]
        self.case.tasks.update(
            UID,
            TASK,
            self.case.fix.task_body(version=2, resources=resources),
            "synthetic_oauth_task_create_2",
            self.case.fix.kid("device_sig"),
        )
        original = self.case.oauth.authorize
        self.case.oauth.authorize = lambda params, browser: original(
            params | {"scope": params["scope"] + " watchlist:read channel_follows:read"}, browser
        )
        try:
            tokens, approved = self.case.consent(name="A2")
        finally:
            self.case.oauth.authorize = original
        _, _, selected = self.case.stage_all(connection=approved["connectionId"], reader="A2_enc")
        self.case.service.commit(
            UID,
            approved["connectionId"],
            TASK,
            list(reversed(selected)),
            "synthetic_multi_sources_commit",
        )
        metadata = self.case.service.metadata(tokens["access_token"], TASK)
        op = "synthetic_multi_sources_beginrun"
        signed = self.make_intent(op, metadata=metadata, agent="A2")
        response, status = self.runs.begin(tokens["access_token"], TASK, signed, op)
        self.assertEqual(status, 201)
        self.assertEqual(
            [x["ref"]["kind"] for x in response["manifest"]["entries"]],
            ["watchlist", "holdings", "channel_follows"],
        )
        cursor = None
        original_pages = []
        for index in range(4):
            page = self.runs.inputs(tokens["access_token"], response["run"]["runId"], cursor)
            original_pages.append(page)
            self.assertEqual(page["componentIndex"], index)
            _, message = _signed_parts(page["component"]["signedObject"])
            self.assertTrue(
                decrypt_jwe(
                    message["jwe"], self.case.fix.keys["A2_enc"], context=message["context"]
                )
            )
            cursor = page["nextCursor"]
        self.assertIsNone(cursor)
        reordered, _ = self.case.tasks.update(
            UID,
            TASK,
            self.case.fix.task_body(version=3, resources=list(reversed(resources))),
            "synthetic_oauth_task_create_3",
            self.case.fix.kid("device_sig"),
        )
        self.assertEqual(reordered["metadata"]["executionEpoch"], response["run"]["executionEpoch"])
        self.assertEqual(self.runs.get(tokens["access_token"], response["run"]["runId"]), response)
        cursor = None
        for original_page in original_pages:
            page = self.runs.inputs(tokens["access_token"], response["run"]["runId"], cursor)
            self.assertEqual(page, original_page)
            cursor = page["nextCursor"]
        self.assertIsNone(cursor)
        self.assertEqual(self.runs.begin(tokens["access_token"], TASK, signed, op), (response, 200))

    def test_control_budget_lifetime_and_connection_caps_preserve_existing_run(self):
        signed = self.make_intent()
        oversized = copy.deepcopy(signed)
        oversized["payload"] = b64url_encode(b"x" * 50000)
        self.fail(
            "payload_too_large",
            lambda: self.runs.begin(self.case.tokens["access_token"], TASK, oversized, OP),
        )
        response, signed = self.begin()
        token, run = self.case.tokens["access_token"], response["run"]["runId"]
        index = document_path(
            "hub_run_indexes",
            self.case.fix.owner,
            self.case.fix.vault,
            self.case.connection,
            self.metadata["authorizationId"],
            self.metadata["grantId"],
            TASK,
        )
        self.case.store.transact(
            lambda u: u.put(
                index, {"runIds": [run, *["run_capacity_" + str(n) for n in range(31)]]}
            )
        )
        op = "synthetic_run_lifetime_capacity"
        self.fail(
            "version_conflict", lambda: self.runs.begin(token, TASK, self.make_intent(op), op)
        )
        self.assertEqual(self.runs.begin(token, TASK, signed, OP), (response, 200))
        self.case.store.transact(lambda u: u.put(index, {"runIds": [run]}))
        quota = document_path("hub_run_quotas", self.case.fix.owner, self.case.connection)
        self.case.store.transact(lambda u: u.put(quota, {"window": 1000 // 60, "count": 20}))
        self.fail(
            "version_conflict", lambda: self.runs.begin(token, TASK, self.make_intent(op), op)
        )
        self.assertEqual(self.runs.begin(token, TASK, signed, OP), (response, 200))
