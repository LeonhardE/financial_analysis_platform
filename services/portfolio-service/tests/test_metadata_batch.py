"""Real SDK batch reads preserve source fences and transaction retry checks."""

import copy
import unittest
from unittest.mock import patch

from fixtures import SOURCE, UID, HoldingsFixture
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.holdings import PortfolioError, PortfolioService, verify_registry
from app.store import FirestorePortfolioStore, StoreUnavailable, document_path
from folioview_shared.encrypted.errors import ContractError
from folioview_shared.encrypted.jsonutil import canonical_json, strict_json_loads
from folioview_shared.identity import owner_key


class MetadataBatchTests(unittest.TestCase):
    def setUp(self):
        self.client = firestore.Client(
            project="synthetic-portfolio", database="portfolio", credentials=AnonymousCredentials()
        )
        self.rpc = MemoryRpc(self.client)
        self.client._firestore_api_internal = self.rpc
        self.store = FirestorePortfolioStore("synthetic-portfolio", "portfolio", client=self.client)
        self.service = PortfolioService(self.store, clock=lambda: 1000)
        self.fixture = HoldingsFixture()
        self.fixture.install(self.service)

    def sources(self, count):
        original = copy.deepcopy(next(iter(self.rpc.documents.values())))
        sources = [SOURCE] + [f"holdings_{i}" for i in range(1, count)]
        for source in sources[1:]:
            row = copy.deepcopy(original)
            row["sourceId"] = source
            row["resourceRef"]["resourceId"] = source
            self.rpc.documents[self.authority_name(source)] = row
        self.rpc.calls.clear()
        return sources

    def authority_name(self, source):
        return self.client.document(
            document_path("portfolio_authorities", owner_key(UID), source)
        )._document_path

    def test_one_two_ten_sources_use_one_sdk_read_and_one_identical_history_verification(self):
        for count in (1, 2, 10):
            sources = self.sources(count)
            with (
                self.subTest(count=count),
                patch("app.holdings.verify_registry", wraps=verify_registry) as verify,
            ):
                values = self.service.metadata_many(UID, list(reversed(sources)))
            self.assertEqual([value["sourceId"] for value in values], list(reversed(sources)))
            self.assertTrue(all(value["state"] == "active" for value in values))
            reads = [args for kind, args in self.rpc.calls if kind == "get"]
            self.assertEqual(len(reads), 1)
            self.assertEqual(len(reads[0]["request"]["documents"]), 3 * count)
            self.assertEqual(verify.call_count, 1)

    def test_retry_rereads_revocation_and_does_not_reuse_previous_attempt_verification(self):
        sources = self.sources(2)

        def revoke():
            self.rpc.documents[self.authority_name(sources[1])]["active"] = False

        self.rpc.aborts = 1
        self.rpc.before_abort = revoke
        with (
            patch("app.holdings.verify_registry", wraps=verify_registry) as verify,
            self.assertRaises(PortfolioError) as error,
        ):
            self.service.metadata_many(UID, sources)
        self.assertEqual(error.exception.code, "insufficient_scope")
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(sum(kind == "get" for kind, _ in self.rpc.calls), 2)

    def test_tampered_second_history_is_not_hidden_by_first_source_cache(self):
        sources = self.sources(2)
        row = self.rpc.documents[self.authority_name(sources[1])]
        history = strict_json_loads(row["registryHistory"])
        history[0]["checkpoint"]["signature"] = "A" * 86
        row["registryHistory"] = canonical_json(history)
        with self.assertRaises(StoreUnavailable):
            self.service.metadata_many(UID, sources)

    def test_mixed_missing_source_fails_without_partial_success_or_previous_request_cache(self):
        sources = self.sources(2)
        self.service.metadata_many(UID, sources)
        del self.rpc.documents[self.authority_name(sources[1])]
        with self.assertRaises(PortfolioError) as error:
            self.service.metadata_many(UID, sources)
        self.assertEqual(error.exception.code, "authorization_unavailable")
        self.service.clock = lambda: 0
        with self.assertRaises(StoreUnavailable):
            self.service.metadata(UID, SOURCE)

    def test_source_limit_and_duplicates_fail_before_store_io(self):
        self.rpc.calls.clear()
        for sources in ([], [SOURCE] * 2, [f"holdings_{i}" for i in range(11)]):
            with self.subTest(sources=sources), self.assertRaises(ContractError):
                self.service.metadata_many(UID, sources)
        self.assertEqual(self.rpc.calls, [])

    def test_closed_stage_timings_do_not_log_owner_or_source_identifiers(self):
        sources = self.sources(2)
        with self.assertLogs("uvicorn.error.portfolio_metadata", level="INFO") as logs:
            self.service.metadata_many(UID, sources)
        text = "\n".join(logs.output)
        for label in ("storage_ms=", "authority_ms=", "head_ms=", "lifecycle_ms=", "total_ms="):
            self.assertIn(label, text)
        for private in (UID, owner_key(UID), *sources, self.fixture.vault):
            self.assertNotIn(private, text)
