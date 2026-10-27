"""Authenticated synthetic messages: ownership, consent, CAS and durable replay identity."""

import copy
import unittest
from dataclasses import replace

from test_encrypted_authority import AuthorityFixture
from test_encrypted_schema import context_for, wrapper

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    decrypt_jwe,
    encrypt_jwe,
    sign_jws,
    signing_input_fingerprint,
)
from folioview_shared.encrypted.envelope import (
    EnvelopeExpectation,
    check_operation_replay,
    operation_namespace,
    parse_carrier,
    validate_context_semantics,
    validate_result_receipt,
    validate_write_transition,
    verify_carrier,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json


class EnvelopeFixture(AuthorityFixture):
    def context(self, kind="result_revision", agent="A1", readers=()):
        context = context_for(kind)
        registry = self.registry
        context.update(
            ownerSubject=self.owner,
            vaultId=self.vault,
            rootKeyId=self.root_id,
            rootEpoch=registry.root_epoch,
            registrySequence=registry.registry_sequence,
            checkpointDigest=registry.checkpoint_digest,
            keyEpoch=registry.key_epoch,
            authorSigningKeyId=self.kid(
                agent + "_sig" if kind == "result_revision" else "device_sig"
            ),
        )
        binding = context["binding"]
        if kind in {"task", "result_revision"}:
            binding["taskId"] = "task_" + agent
            if kind == "task":
                context["objectId"] = binding["taskId"]
                context["resourceBindings"] = [{"ref": self.resource, "sourceEpoch": 1}]
            else:
                binding.update(connectionId="connection_" + agent, grantId="grant_" + agent)
        else:
            binding["resourceRef"] = copy.deepcopy(self.resource)
        names = ["device_enc", "recovery_enc", *readers]
        context["recipients"] = sorted(
            [
                {
                    field: self.certificates[name][field]
                    for field in ("keyId", "role", "principalId", "connectionId", "keyEpoch")
                }
                for name in names
            ],
            key=lambda row: row["keyId"],
        )
        return context

    @staticmethod
    def expectation(context):
        return EnvelopeExpectation(
            context["ownerSubject"],
            context["vaultId"],
            context["objectId"],
            context["objectType"],
            context["revision"],
            context["expectedRevision"],
            context["operationType"],
            context["authorSigningKeyId"],
            copy.deepcopy(context["binding"]),
            copy.deepcopy(context["resourceBindings"]),
            tuple(r["keyId"] for r in context["recipients"]),
        )

    def carrier(self, context, *, signer=None):
        if signer is None:
            signer = next(
                name for name in self.keys if self.kid(name) == context["authorSigningKeyId"]
            )
        recipients = {
            row["keyId"]: next(
                cert["publicJwk"]
                for cert in self.certificates.values()
                if cert["keyId"] == row["keyId"]
            )
            for row in context["recipients"]
        }
        encrypted = encrypt_jwe(wrapper(context), recipients, context=context)
        signed = sign_jws(
            {"context": context, "jwe": encrypted}, self.keys[signer], typ="fv-object+jws"
        )
        return {"contractVersion": CONTRACT_VERSION, "signedObject": signed}

    def verify_carrier(self, carrier, context, **kwargs):
        expected = {
            "registry": self.registry,
            "expectation": self.expectation(context),
            "now": 1000,
            "contract_header": CONTRACT_VERSION,
        }
        expected.update(kwargs)
        return verify_carrier(carrier, **expected)


class EncryptedEnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.f = EnvelopeFixture()

    def assert_code(self, code, action):
        with self.assertRaises(ContractError) as result:
            action()
        self.assertEqual(result.exception.code, code)

    def test_agent_result_is_publicly_verified_and_owner_and_recovery_can_decrypt(self):
        context = self.f.context()
        carrier = self.f.carrier(context)
        verified = self.f.verify_carrier(carrier, context, grant=self.f.verify_grant())
        self.assertEqual(verified.context, context)
        self.assertNotIn("Synthetic", canonical_json(carrier).decode())
        for name in ("device_enc", "recovery_enc"):
            self.assertEqual(
                decrypt_jwe(verified.jwe, self.f.keys[name], context=verified.context),
                wrapper(context),
            )
        returned = verified.context
        returned["binding"]["taskId"] = "changed_after_verification"
        carrier["contractVersion"] = "changed_after_verification"
        self.assertEqual(verified.context, context)
        self.assertEqual(verified.carrier["contractVersion"], CONTRACT_VERSION)

    def test_trusted_owner_vault_object_and_operation_bindings_cannot_be_replaced(self):
        context = self.f.context()
        carrier, grant = self.f.carrier(context), self.f.verify_grant()
        expected = self.f.expectation(context)
        changes = {
            "owner_subject": "owner_B",
            "vault_id": "vault_B",
            "object_id": "other_result",
            "object_type": "task",
            "revision": 2,
            "expected_revision": 1,
            "operation_type": "revise_result",
            "author_signing_key_id": self.f.kid("A2_sig"),
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                self.assert_code(
                    "recipient_binding_mismatch",
                    lambda field=field, value=value: self.f.verify_carrier(
                        carrier,
                        context,
                        grant=grant,
                        expectation=replace(expected, **{field: value}),
                    ),
                )
        # Python bool==int must not defeat typed expected routing comparisons.
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.f.verify_carrier(
                carrier, context, grant=grant, expectation=replace(expected, revision=True)
            ),
        )

    def test_run_task_connection_grant_and_source_binding_substitution_is_rejected(self):
        context = self.f.context()
        carrier, grant = self.f.carrier(context), self.f.verify_grant()
        changes = {
            "taskId": "task_A2",
            "taskVersion": 2,
            "runId": "other_run",
            "manifestId": "other_manifest",
            "taskEnvelopeFingerprint": "e" * 64,
            "manifestFingerprint": "f" * 64,
            "connectionId": "connection_A2",
            "grantId": "grant_A2",
            "grantEpoch": 2,
            "executionEpoch": 2,
            "sourceEpoch": 2,
        }
        for field, value in changes.items():
            binding = copy.deepcopy(context["binding"])
            binding[field] = value
            with self.subTest(field=field):
                self.assert_code(
                    "recipient_binding_mismatch",
                    lambda binding=binding: self.f.verify_carrier(
                        carrier,
                        context,
                        grant=grant,
                        expectation=replace(self.f.expectation(context), binding=binding),
                    ),
                )

    def test_certified_agent_identity_alone_does_not_authorize_a_result(self):
        context = self.f.context()
        carrier = self.f.carrier(context)
        self.assert_code(
            "key_authorization_required", lambda: self.f.verify_carrier(carrier, context)
        )
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.f.verify_carrier(carrier, context, grant=self.f.verify_grant(agent="A2")),
        )
        self.assert_code(
            "key_authorization_required",
            lambda: self.f.verify_carrier(carrier, context, grant=self.f.verify_grant(), now=1500),
        )

    def test_bad_caller_time_is_a_fixed_contract_error(self):
        context = self.f.context()
        carrier, grant = self.f.carrier(context), self.f.verify_grant()
        for now in (None, True, -1, "1000"):
            with self.subTest(now=now):
                self.assert_code(
                    "malformed_request",
                    lambda now=now: self.f.verify_carrier(carrier, context, grant=grant, now=now),
                )

    def test_server_signature_check_does_not_claim_private_tag_validity(self):
        context = self.f.context()
        carrier = self.f.carrier(context)
        message = parse_carrier(carrier, contract_header=CONTRACT_VERSION)
        from folioview_shared.encrypted.crypto import _signed_parts

        _, payload = _signed_parts(message["signedObject"])
        tag = bytearray(b64url_decode(payload["jwe"]["tag"]))
        tag[0] ^= 1
        payload["jwe"]["tag"] = b64url_encode(bytes(tag))
        carrier["signedObject"] = self.f.sign(payload, "A1_sig", typ="fv-object+jws")
        verified = self.f.verify_carrier(carrier, context, grant=self.f.verify_grant())
        self.assert_code(
            "decryption_failed",
            lambda: decrypt_jwe(verified.jwe, self.f.keys["device_enc"], context=context),
        )

    def test_cross_user_grant_or_agent_recipient_cannot_borrow_another_identity(self):
        context = self.f.context()
        carrier = self.f.carrier(context)
        other_user = AuthorityFixture(owner="owner_B", vault="vault_B")
        self.assert_code(
            "key_authorization_required",
            lambda: self.f.verify_carrier(carrier, context, grant=other_user.verify_grant()),
        )
        context = self.f.context("task", readers=("A1_enc",))
        carrier = self.f.carrier(context)
        self.assert_code(
            "key_authorization_required", lambda: self.f.verify_carrier(carrier, context)
        )
        self.f.verify_carrier(carrier, context, read_grants=[self.f.verify_grant()])
        self.assert_code(
            "key_authorization_required",
            lambda: self.f.verify_carrier(
                carrier, context, read_grants=[self.f.verify_grant(agent="A2")]
            ),
        )

    def test_resource_reader_requires_exact_source_epoch_and_version_consent(self):
        context = self.f.context("holdings_snapshot", readers=("A1_enc",))
        carrier = self.f.carrier(context)
        self.f.verify_carrier(carrier, context, read_grants=[self.f.verify_grant()])
        for field, value in (("sourceEpoch", 2), ("sourceRevision", 2)):
            changed = copy.deepcopy(context)
            changed["binding"][field] = value
            if field == "sourceRevision":
                changed.update(revision=2, expectedRevision=1)
            with self.subTest(field=field):
                self.assert_code(
                    "key_authorization_required",
                    lambda changed=changed: self.f.verify_carrier(
                        self.f.carrier(changed), changed, read_grants=[self.f.verify_grant()]
                    ),
                )

    def test_owner_and_recovery_are_required_and_results_do_not_include_agents(self):
        context = self.f.context("task")
        context["recipients"] = [r for r in context["recipients"] if r["role"] != "recovery_enc"]
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.f.verify_carrier(self.f.carrier(context), context),
        )
        context = self.f.context(readers=("A1_enc",))
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.f.verify_carrier(
                self.f.carrier(context), context, grant=self.f.verify_grant()
            ),
        )

    def test_unrelated_agent_revocation_preserves_other_agents_but_old_grant_is_stale(self):
        context = self.f.context(agent="A2")
        carrier, old_grant = self.f.carrier(context), self.f.verify_grant(agent="A2")
        previous = self.f.registry
        self.f.registry = self.f.verify(
            self.f.make_bundle(previous=previous, revoked=("A1_sig", "A1_enc")), previous=previous
        )
        self.assert_code(
            "key_authorization_required",
            lambda: self.f.verify_carrier(carrier, context, grant=old_grant),
        )
        # An older, known checkpoint reference remains valid for unaffected keys.
        self.f.verify_carrier(carrier, context, grant=self.f.verify_grant(agent="A2"))
        self.assert_code("key_authorization_required", lambda: self.f.verify_grant())

    def test_recipient_metadata_tamper_wrong_signature_and_aad_fail_closed(self):
        context = self.f.context()
        changed = copy.deepcopy(context)
        changed["recipients"][0]["keyEpoch"] = 2
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.f.verify_carrier(
                self.f.carrier(changed), changed, grant=self.f.verify_grant()
            ),
        )
        carrier = self.f.carrier(context, signer="A2_sig")
        self.assert_code(
            "invalid_signature",
            lambda: self.f.verify_carrier(carrier, context, grant=self.f.verify_grant()),
        )
        original = self.f.carrier(context)
        changed["recipients"] = copy.deepcopy(context["recipients"])
        changed["ownerSubject"] = "owner_B"
        from folioview_shared.encrypted.crypto import _signed_parts

        _, payload = _signed_parts(original["signedObject"])
        payload["context"] = changed
        original["signedObject"] = self.f.sign(payload, "A1_sig", typ="fv-object+jws")
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: parse_carrier(original, contract_header=CONTRACT_VERSION),
        )

    @staticmethod
    def receipt(context, fingerprint):
        return {
            "contractVersion": CONTRACT_VERSION,
            "vaultId": context["vaultId"],
            "runId": context["binding"]["runId"],
            "taskId": context["binding"]["taskId"],
            "resultId": context["objectId"],
            "revision": context["revision"],
            "deliveryRevision": context["deliveryRevision"],
            "stableOperationId": context["stableOperationId"],
            "envelopeFingerprint": fingerprint,
            "receivedAt": "2026-10-26T12:00:00.123456Z",
            "resultPath": f"/results/{context['objectId']}?revision={context['revision']}",
        }

    def test_original_receipt_survives_later_revision_and_reencryption_conflicts(self):
        context = self.f.context()
        carrier = self.f.carrier(context)
        verified = self.f.verify_carrier(carrier, context, grant=self.f.verify_grant())
        receipt = self.receipt(context, verified.fingerprint)
        validate_write_transition(context, current_revision=0)
        revision = copy.deepcopy(context)
        revision.update(
            revision=2,
            expectedRevision=1,
            operationType="revise_result",
            stableOperationId="revision_operation_000002",
        )
        second = self.f.verify_carrier(
            self.f.carrier(revision), revision, grant=self.f.verify_grant()
        )
        validate_write_transition(second.context, current_revision=1)
        recovered = check_operation_replay(
            carrier["signedObject"], stored_fingerprint=verified.fingerprint, stored_receipt=receipt
        )
        self.assertEqual(recovered, receipt)
        self.assertEqual(recovered["revision"], 1)
        recovered["receivedAt"] = "changed_after_recovery"
        self.assertNotEqual(recovered["receivedAt"], receipt["receivedAt"])
        reencryption = self.f.carrier(context)
        self.assertNotEqual(
            signing_input_fingerprint(reencryption["signedObject"]), verified.fingerprint
        )
        self.assert_code(
            "idempotency_conflict",
            lambda: check_operation_replay(
                reencryption["signedObject"],
                stored_fingerprint=verified.fingerprint,
                stored_receipt=receipt,
            ),
        )
        self.assert_code(
            "initial_result_exists", lambda: validate_write_transition(context, current_revision=1)
        )
        self.assert_code(
            "version_conflict", lambda: validate_write_transition(revision, current_revision=2)
        )

    def test_receipt_and_operation_namespace_bind_owner_agent_run_and_purpose(self):
        context = self.f.context()
        fingerprint = "b" * 64
        receipt = self.receipt(context, fingerprint)
        for field, value in (
            ("runId", "other_run"),
            ("revision", 2),
            ("resultPath", "/results/other_result?revision=1"),
        ):
            changed = {**receipt, field: value}
            with self.subTest(field=field):
                self.assert_code(
                    "recipient_binding_mismatch",
                    lambda changed=changed: validate_result_receipt(
                        changed, context=context, fingerprint=fingerprint
                    ),
                )
        original = operation_namespace(context)
        for field in ("ownerSubject", "vaultId"):
            changed = copy.deepcopy(context)
            changed[field] += "_other"
            self.assertNotEqual(operation_namespace(changed), original)
        for field in ("connectionId", "grantId", "taskId", "runId"):
            changed = copy.deepcopy(context)
            changed["binding"][field] += "_other"
            self.assertNotEqual(operation_namespace(changed), original)

    def test_reshare_preserves_business_revision_and_requires_exact_delivery_cas(self):
        context = self.f.context()
        context.update(
            operationType="reshare_delivery",
            expectedRevision=1,
            deliveryRevision=2,
            priorEnvelopeFingerprint="a" * 64,
            authorSigningKeyId=self.f.kid("device_sig"),
        )
        self.f.verify_carrier(self.f.carrier(context), context)
        validate_write_transition(
            context,
            current_revision=1,
            current_delivery_revision=1,
            prior_envelope_fingerprint="a" * 64,
        )
        for changes in (
            {"current_revision": 2},
            {"current_delivery_revision": 2},
            {"prior_envelope_fingerprint": "b" * 64},
        ):
            state = {
                "current_revision": 1,
                "current_delivery_revision": 1,
                "prior_envelope_fingerprint": "a" * 64,
                **changes,
            }
            self.assert_code(
                "version_conflict", lambda state=state: validate_write_transition(context, **state)
            )

    def test_malformed_signed_payload_replay_produces_contract_error_not_keyerror(self):
        signed = self.f.sign({"unexpected": "not an object message"}, "A1_sig", typ="fv-object+jws")
        context = self.f.context()
        fingerprint = signing_input_fingerprint(signed)
        self.assert_code(
            "malformed_request",
            lambda: check_operation_replay(
                signed,
                stored_fingerprint=fingerprint,
                stored_receipt=self.receipt(context, fingerprint),
            ),
        )

    def test_wrong_purpose_and_non_result_binding_shapes_are_rejected(self):
        context = self.f.context("task")
        context["operationType"] = "submit_result"
        self.assert_code("recipient_binding_mismatch", lambda: validate_context_semantics(context))
        source = self.f.context("holdings_snapshot")
        source["binding"]["runId"] = "illegal_run_on_source"
        self.assert_code("recipient_binding_mismatch", lambda: validate_context_semantics(source))


if __name__ == "__main__":
    unittest.main()
