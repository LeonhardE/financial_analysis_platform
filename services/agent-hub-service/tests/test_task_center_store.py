"""Real JOSE/SQLite multi-provider tasks, isolated runs, removal and history."""

import unittest
from concurrent.futures import ThreadPoolExecutor

import test_persistent_publications as publications
import test_persistent_resource_store as consents
import test_provider_slot_store as providers
from fixtures import OTHER_UID, UID
from test_oauth import TASK
from test_persistent_content import PersistentContentFixture
from test_persistent_identity_store import CONNECTION

from app.persistent_agents import stored_identity
from app.persistent_execution import PersistentExecutionService
from app.persistent_publications import PersistentPublicationService, stored_authority
from app.persistent_results import PersistentOwnerResultService, PersistentResultService, result_id
from app.resource_consents import ResourceConsentService
from app.store import document_path
from app.task_center import TaskCenterAgentService, center_reference
from app.task_center_results import TaskCenterResultService
from app.tasks import TaskService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, signing_input_fingerprint
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    digest,
    seal_persistent_content,
)
from folioview_shared.encrypted.provider_connections import provider_review_digest, provider_slot_id
from folioview_shared.encrypted.task_center import TASK_CENTER_PROFILE, assignment_id

ISSUER = "https://synthetic-hub.example"
BASE = "/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/"


class TaskCenterStoreTests(unittest.TestCase):
    def setUp(self):
        self.pf = providers.ProviderConnectionTests()
        self.pf.setUp()
        self.addCleanup(self.pf.doCleanups)
        self.f, self.store = self.pf.f, self.pf.store
        credential, op2, self.second = self.pf.pending_second_connection()

        def second_provider(unit):
            path = document_path("hub_oauth_connections", self.f.owner, self.second)
            unit.put(path, {**unit.get(path), "provider": "chatgpt"})

        self.store.transact(second_provider)
        packet, op = self.pf.packet()
        self.first_slot = self.pf.apply(packet, op)["slot"]
        state = self.pf.service.state(UID, self.f.vault, "chatgpt")
        packet, op = self.pf.packet(credential, op2, state=state)
        packet["review"].update(
            provider="chatgpt", slotId=provider_slot_id(self.f.owner, "chatgpt")
        )
        _, payload = _signed_parts(packet["approval"])
        payload.update(
            provider="chatgpt",
            slotId=provider_slot_id(self.f.owner, "chatgpt"),
            reviewDigest=provider_review_digest(packet["review"]),
        )
        packet["approval"] = self.f.sign(payload)
        self.second_slot = self.pf.service.command(UID, self.f.vault, "chatgpt", packet, op)["slot"]
        self.fx = consents.ResourceConsentStoreTests()
        self.fx.store, self.fx.f = self.store, self.f
        self.fx.now = self.pf.fx.fx.now
        self.fx.catalogue = consents.Catalogue([self.f.resource])
        self.fx.catalogue.revision = 1
        self.fx.a, self.fx.b = self.f.resource, self.f.resource
        self.fx.serial = 0
        self.fx.service = ResourceConsentService(
            self.store, self.fx.catalogue, clock=lambda: self.fx.now
        )
        self.fx.state = lambda: self.fx.service.state(UID, self.f.vault, self.connection)
        self.p = publications.PublicationTests()
        self.p.fx, self.p.f, self.p.serial = self.fx, self.f, 0
        self.p.service = PersistentPublicationService(
            self.store, self.fx.catalogue, clock=lambda: self.fx.now
        )
        self.p.tasks = TaskService(self.store, self.fx.catalogue, clock=lambda: self.fx.now)
        self.owner = TaskCenterResultService(self.store, clock=lambda: self.fx.now)
        options = dict(
            audience=ISSUER,
            client_ids=[self.pf.fx.conn["clientId"]],
            managed_only=True,
            clock=lambda: self.fx.now,
        )
        self.agent = TaskCenterAgentService(self.store, self.fx.catalogue, **options)
        self.execution = PersistentExecutionService(self.store, self.fx.catalogue, **options)
        self.writer = PersistentResultService(self.store, self.fx.catalogue, **options)
        self.history = PersistentOwnerResultService(self.store, clock=lambda: self.fx.now)
        self.serial = 0
        self.use(CONNECTION)
        self.p.create_task()
        self.definition = self.control("set_rules")["definition"]
        self.authorities = {}
        self.assignments = {}
        for connection in (CONNECTION, self.second):
            self.use(connection)
            command, operation = self.fx.command(resources=[self.fx.proposal(floor=1)])
            self.fx.service.command(UID, self.f.vault, connection, command, operation)
            c = self.context("holdings_snapshot")
            self.p.service.publish(
                UID, self.f.vault, connection, self.p.seal(c), c["stableOperationId"]
            )
            task = self.context("task")
            carrier = self.p.seal(task)
            fp = signing_input_fingerprint(carrier["proof"])
            self.assignments[connection] = self.control("set_assignment", fingerprint=fp)[
                "assignment"
            ]
            self.authorities[connection] = self.p.service.publish(
                UID, self.f.vault, connection, carrier, task["stableOperationId"]
            )
        self.use(CONNECTION)

    def use(self, connection):
        self.connection = connection
        self.identity = self.store.transact(
            lambda u: stored_identity(u, self.f.owner, self.f.vault, connection)
        )["identity"]
        self.fx.identity = self.identity
        self.fx.conn = self.store.transact(
            lambda u: u.get(document_path("hub_oauth_connections", self.f.owner, connection))
        )
        self.f.identity = self.identity
        self.f.client = self.identity["clientId"]
        self.slot = self.first_slot if connection == CONNECTION else self.second_slot
        self.key = "A1_sig" if connection == CONNECTION else "second_provider_sig"

    def control(
        self, action, *, fingerprint=None, assignment=None, schedule=None, task=TASK, **changes
    ):
        self.serial += 1
        op = f"center_owner_operation_{self.serial:04d}"
        old = getattr(self, "definition", None)
        value = {
            "contractVersion": CONTRACT_VERSION,
            "profile": TASK_CENTER_PROFILE,
            "ownerSubject": self.f.owner,
            "vaultId": self.f.vault,
            "taskId": task,
            "taskVersion": 1,
            "executionEpoch": 1,
            "artifactType": "task_center_control",
            "action": action,
            "rootKeyId": self.f.root_id,
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": self.f.registry.key_epoch,
            "issuedAt": self.fx.now,
            "stableOperationId": op,
            "expectedDefinitionVersion": 0 if old is None else old["definitionVersion"],
            "expectedAssignmentVersion": None,
            "assignmentId": None,
            "schedule": schedule,
            "assignment": None,
            "intent": None,
        }
        if action in {"set_assignment", "remove_assignment"}:
            value.update(
                assignmentId=assignment_id(self.f.owner, self.f.vault, task, self.slot["slotId"]),
                expectedAssignmentVersion=0
                if assignment is None
                else assignment["assignmentVersion"],
            )
        if action == "set_assignment":
            value["assignment"] = {
                "slotId": self.slot["slotId"],
                "provider": self.slot["provider"],
                "slotGeneration": self.slot["slotGeneration"],
                "credential": self.slot["currentCredential"],
                "agentId": self.identity["agentId"],
                "authorityFingerprint": fingerprint,
            }
        value.update(changes)
        self.last_signed = self.f.sign(value)
        self.last_op = value["stableOperationId"]
        return self.owner.command(UID, self.f.vault, task, self.last_signed, self.last_op)

    def context(self, kind):
        self.serial += 1
        c = PersistentContentFixture.content_context(self.f, kind)
        c.update(
            issuedAt=self.fx.now,
            registrySequence=self.f.registry.registry_sequence,
            checkpointDigest=self.f.registry.checkpoint_digest,
            stableOperationId=f"center_publication_{self.serial:04d}",
        )
        c.update({k: self.identity[k] for k in BINDING_FIELDS})
        if kind != "result_revision":
            c["recipients"] = sorted(
                [
                    {**r, "keyId": self.identity["agentEncryptionKeyId"]}
                    if r["role"] == "agent_enc"
                    else r
                    for r in c["recipients"]
                ],
                key=lambda r: r["keyId"],
            )
        if kind == "task":
            state = self.store.transact(
                lambda u: stored_authority(u, self.f.owner, self.f.vault, TASK, self.connection)
            )
            c.update(
                taskId=TASK,
                objectId=TASK,
                taskVersion=1,
                executionEpoch=1,
                ownerTaskFingerprint=self.p.task_fingerprint,
                expectedAuthorityVersion=0
                if state is None
                else state["context"]["authorityVersion"],
                expectedAuthorityDigest=None if state is None else digest(state),
                authorityVersion=1 if state is None else state["context"]["authorityVersion"] + 1,
            )
        else:
            c.update(objectId=self.f.resource["resourceId"], permissionEpoch=1)
        return c

    def args(self, route, request):
        self.serial += 1
        path = (
            BASE.format(owner=self.f.owner, vault=self.f.vault, connection=self.connection) + route
        )
        p = {
            "contractVersion": CONTRACT_VERSION,
            "profile": TASK_CENTER_PROFILE if route.startswith("task-center/") else CONTENT_PROFILE,
            "artifactType": "task_center_agent_request"
            if route.startswith("task-center/")
            else "persistent_agent_request",
            "purpose": "authenticated_request",
            **{k: self.identity[k] for k in BINDING_FIELDS},
            "audience": ISSUER,
            "method": "POST",
            "path": path,
            "bodyDigest": digest(request),
            "requestId": f"center_request_operation_{self.serial:04d}",
            "nonce": b64url_encode(bytes([self.serial % 255]) * 32),
            "issuedAt": self.fx.now,
            "expiresAt": self.fx.now + 120,
        }
        return self.f.owner, self.f.vault, self.connection, self.f.sign(p, self.key), path, request

    def begin(self, base="center_shared_base_trigger_001", *, binding=None, operation=None):
        a = self.assignments[self.connection]
        request = {
            "taskId": TASK,
            "baseTriggerId": base,
            "operationId": operation or "center_begin_" + digest([self.connection, base]),
            "binding": binding or center_reference(self.definition, a),
            "taskPublicationFingerprint": a["authorityFingerprint"],
        }
        prepared = self.agent.prepare(*self.args("task-center/prepare", request))
        request = {
            "taskId": TASK,
            "triggerId": prepared["triggerId"],
            "operationId": request["operationId"],
            "taskPublicationFingerprint": a["authorityFingerprint"],
        }
        return self.execution.begin(*self.args("runs/begin", request))

    def submit(self, run):
        self.serial += 1
        m = run["manifest"]
        op = f"center_result_operation_{self.serial:04d}"
        c = PersistentContentFixture.content_context(self.f, "result_revision")
        c.update({k: self.identity[k] for k in BINDING_FIELDS})
        c.update(
            issuedAt=self.fx.now,
            registrySequence=self.f.registry.registry_sequence,
            checkpointDigest=self.f.registry.checkpoint_digest,
            stableOperationId=op,
            objectId=result_id(self.f.owner, self.f.vault, m["runId"]),
            **{
                k: m[k]
                for k in (
                    "taskId",
                    "taskVersion",
                    "executionEpoch",
                    "authorityId",
                    "authorityVersion",
                    "runId",
                )
            },
            manifestFingerprint=run["manifestFingerprint"],
        )
        carrier = seal_persistent_content(
            PersistentContentFixture.private_content(self.f, c),
            PersistentContentFixture.public_keys(self.f, c),
            context=c,
            signing_private_key=self.f.keys[self.key],
        )
        request = {"runId": m["runId"], "operationId": op, "envelope": carrier}
        return self.writer.submit(*self.args("runs/submit", request))

    def test_two_providers_same_task_slot_have_independent_runs_receipts_and_history(self):
        one = self.begin()
        receipt1 = self.submit(one)
        self.use(self.second)
        two = self.begin()
        receipt2 = self.submit(two)
        self.assertNotEqual(one["manifest"]["runId"], two["manifest"]["runId"])
        self.assertNotEqual(receipt1["resultId"], receipt2["resultId"])
        feed = self.owner.results(UID, self.f.vault, TASK, {"limit": 20, "cursor": None})
        self.assertEqual(
            {i["metadata"]["resultId"] for i in feed["items"]},
            {receipt1["resultId"], receipt2["resultId"]},
        )
        self.assertEqual({i["attribution"]["provider"] for i in feed["items"]}, {"muse", "chatgpt"})
        progress = self.owner.progress(
            UID,
            self.f.vault,
            TASK,
            {
                "requestId": "center_shared_base_trigger_001",
                "assignmentIds": [a["assignmentId"] for a in self.assignments.values()],
            },
        )
        self.assertEqual(progress["aggregate"]["state"], "result_received")
        self.assertFalse(progress["nativeScheduleAttested"])
        self.assertEqual(
            self.history.owner_get(UID, self.f.vault, receipt1["resultId"])["receipt"], receipt1
        )

    def test_removing_one_assignment_fences_its_reads_writes_but_retains_both_histories(self):
        one = self.begin()
        saved = self.submit(one)
        pending = self.begin("center_pending_base_trigger_001")
        self.control("remove_assignment", assignment=self.assignments[CONNECTION])
        for fn in [
            lambda: self.submit(pending),
            lambda: self.agent.context(*self.args("task-center/context", {"taskId": TASK})),
        ]:
            with self.assertRaises(ContractError):
                fn()
        self.assertEqual(
            self.history.owner_get(UID, self.f.vault, saved["resultId"])["receipt"], saved
        )
        self.use(self.second)
        self.assertIsNotNone(self.begin()["manifest"])
        self.control("remove_assignment", assignment=self.assignments[self.second])
        self.assertEqual(
            len(
                self.owner.results(UID, self.f.vault, TASK, {"limit": 20, "cursor": None})["items"]
            ),
            1,
        )
        self.assertEqual(
            self.owner.state(UID, self.f.vault, TASK)["rules"]["definition"]["schedule"], None
        )

    def test_rule_change_invalidates_old_runs_preparations_and_plan_confirmations(self):
        run = self.begin()
        old = self.definition
        self.definition = self.control("set_rules")["definition"]
        with self.assertRaises(ContractError):
            self.submit(run)
        with self.assertRaises(ContractError):
            self.begin()
        self.assertEqual(self.definition["ruleVersion"], old["ruleVersion"] + 1)
        self.assertEqual(
            self.owner.state(UID, self.f.vault, TASK)["assignments"][0]["plan"]["status"],
            "unconfirmed",
        )

    def test_signature_variant_retry_is_original_and_cannot_reinstall_removed_assignment(self):
        self.control("remove_assignment", assignment=self.assignments[CONNECTION])
        original = self.owner.receipt(UID, self.f.vault, TASK, self.last_op)
        _, payload = _signed_parts(self.last_signed)
        self.assertEqual(
            self.owner.command(UID, self.f.vault, TASK, self.f.sign(payload), self.last_op),
            original,
        )
        with self.assertRaises(ContractError):
            self.begin()
        with self.assertRaises(ContractError):
            self.owner.state(OTHER_UID, self.f.vault, TASK)

    def test_legacy_begin_and_forged_trigger_provenance_cannot_bypass_enrollment(self):
        a = self.assignments[CONNECTION]
        request = {
            "taskId": TASK,
            "triggerId": "legacy_unprepared_trigger_0001",
            "operationId": "legacy_unprepared_begin_0001",
            "taskPublicationFingerprint": a["authorityFingerprint"],
        }
        with self.assertRaises(ContractError):
            self.execution.begin(*self.args("runs/begin", request))
        request = {
            "taskId": TASK,
            "baseTriggerId": "center_shared_base_trigger_001",
            "operationId": "center_probe_operation_0001",
            "binding": center_reference(self.definition, a),
            "taskPublicationFingerprint": a["authorityFingerprint"],
            "kind": "scheduled",
        }
        with self.assertRaises(ContractError):
            self.agent.prepare(*self.args("task-center/prepare", request))

    def test_same_preparation_race_and_replay_commit_only_one_run(self):
        def start(_):
            return self.begin()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(start, range(2)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.begin(), results[0])

    def test_one_connection_reuses_multiple_tasks_without_shared_assignment_revocation(self):
        second_task = "synthetic_second_center_task"
        body = self.f.task_body(task=second_task, resources=[])
        from folioview_shared.encrypted.crypto import _signed_parts

        _, message = _signed_parts(body["envelope"]["signedObject"])
        context = message["context"]
        context["stableOperationId"] = "second_center_task_create_001"
        body["envelope"] = self.f.carrier(context)
        self.p.tasks.create(UID, body, "second_center_task_create_001", self.f.kid("device_sig"))
        prior = self.definition
        self.definition = None
        definition = self.control("set_rules", task=second_task)["definition"]
        self.definition = definition
        self.control("set_assignment", task=second_task, fingerprint="f" * 64)
        self.definition = prior
        self.control("remove_assignment", assignment=self.assignments[CONNECTION])
        other = self.owner.state(UID, self.f.vault, second_task)
        self.assertEqual(other["assignments"][0]["assignment"]["status"], "active")
        self.assertEqual(
            other["assignments"][0]["assignment"]["credential"]["connectionId"], CONNECTION
        )

    def test_native_plan_confirmation_is_per_assignment_and_rule_version(self):
        schedule = {
            "frequency": "weekly",
            "days": [1, 3, 5],
            "localTime": "13:47",
            "timeZone": "America/Toronto",
            "graceMinutes": 5,
            "effectiveFrom": self.fx.now,
            "dstGap": "skip",
            "dstFold": "first",
        }
        self.definition = self.control("set_rules", schedule=schedule)["definition"]
        for connection in (CONNECTION, self.second):
            self.use(connection)
            self.assignments[connection] = self.control(
                "set_assignment",
                fingerprint=self.authorities[connection]["fingerprint"],
                assignment=self.assignments[connection],
            )["assignment"]
        self.use(CONNECTION)
        request = {
            "taskId": TASK,
            "operationId": "center_native_plan_operation_001",
            "binding": center_reference(self.definition, self.assignments[CONNECTION]),
            "expectedVersion": 0,
            "provider": "muse",
            "planReferenceHash": "a" * 64,
            "reportedStatus": "enabled",
            "reportedAt": self.fx.now,
        }
        reported = self.agent.report_plan(*self.args("task-center/plans/report", request))
        self.assertFalse(reported["nativeScheduleAttested"])
        self.assertEqual(
            self.agent.report_plan(*self.args("task-center/plans/report", request)), reported
        )
        state = self.owner.state(UID, self.f.vault, TASK)
        by_provider = {
            a["assignment"]["provider"]: a["plan"]["status"] for a in state["assignments"]
        }
        self.assertEqual(by_provider, {"muse": "enabled", "chatgpt": "unconfirmed"})
        self.definition = self.control("set_rules", schedule=schedule)["definition"]
        self.assertTrue(
            all(
                a["plan"]["status"] == "unconfirmed"
                for a in self.owner.state(UID, self.f.vault, TASK)["assignments"]
            )
        )

    def test_production_style_buffered_transaction_commits_fences_and_result_together(self):
        import copy

        original = self.store

        class BufferedUnit:
            def __init__(self, unit):
                self.unit, self.pending = unit, []

            def get(self, path):
                return self.unit.get(path)

            def get_many(self, paths, **options):
                return self.unit.get_many(paths, **options)

            def put(self, path, value):
                self.pending.append((path, copy.deepcopy(value)))

        class BufferedStore:
            def transact(self, callback):
                def run(unit):
                    buffered = BufferedUnit(unit)
                    result = callback(buffered)
                    for path, value in buffered.pending:
                        unit.put(path, value)
                    return result

                return original.transact(run)

        buffered = BufferedStore()
        for service in (self.owner, self.agent, self.execution, self.writer):
            service.store = buffered
        run = self.begin()
        receipt = self.submit(run)
        self.assertEqual(
            self.owner.results(UID, self.f.vault, TASK, {"limit": 1, "cursor": None})["items"][0][
                "metadata"
            ]["resultId"],
            receipt["resultId"],
        )
        self.control("remove_assignment", assignment=self.assignments[CONNECTION])
        with self.assertRaises(ContractError):
            self.begin("buffered_after_remove_trigger_001")

    def test_history_query_batches_metadata_without_reading_ciphertext_or_run_history(self):
        self.submit(self.begin())
        original = self.owner.store
        calls = []

        class ObservedUnit:
            def __init__(self, unit):
                self.unit = unit

            def get(self, path):
                calls.append(("get", path))
                return self.unit.get(path)

            def get_many(self, paths, **options):
                calls.append(("batch", tuple(paths)))
                return self.unit.get_many(paths, **options)

        class ObservedStore:
            def transact(self, callback):
                return original.transact(lambda u: callback(ObservedUnit(u)))

        self.owner.store = ObservedStore()
        self.owner.results(UID, self.f.vault, TASK, {"limit": 20, "cursor": None})
        self.assertEqual(sum(kind == "batch" for kind, _ in calls), 1)
        self.assertFalse(
            any(
                "hub_persistent_result_content" in str(paths) or "hub_persistent_runs" in str(paths)
                for _, paths in calls
            )
        )

    def test_regrant_cannot_relabel_old_preparation_as_a_new_successful_run(self):
        original = self.begin()
        self.definition = self.control("set_rules")["definition"]
        self.assignments[CONNECTION] = self.control(
            "set_assignment",
            fingerprint=self.authorities[CONNECTION]["fingerprint"],
            assignment=self.assignments[CONNECTION],
        )["assignment"]
        with self.assertRaises(ContractError) as failure:
            self.begin()
        self.assertEqual(failure.exception.code, "idempotency_conflict")
        with self.assertRaises(ContractError):
            self.submit(original)
        later = self.begin("explicit_new_base_trigger_0001")
        self.assertNotEqual(later["manifest"]["runId"], original["manifest"]["runId"])

    def test_provider_reauthorization_fences_old_assignment_without_losing_owner_history(self):
        saved = self.submit(self.begin())
        self.pf.fx.fresh_keys()
        self.fx.now = self.pf.fx.fx.now
        packet, operation = self.pf.packet()
        self.pf.apply(packet, operation)
        with self.assertRaises(ContractError):
            self.begin()
        state = self.owner.state(UID, self.f.vault, TASK)
        muse = next(a for a in state["assignments"] if a["assignment"]["provider"] == "muse")
        self.assertFalse(muse["plan"]["currentAssignment"])
        self.assertEqual(muse["plan"]["status"], "unconfirmed")
        self.assertEqual(
            self.history.owner_get(UID, self.f.vault, saved["resultId"])["receipt"], saved
        )
