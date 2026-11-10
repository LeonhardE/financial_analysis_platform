"""Attested keyring startup before original TLS, with no financial authority bypass."""

from fixtures import CONNECTION, UID, PolicyFixture, open_secret, public

from app.oauth import OAuth
from folioview_shared.encrypted.errors import ContractError


class WorkloadRecoveryTests(PolicyFixture):
    def request_args(self, route, request, *, key="ephemeral"):
        path = f"/workload/v1/connections/{CONNECTION}/" + route
        return CONNECTION, None, self.proof(path, request, key=key), path, request

    def boot_challenge(self):
        request = {
            "purpose": "recover",
            "operation": self.operation(),
            "resourceBindings": [],
            "bootId": "synthetic_boot_01",
            "releaseRecipientJwk": public(self.keys["ephemeral"]),
        }
        return self.policy.challenge(*self.request_args("challenges", request), workload=True)

    def test_fresh_root_boot_window_can_restore_original_keyring_before_account_request(self):
        ch = self.boot_challenge()
        request = self.grant_request(ch, recover=True)
        result = self.policy.grant(
            *self.request_args("releases", request), release=True, workload=True
        )
        self.assertIsNotNone(result["sealedRecoveryKey"])
        self.assertEqual(len(self.signer.unwrapped), 1)
        # This path never authorizes execute/write or supplies an account token.
        self.assertNotIn("access_token", result)
        bad = {
            "purpose": "execute",
            "operation": self.operation(),
            "resourceBindings": [],
            "bootId": "synthetic_boot_01",
            "releaseRecipientJwk": public(self.keys["ephemeral"]),
        }
        with self.assertRaises(ContractError):
            self.policy.challenge(*self.request_args("challenges", bad), workload=True)
        bad["purpose"] = "recover"
        bad["resourceBindings"] = self.scope["resourceBindings"]
        with self.assertRaises(ContractError):
            self.policy.challenge(*self.request_args("challenges", bad), workload=True)

    def test_without_current_account_or_fresh_root_boot_authorization_startup_stops(self):
        self.now += 301
        with self.assertRaises(ContractError):
            self.boot_challenge()
        self.assertEqual(self.signer.unwrapped, [])

    def test_original_key_confirmation_after_locked_boot_does_not_grant_financial_execution(self):
        ch = self.boot_challenge()
        self.policy.grant(
            *self.request_args("releases", self.grant_request(ch, recover=True)),
            release=True,
            workload=True,
        )
        answer = open_secret(ch["encryptionChallenge"], self.keys["agent_enc"])["secret"]
        path = f"/workload/v1/connections/{CONNECTION}/confirm"
        request = {
            "challengeId": ch["challenge"]["challengeId"],
            "encryptionAnswer": answer,
            "tlsProof": self.proof(
                path, {"statement": ch["statement"], "encryptionAnswer": answer}, key="tls"
            ),
        }
        self.policy.confirm(*self.request_args("confirm", request, key="agent_sig"), workload=True)
        self.assertTrue(self.owner_state()["active"]["confirmed"])
        request = {
            "purpose": "execute",
            "operation": self.operation(),
            "resourceBindings": self.scope["resourceBindings"],
            "bootId": "synthetic_boot_01",
            "releaseRecipientJwk": public(self.keys["ephemeral"]),
        }
        path = f"/v1/connections/{CONNECTION}/challenges"
        with self.assertRaises(ContractError):
            self.policy.challenge(CONNECTION, None, self.proof(path, request), path, request)

    def test_active_durable_account_allows_restart_without_copying_native_client_tokens(self):
        self.authorize()
        self.now += 301  # The original access token and first Root boot window have expired.
        ch = self.boot_challenge()
        result = self.policy.grant(
            *self.request_args("releases", self.grant_request(ch, recover=True)),
            release=True,
            workload=True,
        )
        self.assertIsNotNone(result["sealedRecoveryKey"])
        self.assertEqual(len(self.signer.unwrapped), 1)

    def test_native_revocation_clears_initial_boot_window_and_blocks_keyring_release(self):
        tokens = self.authorize()
        response = OAuth(self.policy).token(
            {"client_id": "synthetic_native", "token": tokens["refresh_token"]}, revoke=True
        )
        self.assertEqual(response["status"], 200)
        with self.assertRaises(ContractError):
            self.boot_challenge()
        self.assertEqual(self.owner_state()["bootstrapUntil"], 0)

    def test_unapproved_attestation_and_terminal_parent_never_release_material(self):
        ch = self.boot_challenge()
        self.attestor.accept = False
        with self.assertRaises(ContractError):
            self.policy.grant(
                *self.request_args("releases", self.grant_request(ch, recover=True)),
                release=True,
                workload=True,
            )
        self.attestor.accept = True
        self.revoke()
        with self.assertRaises(ContractError):
            self.boot_challenge()
        self.assertEqual(self.signer.unwrapped, [])

    def test_root_certificate_change_grants_only_a_new_bounded_locked_boot_window(self):
        tokens = self.authorize()
        OAuth(self.policy).token(
            {"client_id": "synthetic_native", "token": tokens["refresh_token"]}, revoke=True
        )
        c = self.owner_state()
        params = {"certificateDigest": "9" * 64}
        command = self.control(
            "certificate",
            version=c["stateVersion"],
            head=c["stateHead"],
            parameters={"parameters": params, "approval": None},
        )
        self.policy.control(
            UID,
            CONNECTION,
            {"action": "certificate", "parameters": params, "approval": None, "command": command},
        )
        self.boot_challenge()
        self.now += 301
        with self.assertRaises(ContractError):
            self.boot_challenge()
