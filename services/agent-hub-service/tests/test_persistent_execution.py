"""Exact Agent proofs, current fences and immutable trigger replay under real JOSE."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import test_persistent_identity_store as identities
import test_persistent_publications as publications
from fixtures import UID
from test_oauth import TASK, OAuthFixture

from app.persistent_execution import PersistentExecutionService, run_path
from app.store import document_path
from folioview_shared.encrypted.constants import (
    CONTRACT_VERSION,
    MAX_HTTP_WRITE_BYTES,
    MAX_STORED_DOCUMENT_BYTES,
)
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json
from folioview_shared.encrypted.persistent_content import (
    BINDING_FIELDS,
    CONTENT_PROFILE,
    digest,
    open_persistent_content,
)

ISSUER = "https://synthetic-hub.example"


class PersistentKeysFixture(OAuthFixture):
    def pair(self, connection):
        self.add_key("A1_sig", "agent_sig", "synthetic_agent", connection)
        self.add_key("A1_enc", "agent_enc", "synthetic_agent", connection)
        for name in ("A1_sig", "A1_enc"):
            self.certificates[name]["expiresAt"] = 20000
        self.bundle = self.make_bundle(previous=self.registry, issued_at=1000)
        self.registry = self.verify(self.bundle, previous=self.registry)


class PersistentExecutionTests(unittest.TestCase):
    def setUp(self):
        self.p = publications.PublicationTests()
        with patch("test_persistent_identity_store.OAuthFixture", PersistentKeysFixture):
            self.p.setUp()
        self.addCleanup(self.p.doCleanups)
        self.fx, self.f = self.p.fx, self.p.f
        self.source = self.p.publish(self.p.context())
        self.p.create_task()
        self.task = self.p.publish(self.p.context("task"))
        self.service = self.new_service()
        self.base = (
            f"/agent/v3/persistent/owners/{self.f.owner}/vaults/{self.f.vault}"
            f"/connections/{identities.CONNECTION}"
        )
        self.serial = 0

    def new_service(self):
        return PersistentExecutionService(
            self.fx.store,
            self.fx.catalogue,
            audience=ISSUER,
            client_ids=[self.fx.conn["clientId"]],
            clock=lambda: self.fx.now,
        )

    def args(self, route, request, *, key="A1_sig", **changes):
        self.serial += 1
        path = self.base + "/" + route
        payload = {
            "contractVersion": CONTRACT_VERSION,
            "profile": CONTENT_PROFILE,
            "artifactType": "persistent_agent_request",
            "purpose": "authenticated_request",
            **{k: self.fx.identity[k] for k in BINDING_FIELDS},
            "audience": ISSUER,
            "method": "POST",
            "path": path,
            "bodyDigest": digest(request),
            "requestId": f"synthetic_request_{self.serial:04d}",
            "nonce": b64url_encode(bytes([self.serial % 255]) * 32),
            "issuedAt": self.fx.now,
            "expiresAt": self.fx.now + 120,
            **changes,
        }
        return (
            self.f.owner,
            self.f.vault,
            identities.CONNECTION,
            self.f.sign(payload, key),
            path,
            request,
        )

    def begin_request(self, **changes):
        return {
            "taskId": TASK,
            "triggerId": "synthetic_execution_trigger_01",
            "operationId": "synthetic_execution_begin_0001",
            "taskPublicationFingerprint": self.task["fingerprint"],
            **changes,
        }

    def begin(self, **changes):
        return self.service.begin(*self.args("runs/begin", self.begin_request(**changes)))

    def rejects(self, code, action):
        self.fx.rejects(code, action)

    def test_freeze_uses_storage_budget_for_already_verified_registry_history(self):
        # Grow real, Root-signed history through the normal bounded vault API.
        # Every incoming bundle fits its write budget; accumulated history may
        # legitimately be larger than a single incoming HTTP write.
        for index in range(24):
            self.f.add_key(
                f"history_agent_{index}",
                "agent_enc",
                f"history_agent_{index}",
                f"history_connection_{index}",
            )
        path = document_path("hub_vaults", self.f.owner)

        def append():
            row = self.fx.store.transact(lambda unit: unit.get(path))
            bundle = self.f.make_bundle(previous=self.f.registry, issued_at=self.fx.now)
            self.fx.vaults.update_registry(
                UID,
                self.f.vault,
                {
                    "contractVersion": CONTRACT_VERSION,
                    "expectedVersion": row["version"],
                    "registryBundle": bundle,
                },
                f"synthetic_history_append_{len(row['registryHistory']):04d}",
            )
            self.f.registry = self.f.verify(bundle, previous=self.f.registry, now=self.fx.now)
            return self.fx.store.transact(lambda unit: unit.get(path))["registryHistory"]

        history = append()
        while len(canonical_json(history)) <= MAX_HTTP_WRITE_BYTES:
            self.assertLess(len(history), 31, "fixture must stay within supported registry history")
            history = append()
        self.assertLess(len(canonical_json(history)), MAX_STORED_DOCUMENT_BYTES)
        response = self.begin()
        saved_path = run_path(self.f.owner, self.f.vault, response["manifest"]["runId"])
        saved = self.fx.store.transact(lambda unit: unit.get(saved_path))
        self.assertEqual(saved["registryHistory"], history)
        self.assertLess(len(canonical_json(saved)), MAX_STORED_DOCUMENT_BYTES)

        # Normal SDK document-budget checks still ran at the committing write.
        # A later valid registry update and catalogue outage must not replace or
        # rebuild the original immutable run on an exact trigger retry.
        newer = append()
        self.assertEqual(len(newer), len(history) + 1)
        self.fx.catalogue.unavailable = True
        self.assertEqual(self.begin(), response)
        self.assertEqual(
            self.fx.store.transact(lambda unit: unit.get(saved_path))["registryHistory"], history
        )

    def test_transport_expiry_does_not_erase_identity_or_exact_authorized_task(self):
        self.fx.now = 1002
        tasks = self.service.tasks(*self.args("tasks", {}))["tasks"]
        self.assertEqual([r["taskId"] for r in tasks], [TASK])
        output = self.service.task_input(*self.args("task-input", {"taskId": TASK}))
        self.assertEqual(output["authority"]["fingerprint"], self.task["fingerprint"])
        self.assertEqual(
            len(
                open_persistent_content(
                    output["envelope"]["jwe"], self.f.keys["A1_enc"], context=self.task["context"]
                )["payload"]["name"]
            ),
            len("Synthetic daily brief"),
        )

    def test_begin_freezes_inputs_and_process_restart_preserves_original_run(self):
        first = self.begin()
        self.service = self.new_service()
        self.assertEqual(self.begin(), first)
        m = first["manifest"]
        self.assertEqual(m["inputs"][0]["publicationFingerprint"], self.source["fingerprint"])
        result = self.service.input(
            *self.args(
                "runs/input",
                {"runId": m["runId"], "publicationId": m["inputs"][0]["publicationId"]},
            )
        )
        content = open_persistent_content(
            result["envelope"]["jwe"], self.f.keys["A1_enc"], context=self.source["context"]
        )
        self.assertEqual(content["objectId"], self.f.resource["resourceId"])
        self.assertNotIn("Synthetic", canonical_json(first).decode())

    def test_same_trigger_racing_requests_allocate_one_run(self):
        args = self.args("runs/begin", self.begin_request())
        with ThreadPoolExecutor(max_workers=2) as pool:
            a, b = list(pool.map(lambda _: self.service.begin(*args), range(2)))
        self.assertEqual(a, b)
        self.assertEqual(self.begin(), a)

    def test_changed_original_operation_or_cycle_is_not_new_run(self):
        self.begin()
        self.rejects(
            "idempotency_conflict", lambda: self.begin(triggerId="synthetic_execution_other_cycle")
        )
        self.rejects(
            "idempotency_conflict",
            lambda: self.begin(operationId="synthetic_execution_new_operation"),
        )
        self.rejects(
            "idempotency_conflict", lambda: self.begin(taskPublicationFingerprint="f" * 64)
        )

    def test_original_receipt_resolves_source_outage_without_extending_expired_run(self):
        first = self.begin()
        self.fx.now += 7300
        self.fx.catalogue.unavailable = True
        self.assertEqual(self.begin(), first)
        receipt = self.service.run_receipt(
            *self.args("runs/receipt", {"runId": first["manifest"]["runId"]})
        )
        self.assertEqual(receipt["manifest"]["expiresAt"], first["manifest"]["expiresAt"])

    def test_resource_revocation_blocks_inputs_even_after_begin(self):
        first = self.begin()
        self.fx.apply(self.fx.command(targets=[self.fx.revoke_target()]), revoke=True)
        m = first["manifest"]
        self.rejects(
            "insufficient_scope",
            lambda: self.service.input(
                *self.args(
                    "runs/input",
                    {"runId": m["runId"], "publicationId": m["inputs"][0]["publicationId"]},
                )
            ),
        )
        self.rejects(
            "insufficient_scope",
            lambda: self.begin(
                triggerId="synthetic_execution_cycle_02", operationId="synthetic_execution_begin_02"
            ),
        )
        # A historic receipt is not an input capability.
        self.assertEqual(self.begin()["manifest"], m)

    def test_unpublished_new_source_blocks_new_begin_but_not_frozen_old_input(self):
        first = self.begin()
        m = first["manifest"]
        self.fx.catalogue.revision = 2
        self.rejects(
            "source_unavailable",
            lambda: self.begin(
                triggerId="synthetic_execution_cycle_02", operationId="synthetic_execution_begin_02"
            ),
        )
        result = self.service.input(
            *self.args(
                "runs/input",
                {"runId": m["runId"], "publicationId": m["inputs"][0]["publicationId"]},
            )
        )
        self.assertEqual(result["manifestFingerprint"], first["manifestFingerprint"])
        self.p.publish(self.p.context(revision=2, expectedRevision=1, sourceRevision=2))
        newer = self.begin(
            triggerId="synthetic_execution_cycle_02", operationId="synthetic_execution_begin_02"
        )
        self.assertEqual(newer["manifest"]["inputs"][0]["sourceRevision"], 2)
        self.assertEqual(first["manifest"]["inputs"][0]["sourceRevision"], 1)

    def test_task_authority_replacement_blocks_old_run_without_reencrypting_policy(self):
        first = self.begin()
        m = first["manifest"]
        self.p.publish(self.p.context("task"))
        self.rejects(
            "version_conflict",
            lambda: self.service.input(
                *self.args(
                    "runs/input",
                    {"runId": m["runId"], "publicationId": m["inputs"][0]["publicationId"]},
                )
            ),
        )

    def test_wrong_path_body_audience_signer_and_expired_proof_are_rejected(self):
        for changes in (
            {"audience": "https://other.example"},
            {"path": self.base + "/session"},
            {"bodyDigest": "f" * 64},
            {"issuedAt": 800, "expiresAt": 920},
        ):
            args = self.args("tasks", {}, **changes)
            with self.assertRaises(ContractError):
                self.service.tasks(*args)
        with self.assertRaises(ContractError):
            self.service.tasks(*self.args("tasks", {}, key="device_sig"))

    def test_scope_selectors_and_arbitrary_input_cannot_be_added(self):
        self.rejects(
            "malformed_request",
            lambda: self.service.tasks(*self.args("tasks", {"ownerSubject": "other"})),
        )
        self.rejects(
            "malformed_request",
            lambda: self.service.begin(
                *self.args("runs/begin", {**self.begin_request(), "inputs": [self.source]})
            ),
        )
        first = self.begin()
        self.rejects(
            "not_found",
            lambda: self.service.input(
                *self.args(
                    "runs/input",
                    {
                        "runId": first["manifest"]["runId"],
                        "publicationId": "synthetic_unselected_publication",
                    },
                )
            ),
        )

    def test_identity_and_connection_revocation_stop_request_proofs(self):
        payload = {
            **self.fx.payload,
            "artifactType": "persistent_agent_revoke",
            "stableOperationId": identities.REVOKE,
            "bindingFingerprint": self.fx.identity["bindingFingerprint"],
        }
        self.fx.identities.command(
            UID,
            self.f.vault,
            identities.CONNECTION,
            self.f.sign(payload),
            identities.REVOKE,
            revoke=True,
        )
        self.rejects(
            "key_authorization_required", lambda: self.service.tasks(*self.args("tasks", {}))
        )

    def test_unrelated_policy_edit_does_not_revoke_current_input(self):
        first = self.begin()
        m = first["manifest"]
        self.fx.apply(
            self.fx.command(
                resources=[self.fx.proposal(ref=self.fx.b, ident="permission_B", floor=1)]
            )
        )
        result = self.service.input(
            *self.args(
                "runs/input",
                {"runId": m["runId"], "publicationId": m["inputs"][0]["publicationId"]},
            )
        )
        self.assertEqual(result["manifestFingerprint"], first["manifestFingerprint"])

    def test_proof_expiring_during_commit_checks_cannot_allocate_run_or_charge_quota(self):
        quota = self.service.quota

        def expired(unit, owner, connection):
            quota(unit, owner, connection)
            self.fx.now += 121

        with patch.object(self.service, "quota", side_effect=expired):
            self.rejects("key_authorization_required", lambda: self.begin())
        # A fresh proof with the same business intent still allocates normally.
        self.assertEqual(self.begin()["state"], "ready")
