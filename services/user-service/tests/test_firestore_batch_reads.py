"""Actual SDK batches preserve identities, receipts and conflict-time versions."""

import copy
import json
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

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
from test_resources import OTHER, UID, follows, watch_item

from app.channel_follows import ChannelFollowsUnavailable, FirestoreChannelFollowsStore
from app.resources import FirestoreUserResourceStore, ResourceUnavailable
from app.watchlist import FirestoreWatchlistStore


class MemoryRpc:
    def __init__(self, client):
        self.client, self.documents, self.calls = client, {}, []
        self.aborts, self.before_abort = 0, None

    def record(self, kind, kwargs):
        self.calls.append((kind, kwargs))
        assert kwargs["timeout"] == 4 and kwargs["retry"] is None

    def begin_transaction(self, **kwargs):
        self.record("begin", kwargs)
        return BeginTransactionResponse(transaction=b"synthetic-user-transaction")

    def batch_get_documents(self, **kwargs):
        self.record("get", kwargs)
        # Firestore does not promise requested-document order.
        return iter(
            BatchGetDocumentsResponse(
                found=Document(name=name, fields=encode_dict(copy.deepcopy(self.documents[name])))
            )
            if name in self.documents
            else BatchGetDocumentsResponse(missing=name)
            for name in reversed(kwargs["request"]["documents"])
        )

    def commit(self, **kwargs):
        self.record("commit", kwargs)
        if self.aborts:
            self.aborts -= 1
            if self.before_abort:
                self.before_abort()
            raise Aborted("Synthetic User transaction conflict")
        updates = {
            write.update.name: decode_dict(write.update.fields, self.client)
            for write in kwargs["request"]["writes"]
        }
        self.documents.update(updates)
        now = datetime(2026, 11, 14, tzinfo=UTC)
        return CommitResponse(
            write_results=[WriteResult(update_time=now) for _ in updates], commit_time=now
        )

    def rollback(self, **kwargs):
        self.record("rollback", kwargs)
        return Empty()


class FirestoreBatchReadTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-user", database="user", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        with patch("app.resources.firestore.Client", return_value=self.client):
            self.resources = FirestoreUserResourceStore("synthetic-user", "user")
            self.watchlist = FirestoreWatchlistStore("synthetic-user", "user")
            self.channels = FirestoreChannelFollowsStore("synthetic-user", "user")

    def reads(self):
        return [kw["request"]["documents"] for name, kw in self.rpc.calls if name == "get"]

    def test_one_or_two_resource_kinds_use_one_order_independent_consistent_batch(self):
        for kinds in (("watchlist",), ("channel_follows",), ("channel_follows", "watchlist")):
            with self.subTest(kinds=kinds):
                self.rpc.calls.clear()
                result = self.resources.read(UID, kinds)
                self.assertEqual(list(result), list(kinds))
                self.assertTrue(all(value["state"] == "uninitialized" for value in result.values()))
                self.assertEqual([len(batch) for batch in self.reads()], [2 * len(kinds)])
                self.assertFalse(self.rpc.documents)
                self.assertFalse(
                    any(kw["request"]["writes"] for kind, kw in self.rpc.calls if kind == "commit")
                )

    def test_initialization_and_original_replay_keep_one_ref_and_three_document_batch(self):
        original = self.resources.initialize(UID, "watchlist", "first")
        self.assertEqual([len(batch) for batch in self.reads()], [3])
        self.assertEqual(len(self.rpc.documents), 3)
        self.watchlist.change(UID, "AAPL", watch_item())
        self.rpc.calls.clear()
        self.assertEqual(self.resources.initialize(UID, "watchlist", "first"), original)
        self.assertEqual([len(batch) for batch in self.reads()], [3])
        writes = [kw["request"]["writes"] for kind, kw in self.rpc.calls if kind == "commit"]
        self.assertEqual(writes, [[]])
        current = self.resources.read(UID, ("watchlist",))["watchlist"]
        self.assertEqual(current["ref"], original["ref"])
        self.assertEqual(current["revision"], 1)

    def test_channel_and_watchlist_changes_each_use_one_batch_and_retain_noop_semantics(self):
        self.rpc.calls.clear()
        self.assertEqual(self.watchlist.change(UID, "AAPL", watch_item()), [watch_item()])
        self.assertEqual([len(batch) for batch in self.reads()], [2])
        self.rpc.calls.clear()
        self.assertEqual(self.watchlist.change(UID, "AAPL", watch_item()), [watch_item()])
        self.assertEqual([len(batch) for batch in self.reads()], [2])
        self.assertEqual(
            [len(kw["request"]["writes"]) for k, kw in self.rpc.calls if k == "commit"], [0]
        )
        self.rpc.calls.clear()
        saved = self.channels.replace(UID, 0, follows())
        self.assertEqual(saved["revision"], 1)
        self.assertEqual([len(batch) for batch in self.reads()], [2])
        self.rpc.calls.clear()
        self.assertEqual(self.channels.get(UID), saved)
        self.assertEqual([len(batch) for batch in self.reads()], [2])

    def test_conflict_retry_rereads_peer_update_and_does_not_lose_its_symbol(self):
        self.resources.initialize(UID, "watchlist", "first")
        self.rpc.calls.clear()
        self.rpc.aborts = 1

        def peer():
            self.rpc.before_abort = None
            self.watchlist.change(UID, "MSFT", watch_item("MSFT"))

        self.rpc.before_abort = peer
        result = self.watchlist.change(UID, "AAPL", watch_item())
        self.assertEqual({row["symbol"] for row in result}, {"AAPL", "MSFT"})
        self.assertEqual([len(batch) for batch in self.reads()], [2, 2, 2])
        self.assertEqual(self.resources.read(UID, ("watchlist",))["watchlist"]["revision"], 2)

    def test_incomplete_duplicate_foreign_or_failed_stream_never_becomes_absence_or_write(self):
        original = self.rpc.batch_get_documents
        for mode in ("incomplete", "duplicate", "foreign", "failed"):

            def broken(mode=mode, **kwargs):
                rows = list(original(**kwargs))
                if mode == "incomplete":
                    return iter(rows[:-1])
                if mode == "duplicate":
                    return iter([*rows, rows[0]])
                if mode == "foreign":
                    rows[0] = BatchGetDocumentsResponse(
                        missing="projects/foreign/databases/user/documents/a/b"
                    )
                    return iter(rows)

                def fail():
                    yield rows[0]
                    raise RuntimeError("Synthetic interrupted stream")

                return fail()

            for action in (
                lambda: self.resources.read(UID, ("watchlist", "channel_follows")),
                lambda: self.resources.initialize(UID, "watchlist", "first"),
            ):
                self.rpc.calls.clear()
                with self.subTest(mode=mode), patch.object(self.rpc, "batch_get_documents", broken):
                    with self.assertRaises(ResourceUnavailable):
                        action()
                self.assertFalse(any(k == "commit" for k, _ in self.rpc.calls))
                self.assertFalse(self.rpc.documents)
        self.assertEqual(
            self.resources.read(UID, ("watchlist",))["watchlist"]["state"], "uninitialized"
        )

    def test_next_request_and_retry_detect_current_corruption_without_repair(self):
        self.resources.initialize(UID, "channel_follows", "first")
        self.channels.replace(UID, 0, follows())
        self.resources.read(UID, ("channel_follows",))
        _, reference = self.resources.references(UID, "channel_follows")
        before = copy.deepcopy(self.rpc.documents)
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.rpc.documents[reference._document_path].update(
            contentDigest="0" * 64
        )
        with self.assertRaises(ChannelFollowsUnavailable):
            self.channels.replace(UID, 1, [])
        self.assertEqual(
            self.rpc.documents[reference._document_path]["revision"],
            before[reference._document_path]["revision"],
        )
        with self.assertRaises(ResourceUnavailable):
            self.resources.read(UID, ("channel_follows",))

    def test_owner_partitions_and_metadata_only_responses_remain_unchanged(self):
        first = self.resources.initialize(UID, "watchlist", "first")
        second = self.resources.initialize(OTHER, "watchlist", "first")
        self.watchlist.change(UID, "AAPL", watch_item())
        self.channels.replace(UID, 0, follows())
        self.assertNotEqual(first["ref"], second["ref"])
        text = json.dumps(self.resources.read(UID, ("watchlist", "channel_follows")))
        for private in ("AAPL", "Private", "private-source", "contentDigest", "itemCount"):
            self.assertNotIn(private, text)
        self.assertEqual(self.watchlist.get(OTHER), [])
        self.assertEqual(self.resources.read(OTHER, ("watchlist",))["watchlist"], second)
