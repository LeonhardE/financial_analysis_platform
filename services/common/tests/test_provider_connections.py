"""Synthetic public keys and pure plans only; no live credentials or store migration."""

import copy
import unittest

from test_agent_credentials import CredentialFixture

from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_agents import load_persistent_schema
from folioview_shared.encrypted.provider_connections import (
    PROVIDER_CONNECTION_PROFILE,
    check_provider_operation_replay,
    load_provider_connection_schema,
    prepare_provider_activation,
    prepare_provider_disconnect,
    provider_review_digest,
    provider_slot_id,
    require_current_provider_credential,
    validate_provider_connection_schema,
    validate_provider_slot,
)


class ProviderConnectionTests(unittest.TestCase):
    def setUp(self):
        self.credential = CredentialFixture()
        self.f = self.credential.f
        self.lease = self.credential.approve()
        self.identity = self.credential.identity
        self.context = {
            "contractVersion": self.lease["contractVersion"],
            "profile": PROVIDER_CONNECTION_PROFILE,
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "provider": "muse",
            "slotId": provider_slot_id(self.f.owner, "muse"),
        }
        self.args = dict(
            registry=self.f.registry,
            owner_subject=self.f.owner,
            vault_id=self.f.vault,
            provider="muse",
            now=1000,
        )
        self.review = {
            **self.context,
            "retiredCredentials": [],
            "tasks": [
                {
                    "taskId": "task_A",
                    "taskVersion": 3,
                    "executionEpoch": 2,
                    "grantFingerprint": "a" * 64,
                    "resourceIds": ["holdings_A"],
                },
                {
                    "taskId": "task_B",
                    "taskVersion": 1,
                    "executionEpoch": 1,
                    "grantFingerprint": "b" * 64,
                    "resourceIds": [],
                },
            ],
        }

    def payload(self, slot=None, review=None, action="activate", lease=None, **changes):
        lease = self.lease if lease is None else lease
        return {
            **self.context,
            "artifactType": "provider_connection_update",
            "action": action,
            "rootKeyId": self.f.root_id,
            "expectedSlotVersion": slot["slotVersion"] if slot else 0,
            "expectedSlotGeneration": slot["slotGeneration"] if slot else 0,
            "previousCredentialFingerprint": slot["lastCredential"]["credentialFingerprint"]
            if slot
            else None,
            "candidateCredentialFingerprint": lease["credentialFingerprint"]
            if action == "activate"
            else None,
            "reviewDigest": provider_review_digest(review or self.review)
            if action == "activate"
            else None,
            "setupIntentId": lease["setupIntentId"] if action == "activate" else None,
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "stableOperationId": "provider_slot_operation_00001",
            "registrySequence": self.args["registry"].registry_sequence,
            "checkpointDigest": self.args["registry"].checkpoint_digest,
            "keyEpoch": self.args["registry"].key_epoch,
            "issuedAt": 1000,
            **changes,
        }

    def activate(
        self,
        slot=None,
        review=None,
        legacy=(),
        payload=None,
        signed=None,
        lease=None,
        identity=None,
        **changes,
    ):
        review = self.review if review is None else review
        return prepare_provider_activation(
            signed or self.f.sign(payload or self.payload(slot, review, lease=lease)),
            current_slot=slot,
            review=review,
            legacy_credentials=legacy,
            candidate_lease=lease or self.lease,
            candidate_identity=identity or self.identity,
            audience=self.lease["audience"],
            **{**self.args, **changes},
        )

    def legacy(self, reference, **changes):
        return {
            **{k: self.context[k] for k in ("ownerSubject", "vaultId", "provider")},
            "reference": reference,
            **changes,
        }

    def fence(self, slot, lease=None, identity=None, **changes):
        return require_current_provider_credential(
            slot,
            lease or self.lease,
            identity=identity or self.identity,
            audience=self.lease["audience"],
            **{k: v for k, v in {**self.args, **changes}.items() if k != "registry"},
        )

    def renew(self):
        self.f.add_key("new_sig", "agent_sig", "new_agent", self.identity["connectionId"], epoch=2)
        self.f.add_key("new_enc", "agent_enc", "new_agent", self.identity["connectionId"], epoch=2)
        registry = self.f.verify(self.f.make_bundle())
        identity = {
            **self.identity,
            "agentId": "new_agent",
            "agentSigningKeyId": self.f.kid("new_sig"),
            "agentEncryptionKeyId": self.f.kid("new_enc"),
            "bindingFingerprint": "1" * 64,
        }
        payload = {
            **self.credential.payload,
            **{
                k: identity[k]
                for k in (
                    "agentId",
                    "agentSigningKeyId",
                    "agentEncryptionKeyId",
                    "bindingFingerprint",
                )
            },
            "generation": 2,
            "previousCredentialFingerprint": self.lease["credentialFingerprint"],
            "checkpointDigest": registry.checkpoint_digest,
        }
        lease = self.credential.approve(
            payload, identity=identity, current_lease=self.lease, registry=registry
        )
        self.args["registry"] = registry
        return lease, identity

    def test_schema_is_detached_closed_and_separate_from_old_runtime_contracts(self):
        schema = load_provider_connection_schema("ProviderConnectionReview")
        schema["$defs"].clear()
        self.assertTrue(load_provider_connection_schema("ProviderConnectionReview")["$defs"])
        for name in ("AgentCredentialLease", "Unknown"):
            with self.assertRaises(ContractError):
                load_provider_connection_schema(name)
        with self.assertRaises(ContractError):
            load_persistent_schema("ProviderConnectionSlot")
        for value in ({**self.review, "verified": True}, {**self.review, "profile": "P1"}):
            with self.assertRaises(ContractError):
                provider_review_digest(value)
        self.assertEqual(self.credential.approve()["generation"], 1)

    def test_unique_slot_is_owner_provider_scoped_and_vault_is_independently_fenced(self):
        slot = self.activate().slot
        self.assertEqual(slot["slotId"], provider_slot_id(self.f.owner, "muse"))
        for owner, provider in (("other_owner", "muse"), (self.f.owner, "chatgpt")):
            self.assertNotEqual(slot["slotId"], provider_slot_id(owner, provider))
        with self.assertRaises(ContractError):
            provider_slot_id(self.f.owner, "claude")
        for changes in (
            {"vault_id": "other_vault"},
            {"owner_subject": "other_owner"},
            {"provider": "chatgpt"},
        ):
            with self.assertRaises(ContractError):
                self.fence(slot, **changes)

    def test_initial_activation_supports_many_explicit_tasks_without_mutating_inputs(self):
        before = copy.deepcopy((self.review, self.lease, self.identity))
        plan = self.activate()
        self.assertEqual((plan.slot["slotVersion"], plan.slot["slotGeneration"]), (1, 1))
        self.assertEqual(plan.slot["currentCredential"], plan.slot["lastCredential"])
        self.assertEqual([t["taskId"] for t in plan.tasks], ["task_A", "task_B"])
        self.assertEqual(plan.retire, ())
        self.assertEqual(before, (self.review, self.lease, self.identity))
        plan.tasks[0]["resourceIds"].clear()
        self.assertEqual(self.review["tasks"][0]["resourceIds"], ["holdings_A"])
        self.assertEqual(self.fence(plan.slot), self.lease)

    def test_migration_requires_exact_review_and_never_unions_production_and_synthetic_scope(self):
        refs = [
            {
                "connectionId": name,
                "clientId": "muse_synthetic",
                "credentialGeneration": 3,
                "credentialFingerprint": digit * 64,
            }
            for name, digit in (("legacy_live", "1"), ("legacy_test", "2"))
        ]
        review = {**self.review, "retiredCredentials": refs, "tasks": []}
        old = {
            **self.context,
            "slotVersion": 2,
            "slotGeneration": 1,
            "currentCredential": refs[0],
            "lastCredential": refs[0],
        }
        payload = self.payload(old, review)
        plan = self.activate(old, review, [self.legacy(r) for r in refs], payload=payload)
        self.assertEqual(plan.tasks, ())
        self.assertEqual(plan.retire, tuple(refs))
        self.assertEqual(plan.slot["slotId"], old["slotId"])
        self.assertEqual(old["currentCredential"], refs[0])
        changed = {**review, "tasks": self.review["tasks"]}
        with self.assertRaises(ContractError):
            self.activate(old, changed, [self.legacy(r) for r in refs], payload=payload)
        for legacy in (
            [self.legacy(refs[0])],
            [self.legacy(refs[0]), self.legacy({**refs[1], "credentialGeneration": 4})],
        ):
            with self.assertRaises(ContractError):
                self.activate(old, review, legacy, payload=payload)

    def test_duplicate_tasks_resources_connections_and_unbounded_reviews_are_rejected(self):
        for review in (
            {**self.review, "tasks": [self.review["tasks"][0]] * 2},
            {**self.review, "tasks": list(reversed(self.review["tasks"]))},
            {**self.review, "tasks": [{**self.review["tasks"][0], "resourceIds": ["r", "r"]}]},
            {
                **self.review,
                "tasks": [{**self.review["tasks"][0], "resourceIds": [f"r{i}" for i in range(11)]}],
            },
            {**self.review, "tasks": self.review["tasks"] * 51},
        ):
            with self.assertRaises(ContractError):
                provider_review_digest(review)
        with self.assertRaises(ContractError):
            self.activate(
                legacy=[
                    self.legacy(
                        {
                            "connectionId": "same",
                            "clientId": "muse_synthetic",
                            "credentialGeneration": 1,
                            "credentialFingerprint": "1" * 64,
                        }
                    )
                ]
                * 2
            )

    def test_owner_control_checks_real_signature_role_current_checkpoint_and_freshness(self):
        payload = self.payload()
        for signer in ("A1_sig", "root"):
            with self.assertRaises(ContractError):
                self.activate(signed=self.f.sign(payload, signer))
        signed = self.f.sign(payload)
        signed["signature"] = "A" * len(signed["signature"])
        with self.assertRaises(ContractError):
            self.activate(signed=signed)
        for change in (
            {"registrySequence": 2},
            {"checkpointDigest": "0" * 64},
            {"issuedAt": 699},
            {"issuedAt": 1001},
            {"action": "disconnect"},
            {"candidateCredentialFingerprint": "0" * 64},
            {"setupIntentId": "other_setup_operation_001"},
            {"profile": self.lease["profile"]},
        ):
            with self.subTest(change=change), self.assertRaises(ContractError):
                self.activate(payload={**payload, **change})

    def test_wrong_owner_vault_provider_or_legacy_context_never_authorizes_a_switch(self):
        for change in (
            {"owner_subject": "other_owner"},
            {"vault_id": "other_vault"},
            {"provider": "chatgpt"},
        ):
            with self.assertRaises(ContractError):
                self.activate(**change)
        ref = {
            "connectionId": "old",
            "clientId": "muse_synthetic",
            "credentialGeneration": 1,
            "credentialFingerprint": "1" * 64,
        }
        review = {**self.review, "retiredCredentials": [ref]}
        for change in (
            {"ownerSubject": "other_owner"},
            {"vaultId": "other_vault"},
            {"provider": "chatgpt"},
        ):
            with self.assertRaises(ContractError):
                self.activate(review=review, legacy=[self.legacy(ref, **change)])

    def test_concurrent_first_connect_and_replacements_lose_the_slot_cas(self):
        first = self.activate()
        second_payload = self.payload(stableOperationId="provider_slot_operation_00002")
        second = self.activate(payload=second_payload)
        self.assertEqual((first.expected_slot_version, second.expected_slot_version), (0, 0))
        # A transactional consumer compares expected_slot_version again when it
        # commits a prepared plan. Revalidation against the committed row fails.
        for payload in (self.payload(), second_payload):
            with self.assertRaises(ContractError) as error:
                self.activate(first.slot, payload=payload)
            self.assertEqual(error.exception.code, "version_conflict")
        self.assertEqual(first.slot["slotVersion"], 1)

    def test_failed_preparation_keeps_current_lease_and_immutable_actor_history(self):
        old = self.activate().slot
        history = {
            "runId": "run_old",
            "connectionId": self.lease["connectionId"],
            "receipt": "immutable",
        }
        before = copy.deepcopy((old, history))
        with self.assertRaises(ContractError):
            self.activate(old, payload=self.payload(old, reviewDigest="0" * 64))
        self.assertEqual((old, history), before)
        self.assertEqual(self.fence(old), self.lease)

    def test_fresh_same_connection_keys_switch_once_and_old_credential_is_fenced(self):
        old = self.activate().slot
        lease, identity = self.renew()
        review = {**self.review, "retiredCredentials": [old["currentCredential"]]}
        plan = self.activate(
            old, review, [self.legacy(old["currentCredential"])], lease=lease, identity=identity
        )
        self.assertEqual(plan.slot["slotId"], old["slotId"])
        self.assertEqual((plan.slot["slotVersion"], plan.slot["slotGeneration"]), (2, 2))
        self.assertEqual(self.fence(plan.slot, lease, identity), lease)
        with self.assertRaises(ContractError):
            self.fence(plan.slot)
        self.assertEqual(self.fence(old), self.lease)
        for changes in ({"generation": 1}, {"previousCredentialFingerprint": "0" * 64}):
            with self.assertRaises(ContractError):
                self.activate(
                    old,
                    review,
                    [self.legacy(old["currentCredential"])],
                    lease={**lease, **changes},
                    identity=identity,
                )

    def test_disconnect_keeps_high_water_then_reconnect_reuses_slot_without_generation_reset(self):
        old = self.activate().slot
        payload = self.payload(old, action="disconnect")
        plan = prepare_provider_disconnect(self.f.sign(payload), current_slot=old, **self.args)
        disconnected = plan.slot
        self.assertIsNone(disconnected["currentCredential"])
        self.assertEqual(disconnected["lastCredential"], old["lastCredential"])
        self.assertEqual((disconnected["slotVersion"], disconnected["slotGeneration"]), (2, 1))
        with self.assertRaises(ContractError):
            self.fence(disconnected)
        with self.assertRaises(ContractError):
            self.activate(disconnected)
        lease, identity = self.renew()
        reconnect = self.activate(disconnected, lease=lease, identity=identity)
        self.assertEqual((reconnect.slot["slotVersion"], reconnect.slot["slotGeneration"]), (3, 2))
        self.assertEqual(reconnect.slot["slotId"], old["slotId"])
        self.assertEqual(reconnect.retire, ())
        with self.assertRaises(ContractError):
            prepare_provider_disconnect(
                self.f.sign(payload), current_slot=disconnected, **self.args
            )

    def test_unknown_commit_retry_returns_only_original_operation_and_cannot_reinstall_old_keys(
        self,
    ):
        signed = self.f.sign(self.payload())
        plan = self.activate(signed=signed)
        original = copy.deepcopy(plan.operation)
        lease, identity = self.renew()
        review = {**self.review, "retiredCredentials": [plan.slot["currentCredential"]]}
        later = self.activate(
            plan.slot,
            review,
            [self.legacy(plan.slot["currentCredential"])],
            lease=lease,
            identity=identity,
        )
        current_before_retry = copy.deepcopy(later.slot)
        args = {k: v for k, v in self.args.items() if k not in ("registry", "now")}
        args.update(
            stable_operation_id=self.payload()["stableOperationId"],
            fingerprint=signing_input_fingerprint(signed),
        )
        receipt = check_provider_operation_replay(original, **args)
        self.assertEqual(receipt, original)
        receipt["slotVersion"] = 99
        self.assertEqual(original["slotVersion"], 1)
        self.assertIsNone(check_provider_operation_replay(None, **args))
        with self.assertRaises(ContractError) as error:
            check_provider_operation_replay(original, **{**args, "fingerprint": "0" * 64})
        self.assertEqual(error.exception.code, "idempotency_conflict")
        for changes in (
            {"owner_subject": "other_owner"},
            {"vault_id": "other_vault"},
            {"provider": "chatgpt"},
        ):
            with self.assertRaises(ContractError):
                check_provider_operation_replay(original, **{**args, **changes})
        self.assertEqual(original, plan.operation)
        self.assertEqual(later.slot, current_before_retry)
        self.assertEqual(self.fence(later.slot, lease, identity), lease)
        with self.assertRaises(ContractError):
            self.fence(later.slot)

    def test_candidate_expiry_key_deadline_and_slot_counter_bounds_remain_enforced(self):
        with self.assertRaises(ContractError):
            self.activate(now=4900, payload=self.payload(issuedAt=4900))
        with self.assertRaises(ContractError):
            self.activate(lease={**self.lease, "expiresAt": 5001})
        slot = self.activate().slot
        for changed in (
            {**slot, "slotVersion": 0},
            {**slot, "slotGeneration": 2},
            {**slot, "currentCredential": {**slot["currentCredential"], "credentialGeneration": 2}},
        ):
            with self.assertRaises(ContractError):
                validate_provider_slot(
                    changed, owner_subject=self.f.owner, vault_id=self.f.vault, provider="muse"
                )
        large = {**slot, "slotVersion": 9007199254740991}
        with self.assertRaises(ContractError):
            prepare_provider_disconnect(
                self.f.sign(self.payload(large, action="disconnect")),
                current_slot=large,
                **self.args,
            )

    def test_schema_and_review_budget_reject_private_unbounded_and_malformed_values(self):
        for value in (
            None,
            [],
            {**self.review, "privateJwk": {}},
            {**self.review, "slotId": "x" * 70000},
        ):
            with self.assertRaises(ContractError):
                validate_provider_connection_schema("ProviderConnectionReview", value)


if __name__ == "__main__":
    unittest.main()
