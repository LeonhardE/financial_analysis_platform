"""Actual Firestore SDK live-witness transactions with controlled commit collisions."""

import copy
from datetime import UTC, datetime

import test_policy as policy_tests
from google.api_core.exceptions import Aborted
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1._helpers import decode_dict, encode_dict
from google.cloud.firestore_v1.types import (
    BatchGetDocumentsResponse,
    BeginTransactionResponse,
    CommitResponse,
    Document,
    WriteResult,
)
from google.protobuf.empty_pb2 import Empty

from app.contracts import Unavailable
from app.store import FirestoreWitness
from folioview_shared.encrypted.errors import ContractError


class RPC:
    def __init__(self, client):
        self.client = client
        self.documents = {}
        self.calls = []
        self.callback = None
        self.unavailable = False

    def record(self, name, kw):
        assert kw["timeout"] == 4 and kw["retry"] is None
        self.calls.append((name, kw))
        if self.unavailable:
            raise RuntimeError("Synthetic witness outage")

    def begin_transaction(self, **kw):
        self.record("begin", kw)
        return BeginTransactionResponse(transaction=b"synthetic-policy-transaction")

    def batch_get_documents(self, **kw):
        self.record("get", kw)
        return iter(
            BatchGetDocumentsResponse(
                found=Document(name=n, fields=encode_dict(copy.deepcopy(self.documents[n])))
            )
            if n in self.documents
            else BatchGetDocumentsResponse(missing=n)
            for n in kw["request"]["documents"]
        )

    def commit(self, **kw):
        self.record("commit", kw)
        if kw["request"]["writes"] and self.callback:
            callback, self.callback = self.callback, None
            callback()
            raise Aborted("Synthetic policy CAS collision")
        updates = {
            w.update.name: decode_dict(w.update.fields, self.client)
            for w in kw["request"]["writes"]
        }
        self.documents.update(updates)
        now = datetime.now(UTC)
        return CommitResponse(
            write_results=[WriteResult(update_time=now) for _ in updates], commit_time=now
        )

    def rollback(self, **kw):
        self.record("rollback", kw)
        return Empty()


class FirestorePolicyTests(policy_tests.PolicyTests):
    def make_witness(self):
        client = firestore.Client(
            project="synthetic-project",
            database="policy-witness",
            credentials=AnonymousCredentials(),
        )
        self.addCleanup(client.close)
        self.rpc = RPC(client)
        client._firestore_api_internal = self.rpc
        return FirestoreWitness(
            "synthetic-project", "policy-witness", self.config.public["stateEpoch"], client=client
        )

    def test_revocation_wins_between_key_release_and_witness_commit(self):
        ch = self.challenge()
        self.rpc.callback = self.revoke
        with self.assertRaises(ContractError):
            self.policy.grant(
                *self.args("releases", self.grant_request(ch, recover=True), key="ephemeral"),
                release=True,
            )
        self.assertEqual(self.owner_state()["status"], "revoked")

    def test_actual_sdk_stores_only_one_bounded_authoritative_pointer(self):
        self.recover()
        self.assertEqual(len(self.rpc.documents), 1)
        name, head = next(iter(self.rpc.documents.items()))
        self.assertIn("/policy_live_heads/", name)
        self.assertEqual(set(head), {"domain", "sequence", "digest", "previous"})
        self.assertTrue(
            any(method == "commit" and kw["request"]["writes"] for method, kw in self.rpc.calls)
        )
        self.rpc.unavailable = True
        with self.assertRaises(Unavailable):
            self.owner_state()
