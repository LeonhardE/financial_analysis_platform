"""Synthetic preparation publication, current authorization and opaque client copies."""

import copy
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fixtures import BOOT, OTHER_UID, UID
from test_oauth import (
    COOKIE,
    TASK,
    OAuthFixture,
    authorization_params,
    configuration,
    exchange_form,
)

from app.fences import FenceService
from app.oauth import OAuthFailure, OAuthService
from app.preparations import PreparationService, source_versions
from app.store import SQLiteHubStore, document_path
from app.tasks import TaskService, _task_binding
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, decrypt_jwe
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json


class Sources:
    def __init__(self):
        self.available, self.revision, self.epoch, self.calls = True, 5, 1, 0
        self.ref = {
            "kind": "holdings",
            "sourceService": "portfolio",
            "resourceId": "holdings_A",
            "incarnation": "incarnation_A",
        }
        self.after = None

    def read(self, uid):
        self.calls += 1
        if not self.available:
            raise ContractError("source_unavailable")
        value = {
            "groups": [
                {
                    "items": [
                        {
                            "ref": self.ref,
                            "sourceEpoch": self.epoch,
                            "revision": self.revision,
                            "snapshotId": "producer_snapshot_5",
                            "state": "active",
                        }
                    ]
                }
            ]
        }
        if self.after:
            action, self.after = self.after, None
            action()
        return value


class PreparationFixture(OAuthFixture):
    def envelopes(self, intent, *, reader="A1_enc", salt=""):
        result = {}
        for row in intent["objects"]:
            context = self.context(row["objectType"], readers=(reader,))
            context.update(
                objectId=row["objectId"],
                revision=row["revision"],
                expectedRevision=row["revision"]
                if row["objectType"] == "task"
                else row["revision"] - 1,
                deliveryRevision=row["deliveryRevision"],
                priorEnvelopeFingerprint=row["priorEnvelopeFingerprint"],
                operationType="reshare_delivery"
                if row["objectType"] == "task"
                else (
                    "commit_snapshot"
                    if row["objectType"] == "holdings_snapshot"
                    else "commit_evidence"
                ),
                stableOperationId="synthetic_preparation_stage_" + salt + row["objectId"],
                resourceBindings=[],
            )
            if row["objectType"] == "task":
                context["binding"] = _task_binding(row["objectId"], row["revision"])
                context["resourceBindings"] = copy.deepcopy(
                    intent["taskMetadata"]["resourceBindings"]
                )
            else:
                context["binding"] = dict.fromkeys(_task_binding("unused", 1))
                context["binding"].update(
                    resourceRef=row["resourceRef"],
                    sourceRevision=row["sourceRevision"],
                    sourceEpoch=row["sourceEpoch"],
                )
            result[row["objectId"]] = (self.carrier(context), context["stableOperationId"])
        return result


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = SQLiteHubStore(Path(self.directory.name) / "hub.sqlite3")
        self.now = 1000
        self.fix = PreparationFixture()
        self.sources = Sources()
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.vaults.bootstrap(UID, self.fix.bootstrap(), BOOT)
        self.tasks = TaskService(self.store, self.sources, clock=lambda: self.now)
        self.resources = [{"ref": self.sources.ref, "sourceEpoch": 1}]
        self.original = self.tasks.create(
            UID,
            self.fix.task_body(resources=self.resources),
            "synthetic_oauth_task_create_1",
            self.fix.kid("device_sig"),
        )[0]
        self.oauth = OAuthService(self.store, configuration(), self.sources, clock=lambda: self.now)
        self.service = PreparationService(self.oauth)
        self.tokens, self.approved = self.consent()
        self.connection = self.approved["connectionId"]

    def consent(self, *, policy="selected", fixture=None, name="A1", uid=UID, task=TASK):
        fixture = fixture or self.fix
        pending = self.oauth.authorize(
            authorization_params(
                scope="tasks:read runs:create runs:read portfolio:read results:create receipts:read"
            ),
            COOKIE,
        )
        claimed = self.oauth.claim(uid, pending, COOKIE)
        if name == "A1":
            fixture.pair(claimed["connectionId"])
        else:
            fixture.add_key(name + "_sig", "agent_sig", name, claimed["connectionId"])
            fixture.add_key(name + "_enc", "agent_enc", name, claimed["connectionId"])
            fixture.bundle = fixture.make_bundle(previous=fixture.registry, issued_at=1000)
            fixture.registry = fixture.verify(fixture.bundle, previous=fixture.registry)
        self.vaults.update_registry(
            uid,
            fixture.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": fixture.registry.registry_sequence - 1,
                "registryBundle": fixture.bundle,
            },
            "synthetic_preparation_pair_" + str(fixture.registry.registry_sequence),
        )
        state = self.oauth.prepare(
            uid,
            pending,
            COOKIE,
            [task],
            history_policy=policy,
            source_versions=source_versions(self.sources, uid) if policy == "selected" else None,
        )
        signed = fixture.signed_grants(
            state,
            capabilities=["decrypt_task", "decrypt_resources", "encrypt_result"],
            historyPolicy=policy,
            agentSigningKeyId=fixture.kid(name + "_sig"),
            agentEncryptionKeyId=fixture.kid(name + "_enc"),
        )
        if policy == "selected":
            _, payload = _signed_parts(signed[0])
            for binding in payload["resourceBindings"]:
                binding.update(versionAccess="selected", selectedVersions=[self.sources.revision])
            signed = [fixture.sign(payload)]
        location = self.oauth.decide(uid, pending, COOKIE, "approve", signed)
        code = parse_qs(urlsplit(location).query)["code"][0]
        status, tokens, _ = self.oauth.protocol(exchange_form(code), {}, "token")
        self.assertEqual(status, 200, tokens)
        return tokens, state

    def stage_all(self, *, connection=None, reader="A1_enc"):
        connection = connection or self.connection
        intent = self.service.intent(UID, connection, TASK)
        envelopes = self.fix.envelopes(intent, reader=reader)
        descriptors = []
        for obj, (carrier, operation) in envelopes.items():
            descriptors.append(
                self.service.stage(
                    UID, connection, TASK, obj, carrier, operation, self.fix.kid("device_sig")
                )
            )
        selected = [
            {"objectId": d["objectId"], "envelopeFingerprint": d["envelopeFingerprint"]}
            for d in descriptors
        ]
        return intent, envelopes, selected

    def publish(self, *, connection=None, reader="A1_enc"):
        connection = connection or self.connection
        intent, envelopes, selected = self.stage_all(connection=connection, reader=reader)
        receipt = self.service.commit(
            UID, connection, TASK, selected, "synthetic_preparation_commit_0001"
        )
        return intent, envelopes, selected, receipt

    def assert_code(self, code, fn):
        with self.assertRaises(ContractError) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_publish_current_source_revision_five_and_client_decrypt_with_proofs(self):
        intent, envelopes, selected, receipt = self.publish()
        meta = self.service.metadata(self.tokens["access_token"], TASK)
        self.assertEqual(meta["preparationId"], receipt["preparationId"])
        self.assertEqual(meta["taskDeliveryBase"]["deliveryRevision"], 1)
        self.assertEqual(len(meta["registryProofs"]), 2)
        for proof in meta["registryProofs"]:
            result = self.service.registry(
                self.tokens["access_token"], meta["preparationId"], proof["registrySequence"]
            )
            self.assertEqual(
                result["registryBundle"],
                self.fix.bootstrap()["registryBundle"]
                if proof["registrySequence"] == 2
                else self.vaults.current(UID)["vault"]["registryHistory"][0],
            )
        for item in meta["objects"]:
            value = self.service.object(
                self.tokens["access_token"], meta["preparationId"], item["objectId"]
            )
            _, message = _signed_parts(value["envelope"]["signedObject"])
            private = decrypt_jwe(
                message["jwe"], self.fix.keys["A1_enc"], context=message["context"]
            )
            self.assertEqual(private["objectId"], item["objectId"])
            if item["resourceRef"]:
                self.assertEqual((item["revision"], message["context"]["expectedRevision"]), (5, 4))
                self.assertEqual(item["producerSnapshotId"], "producer_snapshot_5")
                self.assertEqual(item["provenance"], "owner_attested_copy")
        self.assertEqual(self.tasks.get(UID, TASK), self.original)
        raw = Path(self.store.path).read_bytes()
        self.assertNotIn(b"Synthetic Holdings", raw)
        self.assertNotIn(self.fix.keys["A1_enc"].get("d").encode(), raw)

    def test_staging_is_invisible_until_atomic_publish_and_exact_retry(self):
        intent, envelopes, selected = self.stage_all()
        self.assert_code(
            "not_found", lambda: self.service.metadata(self.tokens["access_token"], TASK)
        )
        obj, (carrier, operation) = next(iter(envelopes.items()))
        one = self.service.stage(
            UID, self.connection, TASK, obj, carrier, operation, self.fix.kid("device_sig")
        )
        self.assertEqual(one["envelopeFingerprint"], selected[0]["envelopeFingerprint"])
        changed = self.fix.envelopes(intent, salt="different_")[obj][0]
        self.assert_code(
            "idempotency_conflict",
            lambda: self.service.stage(
                UID, self.connection, TASK, obj, changed, operation, self.fix.kid("device_sig")
            ),
        )
        self.assert_code(
            "malformed_request",
            lambda: self.service.commit(
                UID, self.connection, TASK, selected[:1], "synthetic_preparation_commit_partial"
            ),
        )
        receipt = self.service.commit(
            UID, self.connection, TASK, selected, "synthetic_preparation_commit_0001"
        )
        self.assertEqual(
            receipt,
            self.service.commit(
                UID, self.connection, TASK, selected, "synthetic_preparation_commit_0001"
            ),
        )
        self.assertEqual(
            one,
            self.service.stage(
                UID, self.connection, TASK, obj, carrier, operation, self.fix.kid("device_sig")
            ),
        )

    def test_unselected_history_and_changed_source_revision_do_not_get_ready(self):
        tokens, state = self.consent(policy="none", name="A2")
        self.assert_code(
            "key_authorization_required",
            lambda: self.service.intent(UID, state["connectionId"], TASK),
        )
        self.sources.revision = 6
        self.assert_code(
            "source_unavailable", lambda: self.service.intent(UID, self.connection, TASK)
        )
        self.sources.revision = 0
        self.assert_code(
            "source_unavailable", lambda: self.service.intent(UID, self.connection, TASK)
        )

    def test_source_and_connection_revocation_before_or_during_read_reject(self):
        intent, envelopes, selected, receipt = self.publish()
        self.sources.after = lambda: self.oauth.revoke_connection(UID, self.connection)
        with self.assertRaises(OAuthFailure):
            self.service.metadata(self.tokens["access_token"], TASK)
        self.assert_code("not_found", lambda: self.service.intent(OTHER_UID, self.connection, TASK))

    def test_fence_during_publication_blocks_ready_state(self):
        intent, envelopes, selected = self.stage_all()

        def fence():
            FenceService(self.store, clock=lambda: self.now).invalidate(
                {
                    "contractVersion": CONTRACT_VERSION,
                    "ownerSubject": self.fix.owner,
                    "mutationId": "synthetic_preparation_source_fence",
                    "ref": self.sources.ref,
                    "expectedSourceEpoch": 1,
                    "newSourceEpoch": 2,
                    "reason": "disconnected",
                },
                source_service="portfolio",
            )

        self.sources.after = fence
        self.assert_code(
            "version_conflict",
            lambda: self.service.commit(
                UID, self.connection, TASK, selected, "synthetic_preparation_commit_fenced"
            ),
        )
        self.assertIsNone(
            self.store.transact(
                lambda u: u.get(
                    document_path("hub_preparations", self.fix.owner, intent["preparationId"])
                )
            )
        )

    def test_independent_agent_delivery_chain_keeps_prior_preparation_and_blocks_cross_reads(self):
        intent, envelopes, selected, first = self.publish()
        tokens2, state2 = self.consent(name="A2")
        second_intent, _, _, second = self.publish(
            connection=state2["connectionId"], reader="A2_enc"
        )
        self.assertEqual(second_intent["taskDeliveryBase"]["deliveryRevision"], 2)
        self.assertEqual(
            second_intent["taskDeliveryBase"]["envelopeFingerprint"],
            first["objects"][0]["envelopeFingerprint"],
        )
        self.assertEqual(
            self.service.metadata(self.tokens["access_token"], TASK)["preparationId"],
            first["preparationId"],
        )
        self.assert_code(
            "not_found",
            lambda: self.service.object(tokens2["access_token"], first["preparationId"], TASK),
        )
        self.oauth.revoke_connection(UID, self.connection)
        self.assertEqual(
            self.service.metadata(tokens2["access_token"], TASK)["preparationId"],
            second["preparationId"],
        )


class PreparationIntegrityTests(unittest.TestCase):
    setUp = PreparationTests.setUp
    consent = PreparationTests.consent
    stage_all = PreparationTests.stage_all
    publish = PreparationTests.publish
    assert_code = PreparationTests.assert_code

    def test_valid_signed_carrier_substitution_cannot_borrow_committed_fingerprint(self):
        intent, envelopes, selected, receipt = self.publish()
        obj = next(iter(envelopes))
        substituted, operation = self.fix.envelopes(intent)[obj]

        def mutate(unit):
            path = document_path(
                "hub_preparation_objects", self.fix.owner, receipt["preparationId"], obj
            )
            row = unit.get(path)
            row["carrierJson"] = canonical_json(substituted).decode()
            row["operations"][operation]["requestFingerprint"] = (
                __import__("hashlib").sha256(canonical_json(substituted)).hexdigest()
            )
            unit.put(path, row)

        self.store.transact(mutate)
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.service.object(self.tokens["access_token"], receipt["preparationId"], obj),
        )

    def test_saved_receipt_descriptor_swap_or_owner_replacement_is_unavailable(self):
        from app.store import StoreUnavailable

        intent, envelopes, selected, receipt = self.publish()
        path = document_path("hub_preparations", self.fix.owner, receipt["preparationId"])
        original = self.store.transact(lambda unit: unit.get(path))
        for changes in (
            {"ownerSubject": "other_owner"},
            {"receipt": original["receipt"] | {"preparationId": "other_preparation"}},
        ):
            self.store.transact(lambda unit, changes=changes: unit.put(path, original | changes))
            with self.assertRaises(StoreUnavailable):
                self.service.metadata(self.tokens["access_token"], TASK)
        self.store.transact(lambda unit: unit.put(path, original))
        self.assertEqual(
            self.service.metadata(self.tokens["access_token"], TASK)["preparationId"],
            receipt["preparationId"],
        )

    def test_wrong_recipient_and_changed_public_binding_are_refused_before_storage(self):
        intent = self.service.intent(UID, self.connection, TASK)
        envelopes = self.fix.envelopes(intent)
        obj, (carrier, operation) = next(iter(envelopes.items()))
        _, message = _signed_parts(carrier["signedObject"])
        context = message["context"]
        context["recipients"] = [r for r in context["recipients"] if r["role"] != "agent_enc"]
        omitted = self.fix.carrier(context)
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.service.stage(
                UID, self.connection, TASK, obj, omitted, operation, self.fix.kid("device_sig")
            ),
        )
        context["binding"]["taskVersion"] = 2
        context["revision"] = 2
        context["expectedRevision"] = 2
        mismatch = self.fix.carrier(context)
        self.assert_code(
            "recipient_binding_mismatch",
            lambda: self.service.stage(
                UID, self.connection, TASK, obj, mismatch, operation, self.fix.kid("device_sig")
            ),
        )

    def test_narrowed_source_scope_cannot_read_resources_but_task_remains_accessible(self):
        intent, envelopes, selected, receipt = self.publish()
        status, tokens, _ = self.oauth.protocol(
            {
                "grant_type": "refresh_token",
                "client_id": configuration().clients[0].client_id,
                "resource": configuration().resource,
                "refresh_token": self.tokens["refresh_token"],
                "scope": "tasks:read",
            },
            {},
            "token",
        )
        self.assertEqual(status, 200, tokens)
        source = next(row for row in receipt["objects"] if row["resourceRef"])
        with self.assertRaises(OAuthFailure):
            self.service.object(
                tokens["access_token"], receipt["preparationId"], source["objectId"]
            )
        self.assertEqual(
            self.service.object(tokens["access_token"], receipt["preparationId"], TASK)["objectId"],
            TASK,
        )

    def test_new_task_rules_and_outdated_source_revision_cannot_reuse_old_preparation(self):
        intent, envelopes, selected, receipt = self.publish()
        self.sources.revision += 1
        self.assert_code(
            "source_unavailable", lambda: self.service.metadata(self.tokens["access_token"], TASK)
        )
        self.sources.revision -= 1
        self.tasks.update(
            UID,
            TASK,
            self.fix.task_body(version=2, resources=self.resources),
            "synthetic_oauth_task_create_2",
            self.fix.kid("device_sig"),
        )
        self.assert_code(
            "key_authorization_required",
            lambda: self.service.metadata(self.tokens["access_token"], TASK),
        )

    def test_source_read_failure_does_not_mark_read_observed(self):
        intent, envelopes, selected, receipt = self.publish()
        self.sources.available = False
        self.assert_code(
            "source_unavailable",
            lambda: self.service.object(
                self.tokens["access_token"], receipt["preparationId"], TASK
            ),
        )
        self.assertFalse(self.oauth.connections(UID)["items"][0]["grants"][0]["readObserved"])

    def test_stage_operation_capacity_does_not_block_exact_retry_or_revocation(self):
        intent, envelopes, selected = self.stage_all()
        obj, (carrier, operation) = next(iter(envelopes.items()))
        path = document_path(
            "hub_preparation_objects", self.fix.owner, intent["preparationId"], obj
        )

        def fill(unit):
            row = unit.get(path)
            record = row["operations"][operation]
            for n in range(31):
                row["operations"]["synthetic_capacity_operation_" + str(n)] = copy.deepcopy(record)
            unit.put(path, row)

        self.store.transact(fill)
        self.assertEqual(
            self.service.stage(
                UID, self.connection, TASK, obj, carrier, operation, self.fix.kid("device_sig")
            )["envelopeFingerprint"],
            selected[0]["envelopeFingerprint"],
        )
        candidate, candidate_operation = self.fix.envelopes(intent, salt="new_")[obj]
        self.assert_code(
            "version_conflict",
            lambda: self.service.stage(
                UID,
                self.connection,
                TASK,
                obj,
                candidate,
                candidate_operation,
                self.fix.kid("device_sig"),
            ),
        )
        self.oauth.revoke_connection(UID, self.connection)
        self.assertEqual(self.oauth.connections(UID)["items"][0]["status"], "revoked")


class PreparationSourceKindsTests(unittest.TestCase):
    setUp = PreparationTests.setUp
    consent = PreparationTests.consent
    assert_code = PreparationTests.assert_code

    def test_watchlist_and_follows_copies_use_actual_selected_source_revision(self):
        for kind in ("watchlist", "channel_follows"):
            with self.subTest(kind=kind):
                self.sources.ref = {
                    "kind": kind,
                    "sourceService": "user",
                    "resourceId": kind + "_A",
                    "incarnation": "incarnation_" + kind,
                }
                resources = [{"ref": self.sources.ref, "sourceEpoch": 1}]
                task = "task_" + kind
                self.tasks.create(
                    UID,
                    self.fix.task_body(task=task, resources=resources),
                    "synthetic_oauth_task_create_1",
                    self.fix.kid("device_sig"),
                )
                # Public OAuth scopes for each source are selected independently.
                original_authorize = self.oauth.authorize

                def authorize(params, browser, original_authorize=original_authorize):
                    params = params | {
                        "scope": params["scope"] + " watchlist:read channel_follows:read"
                    }
                    return original_authorize(params, browser)

                self.oauth.authorize = authorize
                try:
                    tokens, state = self.consent(task=task, name="A2")
                finally:
                    self.oauth.authorize = original_authorize
                intent = self.service.intent(UID, state["connectionId"], task)
                envelopes = self.fix.envelopes(intent, reader="A2_enc")
                selected = []
                for obj, (carrier, operation) in envelopes.items():
                    desc = self.service.stage(
                        UID,
                        state["connectionId"],
                        task,
                        obj,
                        carrier,
                        operation,
                        self.fix.kid("device_sig"),
                    )
                    selected.append(
                        {"objectId": obj, "envelopeFingerprint": desc["envelopeFingerprint"]}
                    )
                receipt = self.service.commit(
                    UID,
                    state["connectionId"],
                    task,
                    selected,
                    "synthetic_preparation_source_kinds_commit",
                )
                item = next(i for i in receipt["objects"] if i["resourceRef"])
                value = self.service.object(
                    tokens["access_token"], receipt["preparationId"], item["objectId"]
                )
                _, message = _signed_parts(value["envelope"]["signedObject"])
                private = decrypt_jwe(
                    message["jwe"], self.fix.keys["A2_enc"], context=message["context"]
                )
                self.assertEqual(private["objectType"], kind + "_evidence")
                self.assertEqual(item["sourceRevision"], 5)

    def test_delivery_capacity_refuses_new_staging_but_connection_revocation_remains_available(
        self,
    ):
        self.store.transact(
            lambda unit: unit.put(
                document_path("hub_task_deliveries", self.fix.owner, self.fix.vault, TASK, "1"),
                {"deliveryRevision": 32, "envelopeFingerprint": "a" * 64},
            )
        )
        self.assert_code(
            "version_conflict", lambda: self.service.intent(UID, self.connection, TASK)
        )
        self.oauth.revoke_connection(UID, self.connection)
        self.assertEqual(self.oauth.connections(UID)["items"][0]["status"], "revoked")
