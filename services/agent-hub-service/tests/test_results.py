"""Ciphertext-only results and original-connection saved facts over synthetic storage."""

import copy
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import test_preparations as fixtures
import test_runs as run_fixtures
from fixtures import BOOT, OTHER_UID, UID
from test_oauth import CLIENT, TASK
from test_task_routes import HttpTaskFixture

from app import results as result_module
from app.fences import FenceService
from app.oauth import OAuthFailure
from app.results import ResultService, result_path, revision_path
from app.runs import RunService
from app.store import StoreUnavailable
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, decrypt_jwe
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode
from folioview_shared.encrypted.schema import validate_schema

OP = "synthetic_result_operation_0001"
REVISION_OP = "synthetic_result_revision_0002"


def result_consent():
    original = fixtures.authorization_params

    def params(**kwargs):
        kwargs["scope"] = kwargs.get("scope", "") + " results:revise"
        return original(**kwargs)

    return patch.object(fixtures, "authorization_params", side_effect=params)


class ResultTests(unittest.TestCase):
    make_intent = run_fixtures.RunTests.make_intent

    def setUp(self):
        self.case = fixtures.PreparationTests()
        with result_consent():
            self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.case.publish()
        self.metadata = self.case.service.metadata(self.case.tokens["access_token"], TASK)
        self.runs = RunService(self.case.oauth)
        self.runResponse, _ = self.runs.begin(
            self.case.tokens["access_token"], TASK, self.make_intent(), run_fixtures.OP
        )
        self.results = ResultService(self.case.oauth)
        self.run_id = self.runResponse["run"]["runId"]
        self.result_id = self.runResponse["run"]["initialResultId"]
        self.token = self.case.tokens["access_token"]

    def make_carrier(self, operation=OP, *, revision=1, expected=None, **changes):
        run, manifest = self.runResponse["run"], self.runResponse["manifest"]
        context = self.case.fix.context()
        context.update(
            objectId=run["initialResultId"],
            revision=revision,
            expectedRevision=revision - 1 if expected is None else expected,
            stableOperationId=operation,
            operationType="submit_result" if revision == 1 else "revise_result",
            resourceBindings=[],
        )
        context["binding"].update(
            taskId=run["taskId"],
            taskVersion=run["taskVersion"],
            runId=run["runId"],
            manifestId=run["manifestId"],
            manifestFingerprint=self.runResponse["manifestFingerprint"],
            taskEnvelopeFingerprint=manifest["taskEnvelope"]["envelopeFingerprint"],
            connectionId=run["connectionId"],
            grantId=run["grantId"],
            grantEpoch=run["grantEpoch"],
            executionEpoch=run["executionEpoch"],
        )
        context.update(changes)
        return self.case.fix.carrier(context)

    def submit(self, carrier=None, operation=OP):
        return self.results.submit(
            self.token, self.run_id, carrier or self.make_carrier(operation), operation
        )

    def assert_code(self, code, action):
        with self.assertRaises(ContractError) as caught:
            action()
        self.assertEqual(caught.exception.code, code)

    def stored_revision(self, revision=1):
        return self.case.store.transact(
            lambda u: u.get(revision_path(self.case.fix.owner, self.result_id, revision))
        )

    def refresh(self, scope, *, now=None):
        if now is not None:
            self.case.now = now
        status, tokens, _ = self.case.oauth.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": CLIENT,
                "refresh_token": self.case.tokens["refresh_token"],
                "resource": self.case.oauth.config.resource,
                "scope": scope,
            },
            {},
            "token",
        )
        self.assertEqual(status, 200, tokens)
        self.case.tokens = tokens
        return tokens["access_token"]

    def test_initial_receipt_provenance_and_owner_recovery_decryption_survive_restart(self):
        receipt, status = self.submit()
        self.assertEqual(status, 201)
        validate_schema("ResultReceipt", receipt)
        self.assertEqual(receipt["resultId"], self.result_id)
        self.assertNotIn("key", receipt["resultPath"].lower())
        restarted = ResultService(self.case.oauth)
        self.assertEqual(restarted.receipt(self.token, self.run_id, OP), receipt)
        saved = self.stored_revision()
        _, message = _signed_parts(json_carrier(saved)["signedObject"])
        for name in ["device_enc", "recovery_enc"]:
            private = decrypt_jwe(
                message["jwe"], self.case.fix.keys[name], context=message["context"]
            )
            self.assertEqual(private["payload"]["title"], "Synthetic daily report")
        with self.assertRaises(ContractError):
            decrypt_jwe(message["jwe"], self.case.fix.keys["A1_enc"], context=message["context"])
        head = self.case.store.transact(
            lambda u: u.get(result_path(self.case.fix.owner, self.result_id))
        )
        self.assertEqual(head["provenance"]["kind"], "authorized_connection_submission")
        self.assertEqual(head["provenance"]["connectionId"], self.case.connection)
        self.assertEqual(head["provenance"]["clientId"], CLIENT)
        self.assertTrue(self.case.oauth.connections(UID)["items"][0]["grants"][0]["resultSaved"])
        self.assertFalse(self.case.oauth.connections(UID)["items"][0]["grants"][0]["readObserved"])
        self.assertEqual(self.runs.get(self.token, self.run_id)["run"]["state"], "submitted")
        raw = Path(self.case.store.path).read_bytes()
        self.assertNotIn(b"Synthetic daily report", raw)
        self.assertNotIn(self.case.fix.keys["A1_sig"].get("d").encode(), raw)

    def test_exact_and_signature_variant_replay_validate_real_signature_first(self):
        carrier = self.make_carrier()
        receipt, _ = self.submit(carrier)
        self.case.now += 12
        self.assertEqual(self.submit(carrier), (receipt, 200))
        variant = copy.deepcopy(carrier)
        signature = bytearray(b64url_decode(variant["signedObject"]["signature"]))
        signature[32:] = (run_fixtures.P256_ORDER - int.from_bytes(signature[32:], "big")).to_bytes(
            32, "big"
        )
        variant["signedObject"]["signature"] = b64url_encode(signature)
        self.assertEqual(self.submit(variant), (receipt, 200))
        broken = copy.deepcopy(carrier)
        broken["signedObject"]["signature"] = b64url_encode(b"x" * 64)
        self.assert_code("invalid_signature", lambda: self.submit(broken))
        self.assertEqual(self.stored_revision()["receipt"], receipt)

    def test_same_operation_reencrypted_content_conflicts_and_new_initial_operation_cannot_alias(
        self,
    ):
        self.submit()
        self.assert_code("idempotency_conflict", lambda: self.submit(self.make_carrier()))
        other = "synthetic_result_other_initial_0001"
        self.assert_code(
            "initial_result_exists", lambda: self.submit(self.make_carrier(other), other)
        )
        self.assert_code(
            "recipient_binding_mismatch", lambda: self.submit(self.make_carrier(), other)
        )
        self.assertIsNone(self.results.receipt(self.token, self.run_id, other))

    def test_revision_cas_keeps_original_receipts_and_all_immutable_versions(self):
        first, _ = self.submit()
        self.case.now += 10
        second_carrier = self.make_carrier(REVISION_OP, revision=2)
        second, status = self.results.revise(
            self.token, self.result_id, 1, second_carrier, REVISION_OP
        )
        self.assertEqual(status, 201)
        self.assertNotEqual(first["receivedAt"], second["receivedAt"])
        self.case.now += 10
        third_op = "synthetic_result_revision_0003"
        third, _ = self.results.revise(
            self.token, self.result_id, 2, self.make_carrier(third_op, revision=3), third_op
        )
        self.assertEqual(third["revision"], 3)
        self.case.now += 10
        self.assertEqual(
            self.results.revise(self.token, self.result_id, 1, second_carrier, REVISION_OP),
            (second, 200),
        )
        self.assertEqual(self.results.receipt(self.token, self.run_id, OP), first)
        stale_op = "synthetic_result_revision_stale"
        self.assert_code(
            "version_conflict",
            lambda: self.results.revise(
                self.token, self.result_id, 1, self.make_carrier(stale_op, revision=2), stale_op
            ),
        )
        self.assertEqual(self.stored_revision(1)["receipt"], first)
        self.assertEqual(self.stored_revision(2)["receipt"], second)
        head = self.case.store.transact(
            lambda u: u.get(result_path(self.case.fix.owner, self.result_id))
        )
        self.assertEqual(head["metadata"]["receivedAt"], first["receivedAt"])
        self.assertEqual(head["metadata"]["envelopeFingerprint"], third["envelopeFingerprint"])
        self.assertEqual(head["metadata"]["stateVersion"], 2)
        self.assertFalse(head["metadata"]["read"])

    def test_expiry_crossed_during_final_crypto_never_saves_an_unrecoverable_fact(self):
        original = result_module.verify_carrier
        calls = 0

        def delayed(*args, **kwargs):
            nonlocal calls
            verified = original(*args, **kwargs)
            calls += 1
            if calls == 2:
                self.case.now = 1501
            return verified

        with patch.object(result_module, "verify_carrier", side_effect=delayed):
            self.assert_code("key_authorization_required", self.submit)
        self.assertIsNone(self.results.receipt(self.token, self.run_id, OP))
        self.assertIsNone(self.stored_revision())
        self.assertFalse(self.case.oauth.connections(UID)["items"][0]["grants"][0]["resultSaved"])

    def test_results_scopes_are_independent_of_run_and_private_input_read_scopes(self):
        token = self.refresh("results:create results:revise receipts:read")
        receipt, status = self.results.submit(token, self.run_id, self.make_carrier(), OP)
        self.assertEqual(status, 201)
        with self.assertRaises(OAuthFailure):
            self.runs.inputs(token, self.run_id)
        second, _ = self.results.revise(
            token, self.result_id, 1, self.make_carrier(REVISION_OP, revision=2), REVISION_OP
        )
        self.assertEqual(second["revision"], 2)
        self.assertEqual(self.results.receipt(token, self.run_id, OP), receipt)
        only_receipt = self.refresh("receipts:read")
        self.assertEqual(self.results.receipt(only_receipt, self.run_id, OP), receipt)
        with self.assertRaises(OAuthFailure):
            self.results.submit(only_receipt, self.run_id, self.make_carrier(), OP)

    def test_saved_receipt_and_post_replay_ignore_source_failure_and_run_grant_expiry(self):
        carrier = self.make_carrier()
        receipt, _ = self.submit(carrier)
        self.case.sources.available = False
        self.case.now = 1501  # signed grant and Run expired, current OAuth token is still valid.
        self.assertEqual(self.results.receipt(self.token, self.run_id, OP), receipt)
        self.assertEqual(self.submit(carrier), (receipt, 200))
        self.assert_code(
            "key_authorization_required",
            lambda: self.results.revise(
                self.token,
                self.result_id,
                1,
                self.make_carrier(REVISION_OP, revision=2),
                REVISION_OP,
            ),
        )
        self.assertIsNone(self.results.receipt(self.token, self.run_id, REVISION_OP))

    def test_signed_task_pause_blocks_new_writes_without_erasing_saved_receipt(self):
        carrier = self.make_carrier()
        receipt, _ = self.submit(carrier)
        operation = "synthetic_result_pause_task"
        value = HttpTaskFixture.body(
            self.case.fix,
            task=TASK,
            version=2,
            operation=operation,
            transition="pause",
            resources=self.case.resources,
        )
        self.case.tasks.transition(UID, TASK, value, operation, self.case.fix.kid("device_sig"))
        self.assertEqual(self.results.receipt(self.token, self.run_id, OP), receipt)
        self.assertEqual(self.submit(carrier), (receipt, 200))
        with self.assertRaises(OAuthFailure):
            self.results.revise(
                self.token,
                self.result_id,
                1,
                self.make_carrier(REVISION_OP, revision=2),
                REVISION_OP,
            )

    def test_saved_receipt_survives_later_relevant_key_revocation_and_natural_expiry(self):
        carrier = self.make_carrier()
        receipt, _ = self.submit(carrier)
        self.case.fix.add_key("replacement_enc", "device_enc", "replacement_device")
        bundle = self.case.fix.make_bundle(
            previous=self.case.fix.registry,
            revoked=("A1_sig", "A1_enc", "device_enc"),
            issued_at=1000,
        )
        self.case.vaults.update_registry(
            UID,
            self.case.fix.vault,
            {"contractVersion": CONTRACT_VERSION, "expectedVersion": 2, "registryBundle": bundle},
            "synthetic_result_revoke_keys",
        )
        self.assertEqual(self.results.receipt(self.token, self.run_id, OP), receipt)
        self.assertEqual(self.submit(carrier), (receipt, 200))
        token = self.refresh("receipts:read results:create results:revise", now=5100)
        self.assertEqual(self.results.receipt(token, self.run_id, OP), receipt)
        self.assertEqual(self.results.submit(token, self.run_id, carrier, OP), (receipt, 200))

    def test_explicit_connection_grant_and_token_revocation_deny_saved_fact(self):
        carrier = self.make_carrier()
        self.submit(carrier)
        self.case.oauth.revoke_grant(UID, self.case.connection, self.metadata["grantId"])
        self.assert_code("not_found", lambda: self.results.receipt(self.token, self.run_id, OP))
        self.assert_code("not_found", lambda: self.submit(carrier))
        self.case.oauth.revoke_connection(UID, self.case.connection)
        with self.assertRaises(OAuthFailure):
            self.results.receipt(self.token, self.run_id, OP)

    def test_other_connection_and_other_owner_cannot_write_revise_or_recover_by_known_ids(self):
        receipt, _ = self.submit()
        with result_consent():
            second, _ = self.case.consent(name="A2")
        for token in [second["access_token"]]:
            self.assert_code(
                "not_found", lambda token=token: self.results.receipt(token, self.run_id, OP)
            )
            self.assert_code(
                "not_found",
                lambda token=token: self.results.submit(
                    token, self.run_id, self.make_carrier(), OP
                ),
            )
            self.assert_code(
                "not_found",
                lambda token=token: self.results.revise(
                    token,
                    self.result_id,
                    1,
                    self.make_carrier(REVISION_OP, revision=2),
                    REVISION_OP,
                ),
            )
        other = fixtures.PreparationFixture(OTHER_UID)
        self.case.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.case.tasks.create(
            OTHER_UID,
            other.task_body(resources=self.case.resources),
            "synthetic_oauth_task_create_1",
            other.kid("device_sig"),
        )
        with result_consent():
            tokens, _ = self.case.consent(fixture=other, uid=OTHER_UID)
        self.assert_code(
            "not_found", lambda: self.results.receipt(tokens["access_token"], self.run_id, OP)
        )
        self.assert_code(
            "not_found",
            lambda: self.results.submit(
                tokens["access_token"], self.run_id, self.make_carrier(), OP
            ),
        )
        self.assert_code(
            "not_found",
            lambda: self.results.revise(
                tokens["access_token"],
                self.result_id,
                1,
                self.make_carrier(REVISION_OP, revision=2),
                REVISION_OP,
            ),
        )
        self.assertEqual(self.results.receipt(self.token, self.run_id, OP), receipt)

    def test_frozen_task_revision_is_valid_but_wrong_manifest_or_owner_task_fingerprint_is_not(
        self,
    ):
        body = self.case.fix.task_body(version=2, resources=self.case.resources)
        self.case.tasks.update(
            UID, TASK, body, "synthetic_oauth_task_create_2", self.case.fix.kid("device_sig")
        )
        wrong = self.make_carrier()
        _, message = _signed_parts(wrong["signedObject"])
        context = message["context"]
        context["binding"]["taskEnvelopeFingerprint"] = self.metadata["taskMetadata"][
            "envelopeFingerprint"
        ]
        self.assert_code(
            "recipient_binding_mismatch",
            lambda context=context: self.submit(self.case.fix.carrier(context)),
        )
        self.assertEqual(self.submit()[1], 201)

    def test_unavailable_or_invalidated_source_blocks_fresh_save_and_result_saved_stays_false(self):
        self.case.sources.available = False
        self.assert_code("source_unavailable", self.submit)
        self.assertFalse(self.case.oauth.connections(UID)["items"][0]["grants"][0]["resultSaved"])
        self.assertIsNone(self.results.receipt(self.token, self.run_id, OP))
        self.case.sources.available = True
        self.case.sources.epoch = 2
        self.assert_code("source_unavailable", self.submit)
        self.assertIsNone(self.results.receipt(self.token, self.run_id, OP))

    def test_source_fence_or_revocation_between_source_probe_and_save_wins(self):
        mutation = {
            "contractVersion": CONTRACT_VERSION,
            "ownerSubject": self.case.fix.owner,
            "mutationId": "synthetic_result_source_fence",
            "ref": self.case.sources.ref,
            "expectedSourceEpoch": 1,
            "newSourceEpoch": 2,
            "reason": "disconnected",
        }
        self.case.sources.after = lambda: FenceService(self.case.store).invalidate(
            mutation, source_service="portfolio"
        )
        self.assert_code("version_conflict", self.submit)
        self.assertIsNone(self.results.receipt(self.token, self.run_id, OP))

    def test_missing_operation_does_not_overwrite_first_result_or_allow_revision_overwrite(self):
        receipt, _ = self.submit()
        self.case.store.transact(
            lambda u: u.connection.execute(
                "DELETE FROM hub_documents WHERE path=?",
                (
                    self.results._operation_path(
                        self.runs._row(u, self.case.fix.owner, self.run_id), OP
                    ),
                ),
            )
        )
        self.assert_code("initial_result_exists", self.submit)
        self.assertEqual(self.stored_revision()["receipt"], receipt)
        self.assertIsNone(self.results.receipt(self.token, self.run_id, OP))

    def test_signature_recipient_and_cross_run_context_tampering_never_saves(self):
        _, message = _signed_parts(self.make_carrier()["signedObject"])
        for field, value in [
            ("runId", "different_run"),
            ("manifestFingerprint", "f" * 64),
            ("grantEpoch", 2),
        ]:
            context = copy.deepcopy(message["context"])
            context["binding"][field] = value
            self.assert_code(
                "recipient_binding_mismatch",
                lambda context=context: self.submit(self.case.fix.carrier(context)),
            )
        context = copy.deepcopy(message["context"])
        context["recipients"] = [r for r in context["recipients"] if r["role"] == "recovery_enc"]
        self.assert_code(
            "recipient_binding_mismatch",
            lambda context=context: self.submit(self.case.fix.carrier(context)),
        )
        self.assertIsNone(self.results.receipt(self.token, self.run_id, OP))

    def test_historical_registry_chain_after_unrelated_update_is_retained_at_save(self):
        self.case.fix.add_key("new_sig", "device_sig", "new_device")
        bundle = self.case.fix.make_bundle(previous=self.case.fix.registry, issued_at=1000)
        self.case.fix.registry = self.case.fix.verify(bundle, previous=self.case.fix.registry)
        self.case.vaults.update_registry(
            UID,
            self.case.fix.vault,
            {"contractVersion": CONTRACT_VERSION, "expectedVersion": 2, "registryBundle": bundle},
            "synthetic_result_add_unrelated_key",
        )
        carrier = self.make_carrier()
        receipt, _ = self.submit(carrier)
        self.assertEqual(self.stored_revision()["proof"]["proofCount"], 3)
        self.assertEqual(self.results.receipt(self.token, self.run_id, OP), receipt)
        self.assertEqual(self.submit(carrier), (receipt, 200))

    def test_storage_failure_rolls_back_ciphertext_indexes_receipts_and_observation(self):
        original = self.case.store.transact

        def broken(callback):
            def run(unit):
                put = unit.put

                def fail_put(path, value):
                    put(path, value)
                    if path.startswith("hub_result_operations/"):
                        raise StoreUnavailable

                unit.put = fail_put
                return callback(unit)

            return original(run)

        self.case.store.transact = broken
        with self.assertRaises(StoreUnavailable):
            self.submit()
        self.case.store.transact = original
        self.assertIsNone(self.results.receipt(self.token, self.run_id, OP))
        self.assertIsNone(self.stored_revision())
        self.assertFalse(self.case.oauth.connections(UID)["items"][0]["grants"][0]["resultSaved"])
        self.assertEqual(self.runs.get(self.token, self.run_id)["run"]["state"], "ready")

    def test_read_metadata_and_ciphertext_are_not_report_text_or_model_attestation(self):
        self.submit()
        with closing(self.case.store.connect()) as connection:
            bodies = [
                row[0]
                for row in connection.execute(
                    "SELECT body FROM hub_documents WHERE path LIKE 'hub_result%'"
                )
            ]
        for text in bodies:
            self.assertNotIn("Synthetic daily report", text)
            self.assertNotIn("modelName", text)
        row = self.stored_revision()
        row["receipt"]["envelopeFingerprint"] = "f" * 64
        self.case.store.transact(
            lambda u: u.put(revision_path(self.case.fix.owner, self.result_id, 1), row)
        )
        with self.assertRaises(StoreUnavailable):
            self.results.receipt(self.token, self.run_id, OP)


def json_carrier(saved):
    from folioview_shared.encrypted.jsonutil import strict_json_loads

    return strict_json_loads(saved["carrierJson"])
