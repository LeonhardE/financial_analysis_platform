"""Independent Node vectors and signed current-state/recovery/epoch attack cases."""

import copy
import hashlib
import json
import os
import subprocess
import unittest
from pathlib import Path

from test_encrypted_interop import public_part, public_test_key

from folioview_shared.encrypted.crypto import jwk_thumbprint, sign_jws, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.executor_trust import (
    check_executor_retry,
    load_executor_schema,
    validate_executor_schema,
    verify_executor_approval,
    verify_executor_lease,
    verify_executor_recovery,
    verify_executor_transition,
)
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.schema import validate_schema

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def signed(value, scalar):
    return sign_jws(value, public_test_key(scalar), typ="fv-control+jws")


class ExecutorTrustTests(unittest.TestCase):
    def setUp(self):
        self.v = json.loads((HERE / "fixtures/executor_trust_node.json").read_text())

    def options(self, **changes):
        v = self.v
        return (
            dict(
                expected_binding=v["binding"],
                root_jwk=v["rootPublicJwk"],
                policy_jwk=v["policyPublicJwk"],
                current_checkpoint=v["checkpoint"],
                challenge=v["challenge"],
                challenge_used=False,
                expected_operation=v["operation"],
                purpose="recover",
                now=1001,
            )
            | changes
        )

    def lease(self, **changes):
        v = self.v
        return verify_executor_lease(
            v["approvalSigned"], v["checkpointSigned"], v["leaseSigned"], **self.options(**changes)
        )

    def recovery(self, **changes):
        v = self.v
        return verify_executor_recovery(
            v["recoverySigned"],
            **(
                self.options()
                | dict(
                    agent_jwk=v["agentPublicJwk"],
                    expected_receipts=[v["receipt"]],
                    approval_signed=v["approvalSigned"],
                    checkpoint_signed=v["checkpointSigned"],
                    lease_signed=v["leaseSigned"],
                )
                | changes
            ),
        )

    def transition(self, kind, **changes):
        v = self.v
        args = {
            k: self.options()[k]
            for k in ("expected_binding", "root_jwk", "policy_jwk", "current_checkpoint", "now")
        }
        return verify_executor_transition(
            v[kind + "Signed"],
            **(
                args
                | dict(
                    approval_signed=v["approvalSigned"],
                    checkpoint_signed=v["checkpointSigned"],
                    expected_next_binding=v[kind]["nextBinding"],
                )
                | changes
            ),
        )

    def test_independent_node_signatures_and_public_schema_contract(self):
        v = self.v
        self.assertEqual(
            verify_executor_approval(
                v["approvalSigned"],
                expected_binding=v["binding"],
                root_jwk=v["rootPublicJwk"],
                now=1001,
            ),
            v["approval"],
        )
        self.assertEqual(self.lease(), v["lease"])
        self.assertEqual(self.recovery(), v["recovery"])
        self.assertEqual(self.transition("upgrade"), v["upgrade"])
        self.assertEqual(self.transition("migration"), v["migration"])
        self.assertEqual(
            jwk_thumbprint(public_part(public_test_key(11))), v["binding"]["rootKeyId"]
        )
        self.assertEqual(
            check_executor_retry(v["operation"], v["receipt"], expected_operation=v["operation"]),
            v["receipt"],
        )
        browser = json.loads((ROOT / "packages/executor-trust/schemas.json").read_text())
        schema = load_executor_schema("ExecutorBinding")
        schema.pop("$ref")
        self.assertEqual(schema, browser)

    def test_execute_and_write_report_each_require_their_own_signed_challenge(self):
        for purpose in ["execute", "write_report"]:
            self.setUp()
            self.v["challenge"]["purpose"] = purpose
            self.v["lease"]["challenge"] = self.v["challenge"]
            self.v["leaseSigned"] = signed(self.v["lease"], 12)
            self.assertEqual(self.lease(purpose=purpose), self.v["lease"])
            with self.assertRaises(ContractError):
                self.lease(purpose="recover")

    def test_every_expected_binding_field_and_independent_signer_is_enforced(self):
        for field in self.v["binding"]:
            with self.subTest(field=field):
                binding = copy.deepcopy(self.v["binding"])
                replacement = jwk_thumbprint(public_part(public_test_key(18)))
                if field == "identityEpoch":
                    binding[field] = 2
                elif field == "recipientKeyIds":
                    binding[field] = [replacement]
                elif field.endswith("KeyId"):
                    binding[field] = replacement
                elif field in ("bindingFingerprint", "scopeDigest", "workloadDigest"):
                    binding[field] = "0" * 64
                elif field in ("issuer", "audience"):
                    binding[field] = "https://other.example.invalid"
                else:
                    binding[field] = "substitution"
                with self.assertRaises(ContractError):
                    self.lease(expected_binding=binding)
        for changes in [
            {"root_jwk": self.v["policyPublicJwk"]},
            {"policy_jwk": self.v["rootPublicJwk"]},
        ]:
            with self.assertRaises(ContractError):
                self.lease(**changes)
        self.v["approvalSigned"] = signed(self.v["approval"], 12)
        with self.assertRaises(ContractError):
            self.lease()

    def test_narrow_lease_purpose_replay_nonce_request_and_current_state(self):
        v = self.v
        variants = [dict(purpose=p) for p in ["execute", "write_report", "unknown"]]
        variants += [dict(challenge_used=x) for x in [True, None, 0]]
        variants += [dict(now=x) for x in [999, 1060, 1080, 0, True, 1001.0]]
        variants += [
            dict(challenge={**v["challenge"], "nonce": "A" * 43}),
            dict(expected_operation={**v["operation"], "requestDigest": "0" * 64}),
        ]
        variants += [
            dict(current_checkpoint={**v["checkpoint"], field: value})
            for field, value in [
                ("stateVersion", 4),
                ("authorizationEpoch", 3),
                ("stateHead", "0" * 64),
            ]
        ]
        for change in variants:
            with self.subTest(change=change), self.assertRaises(ContractError):
                self.lease(**change)

    def test_signed_revocation_and_foreign_checkpoint_never_authorize(self):
        for field, value in [
            ("revoked", True),
            ("bindingDigest", "0" * 64),
            ("approvalFingerprint", "0" * 64),
        ]:
            self.setUp()
            cp = self.v["checkpoint"]
            cp[field] = value
            self.v["checkpointSigned"] = signed(cp, 12)
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.lease()

    def test_expiry_cross_profile_extra_fields_and_whole_message_budget(self):
        for target, scalar, fields in [
            ("approval", 11, {"expiresAt": 900 + 30 * 86400 + 1}),
            ("checkpoint", 12, {"expiresAt": 1111}),
            ("lease", 12, {"expiresAt": 1081}),
            ("lease", 12, {"issuedAt": 994}),
            ("lease", 12, {"profile": "folioview.persistent-content.v1"}),
            ("lease", 12, {"extra": "field"}),
        ]:
            self.setUp()
            self.v[target].update(fields)
            self.v[target + "Signed"] = signed(self.v[target], scalar)
            with self.subTest(target=target, fields=fields), self.assertRaises(ContractError):
                self.lease()
        self.setUp()
        self.v["leaseSigned"]["extra"] = "x" * 32768
        with self.assertRaises(ContractError):
            self.lease()

    def test_recovery_retains_every_key_state_head_and_original_receipts(self):
        for field in [
            "recoveredBinding",
            "leaseFingerprint",
            "checkpointDigest",
            "stateHead",
            "receipts",
        ]:
            self.setUp()
            self.v["recovery"][field] = (
                {
                    **self.v["binding"],
                    "agentEncryptionKeyId": jwk_thumbprint(public_part(public_test_key(19))),
                }
                if field == "recoveredBinding"
                else []
                if field == "receipts"
                else "0" * 64
            )
            self.v["recoverySigned"] = signed(self.v["recovery"], 13)
            with self.subTest(field=field), self.assertRaises(ContractError):
                self.recovery()
        self.setUp()
        self.v["recoverySigned"] = signed(self.v["recovery"], 11)
        with self.assertRaises(ContractError):
            self.recovery()
        self.setUp()
        with self.assertRaises(ContractError):
            self.recovery(agent_jwk=public_part(public_test_key(18)))
        with self.assertRaises(ContractError):
            self.recovery(purpose="execute")

    def test_upgrade_and_migration_are_explicit_distinct_root_controls(self):
        for kind, field, value in [
            ("upgrade", "identityEpoch", 2),
            ("upgrade", "agentSigningKeyId", jwk_thumbprint(public_part(public_test_key(18)))),
            ("upgrade", "scopeDigest", "0" * 64),
            ("upgrade", "workloadDigest", "a" * 64),
            ("migration", "identityEpoch", 1),
            ("migration", "identityEpoch", 3),
            ("migration", "scopeDigest", "0" * 64),
            ("migration", "agentSigningKeyId", self.v["binding"]["agentSigningKeyId"]),
            ("migration", "agentEncryptionKeyId", self.v["binding"]["agentEncryptionKeyId"]),
        ]:
            self.setUp()
            self.v[kind]["nextBinding"][field] = value
            self.v[kind + "Signed"] = signed(self.v[kind], 11)
            with self.subTest(kind=kind, field=field), self.assertRaises(ContractError):
                self.transition(kind)
        self.setUp()
        self.v["migrationSigned"] = signed(self.v["migration"], 12)
        with self.assertRaises(ContractError):
            self.transition("migration")
        self.setUp()
        with self.assertRaises(ContractError):
            self.transition(
                "migration", current_checkpoint={**self.v["checkpoint"], "stateVersion": 4}
            )

    def test_post_migration_checkpoint_fences_old_epoch_and_retry_is_immutable(self):
        v = self.v
        current = {
            **v["checkpoint"],
            "bindingDigest": digest(v["migration"]["nextBinding"]),
            "stateVersion": 4,
            "authorizationEpoch": 3,
        }
        with self.assertRaises(ContractError):
            self.lease(current_checkpoint=current)
        for field in v["operation"]:
            with self.subTest(field=field), self.assertRaises(ContractError):
                check_executor_retry(
                    {**v["operation"], field: "substitution"},
                    v["receipt"],
                    expected_operation=v["operation"],
                )
        result = check_executor_retry(
            v["operation"], v["receipt"], expected_operation=v["operation"]
        )
        result["receiptId"] = "mutated"
        self.assertEqual(v["receipt"]["receiptId"], "receipt-original")
        result = self.recovery()
        result["receipts"].clear()
        self.assertEqual(len(v["recovery"]["receipts"]), 1)

    def test_approved_transition_recovery_preserves_historical_receipts_without_rebinding(self):
        for kind in ["upgrade", "migration"]:
            self.setUp()
            self.transition(kind)
            v = self.v
            original = copy.deepcopy(v["receipt"])
            v["binding"] = copy.deepcopy(v[kind]["nextBinding"])
            v["approval"]["binding"] = v["binding"]
            v["approvalSigned"] = signed(v["approval"], 11)
            bd = digest(v["binding"])
            v["checkpoint"]["bindingDigest"] = bd
            v["checkpoint"]["approvalFingerprint"] = signing_input_fingerprint(v["approvalSigned"])
            v["checkpoint"]["stateVersion"] += 1
            v["checkpoint"]["authorizationEpoch"] += 1
            v["checkpointSigned"] = signed(v["checkpoint"], 12)
            v["challenge"]["bindingDigest"] = bd
            v["operation"]["bindingDigest"] = bd
            v["lease"].update(
                bindingDigest=bd,
                challenge=v["challenge"],
                operation=v["operation"],
                checkpointDigest=digest(v["checkpoint"]),
            )
            v["leaseSigned"] = signed(v["lease"], 12)
            v["recovery"].update(
                recoveredBinding=v["binding"],
                checkpointDigest=digest(v["checkpoint"]),
                leaseFingerprint=signing_input_fingerprint(v["leaseSigned"]),
            )
            scalar = 18 if kind == "migration" else 13
            v["agentPublicJwk"] = public_part(public_test_key(scalar))
            v["recoverySigned"] = signed(v["recovery"], scalar)
            self.assertEqual(self.recovery()["receipts"], [original])
            self.assertNotEqual(original["operation"]["bindingDigest"], bd)
            self.assertEqual(
                check_executor_retry(
                    original["operation"], original, expected_operation=original["operation"]
                ),
                original,
            )
            with self.assertRaises(ContractError):
                check_executor_retry(v["operation"], original, expected_operation=v["operation"])

    def test_closed_schemas_no_legacy_alias_and_detached_definitions(self):
        with self.assertRaises(ContractError):
            validate_executor_schema(
                "ExecutorBinding", {**self.v["binding"], "privateKey": "forbidden"}
            )
        for name in ["UnknownExecutor", [], "PersistentAgentIdentity"]:
            with self.assertRaises(ContractError):
                load_executor_schema(name)
            with self.assertRaises(ContractError):
                validate_executor_schema(name, {})
        for name in ["PersistentAgentBindingPayload", "AgentKeyGrantPayload"]:
            with self.assertRaises(ContractError):
                validate_schema(name, self.v["approval"])
        schema = load_executor_schema("ExecutorBinding")
        schema["$defs"]["ExecutorBinding"]["additionalProperties"] = True
        with self.assertRaises(ContractError):
            validate_executor_schema("ExecutorBinding", {**self.v["binding"], "extra": "field"})

        def public(value):
            if isinstance(value, dict):
                self.assertNotIn("d", value)
                for child in value.values():
                    public(child)
            elif isinstance(value, list):
                for child in value:
                    public(child)

        public(self.v)
        self.assertFalse(self.v["generatedBy"]["privateKeysStored"])

    def test_even_root_signed_bad_urls_aliasing_and_tampered_signature_are_rejected(self):
        for field, value in [
            ("issuer", "https://policy.example.invalid/"),
            ("issuer", "https://policy.example.invalid?x=1"),
            ("issuer", "https://policy.example.invalid\n"),
            ("issuer", "https://user@policy.example.invalid"),
            ("audience", "https://executor.example.invalid:443/mcp"),
            ("audience", "https://executor.example.invalid/a/../mcp"),
            ("audience", "https://executor.example.invalid/%6dcp"),
            ("audience", "http://executor.example.invalid/mcp"),
            ("recipientKeyIds", [self.v["binding"]["rootKeyId"]]),
            ("tlsKeyId", self.v["binding"]["agentEncryptionKeyId"]),
        ]:
            self.setUp()
            self.v["binding"][field] = value
            self.v["approval"]["binding"] = self.v["binding"]
            self.v["approvalSigned"] = signed(self.v["approval"], 11)
            with self.subTest(field=field), self.assertRaises(ContractError):
                verify_executor_approval(
                    self.v["approvalSigned"],
                    expected_binding=self.v["binding"],
                    root_jwk=self.v["rootPublicJwk"],
                    now=1001,
                )
        self.setUp()
        from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode

        signature = bytearray(b64url_decode(self.v["leaseSigned"]["signature"]))
        signature[0] ^= 1
        self.v["leaseSigned"]["signature"] = b64url_encode(bytes(signature))
        with self.assertRaises(ContractError):
            self.lease()

    def test_checked_browser_bundle_verifies_python_signed_approval_lease_recovery_and_migration(
        self,
    ):
        # Re-sign every control using the Python JOSE implementation. All output
        # passed to Node is public; known synthetic scalars never leave Python.
        v = self.v
        v["approvalSigned"] = signed(v["approval"], 11)
        v["checkpoint"]["approvalFingerprint"] = signing_input_fingerprint(v["approvalSigned"])
        v["checkpointSigned"] = signed(v["checkpoint"], 12)
        v["lease"]["checkpointDigest"] = digest(v["checkpoint"])
        v["leaseSigned"] = signed(v["lease"], 12)
        v["recovery"]["leaseFingerprint"] = signing_input_fingerprint(v["leaseSigned"])
        v["recovery"]["checkpointDigest"] = digest(v["checkpoint"])
        v["recoverySigned"] = signed(v["recovery"], 13)
        for kind in ["upgrade", "migration"]:
            v[kind]["previousApprovalFingerprint"] = signing_input_fingerprint(v["approvalSigned"])
            v[kind]["previousCheckpointDigest"] = digest(v["checkpoint"])
            v[kind + "Signed"] = signed(v[kind], 11)
        result = subprocess.run(
            [os.getenv("FOLIOVIEW_NODE_BIN", "node"), str(HERE / "interop/executor_trust.mjs")],
            input=json.dumps(v),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(
            result.returncode, 0, "Independent browser verification of Python signatures failed"
        )
        self.assertEqual(
            json.loads(result.stdout),
            {
                "approval": True,
                "lease": True,
                "recovery": True,
                "upgrade": True,
                "migration": True,
                "retry": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
