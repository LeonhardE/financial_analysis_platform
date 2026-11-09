"""Real Root/Agent JOSE and durable ciphertext without an OAuth parent or token."""

import copy
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

import test_persistent_execution as executions
import test_persistent_identity_store as identities
import test_persistent_publications as publications
import test_persistent_resource_store as consents
import test_persistent_results as results
from fixtures import BOOT, OTHER_UID, UID
from test_oauth import TASK

from app.executor_connections import (
    SCOPE_PROFILE,
    ExecutorConfig,
    ExecutorIdentityService,
    connection_path,
)
from app.executor_content import ExecutorExecution, ExecutorPublications, ExecutorResources
from app.fences import FenceService
from app.persistent_execution import PersistentExecutionService
from app.persistent_results import PersistentOwnerResultService
from app.store import document_path
from app.tasks import TaskService
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import _signed_parts, sign_jws, signing_input_fingerprint
from folioview_shared.encrypted.executor_trust import EXECUTOR_TRUST_PROFILE
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode, canonical_json
from folioview_shared.encrypted.persistent_agents import PERSISTENT_AGENT_PROFILE
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    digest,
    open_persistent_content,
)


class IndependentKeysFixture(executions.PersistentKeysFixture):
    def __init__(self):
        super().__init__()
        for certificate in self.certificates.values():
            certificate["expiresAt"] = 20000
        self.bundle = self.make_bundle()
        self.registry = self.verify(self.bundle)


class ExecutorFixture(unittest.TestCase):
    make_store = identities.PersistentAgentTests.make_store
    rejects = identities.PersistentAgentTests.rejects

    def setUp(self):
        self.store = self.make_store()
        self.now = 1000
        self.f = IndependentKeysFixture()
        self.vaults = VaultService(self.store, clock=lambda: self.now)
        self.vaults.bootstrap(UID, self.f.bootstrap(), BOOT)
        self.f.pair(identities.CONNECTION)
        self.vaults.update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 1,
                "registryBundle": self.f.bundle,
            },
            "synthetic_executor_registry_01",
        )
        self.configuration = {
            "hubAudience": executions.ISSUER,
            "clientId": "synthetic_executor",
            "issuer": "https://synthetic-policy.example",
            "audience": "https://synthetic-executor.example/execute",
            "provider": "synthetic",
            "providerClientId": "synthetic_model_client",
            "workloadDigest": "a" * 64,
            "tlsKeyId": b64url_encode(b"t" * 32),
            "policySigningKeyId": b64url_encode(b"p" * 32),
        }
        self.config = ExecutorConfig(self.configuration)
        self.identities = ExecutorIdentityService(
            self.store, config=self.config, clock=lambda: self.now
        )
        self.payload = {
            **self.f.base("persistent_agent_binding"),
            "profile": PERSISTENT_AGENT_PROFILE,
            "rootKeyId": self.f.root_id,
            "connectionId": identities.CONNECTION,
            "agentId": "synthetic_agent",
            "clientId": self.config.channel["clientId"],
            "identityEpoch": 1,
            "agentSigningKeyId": self.f.kid("A1_sig"),
            "agentEncryptionKeyId": self.f.kid("A1_enc"),
            "deviceSigningKeyId": self.f.kid("device_sig"),
            "stableOperationId": identities.ENROLL,
            "registrySequence": self.f.registry.registry_sequence,
            "checkpointDigest": self.f.registry.checkpoint_digest,
            "keyEpoch": 1,
            "issuedAt": 1000,
        }
        self.signed = self.f.sign(self.payload)
        self.scope = {
            "profile": SCOPE_PROFILE,
            "purpose": "analysis",
            "resultPolicy": "owner_inbox",
            "resourceBindings": [{"ref": self.f.resource, "sourceEpoch": 1}],
        }
        self.binding = {
            **{k: self.payload[k] for k in BINDING_FIELDS if k != "bindingFingerprint"},
            "bindingFingerprint": signing_input_fingerprint(self.signed),
            **self.config.channel,
            "recipientKeyIds": sorted([self.f.kid("device_enc"), self.f.kid("recovery_enc")]),
            "scopeDigest": digest(self.scope),
        }
        self.approval = self.approve()

    def approve(self, *, author="root", **changes):
        return self.f.sign(
            {
                "contractVersion": CONTRACT_VERSION,
                "profile": EXECUTOR_TRUST_PROFILE,
                "artifactType": "executor_approval",
                "binding": self.binding,
                "operationId": identities.ENROLL,
                "issuedAt": 1000,
                "expiresAt": 18000,
                **changes,
            },
            author,
        )

    def enroll(self, *, approval=None, scope=None, command=None, uid=UID):
        return self.identities.register(
            uid,
            self.f.vault,
            identities.CONNECTION,
            command or self.signed,
            approval or self.approval,
            scope or self.scope,
            identities.ENROLL,
        )

    def revoke(self):
        payload = {
            **self.payload,
            "artifactType": "persistent_agent_revoke",
            "stableOperationId": identities.REVOKE,
            "bindingFingerprint": self.binding["bindingFingerprint"],
            "issuedAt": self.now,
        }
        return self.identities.command(
            UID,
            self.f.vault,
            identities.CONNECTION,
            self.f.sign(payload),
            identities.REVOKE,
            revoke=True,
        )


class ExecutorEnrollmentTests(ExecutorFixture):
    def test_no_oauth_rows_tokens_or_private_keys_and_original_retry_is_immutable(self):
        first = self.enroll()
        self.assertEqual(first, self.enroll())
        self.now = 1100
        self.revoke()
        self.assertEqual(first, self.enroll())
        state = ExecutorIdentityService(self.store, clock=lambda: self.now).state(
            UID, self.f.vault, identities.CONNECTION
        )
        self.assertEqual(state["identity"]["status"], "revoked")
        self.assertEqual(state["receipt"], first)
        with closing(sqlite3.connect(self.store.path)) as db:
            rows = db.execute("SELECT path, body FROM hub_documents").fetchall()
        self.assertFalse(any(p.startswith("hub_oauth_") for p, _ in rows))
        self.assertNotIn('"d":', canonical_json([list(row) for row in rows]).decode())
        self.assertNotIn('"access_token"', canonical_json([list(row) for row in rows]).decode())

    def test_root_and_device_approval_are_both_required_and_scope_channel_cannot_be_selected(self):
        self.rejects(
            "invalid_signature", lambda: self.enroll(approval=self.approve(author="device_sig"))
        )
        self.rejects(
            "key_authorization_required",
            lambda: self.enroll(command=self.f.sign(self.payload, "root")),
        )
        changes = [
            {"providerClientId": "wrong_provider"},
            {"issuer": "https://other.example"},
            {"audience": "https://other.example/execute"},
            {"workloadDigest": "b" * 64},
            {"tlsKeyId": b64url_encode(b"q" * 32)},
            {"scopeDigest": "f" * 64},
            {"recipientKeyIds": [self.f.kid("device_enc")]},
            {"agentEncryptionKeyId": b64url_encode(b"x" * 32)},
        ]
        for change in changes:
            with self.subTest(change=change):
                self.rejects(
                    "key_authorization_required",
                    lambda change=change: self.enroll(
                        approval=self.approve(binding=self.binding | change)
                    ),
                )
        self.rejects(
            "key_authorization_required", lambda: self.enroll(approval=self.approve(expiresAt=1000))
        )
        self.rejects("not_found", lambda: self.enroll(uid=OTHER_UID))

    def test_same_registration_operation_cannot_change_approval_or_body(self):
        self.enroll()
        self.rejects(
            "idempotency_conflict", lambda: self.enroll(approval=self.approve(expiresAt=17000))
        )
        self.rejects("idempotency_conflict", lambda: self.enroll(command=self.f.sign(self.payload)))
        altered = copy.deepcopy(self.scope)
        altered["resourceBindings"][0]["sourceEpoch"] = 2
        self.rejects("idempotency_conflict", lambda: self.enroll(scope=altered))

    def test_parallel_registration_cas_creates_one_parent_and_no_legacy_fallback(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            a, b = list(pool.map(lambda _: self.enroll(), range(2)))
        self.assertEqual(a, b)
        old = PersistentExecutionService(self.store, None, audience=executions.ISSUER)
        self.rejects(
            "not_found",
            lambda: old.session(
                self.f.owner, self.f.vault, identities.CONNECTION, {}, "/legacy", {}
            ),
        )


class ExecutorCiphertextTests(ExecutorFixture):
    output_context = results.PersistentResultTests.output_context
    seal = results.PersistentResultTests.seal

    def setUp(self):
        super().setUp()
        self.enroll()
        self.fx = consents.ResourceConsentStoreTests()
        self.fx.f, self.fx.store, self.fx.now = self.f, self.store, self.now
        self.fx.identity = self.identities.state(UID, self.f.vault, identities.CONNECTION)[
            "identity"
        ]
        self.fx.conn = {"clientId": self.config.channel["clientId"]}
        self.fx.a = self.f.resource
        self.fx.b = {**self.f.resource, "resourceId": "holdings_B", "incarnation": "incarnation_B"}
        self.fx.catalogue = consents.Catalogue([self.fx.a, self.fx.b])
        self.fx.catalogue.revision = 1
        self.fx.serial = 0
        self.fx.service = ExecutorResources(
            self.store, self.fx.catalogue, config=self.config, clock=lambda: self.fx.now
        )
        self.fx.apply(self.fx.command(resources=[self.fx.proposal(floor=1)]))
        self.f.identity, self.f.client = self.fx.identity, self.config.channel["clientId"]
        self.p = publications.PublicationTests()
        self.p.f, self.p.fx, self.p.serial = self.f, self.fx, 0
        self.p.service = ExecutorPublications(
            self.store, self.fx.catalogue, config=self.config, clock=lambda: self.fx.now
        )
        self.p.tasks = TaskService(self.store, self.fx.catalogue, clock=lambda: self.fx.now)
        self.source = self.p.publish(self.p.context())
        self.p.create_task()
        self.task = self.p.publish(self.p.context("task"))
        self.service = self.new_service()
        self.x = executions.PersistentExecutionTests()
        self.x.fx, self.x.f, self.x.p = self.fx, self.f, self.p
        self.x.source, self.x.task, self.x.service = self.source, self.task, self.service
        self.x.serial = 0
        self.x.base = (
            f"/agent/v3/persistent/executor/owners/{self.f.owner}/vaults/{self.f.vault}"
            f"/connections/{identities.CONNECTION}"
        )
        self.run = self.x.begin()
        self.manifest = self.run["manifest"]
        self.operation = "synthetic_executor_result_operation_0001"
        self.context = self.output_context()
        self.carrier = self.seal(self.context)
        self.history = PersistentOwnerResultService(self.store, clock=lambda: self.fx.now)

    def new_service(self, config=None):
        return ExecutorExecution(
            self.store, self.fx.catalogue, config=config or self.config, clock=lambda: self.fx.now
        )

    def submit(self, *, carrier=None, operation=None):
        request = {
            "runId": self.manifest["runId"],
            "operationId": operation or self.operation,
            "envelope": carrier or self.carrier,
        }
        return self.service.submit(*self.x.args("runs/submit", request))

    def test_end_to_end_frozen_task_and_resource_are_original_ciphertext_only(self):
        session = self.service.session(*self.x.args("session", {}))
        self.assertEqual(session["identity"], self.fx.identity)
        for publication in [self.task, self.source]:
            response = self.service.input(
                *self.x.args(
                    "runs/input",
                    {
                        "runId": self.manifest["runId"],
                        "publicationId": publication["publicationId"],
                    },
                )
            )
            self.assertEqual(response["manifestFingerprint"], self.run["manifestFingerprint"])
            self.assertNotIn("Synthetic", canonical_json(response).decode())
            plain = open_persistent_content(
                response["envelope"]["jwe"], self.f.keys["A1_enc"], context=publication["context"]
            )
            self.assertIn("payload", plain)
        receipt = self.submit()
        saved = self.history.owner_get(UID, self.f.vault, receipt["resultId"])
        self.assertEqual(saved["envelope"], self.carrier)
        for key in ("device_enc", "recovery_enc"):
            plain = open_persistent_content(
                saved["envelope"]["jwe"], self.f.keys[key], context=self.context
            )
            self.assertEqual(plain["payload"]["title"], "Synthetic daily report")
        self.assertNotIn("Synthetic", canonical_json(saved).decode())
        self.assertIsNone(
            self.store.transact(lambda u: u.get(document_path("hub_oauth_owners", self.f.owner)))
        )

    def test_original_retry_after_restart_run_expiry_source_outage_and_strict_bytes(self):
        first = self.submit()
        self.service = self.new_service()
        self.fx.now += 7300
        self.fx.catalogue.unavailable = True
        self.assertEqual(first, self.submit())
        self.assertEqual(
            first,
            self.service.result_receipt(
                *self.x.args("runs/result-receipt", {"runId": self.manifest["runId"]})
            ),
        )
        self.rejects("idempotency_conflict", lambda: self.submit(carrier=self.seal(self.context)))
        # ES256's alternate valid s is the same signing input, but different original bytes.
        changed = copy.deepcopy(self.carrier)
        raw = b64url_decode(changed["proof"]["signature"])
        order = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
        changed["proof"]["signature"] = b64url_encode(
            raw[:32] + (order - int.from_bytes(raw[32:], "big")).to_bytes(32, "big")
        )
        self.assertEqual(
            signing_input_fingerprint(changed["proof"]),
            signing_input_fingerprint(self.carrier["proof"]),
        )
        self.rejects("idempotency_conflict", lambda: self.submit(carrier=changed))
        self.assertEqual(len(self.history.owner_list(UID, self.f.vault)["items"]), 1)

    def test_request_proof_binds_body_path_audience_and_signer(self):
        for change in (
            {"audience": "https://other.example"},
            {"bodyDigest": "f" * 64},
            {"path": self.x.base + "/runs/submit"},
            {"expiresAt": 1000},
        ):
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    self.service.session(*self.x.args("session", {}, **change))
        self.rejects(
            "invalid_signature",
            lambda: self.service.session(*self.x.args("session", {}, key="device_sig")),
        )

    def test_source_revocation_during_rpc_prevents_read_and_write(self):
        self.fx.catalogue.callback = lambda: self.fx.apply(
            self.fx.command(targets=[self.fx.revoke_target()]), revoke=True
        )
        self.rejects("insufficient_scope", self.submit)
        self.rejects(
            "insufficient_scope",
            lambda: self.service.input(
                *self.x.args(
                    "runs/input",
                    {
                        "runId": self.manifest["runId"],
                        "publicationId": self.source["publicationId"],
                    },
                )
            ),
        )
        self.assertEqual(self.history.owner_list(UID, self.f.vault)["items"], [])

    def test_source_fence_and_changed_task_authority_reject_stale_run(self):
        self.p.publish(self.p.context("task"))
        self.rejects("version_conflict", self.submit)
        self.rejects(
            "version_conflict",
            lambda: self.service.input(
                *self.x.args(
                    "runs/input",
                    {"runId": self.manifest["runId"], "publicationId": self.task["publicationId"]},
                )
            ),
        )

    def test_source_invalidation_wins_even_with_a_stale_catalogue(self):
        FenceService(self.store).invalidate(
            {
                "contractVersion": CONTRACT_VERSION,
                "ownerSubject": self.f.owner,
                "mutationId": "synthetic_executor_source_deleted_01",
                "ref": self.f.resource,
                "expectedSourceEpoch": 1,
                "newSourceEpoch": 2,
                "reason": "deleted",
            },
            source_service="portfolio",
        )
        self.rejects("version_conflict", self.submit)

    def test_current_recipient_set_and_exact_report_signer_are_required(self):
        _, payload = _signed_parts(self.carrier["proof"])
        bad = copy.deepcopy(self.carrier)
        bad["proof"] = sign_jws(payload, self.f.keys["device_sig"], typ="fv-control+jws")
        self.rejects("invalid_signature", lambda: self.submit(carrier=bad))
        context = self.output_context(
            recipients=[r for r in self.context["recipients"] if r["role"] == "recovery_enc"]
        )
        with self.assertRaises(ValueError):
            self.submit(carrier=self.seal(context))

    def test_newer_source_publication_does_not_replace_the_frozen_original_input(self):
        old = self.service.input(
            *self.x.args(
                "runs/input",
                {"runId": self.manifest["runId"], "publicationId": self.source["publicationId"]},
            )
        )
        self.fx.catalogue.revision = 2
        self.p.publish(self.p.context(revision=2, expectedRevision=1, sourceRevision=2))
        original = self.service.input(
            *self.x.args(
                "runs/input",
                {"runId": self.manifest["runId"], "publicationId": self.source["publicationId"]},
            )
        )
        self.assertEqual(original, old)

    def test_terminal_revocation_denies_agent_receipts_and_retains_owner_report_history(self):
        receipt = self.submit()
        self.revoke()
        self.rejects("key_authorization_required", self.submit)
        self.rejects(
            "key_authorization_required",
            lambda: self.service.result_receipt(
                *self.x.args("runs/result-receipt", {"runId": self.manifest["runId"]})
            ),
        )
        self.assertEqual(
            self.history.owner_get(UID, self.f.vault, receipt["resultId"])["envelope"], self.carrier
        )

    def test_distinct_operation_cannot_create_a_second_report_for_one_run(self):
        first = self.submit()
        operation = "synthetic_executor_other_result_operation_01"
        self.rejects(
            "initial_result_exists",
            lambda: self.submit(
                carrier=self.seal(self.output_context(stableOperationId=operation)),
                operation=operation,
            ),
        )
        self.assertEqual(self.submit(), first)

    def test_owner_recipient_rotation_invalidates_the_old_root_approved_set(self):
        self.f.add_key("new_device_enc", "device_enc", "synthetic_new_device")
        self.f.bundle = self.f.make_bundle(previous=self.f.registry, issued_at=self.fx.now)
        self.vaults.update_registry(
            UID,
            self.f.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": 2,
                "registryBundle": self.f.bundle,
            },
            "synthetic_executor_recipient_rotation_01",
        )
        self.rejects("registry_conflict", self.submit)

    def test_immutable_scope_ceiling_blocks_other_resources_and_task_publication(self):
        self.fx.apply(
            self.fx.command(
                resources=[self.fx.proposal(ref=self.fx.b, ident="permission_B", floor=1)]
            )
        )
        c = self.p.context(
            ref=self.fx.b, objectId=self.fx.b["resourceId"], permissionId="permission_B"
        )
        self.rejects("insufficient_scope", lambda: self.p.publish(c))
        # A signed current task cannot expand the independently Root-approved cap.
        value = self.f.task_body(version=2, resources=[{"ref": self.fx.b, "sourceEpoch": 1}])
        self.p.tasks.update(
            UID, TASK, value, "synthetic_oauth_task_create_2", self.f.kid("device_sig")
        )
        self.p.task_fingerprint = signing_input_fingerprint(value["envelope"]["signedObject"])
        self.rejects(
            "insufficient_scope",
            lambda: self.p.publish(
                self.p.context(
                    "task",
                    taskVersion=2,
                    revision=2,
                    expectedRevision=1,
                    resourceBindings=[{"ref": self.fx.b, "sourceEpoch": 1}],
                )
            ),
        )

    def test_config_drift_approval_expiry_and_terminal_revocation_stop_access(self):
        changed = ExecutorConfig(self.configuration | {"providerClientId": "changed_client"})
        other = self.new_service(changed)
        self.rejects(
            "key_authorization_required", lambda: other.session(*self.x.args("session", {}))
        )
        self.fx.now = 18000
        self.rejects(
            "key_authorization_required", lambda: self.service.session(*self.x.args("session", {}))
        )
        # Owner narrowing is independent of transport activation/approval expiry.
        self.now = self.fx.now
        self.identities.config = None
        self.revoke()
        self.rejects(
            "key_authorization_required", lambda: self.service.session(*self.x.args("session", {}))
        )

    def test_parallel_report_cas_and_original_publication_bytes(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            a, b = list(pool.map(lambda _: self.submit(), range(2)))
        self.assertEqual(a, b)
        self.assertEqual(len(self.history.owner_list(UID, self.f.vault)["items"]), 1)
        envelope = self.p.service.receipt(
            UID, self.f.vault, identities.CONNECTION, self.source["publicationId"]
        )["envelope"]
        self.assertEqual(self.p.publish(self.source["context"], envelope), self.source)
        changed = copy.deepcopy(envelope)
        _, payload = _signed_parts(changed["proof"])
        changed["proof"] = self.f.sign(payload, "root")
        self.rejects(
            "idempotency_conflict", lambda: self.p.publish(self.source["context"], changed)
        )

    def test_oversize_and_foreign_manifest_selectors_fail(self):
        request = {
            "runId": self.manifest["runId"],
            "operationId": self.operation,
            "envelope": {"oversize": "x" * 600000},
        }
        with self.assertRaises(ValueError):
            self.service.submit(*self.x.args("runs/submit", request))
        self.rejects(
            "not_found",
            lambda: self.service.input(
                *self.x.args(
                    "runs/input",
                    {
                        "runId": self.manifest["runId"],
                        "publicationId": "synthetic_foreign_publication_01",
                    },
                )
            ),
        )
        saved = self.store.transact(
            lambda u: u.get(connection_path(self.f.owner, self.f.vault, identities.CONNECTION))
        )
        self.assertEqual(saved["binding"], self.binding)
