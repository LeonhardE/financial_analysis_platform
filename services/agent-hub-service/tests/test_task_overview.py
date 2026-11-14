"""Real SDK combined task snapshots, independent cursors and honest packet delivery."""

import copy
import unittest
from unittest.mock import patch

import test_inbox as foreground_fixture
import test_persistent_results as persistent_fixture
import test_task_packet_batches as task_fixture
import test_task_routes as route_fixture
from fixtures import OTHER_UID, UID
from google.cloud.firestore_v1.types import Value

from app import inbox as inbox_module
from app import task_overview, vaults
from app.api import require_owner
from app.inbox import InboxService
from app.main import app
from app.native_transport import NativeConnectionOwnerService
from app.persistent_results import PersistentOwnerResultService, result_id, result_path
from app.results import result_path as foreground_path
from app.store import StoreUnavailable, document_path
from app.task_center_routes import owner_capabilities
from app.task_lifecycle import lifecycle_path
from app.task_overview import PROFILE, TaskOverviewService, get_overview
from app.tasks import _paths
from folioview_shared.encrypted.budgets import check_size
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import b64url_encode, canonical_json
from folioview_shared.encrypted.persistent_content import digest


class TaskOverviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        case = persistent_fixture.PersistentResultTests()
        case.setUp()
        try:
            receipt = case.submit()
            cls.persistent_template = case.fx.store.transact(
                lambda unit: unit.get(result_path(case.f.owner, case.f.vault, receipt["resultId"]))
            )
        finally:
            case.doCleanups()
        case = foreground_fixture.InboxTests()
        case.setUp()
        try:
            cls.foreground_template = case.base.store.transact(
                lambda unit: unit.get(foreground_path(case.base.fix.owner, case.result_id))
            )
        finally:
            case.doCleanups()

    def setUp(self):
        task_fixture.TaskPacketBatchTests.setUp(self)
        self.service = TaskOverviewService(self.store, clock=lambda: 1000)
        self.payload = {
            "contractVersion": CONTRACT_VERSION,
            "knownPacketVersions": [],
            "packetLimit": 4,
        }
        self.seed_reports(2, 2)

    reads = task_fixture.TaskPacketBatchTests.reads

    def name(self, path):
        return self.client.document(path)._document_path

    def query(self, **changes):
        return self.service.overview(UID, self.vault, {**self.payload, **changes})

    def seed_reports(self, persistent_count, foreground_count):
        self.persistent_ids, self.foreground_ids = [], []
        for n in range(persistent_count):
            row = copy.deepcopy(self.persistent_template)
            run = f"synthetic_overview_run_{n:04d}"
            task = self.ids[n % len(self.ids)]
            result = result_id(self.owner, self.vault, run)
            operation = f"synthetic_overview_publication_{n:04d}"
            row["context"].update(
                ownerSubject=self.owner,
                vaultId=self.vault,
                objectId=result,
                runId=run,
                taskId=task,
                stableOperationId=operation,
            )
            row["metadata"].update(resultId=result, runId=run, taskId=task, receivedAt=1000 + n)
            row["receipt"].update(
                resultId=result,
                runId=run,
                taskId=task,
                receivedAt=1000 + n,
                publicationId=operation,
            )
            self.rpc.documents[self.name(result_path(self.owner, self.vault, result))] = row
            self.persistent_ids.append(result)
        self.page_id = "pidx_" + digest(["synthetic_overview_page"])
        self.persistent_index = document_path(
            "hub_persistent_result_indexes", self.owner, self.vault
        )
        self.page_path = document_path(
            "hub_persistent_result_pages", self.owner, self.vault, self.page_id
        )
        if persistent_count:
            self.rpc.documents[self.name(self.persistent_index)] = {"pageId": self.page_id}
            self.rpc.documents[self.name(self.page_path)] = {
                "pageId": self.page_id,
                "previous": None,
                "resultIds": list(self.persistent_ids),
            }
        else:
            self.rpc.documents.pop(self.name(self.persistent_index), None)
        for n in range(foreground_count):
            row = copy.deepcopy(self.foreground_template)
            result, run = f"synthetic_foreground_{n:04d}", f"synthetic_foreground_run_{n:04d}"
            row.update(
                ownerSubject=self.owner,
                ownerUid=UID,
                vaultId=self.vault,
                resultId=result,
                runId=run,
            )
            row["metadata"].update(
                resultId=result,
                runId=run,
                taskId=self.ids[n % len(self.ids)],
                connectionId="synthetic_native_muse",
                archived=n % 2 == 1,
                read=n % 3 == 0,
            )
            row["provenance"]["connectionId"] = "synthetic_native_muse"
            self.rpc.documents[self.name(foreground_path(self.owner, result))] = row
            self.foreground_ids.append(result)
        self.rpc.documents[self.name(document_path("hub_result_indexes", self.owner))] = {
            "resultIds": list(self.foreground_ids)
        }
        connections = []
        for provider in ("muse", "chatgpt"):
            ident = "synthetic_native_" + provider
            connections.append(ident)
            self.rpc.documents[
                self.name(document_path("hub_oauth_connections", self.owner, ident))
            ] = {
                "ownerSubject": self.owner,
                "connectionId": ident,
                "clientId": "synthetic_client_" + provider,
                "vaultId": self.vault,
                "provider": provider,
                "status": "revoked" if provider == "muse" else "active",
                "expiresAt": 2000,
                "authorizedAt": 999,
                "transportKind": "persistent_runtime",
            }
        self.rpc.documents[self.name(document_path("hub_oauth_owners", self.owner))] = {
            "ownerSubject": self.owner,
            "ownerUid": UID,
            "connectionIds": connections,
            "attempts": {},
        }
        self.rpc.calls.clear()

    def known(self, ids):
        return [
            {key: item["metadata"][key] for key in ("taskId", "taskVersion", "envelopeFingerprint")}
            for item in self.expected
            if item["metadata"]["taskId"] in ids
        ]

    def assert_no_business_writes(self):
        writes = [
            write
            for kind, kw in self.rpc.calls
            if kind == "commit"
            for write in kw["request"]["writes"]
        ]
        self.assertTrue(
            all(
                "/hub_inbox_cursors/" in write.update.name
                or "/hub_task_indexes/" in write.update.name
                for write in writes
            )
        )
        return writes

    def test_one_two_four_packets_use_three_batches_and_one_current_history(self):
        for count in (1, 2, 4):
            with (
                self.subTest(count=count),
                patch("app.vaults.verify_registry", wraps=vaults.verify_registry) as verify,
            ):
                self.rpc.calls.clear()
                value = self.query(knownPacketVersions=self.known(self.ids[count:]))
                self.assertEqual(
                    set(value),
                    {
                        "contractVersion",
                        "profile",
                        "vaultId",
                        "tasks",
                        "capabilities",
                        "feeds",
                        "connections",
                        "packets",
                    },
                )
                self.assertEqual(value["profile"], PROFILE)
                self.assertEqual(value["vaultId"], self.vault)
                self.assertEqual(
                    [row["packet"] for row in value["packets"]["items"]], self.expected[:count]
                )
                self.assertEqual(verify.call_count, 1)
                self.assertEqual([len(group) for group in self.reads()], [7, 5 + count, 2 + count])
                self.assertEqual(sum(kind == "begin" for kind, _ in self.rpc.calls), 1)
                self.assertFalse(self.assert_no_business_writes())

    def test_all_metadata_and_packets_equal_original_separate_services(self):
        tasks = self.f.service.list(UID, limit=32)
        persistent = PersistentOwnerResultService(self.store, clock=lambda: 1000).owner_list(
            UID, self.vault
        )
        inbox = InboxService(self.store, clock=lambda: 1000)
        foreground, archived = inbox.list(UID), inbox.list(UID, filter="archived")
        connections = NativeConnectionOwnerService(
            self.store, clock=lambda: 1000
        ).native_connections(UID)
        packets = self.f.service.packets(UID, self.ids)
        value = self.query()
        self.assertEqual(value["tasks"], tasks)
        self.assertEqual(value["capabilities"], owner_capabilities(UID))
        self.assertEqual(
            value["feeds"],
            {"persistent": persistent, "foreground": foreground, "archived": archived},
        )
        self.assertEqual(value["connections"], connections)
        self.assertEqual(value["connections"]["connections"][0]["status"], "revoked")
        self.assertEqual(value["packets"], packets)

    def test_sqlite_same_snapshot_and_three_queries_without_per_row_reads(self):
        expected = self.query()
        documents = {
            name.split("/documents/", 1)[1]: row for name, row in self.rpc.documents.items()
        }
        self.f.store.transact(lambda unit: [unit.put(path, row) for path, row in documents.items()])
        sql, connect = [], self.f.store.connect

        def traced():
            connection = connect()
            connection.set_trace_callback(sql.append)
            return connection

        with patch.object(self.f.store, "connect", side_effect=traced):
            value = TaskOverviewService(self.f.store, clock=lambda: 1000).overview(
                UID, self.vault, self.payload
            )
        self.assertEqual(value, expected)
        self.assertEqual(sum(statement.startswith("SELECT") for statement in sql), 3)
        self.assertFalse(
            any(statement.startswith(("INSERT", "UPDATE", "DELETE")) for statement in sql)
        )

    def test_both_foreground_cursors_work_independently_on_original_more_routes(self):
        self.seed_reports(21, 42)
        value = self.query()
        self.assertEqual([len(group) for group in self.reads()], [7, 49, 24])
        self.assertEqual(len(value["feeds"]["persistent"]["items"]), 20)
        self.assertIsNotNone(value["feeds"]["persistent"]["nextCursor"])
        inbox = InboxService(self.store, clock=lambda: 1000)
        for name, query_filter in (("foreground", "all"), ("archived", "archived")):
            page = value["feeds"][name]
            self.assertEqual(len(page["items"]), 20)
            self.assertIsNotNone(page["nextCursor"])
            more = inbox.list(UID, limit=20, filter=query_filter, cursor=page["nextCursor"])
            self.assertEqual(len(more["items"]), 1)
            self.assertIsNone(more["nextCursor"])
        collections = [write.update.name for write in self.assert_no_business_writes()]
        self.assertEqual(sum("/hub_inbox_cursors/" in name for name in collections), 1)
        more = PersistentOwnerResultService(self.store, clock=lambda: 1000).owner_list(
            UID, self.vault, cursor=value["feeds"]["persistent"]["nextCursor"]
        )
        self.assertEqual(len(more["items"]), 1)

    def test_cursor_capacity_protects_both_returned_tokens_and_cannot_fake_room(self):
        self.seed_reports(2, 42)
        path = self.name(document_path("hub_inbox_cursors", self.owner, self.vault))
        self.rpc.documents[path] = {
            "ownerSubject": self.owner,
            "vaultId": self.vault,
            "cursors": {
                b64url_encode(n.to_bytes(24, "big")): {
                    "snapshot": "a" * 64,
                    "position": 20,
                    "expiresAt": 3000,
                    "limit": 20,
                    "query": {"kind": "old", "filter": str(n)},
                }
                for n in range(32)
            },
        }
        value = self.query()
        tokens = [value["feeds"][name]["nextCursor"] for name in ("foreground", "archived")]
        self.assertTrue(all(token in self.rpc.documents[path]["cursors"] for token in tokens))
        self.assertEqual(len(self.rpc.documents[path]["cursors"]), 32)
        self.rpc.documents.pop(path)
        with patch.object(inbox_module, "MAX_CURSORS", 1), self.assertRaises(ContractError):
            self.query()
        self.assertNotIn(path, self.rpc.documents)

    def test_zero_limit_or_all_known_names_are_null_and_do_not_read_task_carriers(self):
        for changes in ({"packetLimit": 0}, {"knownPacketVersions": self.known(self.ids)}):
            with self.subTest(changes=changes):
                self.rpc.calls.clear()
                self.assertIsNone(self.query(**changes)["packets"])
                self.assertFalse(
                    any(
                        "/hub_task_versions/" in name or "/hub_tasks/" in name
                        for group in self.reads()
                        for name in group
                    )
                )

    def test_unknown_cache_ids_do_not_authorize_or_read_unlisted_tasks(self):
        known = self.known(self.ids) + [
            {"taskId": "foreign_cached_task", "taskVersion": 1, "envelopeFingerprint": "a" * 64}
        ]
        self.assertIsNone(self.query(knownPacketVersions=known)["packets"])
        self.assertFalse(
            any("/hub_task_versions/" in name for group in self.reads() for name in group)
        )
        known = self.known(self.ids)
        known[0]["envelopeFingerprint"] = "f" * 64
        value = self.query(knownPacketVersions=known)
        self.assertEqual([row["taskId"] for row in value["packets"]["items"]], self.ids[:1])

    def test_combined_budget_alone_defers_packets_and_bad_carrier_is_never_hidden(self):
        without = self.query(packetLimit=0)
        maximum = len(canonical_json(without)) + 100

        def budget(value):
            return check_size(value, maximum if value.get("profile") == PROFILE else 1024 * 1024)

        with patch("app.task_overview.check_read_response", side_effect=budget):
            value = self.query()
            self.assertIsNone(value["packets"])
            self.assertEqual(value["tasks"], without["tasks"])
            self.assertEqual(value["feeds"], without["feeds"])
            original = self.f.service.packets(UID, self.ids)
            self.assertEqual(len(original["items"]), 4)
            path = self.name(_paths(self.owner, self.vault, self.ids[-1], 1))
            self.rpc.documents[path]["ownerSubject"] = "foreign_owner"
            with self.assertRaises(StoreUnavailable):
                self.query()

    def test_packet_batch_partial_prefix_keeps_exact_remaining_suffix(self):
        def budget(value):
            if (
                value.get("profile") == "folioview.owner-task-packets.v1"
                and len(value["items"]) > 1
            ):
                raise ContractError("payload_too_large")

        with patch("app.task_overview.check_read_response", side_effect=budget):
            page = self.query()["packets"]
        self.assertEqual([row["taskId"] for row in page["items"]], self.ids[:1])
        self.assertEqual(page["remainingTaskIds"], self.ids[1:])

    def test_packet_metadata_must_match_current_head_before_any_budget_null(self):
        task = self.ids[0]
        index = self.name(document_path("hub_task_indexes", self.owner, self.vault))
        head = self.name(_paths(self.owner, self.vault, task))
        self.rpc.documents[index]["tasks"][task]["envelopeFingerprint"] = "f" * 64
        self.rpc.documents[head]["metadata"]["envelopeFingerprint"] = "f" * 64

        def combined_only(value):
            if value.get("profile") == PROFILE and value.get("packets") is not None:
                raise ContractError("payload_too_large")

        for forced_budget in (False, True):
            with (
                self.subTest(forced_budget=forced_budget),
                patch(
                    "app.task_overview.check_read_response",
                    side_effect=combined_only
                    if forced_budget
                    else task_overview.check_read_response,
                ),
            ):
                with self.assertRaises(StoreUnavailable):
                    self.query()

    def test_retry_rereads_root_lifecycle_and_state_then_next_request_is_fresh(self):
        path = self.name(lifecycle_path(self.owner, self.vault))
        result = self.name(foreground_path(self.owner, self.foreground_ids[0]))

        def winner():
            self.rpc.documents[path] = {"version": 1, "tasks": {self.ids[0]: "trashed"}}
            self.rpc.documents[result]["metadata"].update(read=False, stateVersion=9)

        self.rpc.aborts = 1
        self.rpc.before_abort = winner
        with patch("app.vaults.verify_registry", wraps=vaults.verify_registry) as verify:
            value = self.query()
            self.assertEqual(verify.call_count, 2)
        self.assertNotIn(self.ids[0], [row["taskId"] for row in value["tasks"]["items"]])
        self.assertNotIn(self.ids[0], [row["taskId"] for row in value["packets"]["items"]])
        self.rpc.documents.pop(path)
        self.assertIn(self.ids[0], [row["taskId"] for row in self.query()["tasks"]["items"]])

    def test_wrong_owner_vault_clock_and_malformed_body_fail_without_partial_snapshot(self):
        for uid, vault in ((OTHER_UID, self.vault), (UID, "foreign_vault")):
            with self.subTest(uid=uid, vault=vault), self.assertRaises(ContractError):
                self.service.overview(uid, vault, self.payload)
        for now in (True, -1, float("nan"), float("inf")):
            with self.subTest(now=now), self.assertRaises(StoreUnavailable):
                TaskOverviewService(self.store, clock=lambda now=now: now).overview(
                    UID, self.vault, self.payload
                )
        valid = self.known(self.ids[:1])[0]
        for changes in (
            {"packetLimit": True},
            {"packetLimit": 1},
            {"knownPacketVersions": [valid, valid]},
            {"knownPacketVersions": [{**valid, "taskVersion": True}]},
            {"knownPacketVersions": [{**valid, "private": "marker"}]},
            {"knownPacketVersions": [valid] * 33},
            {"extra": "marker"},
        ):
            self.rpc.calls.clear()
            with self.subTest(changes=changes), self.assertRaises(ContractError):
                self.query(**changes)
            self.assertEqual(self.rpc.calls, [])

    def test_corrupt_metadata_partial_duplicate_stream_and_read_bytes_fail_closed(self):
        original = self.rpc.batch_get_documents
        for mode in ("partial", "duplicate", "malformed"):

            def broken(mode=mode, **kwargs):
                rows = list(original(**kwargs))
                if mode == "partial":
                    return iter(rows[:-1])
                if mode == "duplicate":
                    return iter([*rows, rows[0]])
                rows[0].found.fields["invalid"] = Value(bytes_value=b"not-json")
                return iter(rows)

            with (
                self.subTest(mode=mode),
                patch.object(self.rpc, "batch_get_documents", broken),
                self.assertRaises(StoreUnavailable),
            ):
                self.query()
        with patch.object(task_overview, "MAX_READ_BYTES", 1), self.assertRaises(ContractError):
            self.query()
        name = self.name(foreground_path(self.owner, self.foreground_ids[0]))
        self.rpc.documents[name]["ownerSubject"] = "foreign_owner"
        with self.assertRaises(StoreUnavailable):
            self.query()

    def test_existing_thirty_two_task_capacity_keeps_complete_unpaged_metadata(self):
        self.f.service.store = self.f.store
        for position in range(4, 32):
            task = f"synthetic_capacity_task_{position:04d}"
            operation = f"synthetic_capacity_create_{position:04d}"
            self.f.save(self.f.fixture.body(task=task, operation=operation), operation=operation)
        connection = self.f.store.connect()
        try:
            from folioview_shared.encrypted.jsonutil import strict_json_loads

            for path, body in connection.execute("SELECT path, body FROM hub_documents"):
                if path.startswith(("hub_tasks/", "hub_task_indexes/", "hub_task_versions/")):
                    self.rpc.documents[self.name(path)] = strict_json_loads(body)
        finally:
            connection.close()
        value = self.query()
        self.assertEqual(len(value["tasks"]["items"]), 32)
        self.assertIsNone(value["tasks"]["nextCursor"])
        self.assertEqual(len(value["packets"]["items"]), 4)

    def test_corrupt_root_on_commit_retry_never_returns_first_attempt_snapshot(self):
        path = self.name(document_path("hub_vaults", self.owner))
        self.rpc.aborts = 1
        self.rpc.before_abort = lambda: self.rpc.documents[path].update(
            ownerSubject="foreign_owner"
        )
        with self.assertRaises(StoreUnavailable):
            self.query()
        self.assertFalse(self.assert_no_business_writes())


class TaskOverviewRouteTests(unittest.TestCase):
    def setUp(self):
        self.fixture = route_fixture.TaskRouteTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.service = TaskOverviewService(self.fixture.store, clock=lambda: 1000)
        app.dependency_overrides[get_overview] = lambda: self.service
        self.addCleanup(lambda: app.dependency_overrides.pop(get_overview, None))
        self.path = f"/api/v3/tasks/{self.fixture.fixture.vault}/overview/query"
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.value = {
            "contractVersion": CONTRACT_VERSION,
            "knownPacketVersions": [],
            "packetLimit": 4,
        }

    def test_owner_read_only_post_has_closed_envelope_and_no_issuance_dependency(self):
        result = self.fixture.client.post(self.path, headers=self.headers, json=self.value)
        self.assertEqual(result.status_code, 200, result.text[:200])
        self.assertEqual(result.headers["cache-control"], "no-store")
        self.assertEqual(result.json()["profile"], PROFILE)
        self.assertEqual(result.json()["tasks"]["items"], [])
        self.assertIsNone(result.json()["packets"])
        self.assertFalse(result.json()["capabilities"]["enabled"])

    def test_query_protocol_media_body_and_native_identity_refusals_precede_read(self):
        for path, headers, value, status in (
            (self.path + "?cursor=unsupported", self.headers, self.value, 400),
            (self.path, {}, self.value, 400),
            (self.path, {**self.headers, "X-FolioView-Delegation": "synthetic"}, self.value, 400),
            (
                self.path,
                {**self.headers, "X-Serverless-Authorization": "synthetic"},
                self.value,
                403,
            ),
            (self.path, self.headers, {**self.value, "extra": "synthetic"}, 400),
        ):
            with (
                self.subTest(path=path, headers=headers),
                patch.object(self.service, "overview") as read,
            ):
                result = self.fixture.client.post(path, headers=headers, json=value)
                self.assertEqual(result.status_code, status)
                read.assert_not_called()
        self.assertEqual(
            self.fixture.client.post(self.path, headers=self.headers, content="{}").status_code, 415
        )
        self.assertEqual(
            self.fixture.client.post(
                self.path,
                headers={**self.headers, "Content-Type": "application/json"},
                content=b" " * 16385,
            ).status_code,
            413,
        )

    def test_missing_owner_cannot_reach_storage(self):
        app.dependency_overrides.pop(require_owner)
        with patch.object(self.service, "overview") as read:
            result = self.fixture.client.post(self.path, headers=self.headers, json=self.value)
        self.assertEqual(result.status_code, 401)
        read.assert_not_called()
