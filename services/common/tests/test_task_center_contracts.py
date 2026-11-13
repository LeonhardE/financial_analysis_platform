"""Owner signatures, actor-isolated runs and lifecycle/calendar boundaries; no I/O."""

import copy
import unittest
from datetime import UTC, datetime

import test_provider_connections as providers

from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    persistent_run_id,
)
from folioview_shared.encrypted.provider_connections import provider_slot_id
from folioview_shared.encrypted.task_center import (
    TASK_CENTER_PROFILE,
    TRASH_RETENTION_SECONDS,
    TrustedScheduleSource,
    aggregate_progress,
    assignment_id,
    assignment_trigger_id,
    bind_task_run,
    load_task_center_schema,
    owner_history_visible,
    plan_assignment,
    plan_task_lifecycle,
    plan_task_rules,
    require_assignment_current,
    require_run_current,
    scheduled_occurrence,
    validate_definition,
    validate_run_binding,
    validate_schedule,
    validate_task_center_schema,
    verify_manual_intent,
)


class TaskCenterContractTests(unittest.TestCase):
    def setUp(self):
        fixture = providers.ProviderConnectionTests()
        fixture.setUp()
        self.f = fixture.f
        self.identity = fixture.identity
        self.slot = fixture.activate().slot
        self.context = dict(
            contractVersion=CONTRACT_VERSION,
            profile=TASK_CENTER_PROFILE,
            ownerSubject=self.f.owner,
            vaultId=self.f.vault,
            taskId="task_A",
        )
        self.args = dict(
            registry=self.f.registry,
            owner_subject=self.f.owner,
            vault_id=self.f.vault,
            task_id="task_A",
            now=1000,
        )

    def control(
        self, action="set_rules", definition=None, assignment=None, signer="device_sig", **changes
    ):
        payload = {
            **self.context,
            "artifactType": "task_center_control",
            "action": action,
            "rootKeyId": self.f.root_id,
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "registrySequence": self.args["registry"].registry_sequence,
            "checkpointDigest": self.args["registry"].checkpoint_digest,
            "keyEpoch": self.args["registry"].key_epoch,
            "issuedAt": self.args["now"],
            "stableOperationId": "task_center_operation_00001",
            "expectedDefinitionVersion": definition["definitionVersion"] if definition else 0,
            "expectedAssignmentVersion": None,
            "assignmentId": None,
            "schedule": None,
            "assignment": None,
            "intent": None,
        }
        if action in {"set_assignment", "remove_assignment"}:
            payload.update(
                expectedAssignmentVersion=assignment["assignmentVersion"] if assignment else 0,
                assignmentId=assignment_id(
                    self.f.owner, self.f.vault, "task_A", self.slot["slotId"]
                ),
            )
        if action == "set_assignment":
            payload["assignment"] = {
                "slotId": self.slot["slotId"],
                "provider": self.slot["provider"],
                "slotGeneration": self.slot["slotGeneration"],
                "credential": self.slot["currentCredential"],
                "agentId": self.identity["agentId"],
                "authorityFingerprint": "a" * 64,
            }
        payload.update(changes)
        return self.f.sign(payload, signer)

    def definition(self, schedule=None, old=None):
        return plan_task_rules(
            self.control(definition=old, schedule=schedule),
            current_definition=old,
            task_version=3,
            execution_epoch=2,
            **self.args,
        )

    def assign(self, definition, old=None):
        return plan_assignment(
            self.control("set_assignment", definition, old),
            current_definition=definition,
            current_assignment=old,
            current_slot=self.slot,
            current_identity=self.identity,
            **self.args,
        )

    def schedule(self, **changes):
        return {
            "frequency": "daily",
            "days": [],
            "localTime": "08:30",
            "timeZone": "America/Toronto",
            "graceMinutes": 10,
            "effectiveFrom": 1000,
            "dstGap": "skip",
            "dstFold": "first",
            **changes,
        }

    def manifest(
        self, assignment, base="synthetic_task_trigger_00001", kind="legacy_unknown", now=1000
    ):
        trigger = assignment_trigger_id(assignment, base, kind=kind)
        return {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "purpose": "analysis",
            **{k: self.identity[k] for k in BINDING_FIELDS},
            "taskId": "task_A",
            "taskVersion": 3,
            "executionEpoch": 2,
            "authorityId": "authority_A",
            "authorityVersion": 1,
            "resultPolicy": "owner_inbox",
            "runId": persistent_run_id(
                owner_subject=self.f.owner,
                vault_id=self.f.vault,
                task_id="task_A",
                trigger_id=trigger,
            ),
            "stableOperationId": "task_center_run_operation_00001",
            "triggerId": trigger,
            "taskPublicationId": "task_center_publication_00001",
            "taskPublicationFingerprint": "a" * 64,
            "createdAt": now,
            "expiresAt": now + 7200,
            "inputs": [
                {
                    "publicationId": "resource_publication_operation_001",
                    "publicationFingerprint": "c" * 64,
                    "ref": self.f.resource,
                    "sourceEpoch": 1,
                    "sourceRevision": 1,
                    "permissionId": "permission_A",
                    "permissionEpoch": 1,
                    "objectId": "resource_A",
                }
            ],
        }

    def test_additive_closed_detached_schemas_reject_private_or_unknown_fields(self):
        schema = load_task_center_schema("CenterTaskDefinition")
        schema["$defs"].clear()
        self.assertTrue(load_task_center_schema("CenterTaskDefinition")["$defs"])
        definition = self.definition()
        for changed in (
            {**definition, "title": "private title"},
            {**definition, "profile": "P1"},
            {**definition, "executors": []},
        ):
            with self.assertRaises(ContractError):
                validate_definition(changed)
        with self.assertRaises(ContractError):
            load_task_center_schema("PersistentTaskContext")
        with self.assertRaises(ContractError):
            validate_task_center_schema("CenterProgressSnapshot", {"private": "x" * 70000})

    def test_definition_has_zero_executors_and_manual_only_without_fabricated_schedule(self):
        definition = self.definition()
        self.assertIsNone(definition["schedule"])
        self.assertEqual(definition["ruleVersion"], 1)
        self.assertNotIn("connectionId", definition)
        self.assertIsNone(scheduled_occurrence(definition, local_date="2026-11-13", now=1000))

    def test_real_owner_signature_current_checkpoint_scope_freshness_and_cas_are_required(self):
        for change in (
            {"ownerSubject": "other_owner"},
            {"vaultId": "other_vault"},
            {"rootKeyId": "x" * 43},
            {"checkpointDigest": "0" * 64},
            {"issuedAt": 699},
            {"expectedDefinitionVersion": 1},
            {"assignmentId": "unexpected"},
        ):
            with self.subTest(change=change), self.assertRaises(ContractError):
                plan_task_rules(
                    self.control(**change),
                    current_definition=None,
                    task_version=3,
                    execution_epoch=2,
                    **self.args,
                )
        for signer in ("A1_sig", "root"):
            with self.assertRaises(ContractError):
                plan_task_rules(
                    self.control(signer=signer),
                    current_definition=None,
                    task_version=3,
                    execution_epoch=2,
                    **self.args,
                )

    def test_daily_weekly_user_time_days_zone_and_rule_effective_boundaries(self):
        schedule = self.schedule(frequency="weekly", days=[1, 3, 5], localTime="13:47")
        definition = self.definition(schedule)
        friday = int(datetime(2026, 11, 13, 18, 47, tzinfo=UTC).timestamp())
        slot = scheduled_occurrence(definition, local_date="2026-11-13", now=friday)
        self.assertEqual(slot["scheduledAt"], friday)
        self.assertIsNone(
            scheduled_occurrence(definition, local_date="2026-11-14", now=friday + 86400)
        )
        self.assertIsNone(scheduled_occurrence(definition, local_date="2026-11-13", now=friday - 1))
        self.assertIsNone(
            scheduled_occurrence(definition, local_date="2026-11-13", now=friday + 660)
        )
        future = {**definition, "schedule": {**schedule, "effectiveFrom": friday + 1}}
        self.assertIsNone(scheduled_occurrence(future, local_date="2026-11-13", now=friday))
        for changed in (
            self.schedule(timeZone="not/a/zone"),
            self.schedule(frequency="weekly", days=[]),
            self.schedule(days=[1]),
            self.schedule(frequency="weekly", days=[3, 1]),
            self.schedule(localTime="25:30"),
        ):
            with self.assertRaises(ContractError):
                validate_schedule(changed)

    def test_dst_gap_skips_and_repeated_time_uses_first_fold_and_one_slot(self):
        gap = self.definition(self.schedule(localTime="02:30"))
        now = int(datetime(2026, 3, 8, 7, 30, tzinfo=UTC).timestamp())
        self.assertIsNone(scheduled_occurrence(gap, local_date="2026-03-08", now=now))
        fold = self.definition(self.schedule(localTime="01:30", graceMinutes=120))
        first = int(datetime(2026, 11, 1, 5, 30, tzinfo=UTC).timestamp())
        a = scheduled_occurrence(fold, local_date="2026-11-01", now=first)
        b = scheduled_occurrence(fold, local_date="2026-11-01", now=first + 3600)
        self.assertEqual(a, b)
        self.assertEqual(a["scheduledAt"], first)

    def test_assignment_is_current_slot_bound_and_other_provider_has_independent_namespace(self):
        definition = self.definition()
        muse = self.assign(definition)
        before = copy.deepcopy(muse)
        self.slot = {
            **self.slot,
            "provider": "chatgpt",
            "slotId": provider_slot_id(self.f.owner, "chatgpt"),
            "currentCredential": {
                **self.slot["currentCredential"],
                "connectionId": "connection_A2",
                "clientId": "chatgpt_synthetic",
                "credentialFingerprint": "b" * 64,
            },
        }
        self.slot["lastCredential"] = self.slot["currentCredential"]
        self.identity = {
            **self.identity,
            "connectionId": "connection_A2",
            "clientId": "chatgpt_synthetic",
            "agentId": "A2",
        }
        chatgpt = self.assign(definition)
        self.assertNotEqual(muse["assignmentId"], chatgpt["assignmentId"])
        base = "same_native_schedule_slot_00001"
        self.assertNotEqual(assignment_trigger_id(muse, base), assignment_trigger_id(chatgpt, base))
        self.assertEqual(before, muse)
        with self.assertRaises(ContractError):
            require_assignment_current(definition, muse, self.slot, authority_fingerprint="a" * 64)

    def test_removed_assignment_does_not_delete_history_or_other_task_and_cannot_reset_generation(
        self,
    ):
        definition = self.definition()
        assignment = self.assign(definition)
        old = copy.deepcopy(assignment)
        removed = plan_assignment(
            self.control("remove_assignment", definition, assignment),
            current_definition=definition,
            current_assignment=assignment,
            current_slot=None,
            current_identity=None,
            remove=True,
            **self.args,
        )
        self.assertEqual(removed["assignmentVersion"], 2)
        self.assertEqual(old, assignment)
        self.assertTrue(owner_history_visible(definition))
        with self.assertRaises(ContractError):
            require_assignment_current(
                definition, removed, self.slot, authority_fingerprint="a" * 64
            )
        restored = self.assign(definition, removed)
        self.assertEqual(restored["assignmentVersion"], 3)

    def test_candidate_scope_and_current_authority_rule_versions_are_all_fences(self):
        definition = self.definition()
        assignment = self.assign(definition)
        with self.assertRaises(ContractError):
            require_assignment_current(
                definition, assignment, self.slot, authority_fingerprint="b" * 64
            )
        next_definition = self.definition(old=definition)
        with self.assertRaises(ContractError):
            require_assignment_current(
                next_definition, assignment, self.slot, authority_fingerprint="a" * 64
            )
        changed_slot = {**self.slot, "slotVersion": 2, "slotGeneration": 2}
        with self.assertRaises(ContractError):
            require_assignment_current(
                definition, assignment, changed_slot, authority_fingerprint="a" * 64
            )
        with self.assertRaises(ContractError):
            plan_assignment(
                self.control("set_assignment", definition, assignment),
                current_definition=next_definition,
                current_assignment=assignment,
                current_slot=self.slot,
                current_identity=self.identity,
                **self.args,
            )
        refreshed = self.assign(next_definition, assignment)
        self.assertEqual(refreshed["assignmentVersion"], 2)
        self.assertEqual(refreshed["ruleVersion"], 2)

    def test_run_binding_keeps_old_manifest_wire_but_freezes_assignment_actor_and_inputs(self):
        definition = self.definition()
        assignment = self.assign(definition)
        manifest = self.manifest(assignment)
        binding = bind_task_run(
            definition,
            assignment,
            self.slot,
            manifest,
            base_trigger_id="synthetic_task_trigger_00001",
        )
        self.assertEqual(binding["trigger"]["kind"], "legacy_unknown")
        self.assertEqual(validate_run_binding(binding, manifest), binding)
        self.assertEqual(
            require_run_current(
                binding, definition, assignment, self.slot, authority_fingerprint="a" * 64
            ),
            binding,
        )
        for changed in (
            {**binding, "inputsDigest": "0" * 64},
            {**binding, "manifestFingerprint": "0" * 64},
        ):
            with self.assertRaises(ContractError):
                validate_run_binding(changed, manifest)
        with self.assertRaises(ContractError):
            require_run_current(
                binding,
                self.definition(old=definition),
                assignment,
                self.slot,
                authority_fingerprint="a" * 64,
            )

    def test_manual_intent_is_owner_signed_targeted_bounded_and_independent_of_schedule(self):
        definition = self.definition(self.schedule())
        assignment = self.assign(definition)
        intent = {
            "expiresAt": 1500,
            "assignments": [{"assignmentId": assignment["assignmentId"], "assignmentVersion": 1}],
        }
        signed = self.control("manual_intent", definition, intent=intent)
        verified = verify_manual_intent(
            signed, current_definition=definition, assignments=[assignment], **self.args
        )
        base = verified.payload["stableOperationId"]
        manifest = self.manifest(assignment, base, "manual")
        binding = bind_task_run(
            definition,
            assignment,
            self.slot,
            manifest,
            base_trigger_id=base,
            kind="manual",
            manual_intent=verified,
        )
        self.assertEqual(binding["trigger"]["sourceFingerprint"], verified.fingerprint)
        self.assertIsNone(binding["trigger"]["scheduledAt"])
        with self.assertRaises(TypeError):
            verified.payload["intent"]["assignments"][0]["assignmentVersion"] = 99
        for expires in (1000, 1601):
            with self.assertRaises(ContractError):
                verify_manual_intent(
                    self.control(
                        "manual_intent", definition, intent={**intent, "expiresAt": expires}
                    ),
                    current_definition=definition,
                    assignments=[assignment],
                    **self.args,
                )
        with self.assertRaises(ContractError):
            bind_task_run(
                definition,
                assignment,
                self.slot,
                manifest,
                base_trigger_id=base,
                kind="manual",
                manual_intent={"verified": True},
            )
        self.assertEqual(definition["schedule"], self.schedule())

    def test_unknown_agent_claim_cannot_become_scheduled_or_manual_provenance(self):
        definition = self.definition()
        assignment = self.assign(definition)
        for kind in ("manual", "scheduled"):
            manifest = self.manifest(assignment, kind=kind)
            with self.assertRaises(ContractError):
                bind_task_run(
                    definition,
                    assignment,
                    self.slot,
                    manifest,
                    base_trigger_id="synthetic_task_trigger_00001",
                    kind=kind,
                )

    def test_scheduled_admission_requires_verified_source_and_handles_midnight_grace(self):
        definition = self.definition(
            self.schedule(localTime="23:30", timeZone="Asia/Shanghai", graceMinutes=60)
        )
        assignment = self.assign(definition)
        at = int(datetime(2026, 11, 13, 15, 30, tzinfo=UTC).timestamp())
        occurrence = scheduled_occurrence(definition, local_date="2026-11-13", now=at + 2700)
        base = occurrence["baseTriggerId"]
        manifest = self.manifest(assignment, base, "scheduled", now=at + 2700)
        for source in (None, {"verified": True}):
            with self.assertRaises(ContractError):
                bind_task_run(
                    definition,
                    assignment,
                    self.slot,
                    manifest,
                    base_trigger_id=base,
                    kind="scheduled",
                    scheduled_source=source,
                )
        # Synthetic trusted-adapter context only; no real provider is attested.
        source = TrustedScheduleSource(
            "synthetic_source_event", "d" * 64, assignment["assignmentId"], 1, base
        )
        binding = bind_task_run(
            definition,
            assignment,
            self.slot,
            manifest,
            base_trigger_id=base,
            kind="scheduled",
            scheduled_source=source,
        )
        self.assertEqual(binding["trigger"]["scheduledAt"], at)
        self.assertEqual(binding["trigger"]["sourceFingerprint"], "d" * 64)

    def test_control_only_device_cannot_add_executor_or_create_manual_intent(self):
        definition = self.definition()
        assignment = self.assign(definition)
        self.f.certificates["device_sig"]["capabilities"].remove("task_grant")
        self.args["registry"] = self.f.verify(self.f.make_bundle())
        with self.assertRaises(ContractError):
            self.assign(definition)
        intent = {
            "expiresAt": 1500,
            "assignments": [{"assignmentId": assignment["assignmentId"], "assignmentVersion": 1}],
        }
        with self.assertRaises(ContractError):
            verify_manual_intent(
                self.control("manual_intent", definition, intent=intent),
                current_definition=definition,
                assignments=[assignment],
                **self.args,
            )

    def test_trash_restore_cascades_parent_visibility_without_restarting_old_assignments(self):
        definition = self.definition()
        assignment = self.assign(definition)
        old = copy.deepcopy((definition, assignment))
        gone = plan_task_lifecycle(
            self.control("trash", definition),
            current_definition=definition,
            action="trash",
            **self.args,
        )
        self.assertFalse(owner_history_visible(gone))
        self.assertEqual(gone["purgeAfter"], 1000 + TRASH_RETENTION_SECONDS)
        recovered = plan_task_lifecycle(
            self.control("restore", gone), current_definition=gone, action="restore", **self.args
        )
        self.assertTrue(owner_history_visible(recovered))
        self.assertEqual(recovered["lifecycleEpoch"], 3)
        self.assertEqual(old, (definition, assignment))
        with self.assertRaises(ContractError):
            require_assignment_current(
                recovered, assignment, self.slot, authority_fingerprint="a" * 64
            )

    def test_purge_boundary_keeps_tombstone_and_never_allows_restoring_or_recreating_it(self):
        for cert in self.f.certificates.values():
            cert["expiresAt"] = TRASH_RETENTION_SECONDS + 5000
        self.args["registry"] = self.f.verify(self.f.make_bundle())
        definition = self.definition()
        gone = plan_task_lifecycle(
            self.control("trash", definition),
            current_definition=definition,
            action="trash",
            **self.args,
        )
        self.args["now"] = gone["purgeAfter"] - 1
        with self.assertRaises(ContractError):
            plan_task_lifecycle(
                self.control("purge", gone), current_definition=gone, action="purge", **self.args
            )
        self.args["now"] += 1
        tombstone = plan_task_lifecycle(
            self.control("purge", gone), current_definition=gone, action="purge", **self.args
        )
        self.assertEqual(tombstone["status"], "purged")
        self.assertFalse(owner_history_visible(tombstone))
        self.assertEqual(tombstone["lifecycleEpoch"], 3)
        with self.assertRaises(ContractError):
            plan_task_lifecycle(
                self.control("restore", tombstone),
                current_definition=tombstone,
                action="restore",
                **self.args,
            )
        with self.assertRaises(ContractError):
            self.definition(old=tombstone)

    def test_progress_is_recoverable_and_does_not_count_report_as_native_cycle_success(self):
        snapshot = {
            **self.context,
            "requestId": "stable_manual_request_00001",
            "requestedAt": 1000,
            "executors": [],
        }
        self.assertEqual(aggregate_progress(snapshot)["state"], "idle")

        def row(ident, stage, result=None):
            return {
                "assignmentId": ident,
                "assignmentVersion": 1,
                "runId": "run_" + ident,
                "resultId": result,
                "stage": stage,
            }

        snapshot["executors"] = [
            row("muse", "result_received", "report_1"),
            row("chatgpt", "failed"),
        ]
        value = aggregate_progress(snapshot)
        self.assertEqual(value["state"], "partial_failure")
        self.assertEqual(value["counts"]["result_received"], 1)
        snapshot["executors"] = [row("muse", "awaiting_confirmation")]
        self.assertEqual(aggregate_progress(snapshot)["state"], "awaiting_confirmation")
        self.assertEqual(snapshot["requestId"], "stable_manual_request_00001")
        snapshot["executors"] = [row("muse", "result_received")]
        with self.assertRaises(ContractError):
            aggregate_progress(snapshot)
