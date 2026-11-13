"""In-memory aliases and synthetic keys only; no consumer or production migration."""

import copy
import json
import subprocess
import unittest
from pathlib import Path

from jwcrypto import jwk
from test_encrypted_authority import AuthorityFixture

from folioview_shared.encrypted.crypto import jwk_thumbprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json
from folioview_shared.encrypted.private_display_names import (
    DISPLAY_NAME_PROFILE,
    check_display_name_replay,
    decrypt_display_name,
    display_name_context,
    display_name_id,
    encrypt_display_name,
    load_display_name_schema,
    plan_display_name_update,
    validate_display_name_envelope,
    validate_display_name_schema,
    verify_display_name_control,
)


class DisplayNameTests(unittest.TestCase):
    def setUp(self):
        self.f = AuthorityFixture()
        self.context = {
            "contractVersion": "folioview.agent-workspace.v2.0",
            "profile": DISPLAY_NAME_PROFILE,
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "rootKeyId": self.f.root_id,
            "ref": self.f.resource,
            "purpose": "owner_display_name",
            "revision": 1,
            "stableOperationId": "synthetic_display_name_0001",
            "recipientKeyId": self.f.kid("recovery_enc"),
        }
        self.args = dict(
            registry=self.f.registry,
            owner_subject=self.f.owner,
            vault_id=self.f.vault,
            resource_ref=self.f.resource,
            now=1000,
        )

    def payload(self, context=None, **changes):
        c = self.context if context is None else context
        return {
            **c,
            "artifactType": "private_display_name_update",
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": 1000,
            "expectedRevision": 0,
            "previousFingerprint": None,
            "envelope": encrypt_display_name(
                "Retirement · 合成", self.f.public(self.f.keys["recovery_enc"]), context=c
            ),
            **changes,
        }

    def signed(self, **changes):
        return self.f.sign(self.payload(**changes))

    def test_original_control_and_owner_decryption_do_not_change_source_or_registry(self):
        before = copy.deepcopy((self.f.resource, self.f.bundle))
        p = self.payload()
        signed = self.f.sign(p)
        state = plan_display_name_update(signed, **self.args)
        self.assertEqual(state["revision"], 1)
        self.assertEqual(
            decrypt_display_name(p["envelope"], self.f.keys["recovery_enc"], context=p),
            "Retirement · 合成",
        )
        self.assertEqual((self.f.resource, self.f.bundle), before)
        self.assertNotIn("displayName", json.dumps(p))
        self.assertNotIn("Retirement", json.dumps(p))
        self.assertEqual(display_name_context(p), self.context)

    def test_encryption_is_fresh_and_only_original_exact_bytes_are_idempotent(self):
        one, two = self.signed(), self.signed()
        self.assertNotEqual(one, two)
        state = plan_display_name_update(one, **self.args)
        self.assertEqual(check_display_name_replay(state, one, context=self.context), state)
        with self.assertRaises(ContractError) as error:
            check_display_name_replay(state, two, context=self.context)
        self.assertEqual(error.exception.code, "idempotency_conflict")

    def test_independent_revision_cas_and_previous_fingerprint_are_required(self):
        signed = self.signed()
        state = plan_display_name_update(signed, **self.args)
        with self.assertRaises(ContractError):
            plan_display_name_update(signed, current_state=state, **self.args)
        c = {**self.context, "revision": 2, "stableOperationId": "synthetic_display_name_0002"}
        p = self.payload(c, expectedRevision=1, previousFingerprint=state["operationFingerprint"])
        following = plan_display_name_update(self.f.sign(p), current_state=state, **self.args)
        self.assertEqual(following["revision"], 2)
        self.assertEqual(following["ref"], state["ref"])
        for changes in [
            {"revision": 3},
            {"previousFingerprint": "0" * 64},
            {"expectedRevision": 0},
            {"previousFingerprint": None},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                plan_display_name_update(
                    self.f.sign({**p, **changes}), current_state=state, **self.args
                )

    def test_slot_and_authority_bind_all_immutable_owner_resource_fields(self):
        original = display_name_id(self.context)
        for changes in [
            {"ownerSubject": "other_owner"},
            {"vaultId": "other_vault"},
            {"rootKeyId": "Z" * 43},
            {"ref": {**self.f.resource, "resourceId": "other_source"}},
            {"ref": {**self.f.resource, "incarnation": "new_incarnation"}},
        ]:
            c = {**self.context, **changes}
            self.assertNotEqual(display_name_id(c), original)
            with self.assertRaises(ContractError):
                plan_display_name_update(self.f.sign(self.payload(c)), **self.args)
        self.assertEqual(
            display_name_id(
                {**self.context, "revision": 9, "stableOperationId": "other_operation_00000000"}
            ),
            original,
        )

    def test_renamed_deleted_source_cannot_rebind_new_incarnation_or_old_receipt(self):
        one = self.signed()
        state = plan_display_name_update(one, **self.args)
        c = {**self.context, "ref": {**self.f.resource, "incarnation": "recreated_A"}}
        with self.assertRaises(ContractError):
            check_display_name_replay(state, one, context=c)
        with self.assertRaises(ContractError):
            plan_display_name_update(one, **{**self.args, "resource_ref": c["ref"]})

    def test_current_owner_device_control_signature_registry_and_freshness_are_mandatory(self):
        for changes in [
            {"deviceSigningKeyId": self.f.kid("A1_sig")},
            {"registrySequence": 2},
            {"checkpointDigest": "a" * 64},
            {"keyEpoch": 2},
            {"issuedAt": 699},
            {"issuedAt": 1001},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                verify_display_name_control(self.signed(**changes), **self.args)
        with self.assertRaises(ContractError):
            verify_display_name_control(self.f.sign(self.payload(), "A1_sig"), **self.args)
        with self.assertRaises(ContractError):
            verify_display_name_control(
                self.f.sign(self.payload(), typ="fv-object+jws"), **self.args
            )
        with self.assertRaises(ContractError):
            verify_display_name_control(self.signed(), **{**self.args, "registry": None})
        revoked = self.f.verify(
            self.f.make_bundle(previous=self.f.registry, revoked=("device_sig",))
        )
        with self.assertRaises(ContractError):
            verify_display_name_control(self.signed(), **{**self.args, "registry": revoked})

    def test_agent_encryption_key_is_never_an_owner_display_recipient(self):
        c = {**self.context, "recipientKeyId": self.f.kid("A1_enc")}
        p = {
            **self.payload(),
            **c,
            "envelope": encrypt_display_name(
                "Synthetic", self.f.public(self.f.keys["A1_enc"]), context=c
            ),
        }
        with self.assertRaises(ContractError):
            verify_display_name_control(self.f.sign(p), **self.args)
        with self.assertRaises(ContractError):
            decrypt_display_name(
                self.payload()["envelope"], self.f.keys["A1_enc"], context=self.context
            )

    def test_purpose_profile_recipients_aad_and_aead_substitution_are_rejected(self):
        p = self.payload()
        envelope = p["envelope"]
        for c in [
            {**self.context, "revision": 2},
            {**self.context, "stableOperationId": "other_operation_00000000"},
            {**self.context, "purpose": "task_input"},
        ]:
            with self.assertRaises(ContractError):
                decrypt_display_name(envelope, self.f.keys["recovery_enc"], context=c)
        for change in [
            {"aad": b64url_encode(b"{}")},
            {"tag": "B" * 22},
            {"protected": b64url_encode(canonical_json({"alg": "dir"}))},
            {"recipients": envelope["recipients"] * 2},
            {"iv": "A" * 17},
            {"ciphertext": "A" * 2049},
            {"url": "https://example.test/private"},
        ]:
            with self.subTest(change=change), self.assertRaises(ContractError):
                decrypt_display_name({**envelope, **change}, self.f.keys["recovery_enc"], context=p)

    def test_private_names_have_a_small_unicode_budget_and_no_invisible_control_text(self):
        public = self.f.public(self.f.keys["recovery_enc"])
        for name in ["", " ", " trailing ", "A" * 81, "a\nnext", "\u202esecret", None, 1]:
            with self.subTest(name=name), self.assertRaises(ContractError):
                encrypt_display_name(name, public, context=self.context)
        for name in ["账户一", "A" * 80, "😀" * 80]:
            e = encrypt_display_name(name, public, context=self.context)
            self.assertEqual(
                decrypt_display_name(e, self.f.keys["recovery_enc"], context=self.context), name
            )

    def test_closed_schema_refuses_task_access_financial_updates_and_oversized_packets(self):
        p = self.payload()
        for changes in [
            {"grants": []},
            {"sourceRevision": 2},
            {"displayName": "Plaintext"},
            {"ref": {**self.f.resource, "kind": "watchlist", "sourceService": "user"}},
            {"revision": True},
            {"expectedRevision": -1},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                validate_display_name_schema("DisplayNameControl", {**p, **changes})
        with self.assertRaises(ContractError):
            load_display_name_schema("TaskContent")
        with self.assertRaises(ContractError):
            verify_display_name_control({"payload": "A" * 13000}, **self.args)
        # A detached schema request must never mutate the packaged legacy grammar.
        schema = load_display_name_schema("DisplayNameControl")
        schema["$defs"]["Identifier"]["pattern"] = "changed"
        self.assertNotEqual(
            load_display_name_schema("DisplayNameControl")["$defs"]["Identifier"]["pattern"],
            "changed",
        )

    def test_real_node_webcrypto_reads_python_envelope_and_python_reads_node_envelope(self):
        # Anonymous pipe only. No fixture key file, environment variable or console dump.
        root = Path(__file__).resolve().parents[3]
        envelope = self.payload()["envelope"]
        result = subprocess.run(
            ["node", str(Path(__file__).with_name("interop") / "private_display_names.mjs")],
            cwd=root,
            input=json.dumps(
                {
                    "privateJwk": self.f.keys["recovery_enc"].export(as_dict=True),
                    "publicJwk": self.f.public(self.f.keys["recovery_enc"]),
                    "context": self.context,
                    "envelope": envelope,
                }
            ),
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, "Synthetic Node interop failed")
        output = json.loads(result.stdout)
        self.assertEqual(output["name"], "Retirement · 合成")
        self.assertEqual(
            decrypt_display_name(
                output["envelope"], self.f.keys["recovery_enc"], context=self.context
            ),
            output["name"],
        )
        self.assertNotEqual(envelope, output["envelope"])
        # Even a valid AEAD envelope cannot select an alternate declared Owner key.
        other = jwk.JWK.generate(kty="EC", crv="P-256")
        c = {**self.context, "recipientKeyId": jwk_thumbprint(self.f.public(other))}
        with self.assertRaises(ContractError):
            validate_display_name_envelope(envelope, context=c)
