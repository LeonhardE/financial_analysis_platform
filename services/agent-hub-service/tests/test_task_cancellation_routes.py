"""Owner-only root cancellation HTTP transport; no device or delegation bypass."""

import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from fixtures import OTHER_UID, UID
from task_cancellation_fixtures import CANCEL, OP, TASK
from test_task_upload_cancellations import CancellationSetup

from app.api import require_owner
from app.main import app
from app.store import SQLiteHubStore
from app.task_upload_cancellations import PROFILE
from app.tasks import get_task_service
from folioview_shared.encrypted.constants import CONTRACT_VERSION


class TaskCancellationRouteTests(CancellationSetup, unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.prepare(SQLiteHubStore(Path(directory.name) / "http.sqlite3"))
        app.dependency_overrides[get_task_service] = lambda: self.tasks
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=UID)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.path = f"/api/v2/tasks/{TASK}/operation-cancellations"
        self.read = self.path + "/" + CANCEL
        self.headers = {"X-FolioView-Contract": CONTRACT_VERSION}
        self.write_headers = {**self.headers, "Idempotency-Key": CANCEL}

    def failure(self, response, status):
        self.assertEqual(response.status_code, status, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_cancel_and_exact_receipt_round_trip_without_current_device(self):
        self.clock = 5001
        posted = self.client.post(self.path, headers=self.write_headers, json=self.command)
        self.assertEqual(posted.status_code, 200, posted.text[:200])
        self.assertEqual(posted.headers["cache-control"], "no-store")
        self.assertEqual(posted.json()["profile"], PROFILE)
        self.assertEqual(posted.json()["receipt"]["outcome"], "cancelled")
        received = self.client.get(self.read, headers=self.headers)
        self.assertEqual(received.status_code, 200)
        self.assertEqual(received.content, posted.content)
        self.failure(
            self.client.get(f"/api/v2/tasks/{TASK}/operations/{OP}", headers=self.headers), 404
        )
        retry = self.client.post(self.path, headers=self.write_headers, json=self.command)
        self.assertEqual(retry.content, posted.content)

    def test_post_header_query_private_fields_and_body_size_boundaries(self):
        for headers, status in [
            ({}, 400),
            (self.headers, 400),
            ({**self.write_headers, "X-FolioView-Author-Key": self.f.kid("device_sig")}, 400),
            ({**self.write_headers, "X-FolioView-Delegation": "opaque"}, 403),
            ({**self.write_headers, "X-Serverless-Authorization": "Bearer a.b.c"}, 403),
            ([*self.write_headers.items(), ("Idempotency-Key", CANCEL)], 400),
            ([*self.write_headers.items(), ("X-FolioView-Contract", CONTRACT_VERSION)], 400),
        ]:
            with self.subTest(headers=headers):
                self.failure(
                    self.client.post(self.path, headers=headers, json=self.command), status
                )
        self.failure(
            self.client.post(
                self.path + "?owner=foreign", headers=self.write_headers, json=self.command
            ),
            400,
        )
        self.failure(
            self.client.post(
                self.path, headers=self.write_headers, json={**self.command, "owner": "foreign"}
            ),
            400,
        )
        self.failure(
            self.client.post(
                self.path,
                headers={**self.write_headers, "Content-Type": "application/json"},
                content=b"x" * 8193,
            ),
            413,
        )
        self.failure(
            self.client.post(
                self.path,
                headers={**self.write_headers, "Content-Type": "text/plain"},
                content="{}",
            ),
            415,
        )
        duplicate = '{"contractVersion":"' + CONTRACT_VERSION + '","command":{},"command":{}}'
        self.failure(
            self.client.post(
                self.path,
                headers={**self.write_headers, "Content-Type": "application/json"},
                content=duplicate,
            ),
            400,
        )
        self.failure(self.client.get(self.read, headers=self.headers), 404)

    def test_get_refuses_body_write_selectors_duplicate_contract_and_delegation(self):
        self.cancel()
        for headers, status in [
            (self.write_headers, 400),
            ({**self.headers, "X-FolioView-Author-Key": self.f.kid("device_sig")}, 400),
            ({**self.headers, "X-FolioView-Delegation": "opaque"}, 403),
            ({**self.headers, "X-Serverless-Authorization": "Bearer a.b.c"}, 403),
            ([*self.headers.items(), ("X-FolioView-Contract", CONTRACT_VERSION)], 400),
        ]:
            self.failure(self.client.get(self.read, headers=headers), status)
        self.failure(self.client.request("GET", self.read, headers=self.headers, content="{}"), 400)
        self.failure(self.client.get(self.read + "?target=any", headers=self.headers), 400)

    def test_changed_cancel_body_conflicts_and_damaged_receipt_never_returns_success(self):
        self.cancel()
        changed = self.f.cancellation({**self.target, "packetDigest": "0" * 64})
        self.failure(self.client.post(self.path, headers=self.write_headers, json=changed), 409)
        ledger = self.store.transact(lambda unit: unit.get(self.ledger_path()))
        broken = copy.deepcopy(ledger)
        broken["records"][CANCEL]["receipt"]["acceptedAt"] = True
        self.store.transact(lambda unit: unit.put(self.ledger_path(), broken))
        self.failure(self.client.get(self.read, headers=self.headers), 503)

    def test_missing_owner_identity_precedes_storage_and_network(self):
        app.dependency_overrides.pop(require_owner)
        app.dependency_overrides[get_task_service] = lambda: (_ for _ in ()).throw(
            AssertionError("storage")
        )
        with patch("socket.create_connection", side_effect=AssertionError("network")):
            self.failure(self.client.get(self.read, headers=self.headers), 401)
            self.failure(
                self.client.post(self.path, headers=self.write_headers, json=self.command), 401
            )

    def test_owner_switch_cannot_read_foreign_cancellation_receipt(self):
        self.cancel()
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=OTHER_UID)
        self.failure(self.client.get(self.read, headers=self.headers), 404)
