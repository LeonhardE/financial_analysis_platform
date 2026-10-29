"""Encrypted task rules, state transitions and privacy over real synthetic JOSE."""

import copy
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fixtures import BOOT, OTHER_UID, SOURCE, UID, VaultFixture
from test_encrypted_envelope import EnvelopeFixture
from test_encrypted_schema import wrapper

from app.fences import FenceService
from app.store import SQLiteHubStore, StoreUnavailable, document_path
from app.tasks import TaskService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import (
    decrypt_jwe,
    encrypt_jwe,
    sign_jws,
    signing_input_fingerprint,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import (
    b64url_decode,
    b64url_encode,
    canonical_json,
    strict_json_loads,
)
from folioview_shared.encrypted.schema import validate_schema
from folioview_shared.identity import owner_key

TASK = "synthetic_private_task"
OP = "synthetic_task_create_operation_0001"
CANARY = "synthetic-task-private-canary"


class TaskFixture(VaultFixture):
    context = EnvelopeFixture.context
    carrier = EnvelopeFixture.carrier

    def body(
        self,
        *,
        task=TASK,
        version=1,
        operation=OP,
        resources=(),
        action=None,
        epoch=None,
        author="device_sig",
        private=None,
    ):
        context = self.context("task")
        context.update(
            objectId=task,
            revision=version,
            expectedRevision=version - 1,
            stableOperationId=operation,
            operationType="transition_task"
            if action
            else "create_task"
            if version == 1
            else "update_task",
            resourceBindings=copy.deepcopy(list(resources)),
            authorSigningKeyId=self.kid(author),
        )
        context["binding"].update(taskId=task, taskVersion=version)
        context["recipients"] = sorted(
            [
                {
                    key: cert[key]
                    for key in ("keyId", "role", "principalId", "connectionId", "keyEpoch")
                }
                for key_id in self.registry.active_key_ids
                if (cert := self.registry.cert(key_id, now=1000))["role"]
                in {"device_enc", "recovery_enc"}
            ],
            key=lambda row: row["keyId"],
        )
        plain = wrapper(context)
        plain["payload"].update(name=CANARY + "-name", goal=CANARY + "-goal")
        plain["payload"]["outputSpec"]["label"] = CANARY + "-output"
        if private is not None:
            plain["payload"].update(private)
        recipients = {
            row["keyId"]: next(
                cert["publicJwk"]
                for cert in self.certificates.values()
                if cert["keyId"] == row["keyId"]
            )
            for row in context["recipients"]
        }
        encrypted = encrypt_jwe(plain, recipients, context=context)
        signed = sign_jws(
            {"context": context, "jwe": encrypted}, self.keys[author], typ="fv-object+jws"
        )
        carrier = {"contractVersion": CONTRACT_VERSION, "signedObject": signed}
        body = {
            "contractVersion": CONTRACT_VERSION,
            "expectedVersion": version - 1,
            "resourceBindings": copy.deepcopy(list(resources)),
            "envelope": carrier,
        }
        if version == 1:
            body["taskId"] = task
        if action:
            payload = self.base("task_transition_intent") | {
                "stableOperationId": operation,
                "taskId": task,
                "action": action,
                "expectedVersion": version - 1,
                "nextTaskVersion": version,
                "nextExecutionEpoch": epoch,
                "nextEnvelopeFingerprint": signing_input_fingerprint(signed),
                "registrySequence": self.registry.registry_sequence,
                "checkpointDigest": self.registry.checkpoint_digest,
                "keyEpoch": self.registry.key_epoch,
            }
            body["transitionIntent"] = self.sign(payload, author)
        return body


class Sources:
    def __init__(self):
        self.bindings, self.calls, self.failed = [], [], False

    def read(self, uid):
        self.calls.append(uid)
        if self.failed:
            raise ContractError("source_unavailable")
        return {
            "groups": [
                {
                    "items": [
                        {
                            "ref": row["ref"],
                            "sourceEpoch": row["sourceEpoch"],
                            "state": "active" if row["ref"]["kind"] == "holdings" else "empty",
                        }
                        for row in self.bindings
                    ]
                }
            ]
        }


class TaskTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "tasks.sqlite3"
        self.store = SQLiteHubStore(self.path)
        self.clock = 1000
        self.vaults = VaultService(self.store, clock=lambda: self.clock)
        self.fixture = TaskFixture()
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        self.sources = Sources()
        self.service = TaskService(self.store, self.sources, clock=lambda: self.clock)

    def code(self, code, action):
        with self.assertRaises(ContractError) as failed:
            action()
        self.assertEqual(failed.exception.code, code)

    def save(
        self,
        value=None,
        *,
        operation=OP,
        mode="create",
        task=TASK,
        author="device_sig",
        fixture=None,
    ):
        fixture = fixture or self.fixture
        value = value or fixture.body(operation=operation)
        args = (
            (UID, value, operation, fixture.kid(author))
            if mode == "create"
            else (UID, task, value, operation, fixture.kid(author))
        )
        return getattr(self.service, mode)(*args)

    def register(self):
        selected = self.vaults.create_source(
            UID,
            self.fixture.vault,
            SOURCE,
            self.fixture.control(),
            "synthetic_source_create_0001",
            self.fixture.kid("device_sig"),
        )["source"]
        binding = {"ref": selected["resourceRef"], "sourceEpoch": 1}
        self.sources.bindings.append(binding)
        return binding

    def advance_registry(self, *, revoked=(), epoch=1):
        bundle = self.fixture.make_bundle(
            previous=self.fixture.registry, revoked=revoked, key_epoch=epoch
        )
        current = self.vaults.current(UID)["vault"]["version"]
        self.vaults.update_registry(
            UID,
            self.fixture.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": current,
                "registryBundle": bundle,
            },
            f"synthetic_registry_advance_{current:04}",
        )
        self.fixture.registry = self.fixture.verify(bundle, previous=self.fixture.registry)
        self.fixture.bundle = bundle

    def test_real_private_rules_roundtrip_and_history_are_ciphertext_only(self):
        first, replay = self.save()
        self.assertFalse(replay)
        validate_schema("EncryptedTask", first)
        context = strict_json_loads(b64url_decode(first["signedObject"]["payload"]))["context"]
        encrypted = strict_json_loads(b64url_decode(first["signedObject"]["payload"]))["jwe"]
        plaintext = decrypt_jwe(encrypted, self.fixture.keys["device_enc"], context=context)
        self.assertEqual(plaintext["payload"]["name"], CANARY + "-name")
        self.assertEqual(plaintext["payload"]["deliveryExpectation"]["timeZone"], "America/Toronto")
        update = self.fixture.body(
            version=2,
            operation="synthetic_task_rule_edit_0001",
            private={"goal": CANARY + "-new-goal"},
        )
        latest, _ = self.save(update, operation="synthetic_task_rule_edit_0001", mode="update")
        self.assertEqual(latest["metadata"]["executionEpoch"], 1)
        for saved, key, goal in (
            (first, "recovery_enc", CANARY + "-goal"),
            (latest, "device_enc", CANARY + "-new-goal"),
        ):
            message = strict_json_loads(b64url_decode(saved["signedObject"]["payload"]))
            self.assertEqual(
                decrypt_jwe(message["jwe"], self.fixture.keys[key], context=message["context"])[
                    "payload"
                ]["goal"],
                goal,
            )
        self.assertEqual(self.service.get(UID, TASK, 1), first)
        self.assertEqual(self.service.get(UID, TASK), latest)
        self.assertEqual(self.sources.calls, [])
        with sqlite3.connect(self.path) as db:
            stored = "".join(row[0] for row in db.execute("SELECT body FROM hub_documents"))
        self.assertNotIn(CANARY, stored)
        self.assertNotIn("America/Toronto", stored)
        self.assertNotIn('"d":', stored)
        self.assertNotIn("signedObject", canonical_json(self.service.list(UID)).decode())

    def test_same_operation_recovers_original_version_after_later_rule_edit(self):
        original_body = self.fixture.body()
        first, _ = self.save(original_body)
        self.save(
            self.fixture.body(version=2, operation="synthetic_task_rule_edit_0001"),
            operation="synthetic_task_rule_edit_0001",
            mode="update",
        )
        recovered, replay = self.save(original_body)
        self.assertTrue(replay)
        self.assertEqual(recovered, first)
        self.assertEqual(self.service.get(UID, TASK)["metadata"]["taskVersion"], 2)
        self.code("idempotency_conflict", lambda: self.save(self.fixture.body()))

    def test_cas_competing_writers_accept_exactly_one_version_and_preserve_history(self):
        self.fixture.add_key("second_sig", "device_sig", "second_device")
        self.advance_registry()
        authors = ("device_sig", "second_sig")
        first, _ = self.save()
        bodies = [
            self.fixture.body(
                version=2, operation=f"synthetic_parallel_update_{i:04}", author=authors[i]
            )
            for i in range(2)
        ]

        def attempt(pair):
            index, value = pair
            try:
                return self.save(
                    value,
                    operation=f"synthetic_parallel_update_{index:04}",
                    mode="update",
                    author=authors[index],
                )[0]
            except ContractError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as workers:
            outcomes = list(workers.map(attempt, enumerate(bodies)))
        self.assertEqual(outcomes.count("version_conflict"), 1)
        self.assertEqual(self.service.get(UID, TASK, 1), first)
        self.assertEqual(self.service.get(UID, TASK)["metadata"]["taskVersion"], 2)

    def test_pause_resume_and_archive_commit_intent_and_new_ciphertext_atomically(self):
        self.save()
        for version, action, epoch, status in (
            (2, "pause", 2, "paused"),
            (3, "resume", 2, "active"),
            (4, "archive", 3, "archived"),
        ):
            operation = f"synthetic_task_{action}_operation_0001"
            value = self.fixture.body(
                version=version, operation=operation, action=action, epoch=epoch
            )
            result, _ = self.save(value, operation=operation, mode="transition")
            self.assertEqual(
                (result["metadata"]["status"], result["metadata"]["executionEpoch"]),
                (status, epoch),
            )
            self.assertEqual(
                self.save(value, operation=operation, mode="transition"), (result, True)
            )
        self.code(
            "version_conflict",
            lambda: self.save(
                self.fixture.body(version=5, operation="synthetic_after_archive_0001"),
                mode="update",
                operation="synthetic_after_archive_0001",
            ),
        )

    def test_transition_requires_same_operation_author_scope_and_next_ciphertext_commitment(self):
        self.save()
        good = self.fixture.body(
            version=2, operation="synthetic_task_pause_0001", action="pause", epoch=2
        )
        for mutate in (
            lambda value: value.update(
                transitionIntent=self.fixture.sign(self.fixture.base("control_command") | {})
            ),
            lambda value: value.update(
                transitionIntent=self.fixture.sign(
                    {
                        **strict_json_loads(b64url_decode(value["transitionIntent"]["payload"])),
                        "stableOperationId": "synthetic_different_operation_0001",
                    }
                )
            ),
            lambda value: value.update(
                transitionIntent=self.fixture.sign(
                    {
                        **strict_json_loads(b64url_decode(value["transitionIntent"]["payload"])),
                        "nextEnvelopeFingerprint": "a" * 64,
                    }
                )
            ),
        ):
            value = copy.deepcopy(good)
            mutate(value)
            with self.assertRaises(ContractError):
                self.save(value, mode="transition", operation="synthetic_task_pause_0001")
        self.assertEqual(self.service.get(UID, TASK)["metadata"]["taskVersion"], 1)

    def test_resource_binding_changes_advance_epoch_but_reordering_only_does_not(self):
        binding = self.register()
        self.save(self.fixture.body(resources=[binding]))
        other = {
            "ref": {
                "kind": "watchlist",
                "sourceService": "user",
                "resourceId": "watchlist_synthetic",
                "incarnation": "incarnation_synthetic",
            },
            "sourceEpoch": 1,
        }
        self.sources.bindings.append(other)
        changed, _ = self.save(
            self.fixture.body(
                version=2, operation="synthetic_scope_add_0001", resources=[binding, other]
            ),
            operation="synthetic_scope_add_0001",
            mode="update",
        )
        reordered, _ = self.save(
            self.fixture.body(
                version=3, operation="synthetic_scope_reorder_0001", resources=[other, binding]
            ),
            operation="synthetic_scope_reorder_0001",
            mode="update",
        )
        self.assertEqual(changed["metadata"]["executionEpoch"], 2)
        self.assertEqual(reordered["metadata"]["executionEpoch"], 2)
        self.assertEqual(len(self.sources.calls), 2)

    def test_pause_and_archive_survive_source_outage_but_resume_needs_fresh_source(self):
        binding = self.register()
        self.save(self.fixture.body(resources=[binding]))
        self.sources.failed = True
        paused, _ = self.save(
            self.fixture.body(
                version=2,
                operation="synthetic_pause_outage_0001",
                resources=[binding],
                action="pause",
                epoch=2,
            ),
            operation="synthetic_pause_outage_0001",
            mode="transition",
        )
        self.assertEqual(paused["metadata"]["status"], "paused")
        value = self.fixture.body(
            version=3,
            operation="synthetic_resume_outage_0001",
            resources=[binding],
            action="resume",
            epoch=2,
        )
        self.code(
            "source_unavailable",
            lambda: self.save(value, operation="synthetic_resume_outage_0001", mode="transition"),
        )
        archived, _ = self.save(
            self.fixture.body(
                version=3,
                operation="synthetic_archive_outage_0001",
                resources=[binding],
                action="archive",
                epoch=3,
            ),
            operation="synthetic_archive_outage_0001",
            mode="transition",
        )
        self.assertEqual(archived["metadata"]["status"], "archived")

    def test_unknown_refs_epoch_scope_and_stale_local_fences_fail_closed(self):
        binding = self.register()
        foreign = copy.deepcopy(binding)
        foreign["ref"]["incarnation"] = "other_incarnation"
        self.code("source_unavailable", lambda: self.save(self.fixture.body(resources=[foreign])))
        FenceService(self.store, clock=lambda: self.clock).invalidate(
            {
                "contractVersion": CONTRACT_VERSION,
                "ownerSubject": owner_key(UID),
                "mutationId": "synthetic_task_source_fence_0001",
                "ref": binding["ref"],
                "expectedSourceEpoch": 1,
                "newSourceEpoch": 2,
                "reason": "account_scope_changed",
            },
            source_service="portfolio",
        )
        self.code("version_conflict", lambda: self.save(self.fixture.body(resources=[binding])))
        self.assertEqual(self.service.list(UID)["items"], [])

    def test_current_authorization_rejects_revoked_write_replay_but_keeps_old_history(self):
        value = self.fixture.body()
        first, _ = self.save(value)
        self.fixture.add_key("replacement_sig", "device_sig", "replacement")
        self.advance_registry(revoked=("device_sig",))
        self.assertEqual(self.service.get(UID, TASK, 1), first)
        self.code("key_authorization_required", lambda: self.save(value))
        next_value = self.fixture.body(
            version=2, operation="synthetic_new_writer_0001", author="replacement_sig"
        )
        result, _ = self.save(
            next_value,
            operation="synthetic_new_writer_0001",
            mode="update",
            author="replacement_sig",
        )
        self.assertEqual(result["metadata"]["taskVersion"], 2)

    def test_registry_advance_disallows_old_checkpoint_new_write_without_destroying_saved_replay(
        self,
    ):
        value = self.fixture.body()
        first, _ = self.save(value)
        stale = self.fixture.body(version=2, operation="synthetic_old_checkpoint_0001")
        self.advance_registry()
        self.assertEqual(self.save(value), (first, True))
        self.code(
            "registry_conflict",
            lambda: self.save(stale, operation="synthetic_old_checkpoint_0001", mode="update"),
        )

    def test_cross_owner_and_task_object_substitution_are_rejected(self):
        other = TaskFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.save()
        self.code("not_found", lambda: self.service.get(OTHER_UID, TASK))
        value = self.fixture.body()
        value["taskId"] = "another_task"
        self.code("recipient_binding_mismatch", lambda: self.save(value))
        self.code(
            "key_authorization_required",
            lambda: self.service.create(
                OTHER_UID, self.fixture.body(), OP, self.fixture.kid("device_sig")
            ),
        )

    def test_persistent_cursor_is_owner_snapshot_limit_and_expiry_bound(self):
        for name in ("task_a", "task_b", "task_c"):
            self.save(
                self.fixture.body(task=name, operation="synthetic_create_" + name),
                operation="synthetic_create_" + name,
            )
        first = self.service.list(UID, limit=1)
        cursor = first["nextCursor"]
        self.assertEqual(len(b64url_decode(cursor, exact_bytes=24)), 24)
        second = self.service.list(UID, limit=1, cursor=cursor)
        self.assertEqual(second["items"][0]["taskId"], "task_b")
        self.code("unsupported_query", lambda: self.service.list(UID, limit=2, cursor=cursor))
        other = TaskFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, other.bootstrap(), BOOT)
        self.code("unsupported_query", lambda: self.service.list(OTHER_UID, limit=1, cursor=cursor))
        self.clock += 900
        self.code("unsupported_query", lambda: self.service.list(UID, limit=1, cursor=cursor))
        self.clock = 1000
        self.save(
            self.fixture.body(task="task_a", version=2, operation="synthetic_cursor_revision_0001"),
            operation="synthetic_cursor_revision_0001",
            mode="update",
            task="task_a",
        )
        self.code("version_conflict", lambda: self.service.list(UID, limit=1, cursor=cursor))

    def test_version_capacity_reserves_pause_archive_and_never_evicts_old_versions(self):
        with patch("app.tasks.MAX_VERSIONS", 6):
            original, _ = self.save()
            for version in (2, 3, 4):
                op = f"synthetic_capacity_rule_{version:04}"
                self.save(
                    self.fixture.body(version=version, operation=op), operation=op, mode="update"
                )
            op = "synthetic_capacity_rule_0005"
            self.code(
                "version_conflict",
                lambda: self.save(
                    self.fixture.body(version=5, operation=op), operation=op, mode="update"
                ),
            )
            self.save(
                self.fixture.body(
                    version=5, operation="synthetic_capacity_pause_0001", action="pause", epoch=2
                ),
                operation="synthetic_capacity_pause_0001",
                mode="transition",
            )
            self.save(
                self.fixture.body(
                    version=6,
                    operation="synthetic_capacity_archive_0001",
                    action="archive",
                    epoch=3,
                ),
                operation="synthetic_capacity_archive_0001",
                mode="transition",
            )
            self.assertEqual(self.service.get(UID, TASK, 1), original)

    def test_task_count_capacity_does_not_create_an_unbounded_owner_index(self):
        with patch("app.tasks.MAX_TASKS", 2):
            for task in ("task_a", "task_b"):
                self.save(
                    self.fixture.body(task=task, operation="synthetic_create_" + task),
                    operation="synthetic_create_" + task,
                )
            self.code("version_conflict", lambda: self.save())
        self.assertEqual(len(self.service.list(UID)["items"]), 2)

    def test_signed_invalid_aead_tag_can_store_but_client_decryption_rejects(self):
        value = self.fixture.body()
        message = strict_json_loads(b64url_decode(value["envelope"]["signedObject"]["payload"]))
        message["jwe"]["tag"] = b64url_encode(b"x" * 16)
        value["envelope"]["signedObject"] = sign_jws(
            message, self.fixture.keys["device_sig"], typ="fv-object+jws"
        )
        result, _ = self.save(value)
        self.assertEqual(result["metadata"]["taskVersion"], 1)
        self.code(
            "decryption_failed",
            lambda: decrypt_jwe(
                message["jwe"], self.fixture.keys["device_enc"], context=message["context"]
            ),
        )

    def test_corrupt_history_or_index_does_not_reflect_or_repair_content(self):
        self.save()
        path = document_path("hub_task_versions", owner_key(UID), self.fixture.vault, TASK, "1")

        def corrupt(unit):
            row = unit.get(path)
            row["metadata"]["envelopeFingerprint"] = "0" * 64
            unit.put(path, row)

        self.store.transact(corrupt)
        with self.assertRaises(StoreUnavailable):
            self.service.get(UID, TASK)

    def test_replay_detects_another_valid_carrier_swapped_into_the_saved_version(self):
        original = self.fixture.body()
        self.save(original)
        replacement = self.fixture.body()
        signed = replacement["envelope"]["signedObject"]
        fingerprint = signing_input_fingerprint(signed)
        path = document_path("hub_task_versions", owner_key(UID), self.fixture.vault, TASK, "1")

        def corrupt(unit):
            row = unit.get(path)
            row["metadata"]["envelopeFingerprint"] = fingerprint
            row["carrierJson"] = canonical_json(replacement["envelope"]).decode()
            unit.put(path, row)

        self.store.transact(corrupt)
        with self.assertRaises(StoreUnavailable):
            self.save(original)

    def test_key_epoch_change_rejects_old_new_writes_and_advances_execution_fence(self):
        value = self.fixture.body()
        original, _ = self.save(value)
        old_update = self.fixture.body(version=2, operation="synthetic_key_epoch_old_0001")
        self.advance_registry(epoch=2)
        with self.assertRaises(ContractError):
            self.save(old_update, operation="synthetic_key_epoch_old_0001", mode="update")
        updated, _ = self.save(
            self.fixture.body(version=2, operation="synthetic_key_epoch_new_0001"),
            operation="synthetic_key_epoch_new_0001",
            mode="update",
        )
        self.assertEqual(updated["metadata"]["keyEpoch"], 2)
        self.assertEqual(updated["metadata"]["executionEpoch"], 2)
        self.assertEqual(self.service.get(UID, TASK, 1), original)
        with self.assertRaises(ContractError):
            self.save(value)

    def test_root_certified_agent_recipient_does_not_grant_task_decryption_consent(self):
        self.fixture.add_key("agent_enc", "agent_enc", "agent_A", "connection_A")
        self.advance_registry()
        value = self.fixture.body()
        message = strict_json_loads(b64url_decode(value["envelope"]["signedObject"]["payload"]))
        context = message["context"]
        cert = self.fixture.certificates["agent_enc"]
        context["recipients"].append(
            {
                field: cert[field]
                for field in ("keyId", "role", "principalId", "connectionId", "keyEpoch")
            }
        )
        context["recipients"].sort(key=lambda row: row["keyId"])
        keys = {
            row["keyId"]: next(
                cert["publicJwk"]
                for cert in self.fixture.certificates.values()
                if cert["keyId"] == row["keyId"]
            )
            for row in context["recipients"]
        }
        encrypted = encrypt_jwe(wrapper(context), keys, context=context)
        value["envelope"]["signedObject"] = sign_jws(
            {"context": context, "jwe": encrypted},
            self.fixture.keys["device_sig"],
            typ="fv-object+jws",
        )
        self.code("recipient_binding_mismatch", lambda: self.save(value))
        self.assertEqual(self.service.list(UID)["items"], [])

    def test_schema_valid_but_inconsistent_list_version_metadata_is_not_returned(self):
        self.save()
        path = document_path("hub_task_indexes", owner_key(UID), self.fixture.vault)

        def corrupt(unit):
            row = unit.get(path)
            row["tasks"][TASK]["objectRevision"] = 2
            unit.put(path, row)

        self.store.transact(corrupt)
        with self.assertRaises(StoreUnavailable):
            self.service.list(UID)

    def test_history_rejects_wrong_checkpoint_epochs_even_with_valid_author_signature(self):
        original, _ = self.save()
        path = document_path("hub_task_versions", owner_key(UID), self.fixture.vault, TASK, "1")
        for field in ("rootEpoch", "keyEpoch", "recipientPrincipal"):
            value = self.fixture.body()
            context = strict_json_loads(
                b64url_decode(value["envelope"]["signedObject"]["payload"])
            )["context"]
            if field == "recipientPrincipal":
                context["recipients"][0]["principalId"] = "foreign_principal"
            else:
                context[field] = 2
            carrier = self.fixture.carrier(context)

            def corrupt(unit, context=context, carrier=carrier):
                row = unit.get(path)
                row["metadata"] = copy.deepcopy(original["metadata"])
                row["metadata"]["keyEpoch"] = context["keyEpoch"]
                row["metadata"]["envelopeFingerprint"] = signing_input_fingerprint(
                    carrier["signedObject"]
                )
                row["carrierJson"] = canonical_json(carrier).decode()
                unit.put(path, row)

            self.store.transact(corrupt)
            with self.subTest(field=field), self.assertRaises(StoreUnavailable):
                self.service.get(UID, TASK, 1)

    def test_history_rejects_author_already_inactive_at_claimed_checkpoint(self):
        self.save()
        self.fixture.add_key("replacement_sig", "device_sig", "replacement")
        self.advance_registry(revoked=("device_sig",))
        value = self.fixture.body(author="device_sig")
        path = document_path("hub_task_versions", owner_key(UID), self.fixture.vault, TASK, "1")

        def corrupt(unit):
            row = unit.get(path)
            row["metadata"]["envelopeFingerprint"] = signing_input_fingerprint(
                value["envelope"]["signedObject"]
            )
            row["carrierJson"] = canonical_json(value["envelope"]).decode()
            row["keyProofs"] = {
                "checkpoint": self.fixture.bundle["checkpoint"],
                "certificates": [entry["certificate"] for entry in self.fixture.bundle["entries"]],
            }
            unit.put(path, row)

        self.store.transact(corrupt)
        with self.assertRaises(StoreUnavailable):
            self.service.get(UID, TASK, 1)

    def test_historical_ciphertext_survives_today_expired_author_without_new_write_authority(self):
        value = self.fixture.body()
        original, _ = self.save(value)
        self.clock = 5001
        self.assertEqual(self.service.get(UID, TASK, 1), original)
        self.code("key_authorization_required", lambda: self.save(value))

    def test_backwards_clock_rejects_new_version_without_blocking_saved_replay(self):
        value = self.fixture.body()
        original, _ = self.save(value)
        self.clock = 999
        operation = "synthetic_clock_regression_0001"
        update = self.fixture.body(version=2, operation=operation)
        with self.assertRaises(StoreUnavailable):
            self.save(update, operation=operation, mode="update")
        self.assertEqual(self.service.get(UID, TASK), original)
        self.assertEqual(self.save(value), (original, True))
        self.clock = 1000
        self.assertEqual(
            self.save(update, operation=operation, mode="update")[0]["metadata"]["taskVersion"], 2
        )

    def test_agent_recipient_and_private_metadata_fallback_are_not_supported(self):
        value = self.fixture.body()
        value["name"] = CANARY
        self.code("malformed_request", lambda: self.save(value))
        duplicate = self.register()
        value = self.fixture.body(resources=[duplicate])
        value["resourceBindings"] = [duplicate, duplicate]
        self.code("malformed_request", lambda: self.save(value))
        value = self.fixture.body()
        value["envelope"]["contractVersion"] = "v1"
        self.code("unsupported_contract", lambda: self.save(value))
