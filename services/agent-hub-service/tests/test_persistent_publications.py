"""Synthetic Root publications enforce live producer, policy and authority CAS."""

import unittest

import test_persistent_identity_store as identities
import test_persistent_resource_store as consents
from fixtures import OTHER_UID, UID
from test_oauth import TASK
from test_persistent_content import PersistentContentFixture

from app.fences import FenceService
from app.persistent_publications import PersistentPublicationService
from app.tasks import TaskService
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.jsonutil import canonical_json
from folioview_shared.encrypted.persistent_content import digest, seal_persistent_content


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.fx = consents.ResourceConsentStoreTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.f = self.fx.f
        self.f.identity = self.fx.identity
        self.f.client = self.fx.conn["clientId"]
        self.fx.catalogue.revision = 1
        self.fx.apply(self.fx.command(resources=[self.fx.proposal(floor=1)]))
        self.service = PersistentPublicationService(
            self.fx.store, self.fx.catalogue, clock=lambda: self.fx.now
        )
        self.tasks = TaskService(self.fx.store, self.fx.catalogue, clock=lambda: self.fx.now)
        self.serial = 0

    def context(self, kind="holdings_snapshot", **changes):
        self.serial += 1
        c = PersistentContentFixture.content_context(self.f, kind)
        c.update(
            registrySequence=self.f.registry.registry_sequence,
            checkpointDigest=self.f.registry.checkpoint_digest,
            stableOperationId=f"synthetic_publication_{self.serial:04d}",
        )
        if kind != "task":
            c.update(objectId=self.f.resource["resourceId"], permissionEpoch=1)
        else:
            state = self.service.task_state(UID, self.f.vault, TASK)["authority"]
            c.update(
                taskId=TASK,
                objectId=TASK,
                ownerTaskFingerprint=self.task_fingerprint,
                expectedAuthorityVersion=0
                if state is None
                else state["context"]["authorityVersion"],
                expectedAuthorityDigest=None if state is None else digest(state),
                authorityVersion=1 if state is None else state["context"]["authorityVersion"] + 1,
            )
        c.update(changes)
        return c

    def seal(self, c, *, signer="root"):
        value = PersistentContentFixture.private_content(self.f, c)
        if c["objectType"] != "task":
            value["payload"]["data"]["snapshotId"] = c["objectId"]
        keys = PersistentContentFixture.public_keys(self.f, c)
        return seal_persistent_content(
            value,
            keys,
            context=c,
            signing_private_key=self.f.root if signer == "root" else self.f.keys[signer],
        )

    def publish(self, c, carrier=None, uid=UID):
        return self.service.publish(
            uid,
            self.f.vault,
            identities.CONNECTION,
            carrier or self.seal(c),
            c["stableOperationId"],
        )

    def create_task(self):
        value = self.f.task_body(resources=[{"ref": self.f.resource, "sourceEpoch": 1}])
        self.task_fingerprint = signing_input_fingerprint(value["envelope"]["signedObject"])
        self.tasks.create(UID, value, "synthetic_oauth_task_create_1", self.f.kid("device_sig"))

    def rejects(self, code, action):
        self.fx.rejects(code, action)

    def test_exact_retry_after_transport_expiry_and_source_outage_uses_original_ciphertext(self):
        c = self.context()
        carrier = self.seal(c)
        first = self.publish(c, carrier)
        self.fx.now = 1400
        self.fx.catalogue.unavailable = True
        self.assertEqual(self.publish(c, carrier), first)
        receipt = self.service.receipt(
            UID, self.f.vault, identities.CONNECTION, c["stableOperationId"]
        )
        self.assertEqual(receipt.pop("envelope"), carrier)
        self.assertEqual(receipt, first)
        self.rejects("idempotency_conflict", lambda: self.publish(c, self.seal(c)))

    def test_new_source_versions_reuse_policy_and_skip_missing_revisions(self):
        first = self.publish(self.context())
        policy = self.fx.state()["consent"]
        self.fx.catalogue.revision = 4
        newer = self.publish(self.context(revision=4, expectedRevision=3, sourceRevision=4))
        self.assertEqual(newer["context"]["permissionEpoch"], first["context"]["permissionEpoch"])
        self.assertEqual(policy, self.fx.state()["consent"])

    def test_future_or_stale_source_cannot_be_published(self):
        self.rejects(
            "source_unavailable",
            lambda: self.publish(self.context(revision=2, expectedRevision=1, sourceRevision=2)),
        )
        self.fx.catalogue.revision = 3
        self.rejects("source_unavailable", lambda: self.publish(self.context()))

    def test_revocation_during_source_rpc_wins_publication(self):
        self.fx.catalogue.callback = lambda: self.fx.apply(
            self.fx.command(targets=[self.fx.revoke_target()]), revoke=True
        )
        self.rejects("insufficient_scope", lambda: self.publish(self.context()))

    def test_source_invalidation_during_rpc_wins_even_if_catalogue_is_stale(self):
        self.fx.catalogue.callback = lambda: FenceService(
            self.fx.store, clock=lambda: 1000
        ).invalidate(
            {
                "contractVersion": self.f.base("control_command")["contractVersion"],
                "ownerSubject": self.f.owner,
                "mutationId": "synthetic_publication_delete_01",
                "ref": self.f.resource,
                "expectedSourceEpoch": 1,
                "newSourceEpoch": 2,
                "reason": "deleted",
            },
            source_service="portfolio",
        )
        self.rejects("version_conflict", lambda: self.publish(self.context()))

    def test_device_or_agent_cannot_publish_root_authorized_input(self):
        c = self.context()
        for signer in ("device_sig", "A1_sig"):
            # Build a structurally valid proof with the wrong signer.
            from folioview_shared.encrypted.crypto import _signed_parts, sign_jws

            carrier = self.seal(c)
            _, payload = _signed_parts(carrier["proof"])
            carrier["proof"] = sign_jws(payload, self.f.keys[signer], typ="fv-control+jws")
            self.rejects("invalid_signature", lambda carrier=carrier: self.publish(c, carrier))

    def test_other_owner_cannot_read_or_replace_operation(self):
        c = self.context()
        self.publish(c)
        self.rejects("not_found", lambda: self.publish(c, uid=OTHER_UID))
        self.rejects(
            "not_found",
            lambda: self.service.receipt(
                OTHER_UID, self.f.vault, identities.CONNECTION, c["stableOperationId"]
            ),
        )

    def test_task_authority_is_exact_current_head_and_cas_not_a_new_namespace(self):
        self.create_task()
        c = self.context("task")
        first = self.publish(c)
        self.assertEqual(first["context"]["taskId"], TASK)
        state = self.service.task_state(UID, self.f.vault, TASK)["authority"]
        c2 = self.context("task")
        self.publish(c2)
        self.assertEqual(
            self.service.task_state(UID, self.f.vault, TASK)["authority"]["context"][
                "authorityVersion"
            ],
            2,
        )
        c3 = self.context("task", authorityId="reset_attempt")
        self.rejects("version_conflict", lambda: self.publish(c3))
        self.rejects(
            "version_conflict",
            lambda: self.publish({**c2, "stableOperationId": "synthetic_stale_task_cas_01"}),
        )
        self.assertEqual(state["fingerprint"], first["fingerprint"])

    def test_task_version_or_owner_fingerprint_cannot_be_substituted(self):
        self.create_task()
        for change in (
            {"ownerTaskFingerprint": "f" * 64},
            {"executionEpoch": 2},
            {"taskVersion": 2, "revision": 2, "expectedRevision": 1},
        ):
            c = self.context("task", **change)
            self.rejects("recipient_binding_mismatch", lambda c=c: self.publish(c))

    def test_returned_receipt_is_detached_and_contains_no_plaintext(self):
        c = self.context()
        result = self.publish(c)
        self.assertNotIn("Synthetic", canonical_json(result).decode())
        result["context"]["permissionEpoch"] = 999
        self.assertEqual(
            self.service.receipt(UID, self.f.vault, identities.CONNECTION, c["stableOperationId"])[
                "context"
            ]["permissionEpoch"],
            1,
        )
