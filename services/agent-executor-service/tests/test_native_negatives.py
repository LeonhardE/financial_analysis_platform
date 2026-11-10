"""Root scope, frozen versions and lost-outcome negatives for the native workflow."""

from unittest.mock import patch

from fixtures import ACCESS
from native_fixtures import RPUB, NativeFixture

from app.contracts import Stopped, clone
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.persistent_content import BINDING_FIELDS
from folioview_shared.encrypted.resource_consents import (
    RESOURCE_CONSENT_PROFILE,
    resource_consent_digest,
    revoke_resource_consent,
)


class NativeNegativeTests(NativeFixture):
    def revoke_resource(self):
        f = self.crypto
        b = self.config.binding
        p = {
            **{k: b[k] for k in BINDING_FIELDS},
            "contractVersion": CONTRACT_VERSION,
            "profile": RESOURCE_CONSENT_PROFILE,
            "artifactType": "persistent_resource_revocation",
            "consentId": self.consent["consentId"],
            "purpose": "analysis",
            "authorKeyId": f.root_id,
            "stableOperationId": "synthetic_native_resource_revoke_01",
            "expectedVersion": self.consent["version"],
            "expectedConsentDigest": resource_consent_digest(self.consent),
            "issuedAt": self.now,
            "registrySequence": f.registry.registry_sequence,
            "checkpointDigest": f.registry.checkpoint_digest,
            "keyEpoch": f.registry.key_epoch,
            "targets": [{"permissionId": "permission_A", "expectedPermissionEpoch": 1}],
        }
        signed = f.sign(p, "root")
        prior = resource_consent_digest(self.consent)
        self.consent = revoke_resource_consent(
            signed,
            current_consent=self.consent,
            current_identity=f.identity,
            registry=f.registry,
            root_jwk=f.root_public,
            owner_subject=f.owner,
            vault_id=f.vault,
            connection_id=b["connectionId"],
            client_id=b["clientId"],
            consent_id=p["consentId"],
            now=self.now,
        )
        self.consent_receipts[p["stableOperationId"]] = {
            "contractVersion": CONTRACT_VERSION,
            "profile": RESOURCE_CONSENT_PROFILE,
            "operationId": p["stableOperationId"],
            "fingerprint": signing_input_fingerprint(signed),
            "priorDigest": prior,
            "consent": self.consent,
            "command": signed,
            "sourceStates": [],
        }

    def test_new_source_version_reuses_scope_but_frozen_run_keeps_old_ciphertext(self):
        old = self.read()
        c = clone(self.resource_context)
        c.update(sourceRevision=2, stableOperationId=RPUB + "2", revision=2, expectedRevision=1)
        private = clone(self.resource_private)
        private["revision"] = 2
        private["payload"]["data"]["accounts"][0]["balances"][0]["cashBalance"] = "200"
        self.resource_context = c
        self.resource_private = private
        self.resource_carrier = self.crypto.seal(c, private)
        self.wire.source_revision = 2
        frozen = self.read(RPUB)
        self.assertEqual(frozen["sourceVersion"], 1)
        self.assertEqual(
            frozen["data"]["data"]["accounts"][0]["balances"][0]["cashBalance"], "100.000000000001"
        )
        second = self.read(trigger="synthetic_native_occurrence_0002")
        latest = self.read(RPUB + "2", trigger="synthetic_native_occurrence_0002")
        self.assertNotEqual(second["runId"], old["runId"])
        self.assertEqual(latest["sourceVersion"], 2)
        self.assertEqual(latest["data"]["data"]["accounts"][0]["balances"][0]["cashBalance"], "200")
        self.assertEqual(len(self.consent_receipts), 1)

    def test_unknown_begin_response_retries_same_original_intent(self):
        self.wire.drop_begin = True
        with self.assertRaises(Stopped):
            self.read()
        self.assertEqual(len(self.wire.runs), 1)
        manifest = next(iter(self.wire.runs.values()))["manifest"]
        self.wire.drop_begin = False
        result = self.read()
        self.assertEqual(result["runId"], manifest["runId"])
        self.assertEqual(len(self.wire.runs), 1)

    def test_wrong_account_extra_destinations_and_unassigned_publication_are_rejected(self):
        for name, args in [
            ("executor_profile", {}),
            (
                "executor_input",
                {
                    "taskId": "task_A1",
                    "triggerId": "synthetic_native_occurrence_0001",
                    "publicationId": None,
                },
            ),
        ]:
            with self.assertRaises(Stopped):
                self.engine.execute(name, args, "other_account")
        with self.assertRaises(Stopped):
            self.engine.execute("executor_profile", {"issuer": "https://attacker.example"}, ACCESS)
        self.read()
        with self.assertRaises(Stopped):
            self.read("synthetic_unassigned_publication_0001")
        self.assertEqual(self.wire.submissions, [])

    def test_revocation_during_input_io_prevents_any_new_plaintext(self):
        self.read()

        def revoke_once():
            self.wire.after_input = None
            self.revoke_resource()

        self.wire.after_input = revoke_once
        with patch("app.native.open_persistent_content") as decrypt:
            with self.assertRaises(Stopped):
                self.read(RPUB)
            decrypt.assert_not_called()

    def test_root_policy_revocation_during_input_io_prevents_decryption(self):
        self.read()
        self.wire.after_input = lambda: setattr(self.authority, "revoked", True)
        with patch("app.native.open_persistent_content") as decrypt:
            with self.assertRaises(Stopped):
                self.read(RPUB)
            decrypt.assert_not_called()

    def test_manifest_and_ciphertext_tampering_cannot_change_frozen_expectations(self):
        self.read()
        self.wire.change_manifest = lambda r: {
            **r,
            "manifest": {**r["manifest"], "taskVersion": 99},
        }
        with self.assertRaises(Stopped):
            self.read(RPUB)
        self.wire.change_manifest = None
        run = next(iter(self.wire.runs))
        packet = self.wire.inputs[(run, RPUB)]
        signature = packet["proof"]["signature"]
        packet["proof"]["signature"] = ("A" if signature[0] != "A" else "B") + signature[1:]
        with self.assertRaises(Stopped):
            self.read(RPUB)

    def test_registry_rollback_is_fenced_by_latest_policy_sealed_state_after_restart(self):
        self.read()
        old_bundle = self.crypto.bundle
        old_registry = self.crypto.registry
        next_bundle = self.crypto.make_bundle(previous=old_registry, issued_at=self.now)
        self.crypto.registry = self.crypto.verify(next_bundle, previous=old_registry, now=self.now)
        self.registry_history.append(next_bundle)
        self.engine.execute("executor_profile", {}, ACCESS)
        self.assertEqual(self.runtime.snapshot_state(ACCESS)["hubPins"]["registrySequence"], 2)
        self.registry_history = [old_bundle]
        self.crypto.registry = old_registry
        runtime = self.new_runtime()
        runtime.restore()
        engine = self.new_engine(runtime)
        with self.assertRaises(Stopped):
            engine.execute("executor_profile", {}, ACCESS)

    def test_forged_consent_aggregate_without_original_root_control_chain_fails(self):
        self.read()
        self.consent = clone(self.consent)
        self.consent["permissions"][0]["fromRevision"] = 99
        with self.assertRaises(Stopped):
            self.read(RPUB)

    def test_wrong_owner_recipient_rotation_cannot_silently_expand_report_destination(self):
        run = self.read()["runId"]
        certificate = self.crypto.add_key("extra_device", "device_enc", "synthetic_new_device")
        certificate.update(notBefore=self.now - 1, expiresAt=self.now + 3600)
        next_bundle = self.crypto.make_bundle(previous=self.crypto.registry, issued_at=self.now)
        self.crypto.registry = self.crypto.verify(
            next_bundle, previous=self.crypto.registry, now=self.now
        )
        self.registry_history.append(next_bundle)
        with self.assertRaises(Stopped):
            self.engine.execute("executor_report", {"runId": run, "report": self.report}, ACCESS)
        self.assertEqual(self.wire.submissions, [])

    def test_expired_frozen_run_does_not_generate_new_report(self):
        run = self.read()["runId"]
        self.now += 7201
        with self.assertRaises(Stopped):
            self.engine.execute("executor_report", {"runId": run, "report": self.report}, ACCESS)
        self.assertEqual(self.wire.submissions, [])

    def test_report_shape_unsafe_markup_wrong_sections_and_destination_are_closed(self):
        run = self.read()["runId"]
        variants = [
            {**self.report, "recipient": "attacker"},
            {**self.report, "sections": [{"sectionId": "other", "markdown": "wrong section"}]},
            {
                **self.report,
                "sections": [{"sectionId": "risks", "markdown": "<script>unsafe</script>"}],
            },
        ]
        for report in variants:
            with self.assertRaises(Stopped):
                self.engine.execute("executor_report", {"runId": run, "report": report}, ACCESS)
        self.assertEqual(self.wire.submissions, [])

    def test_task_input_policy_rejects_stale_partial_and_unknown_asof_resources(self):
        from datetime import UTC, datetime

        self.task_private["payload"]["inputPolicy"]["allowPartial"] = False
        self.task_carrier = self.crypto.seal(self.task_context, self.task_private)
        variants = [
            {
                "fetchedAt": datetime.fromtimestamp(self.now - 86401, UTC)
                .isoformat()
                .replace("+00:00", "Z")
            },
            {"sourceAsOf": None},
            {"coverage": {"state": "partial", "issues": []}},
        ]
        for index, changes in enumerate(variants):
            private = clone(self.resource_private)
            private["payload"].update(changes)
            self.resource_carrier = self.crypto.seal(self.resource_context, private)
            trigger = f"synthetic_input_policy_occurrence_{index:04d}"
            with self.assertRaises(Stopped):
                self.read(RPUB, trigger=trigger)
