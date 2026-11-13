"""Retention pages use the real SDK's bounded Owner query and reference cursor."""

import unittest

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from google.cloud.firestore_v1._helpers import encode_dict
from google.cloud.firestore_v1.types import Document, RunQueryResponse
from test_firestore_store import MemoryRpc

from app.store import FirestoreHubStore, document_path


class LifecycleScanTests(unittest.TestCase):
    def test_query_is_owner_scoped_limited_and_resumes_by_document_reference(self):
        client = firestore.Client(
            project="synthetic-hub", database="agent-hub", credentials=AnonymousCredentials()
        )
        self.addCleanup(client.close)
        rpc = MemoryRpc(client)
        selected = document_path("hub_task_versions", "synthetic_owner", "vault", "task", "1")
        requests = []

        def query(**kwargs):
            rpc.record("query", kwargs)
            req = kwargs["request"]
            requests.append(req)
            return iter(
                [
                    RunQueryResponse(
                        document=Document(
                            name=client.document(selected)._document_path,
                            fields=encode_dict({"ownerSubject": "synthetic_owner"}),
                        )
                    )
                ]
            )

        rpc.run_query = query
        client._firestore_api_internal = rpc
        store = FirestoreHubStore("synthetic-hub", "agent-hub", client=client)
        rows = store.transact(
            lambda u: u.scan_owner(
                "hub_task_versions", "ownerSubject", "synthetic_owner", after=selected
            )
        )
        self.assertEqual(rows, [(selected, {"ownerSubject": "synthetic_owner"})])
        q = requests[0]["structured_query"]
        self.assertEqual(q.limit, 4)
        self.assertEqual(q.where.field_filter.field.field_path, "ownerSubject")
        self.assertEqual(q.where.field_filter.value.string_value, "synthetic_owner")
        self.assertEqual(q.order_by[0].field.field_path, "__name__")
        self.assertEqual(
            q.start_at.values[0].reference_value, client.document(selected)._document_path
        )
        self.assertFalse(q.start_at.before)
