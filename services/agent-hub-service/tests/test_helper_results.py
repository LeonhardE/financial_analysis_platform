"""Actual Worker result encryption, exact ciphertext retry and receipt/CAS boundaries."""

import copy
import json
import time
import unittest
from unittest.mock import patch

import test_helper_runs as runs
import test_preparations as preparations
from jwcrypto import jwk
from test_encrypted_schema import report_content

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    _signed_parts,
    decrypt_jwe,
    signing_input_fingerprint,
    verify_jws,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.schema import validate_schema


class ResultHelperTests(unittest.TestCase):
    def setUp(self):
        self.harness = runs.RunHelperTests(
            "test_actual_run_manifest_and_three_frozen_components_decrypt"
        )
        self.addCleanup(self.harness.doCleanups)
        original = preparations.authorization_params

        def requested(**kwargs):
            kwargs["scope"] += " results:revise"
            return original(**kwargs)

        with patch.object(preparations, "authorization_params", requested):
            self.harness.setUp()
        self.peer, self.case = self.harness.peer, self.harness.case
        self.operation = "synthetic_helper_result_operation_01"
        self.content = report_content()
        self.begin, self.response = self.harness.begin()
        self.run_id = self.begin["runId"]
        self.harness.install(self.response)
        if self._testMethodName != "test_sealing_requires_every_frozen_input_and_pinned_run":
            self.read_inputs()

    def read_inputs(self, run_id=None):
        cursor, run_id = None, run_id or self.run_id
        while True:
            page = self.harness.service.inputs(self.harness.token, run_id, cursor)
            value = self.peer.call("decryptRun", {"runId": run_id, "page": page})
            cursor = value["nextCursor"]
            if cursor is None:
                break

    def seal(self, operation=None, content=None, *, run_id=None):
        return self.peer.call(
            "sealResult",
            {
                "runId": run_id or self.run_id,
                "stableOperationId": operation or self.operation,
                "content": content or self.content,
            },
        )

    def revise(self, expected=1, operation="synthetic_helper_result_revision_01", content=None):
        return self.peer.call(
            "reviseResult",
            {
                "runId": self.run_id,
                "stableOperationId": operation,
                "expectedRevision": expected,
                "content": content or {**self.content, "summary": "Synthetic revised report."},
            },
        )

    def receipt(self, packet, **changes):
        return {
            "contractVersion": CONTRACT_VERSION,
            "vaultId": self.case.fix.vault,
            "runId": packet["runId"],
            "taskId": self.response["run"]["taskId"],
            "resultId": packet["resultId"],
            "revision": packet["revision"],
            "deliveryRevision": 1,
            "stableOperationId": packet["stableOperationId"],
            "envelopeFingerprint": packet["envelopeFingerprint"],
            "receivedAt": "1970-01-01T00:16:40Z",
            "resultPath": f"/results/{packet['resultId']}?revision={packet['revision']}",
            **changes,
        }

    def accept(self, packet, receipt=None):
        return self.peer.call(
            "acceptReceipt",
            {
                "runId": packet["runId"],
                "stableOperationId": packet["stableOperationId"],
                "receipt": receipt or self.receipt(packet),
            },
            trusted=True,
        )

    def denied(self, operation, args, code):
        value = self.peer.call(operation, args, ok=False, trusted=operation == "acceptReceipt")
        self.assertFalse(value["ok"])
        self.assertEqual(value["error"], code)

    def test_sealing_requires_every_frozen_input_and_pinned_run(self):
        args = {
            "runId": self.run_id,
            "stableOperationId": self.operation,
            "content": self.content,
        }
        self.denied("sealResult", args, "run_inputs_not_decrypted")
        self.denied("sealResult", {**args, "runId": "foreign_run"}, "run_pin_required")
        page = self.harness.service.inputs(self.harness.token, self.run_id)
        self.peer.call("decryptRun", {"runId": self.run_id, "page": page})
        self.denied("sealResult", args, "run_inputs_not_decrypted")
        self.read_inputs()
        self.assertEqual(self.seal()["resultId"], self.begin["initialResultId"])

    def test_result_signature_and_owner_recovery_decryption_bind_original_evidence(self):
        packet = self.seal()
        envelope = packet["envelope"]
        validate_schema("Carrier", envelope)
        self.assertEqual(packet["revision"], 1)
        self.assertEqual(packet["expectedRevision"], 0)
        self.assertEqual(
            signing_input_fingerprint(envelope["signedObject"]), packet["envelopeFingerprint"]
        )
        public = self.case.fix.certificates["A1_sig"]["publicJwk"]
        message = verify_jws(envelope["signedObject"], public, typ="fv-object+jws")
        context = message["context"]
        self.assertEqual(context["binding"]["runId"], self.run_id)
        self.assertEqual(
            context["binding"]["taskEnvelopeFingerprint"],
            self.response["manifest"]["taskEnvelope"]["envelopeFingerprint"],
        )
        self.assertEqual(
            context["binding"]["manifestFingerprint"], self.response["manifestFingerprint"]
        )
        self.assertEqual(
            [r["keyId"] for r in context["recipients"]],
            sorted([self.case.fix.kid("device_enc"), self.case.fix.kid("recovery_enc")]),
        )
        for role in ("device_enc", "recovery_enc"):
            plaintext = decrypt_jwe(message["jwe"], self.case.fix.keys[role], context=context)
            self.assertEqual(plaintext["payload"], self.content)
        with self.assertRaises(ContractError):
            decrypt_jwe(message["jwe"], jwk.JWK.generate(kty="EC", crv="P-256"), context=context)
        self.assertNotIn(self.content["title"], json.dumps(packet))
        self.assertNotIn(self.content["sections"][0]["markdown"], json.dumps(packet))

    def test_exact_original_ciphertext_is_replayed_and_changed_content_conflicts(self):
        first = self.seal()
        self.assertEqual(self.seal(), first)
        returned = self.peer.call(
            "resultOutbox", {"runId": self.run_id, "stableOperationId": self.operation}
        )
        self.assertEqual(returned, {**first, "receipt": None})
        self.denied(
            "sealResult",
            {
                "runId": self.run_id,
                "stableOperationId": self.operation,
                "content": {**self.content, "summary": "Changed private content."},
            },
            "idempotency_conflict",
        )
        self.denied(
            "sealResult",
            {
                "runId": self.run_id,
                "stableOperationId": "synthetic_helper_result_different_02",
                "content": self.content,
            },
            "initial_result_exists",
        )
        self.assertEqual(self.seal(), first)

    def test_receipt_pins_reject_foreign_fields_and_replacement_without_advancing(self):
        packet = self.seal()
        receipt = self.receipt(packet)
        for field, value in (
            ("vaultId", "foreign_vault"),
            ("runId", "foreign_run"),
            ("taskId", "foreign_task"),
            ("resultId", "foreign_result"),
            ("revision", 2),
            ("deliveryRevision", 2),
            ("stableOperationId", "synthetic_foreign_operation_02"),
            ("envelopeFingerprint", "0" * 64),
            ("resultPath", "/results/foreign_result?revision=1"),
        ):
            with self.subTest(field=field):
                self.denied(
                    "acceptReceipt",
                    {
                        "runId": self.run_id,
                        "stableOperationId": self.operation,
                        "receipt": {**receipt, field: value},
                    },
                    "receipt_binding_mismatch",
                )
        self.denied(
            "acceptReceipt",
            {
                "runId": self.run_id,
                "stableOperationId": self.operation,
                "receipt": {**receipt, "receivedAt": "1970-01-01T00:16:39Z"},
            },
            "receipt_time_mismatch",
        )
        self.assertEqual(self.accept(packet), receipt)
        self.assertEqual(self.accept(packet), receipt)
        self.denied(
            "acceptReceipt",
            {
                "runId": self.run_id,
                "stableOperationId": self.operation,
                "receipt": {**receipt, "receivedAt": "1970-01-01T00:16:41Z"},
            },
            "receipt_replacement",
        )
        for path in ("/results/x?revision=1&key=secret", "https://example.com/results/x"):
            self.denied(
                "acceptReceipt",
                {
                    "runId": self.run_id,
                    "stableOperationId": self.operation,
                    "receipt": {**receipt, "resultPath": path},
                },
                "invalid_schema",
            )

    def test_revisions_require_acknowledged_base_and_competing_receipts_cannot_overwrite(self):
        packet = self.seal()
        args = {
            "runId": self.run_id,
            "stableOperationId": "synthetic_helper_result_revision_01",
            "expectedRevision": 1,
            "content": self.content,
        }
        self.denied("reviseResult", args, "revision_base_unacknowledged")
        self.accept(packet)
        revision = self.revise()
        self.assertEqual(revision["resultId"], packet["resultId"])
        self.assertEqual(revision["revision"], 2)
        self.assertEqual(self.revise(), revision)
        competing = self.revise(operation="synthetic_helper_result_revision_02")
        self.denied(
            "reviseResult",
            {**args, "stableOperationId": "synthetic_helper_result_revision_03"},
            "revision_candidate_limit",
        )
        self.accept(revision)
        self.assertEqual(self.accept(packet), self.receipt(packet))
        self.denied(
            "acceptReceipt",
            {
                "runId": self.run_id,
                "stableOperationId": competing["stableOperationId"],
                "receipt": self.receipt(competing),
            },
            "receipt_revision_conflict",
        )
        self.denied(
            "reviseResult",
            {**args, "stableOperationId": "synthetic_helper_result_stale_base_03"},
            "revision_base_unacknowledged",
        )
        latest = self.revise(2, "synthetic_helper_result_revision_04")
        self.assertEqual(latest["revision"], 3)

    def test_private_output_sections_markdown_and_citations_are_checked_before_encryption(self):
        unsafe = [
            "<script>unsafe</script>",
            "&#x3c;script&#x3e;unsafe&#x3c;/script&#x3e;",
            "&lt;img src=x&gt;",
            "![image](https://example.com/a.png)",
            "[bad](javascript:unsafe)",
            "[bad][ref]\n\n[ref]: data:unsafe",
            "<javascript:unsafe>",
            "[bad](https://user:pass@example.com/)",
        ]
        for markdown in unsafe:
            value = copy.deepcopy(self.content)
            value["sections"][0]["markdown"] = markdown
            with self.subTest(markdown=markdown):
                self.denied(
                    "sealResult",
                    {"runId": self.run_id, "stableOperationId": self.operation, "content": value},
                    "private_schema_invalid",
                )
        for url in ("https://user:pass@example.com/", "https://example.com:444/"):
            value = copy.deepcopy(self.content)
            value["citations"][0]["url"] = url
            self.denied(
                "sealResult",
                {"runId": self.run_id, "stableOperationId": self.operation, "content": value},
                "private_schema_invalid",
            )
        value = copy.deepcopy(self.content)
        value["sections"][0]["sectionId"] = "undeclared_section"
        self.denied(
            "sealResult",
            {"runId": self.run_id, "stableOperationId": self.operation, "content": value},
            "private_output_mismatch",
        )
        value = copy.deepcopy(self.content)
        value["sections"].append(copy.deepcopy(value["sections"][0]))
        self.denied(
            "sealResult",
            {"runId": self.run_id, "stableOperationId": self.operation, "content": value},
            "duplicate_value",
        )
        valid = copy.deepcopy(self.content)
        valid["sections"][0]["markdown"] = (
            "A &amp; B\n\n[Safe](https://example.com/a) and <https://example.com/b>."
        )
        self.assertEqual(self.seal(content=valid)["revision"], 1)

    def test_closed_result_operations_cannot_choose_keys_context_or_arbitrary_signing(self):
        args = {"runId": self.run_id, "stableOperationId": self.operation, "content": self.content}
        for field in (
            "recipients",
            "privateJwk",
            "context",
            "objectId",
            "resultId",
            "ownerSubject",
        ):
            self.denied("sealResult", {**args, field: "model_provided"}, "invalid_fields")
        self.denied("sign", {"payload": "arbitrary"}, "unsupported_operation")
        self.denied("exportPrivateKey", {}, "unsupported_operation")
        packet = self.seal()
        untrusted = self.peer.call(
            "acceptReceipt",
            {
                "runId": self.run_id,
                "stableOperationId": self.operation,
                "receipt": self.receipt(packet),
            },
            ok=False,
        )
        self.assertEqual(untrusted["error"], "unsupported_operation")
        self.assertFalse(self.peer.call("status")["privateKeysExtractable"])

    def test_aggregate_private_byte_budget_rejects_individually_valid_large_sections(self):
        value = copy.deepcopy(self.content)
        value["sections"][0]["markdown"] = "a" * 16384
        value["citations"] = [
            {
                "citationId": f"source_{index}",
                "title": "t" * 180,
                "url": "https://example.com/" + "a" * 1980,
                "provenance": "agent_provided",
                "publishedAt": None,
            }
            for index in range(20)
        ]
        value["limitations"] = ["l" * 500] * 20
        validate_schema("ResultContent", value)
        self.denied(
            "sealResult",
            {"runId": self.run_id, "stableOperationId": self.operation, "content": value},
            "payload_too_large",
        )
        self.assertEqual(self.seal()["revision"], 1)

    def test_lock_during_async_seal_cannot_return_a_late_signed_packet(self):
        result = self.peer.raw(
            {
                "race": True,
                "read": self.peer.message(
                    "sealResult",
                    {
                        "runId": self.run_id,
                        "stableOperationId": self.operation,
                        "content": self.content,
                    },
                ),
                "lock": self.peer.message("lock"),
            }
        )["value"]
        self.assertFalse(result["read"]["ok"])
        self.assertEqual(result["locked"]["state"], "LOCKED")
        self.assertFalse(result["locked"]["privateKeysPresent"])

    def test_encrypt_result_capability_is_required_independently_of_run_read(self):
        metadata = copy.deepcopy(self.harness.fixture.metadata)
        _, grant = _signed_parts(metadata["agentKeyGrant"])
        grant["capabilities"].remove("encrypt_result")
        metadata["agentKeyGrant"] = self.case.fix.sign(grant)
        self.peer.call("install", {"metadata": metadata})
        self.denied(
            "sealResult",
            {"runId": self.run_id, "stableOperationId": self.operation, "content": self.content},
            "insufficient_capability",
        )

    def test_same_operation_is_partitioned_by_run_and_cross_run_receipts_fail(self):
        first = self.seal()
        second_begin, response = self.harness.begin("another", decrypt=False)
        self.harness.install(response)
        self.read_inputs(second_begin["runId"])
        second = self.seal(run_id=second_begin["runId"])
        self.assertNotEqual(first["resultId"], second["resultId"])
        self.assertEqual(first["stableOperationId"], second["stableOperationId"])
        self.denied(
            "acceptReceipt",
            {
                "runId": second["runId"],
                "stableOperationId": self.operation,
                "receipt": self.receipt(first),
            },
            "receipt_binding_mismatch",
        )
        self.assertEqual(self.accept(first), self.receipt(first))

    def test_lock_discards_keys_and_cached_ciphertext_handles(self):
        packet = self.seal()
        status = self.peer.call("lock")
        self.peer.generation = status["generation"]
        self.assertFalse(status["privateKeysPresent"])
        self.denied(
            "resultOutbox",
            {"runId": self.run_id, "stableOperationId": self.operation},
            "session_locked",
        )
        self.denied(
            "acceptReceipt",
            {
                "runId": self.run_id,
                "stableOperationId": self.operation,
                "receipt": self.receipt(packet),
            },
            "session_locked",
        )

    def test_original_outbox_and_saved_receipt_survive_run_expiry_without_new_encryption(self):
        # Real monotonic Worker expiry, without adding a model-reachable clock
        # mutation API. Leave setup/decryption headroom on slower CI runners.
        with patch("app.runs.MAX_RUN_SECONDS", 30):
            begin, response = self.harness.begin("short", decrypt=False)
        self.harness.install(response)
        self.read_inputs(begin["runId"])
        packet = self.seal(run_id=begin["runId"])
        time.sleep(30.1)
        original = self.peer.call(
            "resultOutbox", {"runId": begin["runId"], "stableOperationId": self.operation}
        )
        self.assertEqual(original["envelope"], packet["envelope"])
        self.assertEqual(self.accept(packet), self.receipt(packet))
        self.denied(
            "sealResult",
            {"runId": begin["runId"], "stableOperationId": self.operation, "content": self.content},
            "run_expired_or_untrusted",
        )

    def test_real_backend_initial_revision_and_lost_receipts_complete_encrypted_loop(self):
        from app.results import ResultService

        backend = ResultService(self.case.oauth)
        packet = self.seal()
        receipt, status = backend.submit(
            self.harness.token, self.run_id, packet["envelope"], self.operation
        )
        self.assertEqual(status, 201)
        validate_schema("ResultReceipt", receipt)
        self.assertEqual(backend.receipt(self.harness.token, self.run_id, self.operation), receipt)
        self.assertEqual(
            backend.submit(self.harness.token, self.run_id, packet["envelope"], self.operation),
            (receipt, 200),
        )
        self.assertEqual(self.accept(packet, receipt), receipt)
        revision = self.revise()
        revised_receipt, status = backend.revise(
            self.harness.token,
            revision["resultId"],
            1,
            revision["envelope"],
            revision["stableOperationId"],
        )
        self.assertEqual(status, 201)
        self.assertEqual(self.accept(revision, revised_receipt), revised_receipt)
        self.assertEqual(backend.receipt(self.harness.token, self.run_id, self.operation), receipt)
        for value in (packet, revision):
            _, message = _signed_parts(value["envelope"]["signedObject"])
            for role in ("device_enc", "recovery_enc"):
                decoded = decrypt_jwe(
                    message["jwe"], self.case.fix.keys[role], context=message["context"]
                )
                self.assertEqual(decoded["revision"], value["revision"])
                self.assertEqual(decoded["payload"]["title"], self.content["title"])
