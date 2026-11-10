"""Fresh, Root-scoped leases, original-key recovery, revocation and state-head CAS."""

import copy
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

from fixtures import CONNECTION, UID, PolicyFixture

from app.contracts import Unavailable, digest, recovery_aad
from app.oauth import OAuth
from folioview_shared.encrypted.crypto import _signed_parts, sign_jws
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.executor_trust import verify_executor_lease
from folioview_shared.encrypted.jsonutil import canonical_json


class PolicyTests(PolicyFixture):
    def setUp(self):
        super().setUp()
        self.tokens = self.authorize()

    def test_original_keys_are_confirmed_before_execution_and_recovery_is_sealed(self):
        with self.assertRaises(ContractError):
            self.lease("execute")
        recovered = self.recover()
        lease, ch, _ = self.lease("execute")
        _, cp = _signed_parts(lease["checkpoint"])
        verified = verify_executor_lease(
            lease["approval"],
            lease["checkpoint"],
            lease["lease"],
            expected_binding=self.binding,
            root_jwk=self.config.root_jwk,
            policy_jwk=self.config.policy_jwk,
            current_checkpoint=cp,
            challenge=ch["challenge"],
            challenge_used=False,
            expected_operation=self.operation(),
            purpose="execute",
            now=self.now,
        )
        self.assertEqual(verified["checkpointDigest"], digest(cp))
        self.assertEqual(recovered["stateHead"], self.enrollment["initialStateHead"])
        self.assertEqual(
            self.signer.unwrapped,
            [(self.enrollment["wrappedStateKey"], recovery_aad(self.binding))],
        )
        stored = canonical_json(self.store.load()[1]).decode()
        self.assertNotIn('"d":', stored)
        for key in self.keys.values():
            self.assertNotIn(key.export(private_key=True, as_dict=True)["d"], stored)

    def test_restart_keeps_connection_tokens_state_head_and_original_keys(self):
        self.recover()
        before = self.owner_state()
        self.policy = self.new_policy()
        self.assertEqual(self.owner_state(), before)
        self.lease("execute")
        self.assertEqual(len(self.signer.unwrapped), 1)

    def test_revocation_during_attestation_or_unwrap_prevents_release(self):
        ch = self.challenge()
        self.attestor.callback = self.revoke
        with self.assertRaises(ContractError):
            self.policy.grant(
                *self.args("releases", self.grant_request(ch, recover=True), key="ephemeral"),
                release=True,
            )
        self.assertEqual(self.signer.unwrapped, [])

    def test_revocation_during_key_unwrap_cannot_commit_an_old_generation(self):
        ch = self.challenge()
        self.signer.callback = self.revoke
        with self.assertRaises(ContractError):
            self.policy.grant(
                *self.args("releases", self.grant_request(ch, recover=True), key="ephemeral"),
                release=True,
            )
        self.assertEqual(self.owner_state()["status"], "revoked")

    def test_boot_recovery_fences_previous_generation_and_old_leases(self):
        first = self.recover()
        old, ch, request = self.lease()
        second = self.recover(boot="synthetic_boot_02")
        self.assertGreater(second["generation"], first["generation"])
        with self.assertRaises(ContractError):
            self.lease("execute", bootId="synthetic_boot_01")
        record = self.receipt_request(old)
        with self.assertRaises(ContractError):
            self.policy.commit(*self.args("commits", record))

    def receipt_request(self, lease):
        return {
            "lease": lease["lease"],
            "expectedHead": self.enrollment["initialStateHead"],
            "nextHead": "f" * 64,
            "receipt": {
                "operation": self.operation(),
                "receiptId": "synthetic_hub_receipt",
                "resultDigest": "1" * 64,
            },
        }

    def test_commit_is_cas_and_original_receipt_survives_lease_expiry(self):
        self.recover()
        lease, _, _ = self.lease()
        request = self.receipt_request(lease)
        original = self.policy.commit(*self.args("commits", request))
        self.now += 121
        self.assertEqual(self.policy.commit(*self.args("commits", request)), original)
        changed = copy.deepcopy(request)
        changed["receipt"]["resultDigest"] = "2" * 64
        with self.assertRaises(ContractError) as caught:
            self.policy.commit(*self.args("commits", changed))
        self.assertEqual(caught.exception.code, "idempotency_conflict")
        self.assertEqual(self.owner_state()["stateHead"], "f" * 64)

    def test_parallel_identical_commits_return_one_immutable_receipt(self):
        self.recover()
        lease, _, _ = self.lease()
        request = self.receipt_request(lease)
        with ThreadPoolExecutor(max_workers=2) as pool:
            a, b = list(
                pool.map(lambda _: self.policy.commit(*self.args("commits", request)), range(2))
            )
        self.assertEqual(a, b)
        self.assertEqual(len(self.store.load()[1]["connections"][CONNECTION]["operations"]), 1)

    def test_wrong_scope_audience_proof_and_key_cannot_authorize(self):
        request = {
            "purpose": "recover",
            "operation": self.operation(),
            "resourceBindings": [],
            "bootId": "synthetic_boot_01",
            "releaseRecipientJwk": self.enrollment["agentEncryptionJwk"],
        }
        for changes in (
            {"audience": "https://hub.example"},
            {"bodyDigest": "0" * 64},
            {"bindingDigest": "0" * 64},
        ):
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.policy.challenge(*self.args("challenges", request, **changes))
        with self.assertRaises(ContractError):
            self.challenge(
                resourceBindings=[
                    {"ref": self.resource | {"incarnation": "foreign"}, "sourceEpoch": 1}
                ]
            )
        ch = self.challenge()
        with self.assertRaises(ContractError):
            self.policy.grant(
                *self.args("releases", self.grant_request(ch, recover=True), key="tls"),
                release=True,
            )

    def test_stale_challenge_and_unapproved_workload_do_not_release(self):
        ch = self.challenge()
        self.attestor.accept = False
        with self.assertRaises(ContractError):
            self.policy.grant(
                *self.args("releases", self.grant_request(ch, recover=True), key="ephemeral"),
                release=True,
            )
        self.attestor.accept = True
        self.now += 121
        with self.assertRaises(ContractError):
            self.policy.grant(
                *self.args("releases", self.grant_request(ch, recover=True), key="ephemeral"),
                release=True,
            )
        self.assertEqual(self.signer.unwrapped, [])

    def test_disabled_service_cannot_mint_but_root_narrowing_still_works(self):
        self.policy = self.new_policy(replace(self.config, enabled=False))
        with self.assertRaises(Unavailable):
            self.challenge()
        self.revoke()
        self.assertEqual(self.owner_state()["status"], "revoked")

    def test_exact_root_enrollment_retry_never_revives_terminal_revocation(self):
        self.revoke()
        original = self.policy.control(UID, CONNECTION, self.registration)
        self.assertEqual(original["status"], "active")
        self.assertEqual(self.owner_state()["status"], "revoked")

    def test_root_secret_and_account_are_independent_of_hub_assertions(self):
        with self.assertRaises(ContractError):
            self.policy.owner_state("different_owner", CONNECTION)
        before = self.owner_state()
        command = self.control(
            "revoke",
            version=before["stateVersion"],
            head=before["stateHead"],
            parameters={"parameters": {}, "approval": None},
        )
        _, payload = _signed_parts(command)
        wrong = sign_jws(payload, self.keys["policy"], typ="fv-control+jws")
        with self.assertRaises(ContractError):
            self.policy.control(
                UID,
                CONNECTION,
                {"action": "revoke", "parameters": {}, "approval": None, "command": wrong},
            )
        self.assertEqual(self.owner_state()["status"], "active")

    def test_lease_lost_ack_retry_returns_original_and_changed_request_conflicts(self):
        self.recover()
        lease, ch, request = self.lease()
        self.assertEqual(self.policy.grant(*self.args("leases", request)), lease)
        changed = copy.deepcopy(request)
        changed["attestationToken"] = "modified"
        with self.assertRaises(ContractError) as caught:
            self.policy.grant(*self.args("leases", changed))
        self.assertEqual(caught.exception.code, "idempotency_conflict")

    def test_oauth_revoke_fences_fresh_lease_and_owner_history_is_preserved(self):
        self.recover()
        response = OAuth(self.policy).token(
            {"client_id": "synthetic_native", "token": self.tokens["refresh_token"]}, revoke=True
        )
        self.assertEqual(response["status"], 200, response)
        with self.assertRaises(ContractError):
            self.lease()
        self.assertEqual(self.owner_state()["status"], "active")

    def test_sealed_recovery_key_retry_requires_original_fresh_current_generation(self):
        ch = self.challenge()
        request = self.grant_request(ch, recover=True)
        result = self.policy.grant(*self.args("releases", request, key="ephemeral"), release=True)
        self.assertEqual(
            self.policy.grant(*self.args("releases", request, key="ephemeral"), release=True),
            result,
        )
        self.now += 121
        with self.assertRaises(ContractError):
            self.policy.grant(*self.args("releases", request, key="ephemeral"), release=True)
        self.assertEqual(len(self.signer.unwrapped), 1)
