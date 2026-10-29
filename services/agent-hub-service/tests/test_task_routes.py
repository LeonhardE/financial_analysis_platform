"""Owner-only encrypted task HTTP boundaries with fresh synthetic keys."""

import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from fixtures import BOOT, OTHER_UID, UID, VaultFixture
from test_encrypted_envelope import EnvelopeFixture

from app.api import require_owner
from app.main import app
from app.store import SQLiteHubStore
from app.tasks import TaskService, get_task_service
from app.vaults import VaultService
from folioview_shared.encrypted.constants import CONTRACT_VERSION
from folioview_shared.encrypted.crypto import signing_input_fingerprint
from folioview_shared.encrypted.schema import validate_schema

TASK = "synthetic_http_task"
CREATE = "synthetic_task_http_create_0001"


class NoSources:
    def read(self, uid):
        raise AssertionError("Resource-free task must not fetch a source")


class HttpTaskFixture(VaultFixture):
    context = EnvelopeFixture.context
    carrier = EnvelopeFixture.carrier

    def body(self, *, task=TASK, version=1, operation=CREATE, transition=None, resources=()):
        context = self.context("task")
        context.update(
            objectId=task,
            revision=version,
            expectedRevision=version - 1,
            stableOperationId=operation,
            operationType="transition_task"
            if transition
            else ("create_task" if version == 1 else "update_task"),
            resourceBindings=copy.deepcopy(list(resources)),
        )
        context["binding"].update(taskId=task, taskVersion=version)
        carrier = self.carrier(context)
        value = {
            "contractVersion": CONTRACT_VERSION,
            "expectedVersion": version - 1,
            "resourceBindings": copy.deepcopy(list(resources)),
            "envelope": carrier,
        }
        if version == 1:
            value["taskId"] = task
        if transition:
            intent = self.base("task_transition_intent") | {
                "stableOperationId": operation,
                "taskId": task,
                "action": transition,
                "expectedVersion": version - 1,
                "nextTaskVersion": version,
                "nextExecutionEpoch": 2,
                "nextEnvelopeFingerprint": signing_input_fingerprint(carrier["signedObject"]),
                "registrySequence": self.registry.registry_sequence,
                "checkpointDigest": self.registry.checkpoint_digest,
                "keyEpoch": self.registry.key_epoch,
            }
            value["transitionIntent"] = self.sign(intent)
        return value


def result_value(value):
    return value[0] if isinstance(value, tuple) else value


class TaskRouteTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SQLiteHubStore(Path(directory.name) / "hub.sqlite3")
        self.vaults = VaultService(self.store, clock=lambda: 1000)
        self.fixture = HttpTaskFixture()
        self.vaults.bootstrap(UID, self.fixture.bootstrap(), BOOT)
        self.other = HttpTaskFixture(OTHER_UID)
        self.vaults.bootstrap(OTHER_UID, self.other.bootstrap(), BOOT)
        self.service = TaskService(self.store, NoSources(), clock=lambda: 1000)
        app.dependency_overrides[get_task_service] = lambda: self.service
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=UID)
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {
            "X-FolioView-Contract": CONTRACT_VERSION,
            "Idempotency-Key": CREATE,
            "X-FolioView-Author-Key": self.fixture.kid("device_sig"),
        }

    def failure(self, response, status, code=None):
        self.assertEqual(response.status_code, status, response.text[:200])
        self.assertEqual(response.headers["cache-control"], "no-store")
        validate_schema("Error", response.json())
        if code:
            self.assertEqual(response.json()["error"]["code"], code)
        self.assertNotIn("synthetic-secret-marker", response.text)

    def test_create_read_history_and_metadata_list_preserve_ciphertext_without_plaintext(self):
        body = self.fixture.body()
        created = self.client.post("/api/v2/tasks", headers=self.headers, json=body)
        self.assertEqual(created.status_code, 201, created.text[:200])
        self.assertEqual(created.headers["cache-control"], "no-store")
        validate_schema("EncryptedTask", created.json())
        current = self.client.get(f"/api/v2/tasks/{TASK}", headers=self.headers)
        historical = self.client.get(f"/api/v2/tasks/{TASK}/versions/1", headers=self.headers)
        self.assertEqual(current.json(), created.json())
        self.assertEqual(historical.json(), created.json())
        listed = self.client.get("/api/v2/tasks", headers=self.headers)
        self.assertEqual(listed.status_code, 200, listed.text[:200])
        validate_schema("TaskMetadataPage", listed.json())
        self.assertEqual(listed.json()["items"], [created.json()["metadata"]])
        self.assertNotIn("signedObject", listed.text)
        self.assertNotIn("title", listed.text)
        replay = self.client.post("/api/v2/tasks", headers=self.headers, json=body)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json(), created.json())
        self.assertEqual(replay.content, created.content)

    def test_account_switch_cannot_read_or_list_another_owners_task_or_versions(self):
        self.service.create(UID, self.fixture.body(), CREATE, self.fixture.kid("device_sig"))
        app.dependency_overrides[require_owner] = lambda: SimpleNamespace(uid=OTHER_UID)
        for path in (f"/api/v2/tasks/{TASK}", f"/api/v2/tasks/{TASK}/versions/1"):
            self.failure(self.client.get(path, headers=self.headers), 404)
        listed = self.client.get("/api/v2/tasks", headers=self.headers)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["items"], [])
        self.assertIsNone(listed.json()["nextCursor"])

    def test_unknown_private_fields_queries_and_protocol_credentials_fail_closed(self):
        body = self.fixture.body()
        for field, value in (
            ("owner", OTHER_UID),
            ("title", "synthetic-secret-marker"),
            ("timezone", "America/Toronto"),
        ):
            self.failure(
                self.client.post(
                    "/api/v2/tasks", headers=self.headers, json={**body, field: value}
                ),
                400,
            )
        for query in (
            "q=synthetic-secret-marker",
            "search=secret",
            "sort=title",
            "offset=1",
            "limit=0",
            "limit=51",
            "limit=1&limit=2",
        ):
            self.failure(self.client.get("/api/v2/tasks?" + query, headers=self.headers), 400)
        for extra in (
            {"X-FolioView-Delegation": "opaque"},
            {"X-Serverless-Authorization": "Bearer a.b.c"},
        ):
            self.failure(self.client.get("/api/v2/tasks", headers={**self.headers, **extra}), 403)

    def test_write_transport_headers_json_and_size_are_bounded_before_persistence(self):
        body = self.fixture.body()
        for missing in ("X-FolioView-Contract", "Idempotency-Key", "X-FolioView-Author-Key"):
            self.failure(
                self.client.post(
                    "/api/v2/tasks",
                    headers={k: v for k, v in self.headers.items() if k != missing},
                    json=body,
                ),
                400,
            )
        self.failure(
            self.client.post(
                "/api/v2/tasks",
                headers={**self.headers, "Content-Type": "text/plain"},
                content="{}",
            ),
            415,
        )
        self.failure(
            self.client.post(
                "/api/v2/tasks",
                headers={**self.headers, "Content-Type": "application/json"},
                content=b"x" * 589825,
            ),
            413,
        )
        duplicate = (
            '{"contractVersion":"' + CONTRACT_VERSION + '","expectedVersion":0,"expectedVersion":1}'
        )
        self.failure(
            self.client.post(
                "/api/v2/tasks",
                headers={**self.headers, "Content-Type": "application/json"},
                content=duplicate,
            ),
            400,
        )
        self.assertEqual(self.service.list(UID)["items"], [])

    def test_missing_identity_is_rejected_before_storage_or_cloud(self):
        app.dependency_overrides.pop(require_owner)
        app.dependency_overrides[get_task_service] = lambda: (_ for _ in ()).throw(
            AssertionError("private storage")
        )
        with patch("socket.create_connection", side_effect=AssertionError("network")):
            self.failure(self.client.get("/api/v2/tasks", headers=self.headers), 401)

    def test_state_transition_requires_intent_and_next_ciphertext_is_retained(self):
        created = self.client.post("/api/v2/tasks", headers=self.headers, json=self.fixture.body())
        self.assertEqual(created.status_code, 201)
        operation = "synthetic_task_http_pause_0001"
        headers = {**self.headers, "Idempotency-Key": operation}
        body = self.fixture.body(version=2, operation=operation, transition="pause")
        without = copy.deepcopy(body)
        without.pop("transitionIntent")
        self.failure(
            self.client.post(f"/api/v2/tasks/{TASK}/transitions", headers=headers, json=without),
            400,
        )
        paused = self.client.post(f"/api/v2/tasks/{TASK}/transitions", headers=headers, json=body)
        self.assertEqual(paused.status_code, 200, paused.text[:200])
        self.assertEqual(paused.json()["metadata"]["status"], "paused")
        self.assertEqual(paused.json()["metadata"]["executionEpoch"], 2)
        self.assertEqual(paused.json()["metadata"]["taskVersion"], 2)
        self.assertEqual(
            self.client.get(f"/api/v2/tasks/{TASK}/versions/1", headers=headers).json(),
            created.json(),
        )
