"""Root upgrades/migrations preserve current head and fence old generations."""

import copy

from fixtures import CONNECTION, UID, PolicyFixture, public
from jwcrypto import jwk

from app.contracts import digest, recovery_aad
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, sign_jws, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.executor_trust import EXECUTOR_TRUST_PROFILE


class TransitionTests(PolicyFixture):
    def setUp(self):
        super().setUp()
        self.tokens = self.authorize()
        self.recover()

    def transition(self, kind="code_upgrade", *, change_head=False):
        cp = self.policy.owner_checkpoint(UID, CONNECTION)["checkpoint"]
        _, checkpoint = _signed_parts(cp)
        e = copy.deepcopy(self.enrollment)
        e["workload"]["imageDigest"] = "sha256:" + "f" * 64
        if kind == "epoch_migration":
            for name, field in [
                ("new_sig", "agentSigningJwk"),
                ("new_enc", "agentEncryptionJwk"),
                ("new_tls", "tlsJwk"),
            ]:
                self.keys[name] = jwk.JWK.generate(kty="EC", crv="P-256")
                e[field] = public(self.keys[name])
            e["identityEpoch"] = 2
            e["bindingFingerprint"] = "2" * 64
            e["wrappedStateKey"] = __import__(
                "folioview_shared.encrypted.jsonutil", fromlist=["b64url_encode"]
            ).b64url_encode(b"synthetic-new-generation-wrap")
        if change_head:
            e["initialStateHead"] = "0" * 64
        binding = self.policy.enrollment_binding(e, CONNECTION)
        op = "synthetic_policy_transition_0001"
        transition = sign_jws(
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_transition",
                "transitionType": kind,
                "previousApprovalFingerprint": signing_input_fingerprint(
                    self.registration["approval"]
                ),
                "previousCheckpointDigest": digest(checkpoint),
                "nextBinding": binding,
                "operationId": op,
                "issuedAt": self.now,
                "expiresAt": self.now + 120,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )
        approval = sign_jws(
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_approval",
                "binding": binding,
                "operationId": op,
                "issuedAt": self.now,
                "expiresAt": self.now + 86400,
            },
            self.keys["root"],
            typ="fv-control+jws",
        )
        params = {"transition": transition, "enrollment": e}
        current = self.owner_state()
        request = {
            "action": "transition",
            "parameters": params,
            "approval": approval,
            "command": self.control(
                "transition",
                version=current["stateVersion"],
                head=current["stateHead"],
                parameters={"parameters": params, "approval": approval},
                operation=op,
            ),
        }
        return request, binding

    def test_root_code_upgrade_preserves_original_keys_and_state_head(self):
        request, new = self.transition()
        old = self.owner_state()
        result = self.policy.control(UID, CONNECTION, request)
        current = self.owner_state()
        self.assertGreater(result["authorizationEpoch"], old["authorizationEpoch"])
        self.assertEqual(current["stateHead"], old["stateHead"])
        self.assertIsNone(current["active"])
        self.assertEqual(recovery_aad(self.binding), recovery_aad(new))
        with self.assertRaises(ContractError):
            self.lease()
        self.assertEqual(self.policy.control(UID, CONNECTION, request), result)

    def test_code_upgrade_cannot_restore_an_old_backup_head(self):
        request, _ = self.transition(change_head=True)
        with self.assertRaises(ContractError):
            self.policy.control(UID, CONNECTION, request)
        self.assertEqual(self.owner_state()["stateHead"], self.enrollment["initialStateHead"])

    def test_explicit_root_epoch_migration_changes_keys_and_fences_old_tokens(self):
        request, new = self.transition("epoch_migration")
        self.policy.control(UID, CONNECTION, request)
        c = self.owner_state()
        self.assertEqual(c["binding"]["identityEpoch"], 2)
        self.assertIsNone(c["active"])
        self.assertNotEqual(new["agentSigningKeyId"], self.binding["agentSigningKeyId"])
        self.assertNotEqual(recovery_aad(new), recovery_aad(self.binding))
        with self.assertRaises(ContractError):
            self.challenge()

    def test_certificate_approval_is_root_cas_and_does_not_replace_tls_key(self):
        c = self.owner_state()
        params = {"certificateDigest": "9" * 64}
        command = self.control(
            "certificate",
            version=c["stateVersion"],
            head=c["stateHead"],
            parameters={"parameters": params, "approval": None},
        )
        request = {
            "action": "certificate",
            "parameters": params,
            "approval": None,
            "command": command,
        }
        self.policy.control(UID, CONNECTION, request)
        now = self.owner_state()
        self.assertEqual(now["certificateDigest"], "9" * 64)
        self.assertEqual(now["binding"]["tlsKeyId"], c["binding"]["tlsKeyId"])
        self.assertIsNone(now["active"])
