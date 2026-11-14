"""Owner packet batches retain real JOSE, lifecycle, transaction and byte boundaries."""

import copy
import unittest
from unittest.mock import patch

import test_task_routes as http_tasks
import test_tasks as tasks
from fixtures import OTHER_UID, UID
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.store import FirestoreHubStore, StoreUnavailable, document_path
from app.task_lifecycle import lifecycle_path
from app.tasks import PACKET_BATCH_PROFILE, _paths
from folioview_shared.encrypted.budgets import check_size
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads


class TaskPacketBatchTests(unittest.TestCase):
    def setUp(self):
        self.f = tasks.TaskTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.ids = [f"synthetic_batch_task_{n}" for n in range(4)]
        for task_id in self.ids:
            operation = f"synthetic_batch_create_{task_id}"
            self.f.save(self.f.fixture.body(task=task_id, operation=operation), operation=operation)
        self.expected = [self.f.service.get(UID, task_id) for task_id in self.ids]
        self.client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(self.client.close)
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestoreHubStore("synthetic-hub", "agent-hub", client=self.client)
        connection = self.f.store.connect()
        try:
            for path, body in connection.execute("SELECT path, body FROM hub_documents"):
                self.rpc.documents[self.client.document(path)._document_path] = strict_json_loads(
                    body
                )
        finally:
            connection.close()
        self.f.service.store = self.store
        self.owner, self.vault = self.f.fixture.owner, self.f.fixture.vault

    def reads(self):
        return [kw["request"]["documents"] for name, kw in self.rpc.calls if name == "get"]

    def query(self, ids=None):
        return self.f.service.packets(UID, self.ids if ids is None else ids)

    def test_one_and_four_packets_match_single_reads_with_three_bounded_prefetch_phases(self):
        before = copy.deepcopy(self.rpc.documents)
        for count in (1, 4):
            with self.subTest(count=count):
                self.rpc.calls.clear()
                result = self.query(self.ids[:count])
                self.assertEqual(result["profile"], PACKET_BATCH_PROFILE)
                self.assertEqual(result["remainingTaskIds"], [])
                self.assertEqual([r["packet"] for r in result["items"]], self.expected[:count])
                self.assertEqual([len(b) for b in self.reads()][-3:], [2, count, count])
                self.assertEqual(
                    self.rpc.documents, before, "read must not create cursors or commands"
                )
                self.assertNotIn(tasks.CANARY, canonical_json(result).decode())

    def test_unknown_and_trashed_tasks_are_unavailable_without_fetching_their_ciphertext(self):
        path = self.client.document(lifecycle_path(self.owner, self.vault))._document_path
        self.rpc.documents[path] = {"version": 1, "tasks": {self.ids[0]: "trashed"}}
        result = self.query([self.ids[0], "unknown_task", self.ids[1]])
        self.assertEqual(
            [r["status"] for r in result["items"]], ["not_found", "not_found", "ready"]
        )
        forbidden = self.client.document(
            _paths(self.owner, self.vault, self.ids[0], 1)
        )._document_path
        self.assertNotIn(forbidden, [p for batch in self.reads() for p in batch])
        self.assertEqual(result["items"][2]["packet"], self.expected[1])

    def test_response_budget_returns_an_exact_suffix_with_progress_and_no_dropped_packets(self):
        one = self.query(self.ids[:1])
        maximum = len(canonical_json(one)) + 256
        seen, remaining = [], list(self.ids)
        with patch("app.tasks.check_read_response", side_effect=lambda v: check_size(v, maximum)):
            while remaining:
                result = self.query(remaining)
                self.assertLessEqual(len(canonical_json(result)), maximum)
                self.assertTrue(result["items"])
                count = len(result["items"])
                self.assertEqual([r["taskId"] for r in result["items"]], remaining[:count])
                self.assertEqual(result["remainingTaskIds"], remaining[count:])
                seen.extend(r["packet"] for r in result["items"])
                remaining = result["remainingTaskIds"]
        self.assertEqual(seen, self.expected)

    def test_commit_retry_rechecks_a_new_task_deletion_before_returning_any_packet(self):
        path = self.client.document(lifecycle_path(self.owner, self.vault))._document_path
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.rpc.documents.update(
            {path: {"version": 1, "tasks": {self.ids[0]: "trashed"}}}
        )
        result = self.query()
        self.assertEqual(result["items"][0], {"taskId": self.ids[0], "status": "not_found"})
        self.assertEqual([r["packet"] for r in result["items"][1:]], self.expected[1:])

    def test_prefetch_completeness_and_corrupt_packets_never_return_partial_success(self):
        original = self.rpc.batch_get_documents
        for mode in ("incomplete", "duplicate"):

            def broken(mode=mode, **kwargs):
                rows = list(original(**kwargs))
                if len(kwargs["request"]["documents"]) == 1:
                    return iter(rows)
                return iter(rows[:-1] if mode == "incomplete" else [*rows, rows[0]])

            with self.subTest(mode=mode), patch.object(self.rpc, "batch_get_documents", broken):
                with self.assertRaises(StoreUnavailable):
                    self.query()
        path = self.client.document(_paths(self.owner, self.vault, self.ids[3], 1))._document_path
        self.rpc.documents[path]["ownerSubject"] = "foreign_owner"
        with self.assertRaises(StoreUnavailable):
            self.query()

    def test_owner_and_input_boundaries_refuse_cross_owner_or_unbounded_work(self):
        for ids in (
            [],
            self.ids + ["extra_task"],
            [self.ids[0]] * 2,
            [True],
            ["../escape"],
            "task",
        ):
            self.rpc.calls.clear()
            with self.subTest(ids=ids), self.assertRaises(ContractError):
                self.query(ids)
            self.assertEqual(self.rpc.calls, [])
        with self.assertRaises(ContractError) as denied:
            self.f.service.packets(OTHER_UID, self.ids)
        self.assertEqual(denied.exception.code, "not_found")

    def test_corrupt_head_or_index_is_not_downgraded_to_a_missing_task(self):
        path = self.client.document(_paths(self.owner, self.vault, self.ids[0]))._document_path
        self.rpc.documents[path]["metadata"]["envelopeFingerprint"] = "0" * 64
        with self.assertRaises(StoreUnavailable):
            self.query()
        index = self.client.document(
            document_path("hub_task_indexes", self.owner, self.vault)
        )._document_path
        self.rpc.documents[index]["ownerSubject"] = "foreign_owner"
        with self.assertRaises(StoreUnavailable):
            self.query()


class TaskPacketBatchRouteTests(unittest.TestCase):
    def setUp(self):
        self.f = http_tasks.TaskRouteTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.path = "/api/v2/tasks/packets/query"

    def test_read_only_post_uses_existing_owner_and_contract_without_command_headers(self):
        self.f.service.create(
            UID, self.f.fixture.body(), http_tasks.CREATE, self.f.fixture.kid("device_sig")
        )
        before = self.f.service.get(UID, http_tasks.TASK)
        result = self.f.client.post(
            self.path,
            headers=self.headers,
            json={"contractVersion": CONTRACT_VERSION, "taskIds": [http_tasks.TASK]},
        )
        self.assertEqual(result.status_code, 200, result.text[:200])
        self.assertEqual(result.headers["cache-control"], "no-store")
        self.assertEqual(result.json()["items"][0]["packet"], before)
        self.assertEqual(self.f.service.get(UID, http_tasks.TASK), before)

    def test_closed_body_query_media_and_native_identity_headers_fail_before_service_work(self):
        valid = {"contractVersion": CONTRACT_VERSION, "taskIds": ["unknown_task"]}
        for path, headers, body, status in (
            (self.path + "?search=private", self.headers, valid, 400),
            (self.path, {}, valid, 400),
            (self.path, {**self.headers, "X-FolioView-Delegation": "private_marker"}, valid, 403),
            (self.path, self.headers, {**valid, "name": "synthetic-secret-marker"}, 400),
        ):
            with (
                self.subTest(path=path, headers=headers),
                patch.object(self.f.service, "packets") as read,
            ):
                result = self.f.client.post(path, headers=headers, json=body)
                self.f.failure(result, status)
                read.assert_not_called()
        self.f.failure(self.f.client.post(self.path, headers=self.headers, content="{}"), 415)
        self.f.failure(
            self.f.client.post(
                self.path,
                headers={**self.headers, "Content-Type": "application/json"},
                content=b" " * 4097,
            ),
            413,
        )
