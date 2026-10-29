"""Real Worker Begin signing, formal Run binding and frozen input decryption."""

import copy
import unittest
from unittest.mock import patch

import test_helper as helpers
import test_preparations as preparations
from test_oauth import TASK

from app.runs import RunService, allocate
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.envelope import manifest_fingerprint
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode


class RunHelperTests(unittest.TestCase):
    def setUp(self):
        from test_encrypted_schema import wrapper

        def timed_wrapper(context):
            value = wrapper(context)
            if context["objectType"] == "task":
                value["payload"]["inputPolicy"] = {
                    "allowPartial": False,
                    "allowUnknownAsOf": False,
                    "maxFetchedAgeSeconds": 60,
                }
            else:
                p = value["payload"]
                p.update(
                    sourceAsOf="1970-01-01T00:16:30Z",
                    fetchedAt="1970-01-01T00:16:30Z",
                    freshness="fresh",
                )
                if self._testMethodName == "test_private_policy_refuses_partial_coverage":
                    p["coverage"]["state"] = "partial"
                elif self._testMethodName == "test_private_policy_refuses_unknown_asof":
                    p.update(sourceAsOf=None, freshness="unknown")
                elif self._testMethodName == "test_private_policy_refuses_old_fetched_data":
                    p["fetchedAt"] = "1970-01-01T00:15:00Z"
            return value

        private = patch("test_encrypted_envelope.wrapper", timed_wrapper)
        private.start()
        self.addCleanup(private.stop)
        self.fixture = helpers.BrowserHelperTests(
            "test_three_resource_kinds_decrypt_and_reject_private_semantic_errors"
        )
        self.addCleanup(self.fixture.doCleanups)
        if self._testMethodName == "test_historical_writer_revocation_keeps_frozen_run_inputs":
            original_add = preparations.PreparationFixture.add_key
            original_envelopes = preparations.PreparationFixture.envelopes

            def add(instance, name, *args, **kwargs):
                value = original_add(instance, name, *args, **kwargs)
                if name == "A1_enc" and hasattr(instance, "worker_keys"):
                    original_add(instance, "run_writer", "device_sig", "separate_run_writer")
                return value

            def envelopes(instance, intent, **kwargs):
                values = original_envelopes(instance, intent, **kwargs)
                for obj, (carrier, operation) in values.items():
                    context = _signed_parts(carrier["signedObject"])[1]["context"]
                    context["authorSigningKeyId"] = instance.kid("run_writer")
                    values[obj] = (instance.carrier(context, signer="run_writer"), operation)
                return values

            def stage_all(instance, *, connection=None, reader="A1_enc"):
                connection = connection or instance.connection
                intent = instance.service.intent(instance.fix.uid, connection, TASK)
                packets = instance.fix.envelopes(intent, reader=reader)
                descriptors = []
                for obj, (carrier, operation) in packets.items():
                    author = _signed_parts(carrier["signedObject"])[1]["context"][
                        "authorSigningKeyId"
                    ]
                    descriptors.append(
                        instance.service.stage(
                            instance.fix.uid, connection, TASK, obj, carrier, operation, author
                        )
                    )
                return (
                    intent,
                    packets,
                    [{k: d[k] for k in ("objectId", "envelopeFingerprint")} for d in descriptors],
                )

            with (
                patch.object(preparations.PreparationTests, "stage_all", stage_all),
                patch.object(preparations.PreparationFixture, "add_key", add),
                patch.object(preparations.PreparationFixture, "envelopes", envelopes),
            ):
                self.fixture.setUp()
        else:
            self.fixture.setUp()
        self.peer, self.case = self.fixture.peer, self.fixture.case
        self.service = RunService(self.case.oauth)
        self.token = self.case.tokens["access_token"]
        self.fixture.ready()

    def decrypt_preparation(self):
        for obj, (carrier, _) in self.fixture.envelopes.items():
            self.peer.call("decrypt", {"objectId": obj, "envelope": carrier})

    def begin(self, suffix="one", *, decrypt=True):
        if decrypt:
            self.decrypt_preparation()
        value = self.peer.call("beginRun", {"stableOperationId": "synthetic_helper_run_" + suffix})
        response, status = self.service.begin(
            self.token, TASK, value["signedBeginIntent"], value["stableOperationId"]
        )
        self.assertEqual(status, 201)
        return value, response

    def install(self, response):
        return self.peer.call("installRun", {"response": response})

    def denied(self, op, args, expected=None):
        result = self.peer.call(op, args, ok=False)
        self.assertFalse(result["ok"])
        if expected:
            self.assertEqual(result["error"], expected)
        return result

    def test_begin_requires_typed_inputs_and_caches_exact_signed_operation(self):
        self.denied(
            "beginRun",
            {"stableOperationId": "synthetic_helper_run_before_read"},
            "inputs_not_decrypted",
        )
        self.decrypt_preparation()
        first = self.peer.call("beginRun", {"stableOperationId": "synthetic_helper_run_cached"})
        second = self.peer.call("beginRun", {"stableOperationId": "synthetic_helper_run_cached"})
        self.assertEqual(first, second)
        fingerprint = signing_input_fingerprint(first["signedBeginIntent"])
        payload = _signed_parts(first["signedBeginIntent"])[1]
        ids = allocate(payload, fingerprint)
        self.assertEqual({k: first[k] for k in ("runId", "manifestId", "initialResultId")}, ids)
        self.assertEqual(
            payload["taskEnvelopeFingerprint"], self.fixture.pin["taskDeliveryFingerprint"]
        )
        self.assertNotEqual(
            payload["taskEnvelopeFingerprint"], self.fixture.pin["taskEnvelopeFingerprint"]
        )
        self.assertEqual(len(payload["resourceVersions"]), 3)
        response, status = self.service.begin(
            self.token, TASK, first["signedBeginIntent"], first["stableOperationId"]
        )
        self.assertEqual(status, 201)
        self.assertEqual(self.install(response)["componentCount"], 4)

    def test_actual_run_manifest_and_three_frozen_components_decrypt(self):
        begin, response = self.begin()
        installed = self.install(response)
        self.assertEqual(installed["runId"], begin["runId"])
        cursor = None
        for index in range(4):
            page = self.service.inputs(self.token, begin["runId"], cursor)
            content = self.peer.call("decryptRun", {"runId": begin["runId"], "page": page})
            self.assertEqual(content["componentIndex"], index)
            self.assertEqual(content["manifestFingerprint"], response["manifestFingerprint"])
            self.assertEqual(content["revision"], 1 if index == 0 else 5)
            repeated = self.peer.call("decryptRun", {"runId": begin["runId"], "page": page})
            self.assertEqual(repeated, content)
            cursor = content["nextCursor"]
        self.assertIsNone(cursor)

    def test_response_allocations_and_manifest_selection_cannot_be_replaced(self):
        begin, response = self.begin()
        wrong = copy.deepcopy(response)
        wrong["run"]["runId"] = wrong["manifest"]["runId"] = "foreign_run"
        wrong["manifestFingerprint"] = manifest_fingerprint(wrong["manifest"])
        self.denied("installRun", {"response": wrong}, "run_allocation_mismatch")
        wrong = copy.deepcopy(response)
        wrong["manifest"]["entries"][0]["envelopeFingerprint"] = "0" * 64
        wrong["manifestFingerprint"] = manifest_fingerprint(wrong["manifest"])
        self.denied("installRun", {"response": wrong}, "manifest_resource_mismatch")
        self.install(response)
        wrong = copy.deepcopy(response)
        wrong["authorProofs"][0]["registrySequence"] = 1
        self.denied("installRun", {"response": wrong}, "historical_author_untrusted")
        wrong = copy.deepcopy(response)
        wrong["run"]["createdAt"] = wrong["manifest"]["createdAt"] = "1970-01-01T00:16:39Z"
        for proof in wrong["authorProofs"]:
            proof["verifiedAt"] = 999
        wrong["manifestFingerprint"] = manifest_fingerprint(wrong["manifest"])
        self.denied("installRun", {"response": wrong}, "historical_author_untrusted")
        self.assertEqual(self.peer.call("status")["state"], "ACTIVE")

    def test_cross_run_pages_and_wrong_order_cursors_fail(self):
        first, response1 = self.begin("first")
        second, response2 = self.begin("second", decrypt=False)
        self.install(response1)
        self.install(response2)
        page0 = self.service.inputs(self.token, first["runId"])
        other = self.service.inputs(self.token, second["runId"])
        self.denied(
            "decryptRun", {"runId": first["runId"], "page": other}, "manifest_binding_mismatch"
        )
        later = self.service.inputs(self.token, first["runId"], page0["nextCursor"])
        self.denied(
            "decryptRun", {"runId": first["runId"], "page": later}, "component_order_mismatch"
        )
        wrong = copy.deepcopy(page0)
        wrong["nextCursor"] = None
        self.denied(
            "decryptRun", {"runId": first["runId"], "page": wrong}, "component_cursor_mismatch"
        )
        self.peer.call("decryptRun", {"runId": first["runId"], "page": page0})
        self.peer.call("decryptRun", {"runId": second["runId"], "page": other})

    def test_frozen_run_survives_ordinary_source_and_rule_versions(self):
        begin, response = self.begin()
        self.install(response)
        self.case.sources.revision = 6
        value = self.case.fix.task_body(version=2, resources=self.case.resources)
        self.case.tasks.update(
            self.case.fix.uid,
            TASK,
            value,
            "synthetic_oauth_task_create_2",
            self.case.fix.kid("device_sig"),
        )
        frozen = self.service.get(self.token, begin["runId"])
        self.assertEqual(frozen["manifest"], response["manifest"])
        self.install(frozen)
        page = self.service.inputs(self.token, begin["runId"])
        content = self.peer.call("decryptRun", {"runId": begin["runId"], "page": page})
        self.assertEqual(content["revision"], 1)
        page = self.service.inputs(self.token, begin["runId"], page["nextCursor"])
        content = self.peer.call("decryptRun", {"runId": begin["runId"], "page": page})
        self.assertEqual(content["revision"], 5)

    def test_equivalent_es256_signature_keeps_begin_fingerprint_and_original_manifest(self):
        self.decrypt_preparation()
        begin = self.peer.call("beginRun", {"stableOperationId": "synthetic_helper_run_es256"})
        alternate = copy.deepcopy(begin["signedBeginIntent"])
        signature = b64url_decode(alternate["signature"])
        order = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
        changed = order - int.from_bytes(signature[32:], "big")
        alternate["signature"] = b64url_encode(signature[:32] + changed.to_bytes(32, "big"))
        self.assertNotEqual(alternate, begin["signedBeginIntent"])
        first, status = self.service.begin(self.token, TASK, alternate, begin["stableOperationId"])
        self.assertEqual(status, 201)
        self.install(first)
        replay, status = self.service.begin(
            self.token, TASK, begin["signedBeginIntent"], begin["stableOperationId"]
        )
        self.assertEqual(status, 200)
        self.assertEqual(replay, first)

    def test_historical_writer_revocation_keeps_frozen_run_inputs(self):
        begin, response = self.begin()
        self.install(response)
        fix = self.case.fix
        bundle = fix.make_bundle(previous=fix.registry, revoked=["run_writer"], issued_at=1000)
        self.case.vaults.update_registry(
            fix.uid,
            fix.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": fix.registry.registry_sequence,
                "registryBundle": bundle,
            },
            "synthetic_run_writer_revocation",
        )
        fix.registry = fix.verify(bundle, previous=fix.registry)
        self.peer.call("registry", {"bundles": [bundle]})
        frozen = self.service.get(self.token, begin["runId"])
        self.install(frozen)
        page = self.service.inputs(self.token, begin["runId"])
        self.peer.call("decryptRun", {"runId": begin["runId"], "page": page})

    def test_lock_during_run_decryption_discards_late_plaintext(self):
        begin, response = self.begin()
        self.install(response)
        page = self.service.inputs(self.token, begin["runId"])
        result = self.peer.raw(
            {
                "race": True,
                "read": self.peer.message("decryptRun", {"runId": begin["runId"], "page": page}),
                "lock": self.peer.message("lock"),
            }
        )
        self.assertTrue(result["ok"])
        self.assertFalse(result["value"]["read"]["ok"])
        self.assertNotIn("payload", result["value"]["read"])
        self.assertFalse(result["value"]["locked"]["privateKeysPresent"])

    def test_private_policy_refuses_partial_coverage(self):
        self.decrypt_preparation()
        self.denied(
            "beginRun",
            {"stableOperationId": "synthetic_run_private_partial"},
            "input_policy_partial",
        )

    def test_private_policy_refuses_unknown_asof(self):
        self.decrypt_preparation()
        self.denied(
            "beginRun", {"stableOperationId": "synthetic_run_private_unknown"}, "input_policy_asof"
        )

    def test_private_policy_refuses_old_fetched_data(self):
        self.decrypt_preparation()
        self.denied(
            "beginRun",
            {"stableOperationId": "synthetic_run_private_stale"},
            "input_policy_fetched_age",
        )
