"""Real SDK batch reads preserve source fences and transaction retry checks."""

import copy
import unittest
from unittest.mock import patch

from fixtures import SOURCE, UID, HoldingsFixture
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
from test_firestore_store import MemoryRpc

from app.holdings import PortfolioError, PortfolioService, _authority, verify_registry
from app.lifecycle import state_path
from app.store import FirestorePortfolioStore, StoreUnavailable, document_path
from folioview_shared.encrypted.constants import MAX_SAFE_INTEGER
from folioview_shared.encrypted.crypto import verify_jws
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

    def long_history(self, count=2):
        sources = self.sources(count)
        fixture = self.fixture
        fixture.certificates = {
            name: value for name, value in fixture.certificates.items() if not name.startswith("A")
        }
        fixture.bundle = fixture.make_bundle()
        fixture.registry = fixture.verify(fixture.bundle)
        history = [fixture.bundle]
        registry = fixture.registry
        for generation in range(1, 23):
            principal, connection = f"synthetic_{generation}", f"connection_{generation}"
            for role in ("agent_sig", "agent_enc"):
                fixture.add_key(f"{principal}_{role}", role, principal, connection)
            bundle = fixture.make_bundle(previous=registry)
            known = {
                entry["certificate"]["payload"]: entry["certificate"]
                for entry in history[-1]["entries"]
            }
            for entry in bundle["entries"]:
                entry["certificate"] = copy.deepcopy(
                    known.get(entry["certificate"]["payload"], entry["certificate"])
                )
            registry = fixture.verify(bundle, previous=registry)
            history.append(bundle)
        for source in sources:
            self.rpc.documents[self.authority_name(source)]["registryHistory"] = canonical_json(
                history
            )
        return sources, history

    def test_long_history_reuses_signatures_across_seconds_but_not_requests(self):
        sources, _ = self.long_history()
        self.service.clock = iter((1000, 1001, 1002, 1003)).__next__
        self.rpc.calls.clear()
        with (
            patch("app.holdings.verify_registry", wraps=verify_registry) as histories,
            patch(
                "folioview_shared.encrypted.authority.verify_jws", wraps=verify_jws
            ) as signatures,
        ):
            first = self.service.metadata_many(UID, sources)
            self.assertEqual(histories.call_count, 23)
            self.assertEqual(signatures.call_count, 70)  # 23 checkpoints plus 47 certificates.
            self.assertEqual(self.service.metadata_many(UID, sources), first)
            self.assertEqual(histories.call_count, 46)
            self.assertEqual(signatures.call_count, 140)
        self.assertEqual(sum(kind == "get" for kind, _ in self.rpc.calls), 2)
        self.assertTrue(
            all(not kw["request"]["writes"] for kind, kw in self.rpc.calls if kind == "commit")
        )

    def test_reused_history_still_rejects_future_checkpoint_after_clock_rollback(self):
        sources, history = self.long_history()
        self.service.clock = iter((1000, 521)).__next__  # Last checkpoint was issued at 522.
        with (
            patch("app.holdings.verify_registry", wraps=verify_registry) as verify,
            self.assertRaises(StoreUnavailable),
        ):
            self.service.metadata_many(UID, sources)
        self.assertEqual(verify.call_count, len(history))

    def test_cache_hit_preserves_strict_time_and_complete_public_key_checks(self):
        row = copy.deepcopy(self.rpc.documents[self.authority_name(SOURCE)])
        row["registryHistory"] = strict_json_loads(row["registryHistory"])
        owner, cache = owner_key(UID), {}
        with patch("app.holdings.verify_registry", wraps=verify_registry) as verify:
            _authority(row, owner, SOURCE, 1000, registry_cache=cache)
            for now in (-1, True, 1000.0, "1000", MAX_SAFE_INTEGER + 1):
                with self.subTest(now=now), self.assertRaises(ContractError):
                    _authority(row, owner, SOURCE, now, registry_cache=cache)
            original = row["rootJwk"]
            for public in (original | {"extra": "rejected"}, original | {"crv": "P-384"}):
                row["rootJwk"] = public
                with self.subTest(public=public), self.assertRaises(ContractError):
                    _authority(row, owner, SOURCE, 1001, registry_cache=cache)
            self.assertEqual(verify.call_count, 1)

    def test_distinct_complete_histories_are_verified_independently(self):
        sources, history = self.long_history()
        self.rpc.documents[self.authority_name(sources[1])]["registryHistory"] = canonical_json(
            history[:-1]
        )
        self.service.clock = iter((1000, 1001)).__next__
        with patch("app.holdings.verify_registry", wraps=verify_registry) as verify:
            self.service.metadata_many(UID, sources)
        self.assertEqual(verify.call_count, 45)

    def test_distinct_root_pins_cannot_reuse_a_verified_history(self):
        sources = self.sources(2)
        other = HoldingsFixture(source=sources[1])
        row = self.rpc.documents[self.authority_name(sources[1])]
        row.update(
            rootJwk=other.root_public,
            rootKeyId=other.root_id,
            registryHistory=canonical_json([other.bundle]),
            writerKeyIds=[other.kid("device_sig")],
            recipientKeyIds=sorted([other.kid("device_enc"), other.kid("recovery_enc")]),
        )
        with patch("app.holdings.verify_registry", wraps=verify_registry) as verify:
            self.service.metadata_many(UID, sources)
        self.assertEqual(verify.call_count, 2)
        # Replacing only the public key while keeping the old pin also fails.
        row["rootKeyId"] = self.fixture.root_id
        with self.assertRaises(StoreUnavailable):
            self.service.metadata_many(UID, sources)

    def test_identical_history_reuse_never_masks_current_source_rows(self):
        sources = self.sources(2)
        owner = owner_key(UID)
        original = copy.deepcopy(self.rpc.documents)
        state_name = self.client.document(state_path(owner, sources[1]))._document_path
        head_name = self.client.document(
            document_path("portfolio_heads", owner, sources[1])
        )._document_path

        def bad_state(row):
            self.rpc.documents[state_name] = {
                "ownerSubject": "foreign_owner",
                "sourceId": sources[1],
                "resourceRef": row["resourceRef"],
                "sourceEpoch": row["sourceEpoch"],
                "state": "active",
                "mutationCount": 1,
                "pendingMutationId": None,
                "lastMutationId": "synthetic_mutation_000001",
            }

        def bad_head(_row):
            self.rpc.documents[head_name] = {
                "ownerSubject": "foreign_owner",
                "sourceId": sources[1],
                "revision": 1,
                "snapshotId": "snapshot_A",
            }

        for mutate in (
            lambda row: row.update(active=False),
            lambda row: row.update(sourceEpoch=True),
            bad_state,
            bad_head,
        ):
            self.rpc.documents = copy.deepcopy(original)
            second = self.rpc.documents[self.authority_name(sources[1])]
            self.service.clock = iter((1000, 1001)).__next__
            mutate(second)
            with (
                patch("app.holdings.verify_registry", wraps=verify_registry) as verify,
                self.assertRaises((StoreUnavailable, PortfolioError)),
            ):
                self.service.metadata_many(UID, sources)
            self.assertEqual(verify.call_count, 1)

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
