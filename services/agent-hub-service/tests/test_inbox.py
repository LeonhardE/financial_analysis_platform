"""Owner Inbox metadata, historical encrypted evidence and signed logical controls."""

import copy
import unittest
from unittest.mock import patch

import test_results as fixtures
from fixtures import OTHER_UID, UID
from test_oauth import TASK

from app.inbox import InboxService
from app.store import SQLiteHubStore, StoreUnavailable, document_path
from folioview_shared.encrypted.authority import verify_agent_grant, verify_registry
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import decrypt_jwe
from folioview_shared.encrypted.envelope import EnvelopeExpectation, verify_carrier
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_decode, b64url_encode
from folioview_shared.encrypted.schema import validate_schema

OP = "synthetic_inbox_state_operation_0001"


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.ResultTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)
        self.base = self.case.case
        self.receipt, _ = self.case.submit()
        self.inbox = InboxService(self.base.store, clock=lambda: self.base.now)
        self.result_id, self.run_id = self.case.result_id, self.case.run_id
        self.uid = UID

    def command(self, *, operation=OP, expected=0, author="device_sig", target=None, **parameters):
        payload = self.base.fix.base("control_command") | {
            "stableOperationId": operation,
            "action": "result_state_update",
            "targetId": target or self.result_id,
            "expectedVersion": expected,
            "expectedSourceEpoch": None,
            "registrySequence": self.base.fix.registry.registry_sequence,
            "checkpointDigest": self.base.fix.registry.checkpoint_digest,
            "keyEpoch": self.base.fix.registry.key_epoch,
            "parameters": parameters or {"read": True},
        }
        return {"contractVersion": CONTRACT_VERSION, "command": self.base.fix.sign(payload, author)}

    def state(self, value=None, *, operation=OP, result=None, author="device_sig"):
        return self.inbox.state(
            UID,
            result or self.result_id,
            value or self.command(operation=operation),
            operation,
            self.base.fix.kid(author),
        )

    def fail(self, code, action):
        with self.assertRaises(ContractError) as caught:
            action()
        self.assertEqual(caught.exception.code, code)

    def new_result(self, suffix, *, connection=None, agent="A1"):
        old_metadata, old_response = self.case.metadata, self.case.runResponse
        token = self.case.token
        if connection is not None:
            token = connection["token"]
            self.case.metadata = self.base.service.metadata(token, TASK)
        begin_op = "synthetic_inbox_run_" + suffix
        intent = self.case.make_intent(begin_op, agent=agent)
        response, _ = self.case.runs.begin(token, TASK, intent, begin_op)
        self.case.runResponse = response
        try:
            operation = "synthetic_inbox_result_" + suffix
            carrier = self.case.make_carrier(
                operation, authorSigningKeyId=self.base.fix.kid(agent + "_sig")
            )
            receipt, _ = self.case.results.submit(
                token, response["run"]["runId"], carrier, operation
            )
            return receipt
        finally:
            self.case.metadata, self.case.runResponse = old_metadata, old_response

    def revise(self, revision=2):
        operation = "synthetic_inbox_revision_" + str(revision)
        packet = self.case.make_carrier(operation, revision=revision)
        return self.case.results.revise(
            self.case.token, self.result_id, revision - 1, packet, operation
        )[0]

    def advance_registry(self, *, revoked=()):
        old = self.base.fix.registry
        if "device_sig" in revoked:
            self.base.fix.add_key("backup_device_sig", "device_sig", "backup_device")
        if "device_enc" in revoked:
            self.base.fix.add_key("backup_device_enc", "device_enc", "backup_device")
        bundle = self.base.fix.make_bundle(previous=old, revoked=revoked, issued_at=self.base.now)
        self.base.vaults.update_registry(
            UID,
            self.base.fix.vault,
            {
                "contractVersion": CONTRACT_VERSION,
                "expectedVersion": self.base.vaults.current(UID)["vault"]["version"],
                "registryBundle": bundle,
            },
            "synthetic_inbox_registry_" + str(old.registry_sequence),
        )
        self.base.fix.registry = self.base.fix.verify(bundle, previous=old, now=self.base.now)
        self.base.fix.bundle = bundle

    def test_uninitialized_owner_reads_are_empty_without_storage_initialization(self):
        before = self.base.store.transact(
            lambda u: u.connection.execute("SELECT COUNT(*) FROM hub_documents").fetchone()[0]
        )
        self.assertEqual(
            self.inbox.list(OTHER_UID),
            {"contractVersion": CONTRACT_VERSION, "items": [], "nextCursor": None},
        )
        self.assertEqual(set(self.inbox.counts(OTHER_UID)["counts"].values()), {0})
        after = self.base.store.transact(
            lambda u: u.connection.execute("SELECT COUNT(*) FROM hub_documents").fetchone()[0]
        )
        self.assertEqual(before, after)

    def test_lists_counts_read_only_batched_heads_and_never_read_ciphertext_or_run(self):
        original = self.base.store.transact

        def transact(callback):
            def guarded(unit):
                get, many = unit.get, unit.get_many

                def check(path):
                    self.assertNotIn(
                        path.split("/")[0],
                        {"hub_runs", "hub_result_revisions", "hub_oauth_connections"},
                    )
                    return get(path)

                def checked_many(paths):
                    self.assertTrue(all(path.startswith("hub_results/") for path in paths))
                    return many(paths)

                unit.get, unit.get_many = check, checked_many
                return callback(unit)

            return original(guarded)

        with patch.object(self.base.store, "transact", transact):
            listed = self.inbox.list(UID)
            counts = self.inbox.counts(UID)
        validate_schema("ResultMetadataPage", listed)
        self.assertEqual(
            counts["counts"], {"all": 1, "unread": 1, "starred": 0, "archived": 0, "total": 1}
        )
        self.assertEqual(set(counts), {"contractVersion", "profile", "asOf", "counts"})
        self.assertFalse(listed["items"][0]["read"])
        self.assertNotIn("Synthetic daily report", str(listed))
        self.assertNotIn("signedObject", str(listed))

    def test_sort_filters_counts_and_unknown_task_do_not_leak_other_results(self):
        second = self.new_result("second")
        self.base.now += 5
        third = self.new_result("third")
        first_two = sorted([self.result_id, second["resultId"]], reverse=True)
        self.assertEqual(
            [x["resultId"] for x in self.inbox.list(UID)["items"]], [third["resultId"], *first_two]
        )
        self.state(self.command(starred=True, archived=True))
        self.assertEqual(
            self.inbox.counts(UID)["counts"],
            {"all": 2, "unread": 2, "starred": 0, "archived": 1, "total": 3},
        )
        self.assertEqual(
            [x["resultId"] for x in self.inbox.list(UID, filter="archived")["items"]],
            [self.result_id],
        )
        self.assertEqual(self.inbox.list(UID, filter="starred")["items"], [])
        self.assertEqual(self.inbox.list(UID, task_id="unknown_task")["items"], [])
        self.assertEqual(
            set(self.inbox.counts(UID, task_id="unknown_task")["counts"].values()), {0}
        )

    def test_cursor_survives_restart_and_binds_owner_filter_limit_task_and_expiry(self):
        self.new_result("cursor_two")
        first = self.inbox.list(UID, limit=1)
        cursor = first["nextCursor"]
        self.assertIsNotNone(cursor)
        restarted = InboxService(SQLiteHubStore(self.base.store.path), clock=lambda: self.base.now)
        second = restarted.list(UID, limit=1, cursor=cursor)
        self.assertEqual(second, self.inbox.list(UID, limit=1, cursor=cursor))
        self.assertNotEqual(first["items"][0]["resultId"], second["items"][0]["resultId"])
        for changes in [{"limit": 2}, {"filter": "unread"}, {"task_id": TASK}]:
            params = {"limit": 1, "cursor": cursor} | changes
            self.fail("unsupported_query", lambda params=params: self.inbox.list(UID, **params))
        self.fail("unsupported_query", lambda: self.inbox.list(OTHER_UID, limit=1, cursor=cursor))
        self.base.now += 901
        self.fail("unsupported_query", lambda: self.inbox.list(UID, limit=1, cursor=cursor))

    def test_cursor_detects_metadata_or_content_change_and_requires_restart(self):
        self.new_result("changing_cursor")
        cursor = self.inbox.list(UID, limit=1)["nextCursor"]
        self.state()
        self.fail("version_conflict", lambda: self.inbox.list(UID, limit=1, cursor=cursor))
        cursor = self.inbox.list(UID, limit=1)["nextCursor"]
        self.revise()
        self.fail("version_conflict", lambda: self.inbox.list(UID, limit=1, cursor=cursor))

    def test_bounded_cursor_cache_allows_forward_traversal_beyond_retained_capacity(self):
        for suffix in [
            "cursor_forward_two",
            "cursor_forward_three",
            "cursor_forward_four",
            "cursor_forward_five",
        ]:
            self.new_result(suffix)
        expected = [row["resultId"] for row in self.inbox.list(UID)["items"]]
        with patch("app.inbox.MAX_CURSORS", 2):
            cursor, seen, tokens = None, [], []
            while True:
                page = self.inbox.list(UID, limit=1, cursor=cursor)
                seen.extend(row["resultId"] for row in page["items"])
                cursor = page["nextCursor"]
                if cursor is None:
                    break
                tokens.append(cursor)
            self.assertEqual(seen, expected)
            saved = self.base.store.transact(
                lambda u: u.get(
                    document_path("hub_inbox_cursors", self.base.fix.owner, self.base.fix.vault)
                )
            )
            self.assertEqual(len(saved["cursors"]), 2)
            evicted = next(token for token in tokens if token not in saved["cursors"])
            self.fail("unsupported_query", lambda: self.inbox.list(UID, limit=1, cursor=evicted))

    def test_detail_history_evidence_full_chain_and_owner_recovery_decryption(self):
        self.base.now += 5
        self.advance_registry()
        second = self.revise()
        self.state(self.command(expected=1, starred=True))
        value = self.inbox.get(UID, self.result_id, 2)
        validate_schema("EncryptedResult", value)
        self.assertEqual(value["metadata"]["receivedAt"], self.receipt["receivedAt"])
        evidence = self.inbox.evidence(UID, self.result_id, 2)
        self.assertEqual(evidence["receipt"], second)
        self.assertNotEqual(second["receivedAt"], value["metadata"]["receivedAt"])
        accepted = evidence["authorProof"]["verifiedAt"]
        registry = None
        for proof in evidence["registryProofs"]:
            bundle = self.inbox.registry(UID, self.result_id, 2, proof["registrySequence"])
            registry = verify_registry(
                bundle,
                root_jwk=self.base.fix.root_public,
                pinned_root_key_id=self.base.fix.root_id,
                owner_subject=self.base.fix.owner,
                vault_id=self.base.fix.vault,
                now=accepted,
                previous=registry,
            )
            self.assertEqual(registry.checkpoint_digest, proof["checkpointDigest"])
        run = evidence["run"]
        grant = verify_agent_grant(
            evidence["agentKeyGrant"],
            registry=registry,
            owner_subject=self.base.fix.owner,
            vault_id=run["vaultId"],
            connection_id=run["connectionId"],
            authorization_id=run["authorizationId"],
            task_id=run["taskId"],
            task_version=run["taskVersion"],
            execution_epoch=run["executionEpoch"],
            grant_id=run["grantId"],
            grant_epoch=run["grantEpoch"],
            now=accepted,
            authorization_expires_at=evidence["authorizationExpiresAt"],
        )
        self.assertEqual(evidence["manifest"], self.case.runResponse["manifest"])
        binding = {
            key: run[key]
            for key in [
                "taskId",
                "taskVersion",
                "runId",
                "manifestId",
                "connectionId",
                "grantId",
                "grantEpoch",
                "executionEpoch",
            ]
        }
        binding.update(
            taskEnvelopeFingerprint=evidence["manifest"]["taskEnvelope"]["envelopeFingerprint"],
            manifestFingerprint=evidence["manifestFingerprint"],
            resourceRef=None,
            sourceRevision=None,
            sourceEpoch=None,
        )
        expected = EnvelopeExpectation(
            self.base.fix.owner,
            run["vaultId"],
            self.result_id,
            "result_revision",
            2,
            1,
            "revise_result",
            grant["agentSigningKeyId"],
            binding,
            [],
            tuple(grant["writebackRecipientKeyIds"]),
        )
        verified = verify_carrier(
            {"contractVersion": CONTRACT_VERSION, "signedObject": value["signedObject"]},
            registry=registry,
            expectation=expected,
            now=accepted,
            contract_header=CONTRACT_VERSION,
            grant=grant,
        )
        for name in ["device_enc", "recovery_enc"]:
            private = decrypt_jwe(verified.jwe, self.base.fix.keys[name], context=verified.context)
            self.assertEqual(private["payload"]["title"], "Synthetic daily report")
        first = self.inbox.get(UID, self.result_id, 1)
        self.assertTrue(first["metadata"]["starred"])
        self.assertEqual(first["metadata"]["stateVersion"], 2)
        self.assertEqual(first["metadata"]["revision"], 1)
        history = self.inbox.history(UID, self.result_id, limit=1)
        self.assertEqual(history["items"][0]["revision"], 2)
        self.assertEqual(
            self.inbox.history(UID, self.result_id, limit=1, cursor=history["nextCursor"])["items"][
                0
            ]["revision"],
            1,
        )
        self.fail("not_found", lambda: self.inbox.get(UID, self.result_id, 3))
        self.fail("not_found", lambda: self.inbox.get(UID, self.result_id, delivery_revision=2))
        self.fail("not_found", lambda: self.inbox.registry(UID, self.result_id, 2, 32))

    def test_history_reads_only_requested_revision_window_and_never_marks_read(self):
        self.revise(2)
        self.revise(3)
        original = self.base.store.transact
        seen = []

        def transact(callback):
            def guarded(unit):
                many = unit.get_many

                def observed(paths, **kwargs):
                    seen.extend(paths)
                    self.assertEqual(
                        set(kwargs["field_paths"]),
                        {"ownerSubject", "resultId", "revision", "receipt"},
                    )
                    return many(paths, **kwargs)

                unit.get_many = observed
                return callback(unit)

            return original(guarded)

        with patch.object(self.base.store, "transact", transact):
            page = self.inbox.history(UID, self.result_id, limit=1)
        self.assertEqual(page["items"][0]["revision"], 3)
        self.assertEqual(len(seen), 1)
        self.assertFalse(self.inbox.get(UID, self.result_id)["metadata"]["read"])

    def test_historical_owner_reads_survive_agent_revoke_source_outage_and_key_expiry(self):
        initial = self.inbox.get(UID, self.result_id)
        self.advance_registry(revoked=("A1_sig", "A1_enc", "device_sig", "device_enc"))
        self.base.oauth.revoke_connection(UID, self.base.connection)
        self.base.sources.available = False
        calls = self.base.sources.calls
        self.base.now = 100000
        self.assertEqual(self.inbox.get(UID, self.result_id), initial)
        self.assertEqual(self.inbox.list(UID)["items"], [initial["metadata"]])
        self.assertEqual(self.inbox.evidence(UID, self.result_id, 1)["receipt"], self.receipt)
        self.assertEqual(self.base.sources.calls, calls)

    def test_foreign_owner_cannot_access_known_ids_cursors_history_proofs_or_state(self):
        for action in [
            lambda: self.inbox.get(OTHER_UID, self.result_id),
            lambda: self.inbox.history(OTHER_UID, self.result_id),
            lambda: self.inbox.evidence(OTHER_UID, self.result_id, 1),
            lambda: self.inbox.registry(OTHER_UID, self.result_id, 1, 1),
            lambda: self.inbox.state(
                OTHER_UID, self.result_id, self.command(), OP, self.base.fix.kid("device_sig")
            ),
        ]:
            self.fail("not_found", action)
        self.assertEqual(self.inbox.list(OTHER_UID)["items"], [])

    def test_multiple_authorized_agents_aggregate_with_real_connection_provenance(self):
        tokens, approved = self.base.consent(name="A2")
        self.base.publish(connection=approved["connectionId"], reader="A2_enc")
        second = self.new_result(
            "second_agent", connection={"token": tokens["access_token"]}, agent="A2"
        )
        rows = self.inbox.list(UID)["items"]
        self.assertEqual(
            {row["connectionId"] for row in rows}, {self.base.connection, approved["connectionId"]}
        )
        evidence = self.inbox.evidence(UID, second["resultId"], 1)
        self.assertEqual(evidence["provenance"]["kind"], "authorized_connection_submission")
        self.assertEqual(evidence["provenance"]["connectionId"], approved["connectionId"])

    def test_signed_state_cas_updates_only_logical_metadata_and_replay_keeps_old_ack(self):
        before = copy.deepcopy(self.case.stored_revision())
        packet = self.command(read=True, starred=True, archived=True)
        first = self.state(packet)
        self.assertEqual(first["stateVersion"], 1)
        self.assertTrue(first["read"] and first["starred"] and first["archived"])
        self.assertEqual(self.state(packet), first)
        self.fail(
            "version_conflict",
            lambda: self.state(self.command(operation=OP + "stale"), operation=OP + "stale"),
        )
        self.revise()
        self.assertEqual(self.state(packet), first)
        latest = self.inbox.get(UID, self.result_id)["metadata"]
        self.assertEqual(
            (latest["revision"], latest["stateVersion"], latest["read"]), (2, 2, False)
        )
        self.assertTrue(latest["starred"] and latest["archived"])
        self.assertEqual(self.case.stored_revision(), before)

    def test_state_replay_checks_actual_signature_header_identity_and_high_low_s(self):
        packet = self.command()
        accepted = self.state(packet)
        altered = copy.deepcopy(packet)
        raw = bytearray(b64url_decode(altered["command"]["signature"]))
        order = int("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16)
        raw[32:] = (order - int.from_bytes(raw[32:], "big")).to_bytes(32, "big")
        altered["command"]["signature"] = b64url_encode(raw)
        self.assertEqual(self.state(altered), accepted)
        altered["command"]["signature"] = b64url_encode(b"x" * 64)
        self.fail("invalid_signature", lambda: self.state(altered))
        self.fail("idempotency_conflict", lambda: self.state(self.command(read=False)))
        self.fail("idempotency_conflict", lambda: self.state(packet, operation=OP + "different"))
        self.fail("key_authorization_required", lambda: self.state(packet, author="A1_sig"))

    def test_state_current_registry_and_device_eligibility_do_not_gate_historical_reads(self):
        packet = self.command()
        self.state(packet)
        self.advance_registry()
        with self.assertRaises(ContractError):
            self.state(packet)
        self.assertTrue(self.inbox.get(UID, self.result_id)["metadata"]["read"])
        fresh = self.command(operation=OP + "fresh", expected=1, read=False)
        self.state(fresh, operation=OP + "fresh")
        self.advance_registry(revoked=("device_sig",))
        with self.assertRaises(ContractError):
            self.state(fresh, operation=OP + "fresh")
        self.assertFalse(self.inbox.get(UID, self.result_id)["metadata"]["read"])

    def test_state_capacity_keeps_known_replay_and_owner_reads_available(self):
        with patch("app.inbox.MAX_STATE_OPERATIONS", 2):
            packet = self.command()
            first = self.state(packet)
            self.state(
                self.command(operation=OP + "two", expected=1, starred=True), operation=OP + "two"
            )
            self.fail(
                "version_conflict",
                lambda: self.state(
                    self.command(operation=OP + "three", expected=2), operation=OP + "three"
                ),
            )
            self.assertEqual(self.state(packet), first)
            self.assertEqual(len(self.inbox.list(UID)["items"]), 1)

    def test_unknown_private_queries_and_bad_domain_values_are_rejected(self):
        for kwargs in [
            {"limit": 0},
            {"limit": True},
            {"limit": 51},
            {"filter": "title"},
            {"cursor": "not-a-cursor"},
            {"task_id": "bad/email@example.com"},
        ]:
            with self.assertRaises(ContractError):
                self.inbox.list(UID, **kwargs)
        self.fail(
            "malformed_request",
            lambda: self.inbox.state(
                UID,
                self.result_id,
                self.command() | {"ownerSubject": "other"},
                OP,
                self.base.fix.kid("device_sig"),
            ),
        )
        self.fail("malformed_request", lambda: self.state(self.command(**{"title": "private"})))

    def test_corrupt_head_index_or_historical_proof_fails_closed(self):
        path = document_path("hub_results", self.base.fix.owner, self.result_id)
        original = self.base.store.transact(lambda u: u.get(path))
        bad = copy.deepcopy(original)
        bad["metadata"]["title"] = "synthetic_private_marker"
        self.base.store.transact(lambda u: u.put(path, bad))
        with self.assertRaises(StoreUnavailable):
            self.inbox.list(UID)
        self.base.store.transact(lambda u: u.put(path, original))
        path = document_path("hub_result_revisions", self.base.fix.owner, self.result_id, "1")
        bad = self.base.store.transact(lambda u: u.get(path))
        bad["proof"]["rootEpoch"] = 2
        self.base.store.transact(lambda u: u.put(path, bad))
        with self.assertRaises(StoreUnavailable):
            self.inbox.get(UID, self.result_id)

    def test_failed_state_storage_rolls_back_head_and_operation_atomically(self):
        before = self.inbox.get(UID, self.result_id)["metadata"]
        original = self.base.store.transact

        def fail(callback):
            def broken(unit):
                put = unit.put

                def write(path, value):
                    if path.startswith("hub_result_state_operations/"):
                        raise StoreUnavailable
                    return put(path, value)

                unit.put = write
                return callback(unit)

            return original(broken)

        with patch.object(self.base.store, "transact", fail), self.assertRaises(StoreUnavailable):
            self.state()
        self.assertEqual(self.inbox.get(UID, self.result_id)["metadata"], before)
        self.assertIsNone(
            self.base.store.transact(
                lambda u: u.get(
                    document_path(
                        "hub_result_state_operations",
                        self.base.fix.owner,
                        self.base.fix.vault,
                        self.result_id,
                    )
                )
            )
        )

    def test_state_expiry_crossed_after_signature_verification_cannot_mutate(self):
        packet = self.command()
        from app.inbox import verify_control_command as verify

        def expire(*args, **kwargs):
            value = verify(*args, **kwargs)
            self.base.now = self.base.fix.certificates["device_sig"]["expiresAt"]
            return value

        with patch("app.inbox.verify_control_command", expire):
            self.fail("key_authorization_required", lambda: self.state(packet))
        self.assertFalse(self.inbox.list(UID)["items"][0]["read"])
        self.base.now = 1000
        self.state(packet)
        with patch("app.inbox.verify_control_command", expire):
            self.fail("key_authorization_required", lambda: self.state(packet))
        self.assertTrue(self.inbox.list(UID)["items"][0]["read"])
