"""Watchlist privacy, persistence, bounded operations, and upstream independence."""

import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from firebase_admin import auth

from app.main import app
from app.market_client import MarketResolver, get_market_resolver
from app.watchlist import (
    LIMIT,
    FirestoreWatchlistStore,
    SQLiteWatchlistStore,
    WatchlistFull,
    WatchlistUnavailable,
    checked_items,
    configured_store,
    create_watchlist_store,
    get_watchlist_store,
    owner_key,
)
from folioview_shared import auth as app_auth
from folioview_shared.instruments import DEFAULT_BY_SYMBOL, Instrument

TOKEN = "verified-id-token"
USER = "verified-owner"
CLAIMS = {"uid": USER, "firebase": {"sign_in_provider": "google.com"}}


def item(symbol="AAPL", added_at="2026-10-20T10:00:00Z"):
    return {
        "symbol": symbol,
        "name": f"Company {symbol}",
        "instrumentType": "stock",
        "currency": "USD",
        "addedAt": added_at,
    }


class SQLiteWatchlistTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / "watchlists.sqlite3")
        self.store = SQLiteWatchlistStore(self.path)

    def test_persistence_uid_isolation_and_hashed_document_keys(self):
        self.assertEqual(self.store.get(USER), [])
        saved = self.store.change(USER, "AAPL", item())
        restarted = SQLiteWatchlistStore(self.path)
        self.assertEqual(restarted.get(USER), saved)
        self.assertEqual(restarted.get("different-user"), [])
        with closing(sqlite3.connect(self.path)) as db, db:
            owner, data = db.execute("SELECT owner,value FROM user_watchlists").fetchone()
        self.assertEqual(owner, owner_key(USER))
        self.assertNotIn(USER, data)
        self.assertNotIn("email", data)
        self.assertNotIn("token", data)

    def test_duplicate_add_and_missing_delete_make_no_extra_writes(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE writes (value INTEGER)")
            for event in ("INSERT", "UPDATE"):
                db.execute(
                    f"CREATE TRIGGER trace_{event} AFTER {event} ON user_watchlists "
                    "BEGIN INSERT INTO writes VALUES (1); END"
                )
        first = self.store.change(USER, "AAPL", item())
        duplicate = self.store.change(USER, "AAPL", item(added_at="2026-10-21T10:00:00Z"))
        self.assertEqual(first, duplicate)
        self.assertEqual(self.store.change(USER, "MSFT", None), first)
        with closing(sqlite3.connect(self.path)) as db, db:
            self.assertEqual(db.execute("SELECT count(*) FROM writes").fetchone()[0], 1)
        self.assertEqual(self.store.change(USER, "AAPL", None), [])
        self.assertEqual(SQLiteWatchlistStore(self.path).get(USER), [])

    def test_stable_oldest_first_order_does_not_change_on_duplicate(self):
        self.store.change(USER, "MSFT", item("MSFT", "2026-10-20T10:00:01Z"))
        self.store.change(USER, "AAPL", item())
        self.store.change(USER, "NVDA", item("NVDA"))
        self.assertEqual([row["symbol"] for row in self.store.get(USER)], ["AAPL", "NVDA", "MSFT"])
        self.store.change(USER, "AAPL", item(added_at="2026-10-21T10:00:00Z"))
        self.assertEqual(self.store.get(USER)[0]["addedAt"], "2026-10-20T10:00:00Z")

    def test_concurrent_instances_cannot_exceed_atomic_limit_or_create_duplicates(self):
        for index in range(LIMIT - 1):
            symbol = f"S{index}"
            self.store.change(USER, symbol, item(symbol))

        def add(index):
            store = SQLiteWatchlistStore(self.path)
            symbol = f"NEW{index}"
            try:
                store.change(USER, symbol, item(symbol))
                return True
            except WatchlistFull:
                return False

        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(add, range(20))), 1)
        rows = self.store.get(USER)
        self.assertEqual(len(rows), LIMIT)
        existing = rows[0]
        self.assertEqual(self.store.change(USER, existing["symbol"], existing), rows)
        self.assertEqual(len({row["symbol"] for row in rows}), LIMIT)
        self.assertEqual(self.store.get("other-user"), [])

    def test_corrupt_storage_fails_closed_and_is_not_overwritten(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("INSERT INTO user_watchlists VALUES (?, ?)", (owner_key(USER), "invalid"))
        for operation in (
            lambda: self.store.get(USER),
            lambda: self.store.change(USER, "AAPL", item()),
            lambda: self.store.change(USER, "AAPL", None),
        ):
            with self.assertRaises(WatchlistUnavailable):
                operation()
        with closing(sqlite3.connect(self.path)) as db, db:
            self.assertEqual(
                db.execute("SELECT value FROM user_watchlists").fetchone()[0], "invalid"
            )

    def test_documents_reject_oversize_duplicate_invalid_or_sensitive_items(self):
        malformed = (
            {},
            {"version": 1, "items": [item(), item()]},
            {"version": 1, "items": [item(f"S{x}") for x in range(LIMIT + 1)]},
            {"version": 1, "items": [{**item(), "email": "private@example.com"}]},
            {"version": 1, "items": [item("^HACK")]},
            {"version": 1, "items": [{**item(), "addedAt": "2026-10-20T10:00:00"}]},
            {"version": 1, "items": [{**item(), "currency": "CAD"}]},
        )
        for value in malformed:
            with self.subTest(value=value), self.assertRaises(WatchlistUnavailable):
                checked_items(value)


class FirestoreWatchlistTests(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.collection = MagicMock()
        self.metadata_collection = MagicMock()
        self.client.collection.side_effect = lambda name: (
            self.collection if name == "user_watchlists" else self.metadata_collection
        )
        self.document = self.collection.document.return_value
        self.metadata_document = self.metadata_collection.document.return_value
        self.document.get.return_value.to_dict.return_value = None
        self.metadata_document.get.return_value.to_dict.return_value = None
        with patch("app.watchlist.firestore.Client", return_value=self.client) as constructor:
            self.store = FirestoreWatchlistStore("test-project", "(default)")
        constructor.assert_called_once_with(project="test-project", database="(default)")
        self.transaction = MagicMock()
        decorator = patch("app.watchlist.firestore.transactional", side_effect=lambda fn: fn)
        decorator.start()
        self.addCleanup(decorator.stop)
        transaction = patch("app.watchlist.BoundedTransaction", return_value=self.transaction)
        self.transaction_constructor = transaction.start()
        self.addCleanup(transaction.stop)

    def test_gets_are_bounded_private_and_never_process_cached(self):
        self.assertEqual(self.store.get(USER), [])
        self.document.get.return_value.to_dict.return_value = {"version": 1, "items": [item()]}
        self.assertEqual(self.store.get(USER), [item()])
        self.assertEqual(self.document.get.call_count, 2)
        self.document.get.assert_called_with(timeout=4, retry=None)
        self.client.collection.assert_called_once_with("user_watchlists")
        self.collection.document.assert_called_with(owner_key(USER))

    def test_transaction_adds_once_and_does_not_write_duplicate_or_missing_delete(self):
        self.assertEqual(self.store.change(USER, "AAPL", item()), [item()])
        self.transaction_constructor.assert_called_once_with(self.client, max_attempts=2)
        self.document.get.assert_called_with(transaction=self.transaction, timeout=4, retry=None)
        self.assertEqual(self.transaction.set.call_count, 2)
        self.transaction.set.assert_any_call(self.document, {"version": 1, "items": [item()]})
        metadata = self.transaction.set.call_args_list[1].args[1]
        self.assertEqual(metadata["revision"], 1)
        self.metadata_document.get.return_value.to_dict.return_value = metadata
        self.document.get.return_value.to_dict.return_value = {"version": 1, "items": [item()]}
        self.transaction.reset_mock()
        self.assertEqual(self.store.change(USER, "AAPL", item()), [item()])
        self.assertEqual(self.store.change(USER, "MSFT", None), [item()])
        self.transaction.set.assert_not_called()
        self.assertEqual(self.store.change(USER, "AAPL", None), [])
        self.assertEqual(self.transaction.set.call_count, 2)
        self.transaction.set.assert_any_call(self.document, {"version": 1, "items": []})
        self.assertEqual(self.transaction.set.call_args_list[1].args[1]["revision"], 2)

    def test_transaction_enforces_limit_and_sdk_errors_are_private(self):
        full = [item(f"S{x}") for x in range(LIMIT)]
        self.document.get.return_value.to_dict.return_value = {"version": 1, "items": full}
        with self.assertRaises(WatchlistFull):
            self.store.change(USER, "NEW", item("NEW"))
        self.transaction.set.assert_not_called()
        self.document.get.side_effect = RuntimeError("private SDK details")
        for operation in (
            lambda: self.store.get(USER),
            lambda: self.store.change(USER, "AAPL", None),
        ):
            with self.assertRaises(WatchlistUnavailable):
                operation()

    def test_cloud_run_refuses_sqlite_unknown_backend_and_emulator_even_empty_service_name(self):
        for config in (
            {"K_SERVICE": "market-api", "MARKET_CACHE_BACKEND": "sqlite"},
            {"K_SERVICE": "", "MARKET_CACHE_BACKEND": "sqlite"},
            {"K_SERVICE": "market-api", "FIRESTORE_EMULATOR_HOST": "localhost:8080"},
            {"K_SERVICE": "market-api", "FIREBASE_AUTH_EMULATOR_HOST": "localhost:9099"},
            {"K_SERVICE": "market-api", "MARKET_CACHE_BACKEND": "unknown"},
            {"MARKET_CACHE_BACKEND": "firestore"},
        ):
            with self.subTest(config=config), patch.dict(os.environ, config, clear=True):
                with self.assertRaises(WatchlistUnavailable):
                    create_watchlist_store()

    def test_cloud_run_reuses_existing_runtime_project_database_and_credentials(self):
        with (
            patch.dict(
                os.environ,
                {
                    "K_SERVICE": "market-api",
                    "MARKET_CACHE_BACKEND": "firestore",
                    "MARKET_FIRESTORE_DATABASE": "(default)",
                    "FIREBASE_PROJECT_ID": "test-project",
                },
                clear=True,
            ),
            patch("app.watchlist.FirestoreWatchlistStore") as constructor,
        ):
            create_watchlist_store()
        constructor.assert_called_once_with("test-project", "(default)")

    def test_user_configuration_takes_precedence_and_preserves_existing_collection(self):
        with (
            patch.dict(
                os.environ,
                {
                    "K_SERVICE": "user-api",
                    "USER_STORE_BACKEND": "firestore",
                    "MARKET_CACHE_BACKEND": "sqlite",
                    "FIRESTORE_DATABASE": "existing-database",
                    "MARKET_FIRESTORE_DATABASE": "legacy-database",
                    "GOOGLE_CLOUD_PROJECT": "same-project",
                },
                clear=True,
            ),
            patch("app.watchlist.FirestoreWatchlistStore") as constructor,
        ):
            create_watchlist_store()
        constructor.assert_called_once_with("same-project", "existing-database")


class WatchlistRouteTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"FIREBASE_PROJECT_ID": "test-project"}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = SQLiteWatchlistStore(str(Path(self.directory.name) / "watchlists.sqlite3"))
        self.resolver = MagicMock(spec=MarketResolver)
        self.resolver.resolve = AsyncMock(side_effect=self.resolve)
        app.dependency_overrides[get_watchlist_store] = lambda: self.store
        app.dependency_overrides[get_market_resolver] = lambda: self.resolver
        self.addCleanup(app.dependency_overrides.clear)
        app_patch = patch.object(
            app_auth.firebase_admin,
            "get_app",
            return_value=SimpleNamespace(project_id="test-project"),
        )
        app_patch.start()
        self.addCleanup(app_patch.stop)
        verifier = patch.object(app_auth.auth, "verify_id_token", return_value=deepcopy(CLAIMS))
        self.verifier = verifier.start()
        self.addCleanup(verifier.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    @staticmethod
    def resolve(symbol):
        if symbol in DEFAULT_BY_SYMBOL:
            return DEFAULT_BY_SYMBOL[symbol]
        if symbol == "NFLX":
            return Instrument("NFLX", "Netflix")
        raise HTTPException(404, "US stock symbol not found")

    def request(self, method="GET", path="", **kwargs):
        return self.client.request(
            method,
            f"/api/v1/watchlist{path}",
            headers={"Authorization": f"Bearer {TOKEN}"},
            **kwargs,
        )

    def assert_private(self, response, status):
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(response.headers.get("cache-control"), "no-store")

    def test_auth_is_required_and_client_identity_cannot_override_verified_uid(self):
        for method, path in (("GET", ""), ("PUT", "/AAPL"), ("DELETE", "/AAPL")):
            anonymous = self.client.request(
                method,
                f"/api/v1/watchlist{path}?uid={USER}",
                headers={"X-User-Id": USER},
            )
            self.assert_private(anonymous, 401)
        self.verifier.assert_not_called()
        added = self.request("PUT", "/aapl?uid=attacker", json={"uid": "attacker"})
        self.assert_private(added, 200)
        self.assertEqual(added.json()["items"][0]["symbol"], "AAPL")
        self.assertEqual(self.store.get("attacker"), [])
        self.verifier.return_value = {
            "uid": "second-user",
            "firebase": {"sign_in_provider": "google.com"},
        }
        self.assertEqual(self.request().json(), {"items": [], "limit": LIMIT})
        self.request("DELETE", "/AAPL")
        self.assertEqual(len(self.store.get(USER)), 1)

    def test_expired_token_is_401_and_provider_or_storage_failure_is_503(self):
        self.verifier.side_effect = auth.ExpiredIdTokenError("private token", None)
        self.assert_private(self.request(), 401)
        self.verifier.side_effect = None
        self.store.get = MagicMock(side_effect=WatchlistUnavailable)
        failed = self.request()
        self.assert_private(failed, 503)
        self.assertNotIn("private", failed.text)
        self.store.get.side_effect = RuntimeError("private unexpected SDK detail")
        unexpected = self.request()
        self.assert_private(unexpected, 503)
        self.assertNotIn("private", unexpected.text)
        self.resolver.resolve.assert_not_awaited()

    def test_crud_alias_normalization_and_persistence_with_no_price_requests(self):
        self.assert_private(self.request(), 200)
        first = self.request("PUT", "/aapl")
        self.assert_private(first, 200)
        duplicate = self.request("PUT", "/AAPL")
        self.assertEqual(first.json(), duplicate.json())
        alias = self.request("PUT", "/^GSPC")
        self.assert_private(alias, 200)
        self.assertIn("SPX", [row["symbol"] for row in alias.json()["items"]])
        self.assertEqual(self.request().json(), alias.json())
        self.assertEqual(len(SQLiteWatchlistStore(self.store.path).get(USER)), 2)
        self.assert_private(self.request("DELETE", "/aapl"), 200)
        self.assert_private(self.request("DELETE", "/aapl"), 200)

    def test_new_add_uses_only_metadata_from_market_service(self):
        result = self.request("PUT", "/NFLX")
        self.assert_private(result, 200)
        self.assertEqual(result.json()["items"][0]["name"], "Netflix")
        self.resolver.resolve.assert_awaited_once_with("NFLX")

    def test_authenticated_add_crosses_http_boundary_without_forwarding_private_identity(self):
        requests = []

        class JSONBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield json.dumps({"stocks": [Instrument("NFLX", "Netflix").public()]}).encode()

        def handle(request):
            requests.append(request)
            return httpx.Response(200, stream=JSONBody())

        resolver = MarketResolver("https://market.example", transport=httpx.MockTransport(handle))
        app.dependency_overrides[get_market_resolver] = lambda: resolver
        added = self.request("PUT", "/NFLX?uid=attacker", json={"uid": "attacker"})
        self.assert_private(added, 200)
        self.assertEqual(self.store.get(USER)[0]["name"], "Netflix")
        self.assertEqual(self.store.get("attacker"), [])
        self.assertEqual(len(requests), 1)
        self.assertEqual(str(requests[0].url), "https://market.example/api/stocks/search?q=NFLX")
        self.assertNotIn("authorization", requests[0].headers)
        self.assertNotIn("cookie", requests[0].headers)
        self.assertNotIn(TOKEN, str(requests[0].headers))

    def test_unknown_symbol_and_upstream_validation_failure_do_not_write(self):
        unknown = self.request("PUT", "/NOTFOUND")
        self.assert_private(unknown, 404)
        self.resolver.resolve.side_effect = HTTPException(429, "Upstream quota exhausted")
        self.assert_private(self.request("PUT", "/OTHER"), 503)
        self.assertEqual(self.store.get(USER), [])

    def test_list_delete_and_duplicate_add_survive_unavailable_market_service(self):
        self.request("PUT", "/AAPL")
        self.resolver.resolve.reset_mock()
        self.resolver.resolve.side_effect = HTTPException(503, "Market unavailable")
        self.assert_private(self.request(), 200)
        self.assert_private(self.request("PUT", "/AAPL"), 200)
        self.assert_private(self.request("DELETE", "/AAPL"), 200)
        self.resolver.resolve.assert_not_awaited()

    def test_full_watchlist_returns_409_but_duplicates_and_delete_still_succeed(self):
        for index in range(LIMIT):
            symbol = f"S{index}"
            self.store.change(USER, symbol, item(symbol))
        self.assert_private(self.request("PUT", "/MSFT"), 409)
        self.assert_private(self.request("PUT", "/S0"), 200)
        self.assert_private(self.request("DELETE", "/S0"), 200)
        self.assert_private(self.request("PUT", "/MSFT"), 200)
        self.resolver.resolve.assert_awaited_once_with("MSFT")

    def test_all_private_validation_and_method_errors_have_no_store(self):
        for method, path, status in (
            ("PUT", "/bad!", 400),
            ("DELETE", "/A" * 33, 404),
            ("PUT", "/" + "A" * 33, 422),
            ("DELETE", "/" + "A" * 33, 422),
            ("POST", "", 405),
        ):
            with self.subTest(method=method, path=path):
                self.assert_private(self.request(method, path), status)
        self.resolver.resolve.assert_not_awaited()
        self.assertEqual(self.store.get(USER), [])

    def test_cors_allows_only_configured_origin_and_watchlist_methods_with_bearer(self):
        for method in ("GET", "PUT", "DELETE"):
            response = self.client.options(
                "/api/v1/watchlist/AAPL",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": method,
                    "Access-Control-Request-Headers": "Authorization",
                },
            )
            self.assert_private(response, 200)
            self.assertEqual(
                response.headers.get("access-control-allow-origin"), "http://localhost:3000"
            )
            self.assertNotIn("access-control-allow-credentials", response.headers)
        rejected = self.client.options(
            "/api/v1/watchlist/AAPL",
            headers={"Origin": "https://attacker.example", "Access-Control-Request-Method": "PUT"},
        )
        self.assert_private(rejected, 400)
        self.assertNotIn("access-control-allow-origin", rejected.headers)

    def test_missing_storage_configuration_is_no_store_503_and_health_remains_available(self):
        app.dependency_overrides.pop(get_watchlist_store)
        configured_store.cache_clear()
        self.addCleanup(configured_store.cache_clear)
        with patch.dict(os.environ, {"MARKET_CACHE_BACKEND": "invalid"}):
            self.assert_private(self.request(), 503)
        self.assertEqual(self.client.get("/health").status_code, 200)
        self.assertEqual(self.client.get("/api/stocks/search?q=AAPL").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/preferences").status_code, 404)


if __name__ == "__main__":
    unittest.main()
