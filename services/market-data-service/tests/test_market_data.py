"""Market/provider/cache boundaries; all Yahoo and Firestore RPCs are mocked."""

import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.market_cache import (
    BoundedTransaction,
    CacheUnavailable,
    FirestoreMarketCache,
    SQLiteMarketCache,
    create_cache,
    reserve,
)
from app.market_data import MarketService, get_market_service
from app.yahoo_provider import (
    DEFAULT_BY_SYMBOL,
    DEFAULT_INSTRUMENTS,
    Instrument,
    UpstreamError,
    YahooProvider,
    candle_payload,
    valid_candles,
)

NOW = datetime(2026, 10, 20, 15, 0, tzinfo=UTC).timestamp()  # Tuesday 11:00 New York


def history_frame():
    dates = pd.bdate_range("2026-08-01", "2026-10-20")
    return pd.DataFrame(
        {
            "Open": [100 + index for index in range(len(dates))],
            "High": [102 + index for index in range(len(dates))],
            "Low": [99 + index for index in range(len(dates))],
            "Close": [101 + index for index in range(len(dates))],
            "Volume": [1000] * len(dates),
        },
        index=dates,
    )


def payload(symbol="AAPL", now=NOW):
    return candle_payload(DEFAULT_BY_SYMBOL[symbol], history_frame(), now)


class ProviderTests(unittest.TestCase):
    def test_true_indices_use_exact_yahoo_identifiers(self):
        self.assertEqual(
            [(item.symbol, item.yahoo_symbol) for item in DEFAULT_INSTRUMENTS[:3]],
            [("SPX", "^GSPC"), ("IXIC", "^IXIC"), ("DJI", "^DJI")],
        )

    def test_daily_change_uses_previous_bar_and_calendar_month_crop(self):
        frame = history_frame()
        result = candle_payload(DEFAULT_BY_SYMBOL["AAPL"], frame, NOW)
        self.assertEqual(result["changePercent"], round((158 / 157 - 1) * 100, 2))
        self.assertGreaterEqual(result["candles"][0]["time"], "2026-09-19")
        self.assertEqual(result["dataDate"], "2026-10-20")
        self.assertEqual(result["adjustment"], "split_and_dividend_adjusted")
        self.assertTrue(result["isPartial"])
        after_close = datetime(2026, 10, 20, 20, 30, tzinfo=UTC).timestamp()
        self.assertFalse(candle_payload(DEFAULT_BY_SYMBOL["AAPL"], frame, after_close)["isPartial"])

    def test_bad_nan_infinite_inconsistent_negative_volume_future_rows_dropped(self):
        frame = history_frame().tail(10).astype(float)
        frame.loc[frame.index[0], "Close"] = float("nan")
        frame.loc[frame.index[1], "Open"] = float("inf")
        frame.loc[frame.index[2], "High"] = 1
        frame.loc[frame.index[3], "Low"] = 999
        frame.loc[frame.index[4], "Volume"] = -1
        frame.loc[frame.index[5], "Close"] = 0
        frame.loc[pd.Timestamp("2027-01-01")] = [1, 2, 1, 2, 100]
        result = valid_candles(frame, NOW)
        self.assertEqual(len(result), 4)
        json.dumps(result, allow_nan=False)

    def test_rows_sorted_and_deduplicated_single_or_old_data_refused(self):
        frame = history_frame().tail(3)
        unordered = pd.concat([frame.iloc[::-1], frame.tail(1)])
        result = valid_candles(unordered, NOW)
        self.assertEqual(
            [row["time"] for row in result], ["2026-10-16", "2026-10-19", "2026-10-20"]
        )
        self.assertIsNone(candle_payload(DEFAULT_BY_SYMBOL["AAPL"], frame.head(1), NOW))
        self.assertIsNone(candle_payload(DEFAULT_BY_SYMBOL["AAPL"], frame, NOW + 8 * 86400))

    def test_batch_explicitly_adjusts_all_ohlc_and_uses_bounded_parallel_download(self):
        frame = pd.concat({"AAPL": history_frame(), "^GSPC": history_frame()}, axis=1)
        with patch("app.yahoo_provider.yf.download", return_value=frame) as download:
            result = YahooProvider().history(
                [DEFAULT_BY_SYMBOL["AAPL"], DEFAULT_BY_SYMBOL["SPX"]], NOW
            )
        self.assertEqual(set(result), {"AAPL", "SPX"})
        self.assertEqual(download.call_args.kwargs["tickers"], ["AAPL", "^GSPC"])
        self.assertTrue(download.call_args.kwargs["auto_adjust"])
        self.assertEqual(download.call_args.kwargs["interval"], "1d")
        self.assertEqual(download.call_args.kwargs["timeout"], 6)

    def test_empty_and_partial_downloads_are_not_replaced_by_mock(self):
        with patch("app.yahoo_provider.yf.download", return_value=pd.DataFrame()):
            self.assertEqual(YahooProvider().history([DEFAULT_BY_SYMBOL["AAPL"]], NOW), {})
        partial = pd.concat({"AAPL": history_frame()}, axis=1)
        with patch("app.yahoo_provider.yf.download", return_value=partial):
            result = YahooProvider().history(
                [DEFAULT_BY_SYMBOL["AAPL"], DEFAULT_BY_SYMBOL["SPX"]], NOW
            )
        self.assertEqual(set(result), {"AAPL"})

    def test_search_filters_foreign_markets_etfs_currency_and_unsafe_symbols(self):
        quotes = [
            {"symbol": "NFLX", "longname": "Netflix", "quoteType": "EQUITY", "exchange": "NMS"},
            {"symbol": "BRK-B", "quoteType": "EQUITY", "exchange": "NYQ"},
            {"symbol": "SPY", "quoteType": "ETF", "exchange": "NYSE"},
            {"symbol": "VOD.L", "quoteType": "EQUITY", "exchange": "LSE"},
            {"symbol": "TEST", "quoteType": "EQUITY", "exchange": "NMS", "currency": "CAD"},
            {"symbol": "https://evil", "quoteType": "EQUITY", "exchange": "NYQ"},
        ]
        with patch(
            "app.yahoo_provider.yf.Search", return_value=SimpleNamespace(quotes=quotes)
        ) as search:
            result = YahooProvider().search("Netflix")
        self.assertEqual([item.symbol for item in result], ["NFLX", "BRK-B"])
        self.assertEqual(search.call_args.kwargs["news_count"], 0)
        self.assertEqual(search.call_args.kwargs["lists_count"], 0)
        self.assertEqual(search.call_args.kwargs["recommended"], 0)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / "cache.sqlite3")
        self.env = patch.dict(os.environ, {"MARKET_UPSTREAM_DAILY_LIMIT": "10"}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_budget_and_singleflight_apply_across_cache_instances_and_threads(self):
        first = SQLiteMarketCache(self.path)
        second = SQLiteMarketCache(self.path)
        self.assertIsNone(first.claim("overview", NOW, 10))
        self.assertIsNotNone(second.claim("overview", NOW, 10))
        self.assertIn("daily", second.claim("other", NOW))
        # New UTC day resets the shared daily budget; 20 parallel callers cannot
        # exceed ten reservations even when they use separate cache instances.
        tomorrow = NOW + 86400
        with ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(
                pool.map(
                    lambda index: SQLiteMarketCache(self.path).claim(str(index), tomorrow),
                    range(20),
                )
            )
        self.assertEqual(outcomes.count(None), 10)

    def test_persistence_negative_cache_global_cooldown_and_expired_lease(self):
        first = SQLiteMarketCache(self.path)
        first.put("prices", {"real": 123.4}, NOW)
        second = SQLiteMarketCache(self.path)
        self.assertEqual(second.get("prices").value, {"real": 123.4})
        self.assertIsNone(first.claim("failed", NOW))
        self.assertIsNotNone(second.claim("failed", NOW + 44))
        self.assertIsNone(second.claim("failed", NOW + 46))
        second.fail("failed", NOW + 46, rate_limited=True)
        self.assertIsNotNone(first.claim("anything", NOW + 100))
        self.assertIsNone(first.claim("anything", NOW + 947))

    def test_explicit_refresh_time_overrides_hourly_ttl_and_older_writes_are_ignored(self):
        cache = SQLiteMarketCache(self.path)
        cache.put("prices", {"price": 110, "_refreshAfter": NOW + 60}, NOW)
        self.assertIsNone(cache.claim("prices", NOW + 61))
        cache.put("prices", {"price": 120}, NOW + 20)
        cache.put("prices", {"price": 99}, NOW)
        self.assertEqual(cache.get("prices").value["price"], 120)

    def test_rate_window_is_global_and_cache_rejects_nonfinite_json(self):
        state = {}
        self.assertIsNone(reserve(state, NOW, 20, 200))
        self.assertIsNotNone(reserve(state, NOW, 1, 200))
        self.assertIsNone(reserve(state, NOW + 61, 1, 200))
        with self.assertRaises(ValueError):
            SQLiteMarketCache(self.path).put("nan", {"price": float("nan")}, NOW)

    def test_cloud_run_refuses_process_local_cache_and_emulator(self):
        for config in (
            {"K_SERVICE": "market-api", "MARKET_CACHE_BACKEND": "sqlite"},
            {"K_SERVICE": "market-api", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8085"},
            {"K_SERVICE": "market-api", "MARKET_CACHE_BACKEND": "other"},
        ):
            with self.subTest(config=config), patch.dict(os.environ, config, clear=True):
                with self.assertRaises(CacheUnavailable):
                    create_cache()

    def test_firestore_lifecycle_rpcs_have_no_unbounded_retry(self):
        client = MagicMock()
        client._database_string = "projects/test/databases/(default)"
        client._rpc_metadata = ()
        client._firestore_api.begin_transaction.return_value = SimpleNamespace(transaction=b"test")
        client._firestore_api.commit.return_value = SimpleNamespace(
            write_results=[], commit_time=None
        )
        transaction = BoundedTransaction(client, max_attempts=2)
        transaction._begin()
        transaction._commit()
        transaction._begin()
        transaction._rollback()
        for method in ("begin_transaction", "commit", "rollback"):
            for call in getattr(client._firestore_api, method).call_args_list:
                self.assertEqual(call.kwargs["timeout"], 4)
                self.assertIsNone(call.kwargs["retry"])

    def test_firestore_reads_are_briefly_cached_but_writes_use_real_database(self):
        client = MagicMock()
        document = client.collection.return_value.document.return_value
        document.get.return_value.to_dict.return_value = {"value": {"price": 100}, "updated": NOW}
        with patch("app.market_cache.firestore.Client", return_value=client):
            cache = FirestoreMarketCache("test-project")
        self.assertEqual(cache.get("prices").value, {"price": 100})
        self.assertEqual(cache.get("prices").value, {"price": 100})
        document.get.assert_called_once_with(timeout=4, retry=None)
        transaction = MagicMock()
        with (
            patch(
                "app.market_cache.firestore.transactional", side_effect=lambda function: function
            ),
            patch("app.market_cache.BoundedTransaction", return_value=transaction),
        ):
            cache.put("prices", {"price": 101}, NOW)
        transaction.set.assert_called_once_with(
            document, {"value": {"price": 101}, "updated": NOW, "lease": 0, "retry": 0}
        )
        self.assertEqual(cache.get("prices").value, {"price": 101})

    def test_firestore_put_preserves_newer_snapshot(self):
        client = MagicMock()
        document = client.collection.return_value.document.return_value
        document.get.return_value.to_dict.return_value = {
            "value": {"price": 120},
            "updated": NOW + 20,
        }
        with patch("app.market_cache.firestore.Client", return_value=client):
            cache = FirestoreMarketCache("test-project")
        transaction = MagicMock()
        with (
            patch(
                "app.market_cache.firestore.transactional", side_effect=lambda function: function
            ),
            patch("app.market_cache.BoundedTransaction", return_value=transaction),
        ):
            cache.put("prices", {"price": 99}, NOW)
        transaction.set.assert_not_called()
        self.assertEqual(cache.get("prices").value["price"], 120)


class MarketServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.cache = SQLiteMarketCache(str(Path(self.directory.name) / "cache.sqlite3"))
        self.provider = MagicMock()
        self.provider.history.return_value = {
            item.symbol: payload(item.symbol) for item in DEFAULT_INSTRUMENTS
        }
        self.provider.search.return_value = []
        self.now = NOW
        self.service = MarketService(self.cache, self.provider, clock=lambda: self.now)

    def test_overview_batch_primes_detail_and_no_repeated_yahoo_calls(self):
        result = self.service.overview()
        self.assertEqual(len(result["stocks"]), 10)
        self.assertFalse(result["isMock"])
        self.assertIsNone(result["warning"])
        first = self.service.candles("aapl")
        second = self.service.candles("^GSPC")
        self.assertEqual(second["symbol"], "SPX")
        self.assertEqual(first["latestClose"], result["stocks"][3]["latestClose"])
        self.service.overview()
        self.provider.history.assert_called_once()
        self.assertNotIn("_refreshAfter", first)

    def test_failed_batch_keeps_actual_stale_values_and_never_uses_mock(self):
        original = self.service.overview()
        self.now += 4000
        self.provider.history.side_effect = UpstreamError(rate_limited=True)
        result = self.service.overview()
        self.assertEqual(result["stocks"][0]["latestClose"], original["stocks"][0]["latestClose"])
        self.assertTrue(result["stocks"][0]["isStale"])
        self.assertFalse(result["isMock"])
        self.assertIsNotNone(result["warning"])
        self.service.overview()
        self.assertEqual(self.provider.history.call_count, 2)
        self.assertTrue(self.service.candles("AAPL")["isStale"])

    def test_partial_batch_marks_missing_and_negative_caches_it(self):
        self.provider.history.return_value = {"AAPL": payload()}
        result = self.service.overview()
        self.assertIsNone(result["stocks"][0]["latestClose"])
        self.assertIsNotNone(result["stocks"][3]["latestClose"])
        with self.assertRaises(HTTPException) as failure:
            self.service.candles("SPX")
        self.assertEqual(failure.exception.status_code, 503)
        self.provider.history.assert_called_once()

    def test_cold_empty_batch_overview_is_metadata_only_and_details_fail_closed(self):
        self.provider.history.return_value = {}
        result = self.service.overview()
        self.assertTrue(all(item["latestClose"] is None for item in result["stocks"]))
        self.assertFalse(result["isMock"])
        self.assertIsNotNone(result["warning"])
        with self.assertRaises(HTTPException) as failure:
            self.service.candles("AAPL")
        self.assertEqual(failure.exception.status_code, 503)
        self.provider.history.assert_called_once()

    def test_unavailable_shared_cache_never_contacts_yahoo(self):
        self.cache.get = MagicMock(side_effect=CacheUnavailable)
        self.assertTrue(
            all(row["latestClose"] is None for row in self.service.overview()["stocks"])
        )
        with self.assertRaises(HTTPException) as failure:
            self.service.candles("AAPL")
        self.assertEqual(failure.exception.status_code, 503)
        self.provider.history.assert_not_called()

    def test_expired_cache_beyond_seven_days_not_returned(self):
        self.service.overview()
        self.now += 8 * 86400
        self.provider.history.return_value = {}
        result = self.service.overview()
        self.assertTrue(all(item["latestClose"] is None for item in result["stocks"]))

    def test_recent_aggregate_cannot_keep_older_than_seven_day_quotes_alive(self):
        result = self.service.overview()
        self.now += 8 * 86400
        # A newer aggregate can contain an individually older quote after a
        # partial refresh. Its own timestamp must not reset the quote's age.
        self.cache.put("overview:v1", {**result, "_refreshAfter": self.now - 1}, self.now - 10)
        self.provider.history.return_value = {}
        result = self.service.overview()
        self.assertTrue(all(item["latestClose"] is None for item in result["stocks"]))

    def test_default_alias_search_is_free_and_dynamic_search_cached_empty_results_too(self):
        self.assertEqual(self.service.search("标普")["stocks"][0]["symbol"], "SPX")
        self.assertEqual(self.service.search("apple")["stocks"][0]["symbol"], "AAPL")
        self.provider.search.assert_not_called()
        self.assertEqual(self.service.search("unknown stock")["stocks"], [])
        self.service.search("unknown stock")
        self.provider.search.assert_called_once()

    def test_search_result_can_be_opened_but_foreign_or_unknown_symbols_cannot(self):
        self.provider.search.return_value = [Instrument("NFLX", "Netflix", yahoo_symbol="NFLX")]
        self.service.search("Netflix")
        netflix = deepcopy(payload())
        netflix.update(symbol="NFLX", name="Netflix")
        self.provider.history.return_value = {"NFLX": netflix}
        self.assertEqual(self.service.candles("NFLX")["name"], "Netflix")
        self.provider.search.return_value = []
        with self.assertRaises(HTTPException) as failure:
            self.service.candles("UNKNOWN")
        self.assertEqual(failure.exception.status_code, 404)

    def test_valid_ticker_prefix_is_not_shadowed_by_a_default_company(self):
        for symbol, name in (
            ("MS", "Morgan Stanley"),
            ("GOOG", "Alphabet Class C"),
            ("APP", "AppLovin"),
        ):
            with self.subTest(symbol=symbol):
                self.provider.search.return_value = [Instrument(symbol, name, yahoo_symbol=symbol)]
                result = self.service.search(symbol)
                self.assertEqual(result["stocks"][0]["symbol"], symbol)
        self.assertEqual(self.provider.search.call_count, 3)

    def test_preopen_snapshot_refreshes_at_next_session_not_one_hour_later(self):
        self.now = datetime(2026, 10, 20, 13, 20, tzinfo=UTC).timestamp()
        self.service.overview()
        self.now = datetime(2026, 10, 20, 13, 36, tzinfo=UTC).timestamp()
        self.service.overview()
        self.assertEqual(self.provider.history.call_count, 2)

    def test_partial_offhours_batch_retries_only_missing_symbol_after_cooldown(self):
        self.now = datetime(2026, 10, 23, 21, 0, tzinfo=UTC).timestamp()
        values = {item.symbol: payload(item.symbol, now=self.now) for item in DEFAULT_INSTRUMENTS}
        for value in values.values():
            value["dataDate"] = "2026-10-23"
        missing = values.pop("TSLA")
        self.provider.history.return_value = values
        self.service.overview()
        self.now += 301
        self.provider.history.return_value = {"TSLA": missing}
        result = self.service.overview()
        self.assertEqual(
            [item.symbol for item in self.provider.history.call_args.args[0]], ["TSLA"]
        )
        self.assertIsNone(result["warning"])

    def test_concurrent_overview_and_default_chart_share_one_download_batch(self):
        started = Event()
        release = Event()
        original = self.provider.history.return_value

        def blocked_history(instruments, now):
            started.set()
            release.wait(timeout=2)
            return original

        self.provider.history.side_effect = blocked_history
        second_cache = SQLiteMarketCache(self.cache.path)
        second = MarketService(second_cache, self.provider, clock=lambda: self.now)
        with ThreadPoolExecutor(max_workers=2) as pool:
            overview = pool.submit(self.service.overview)
            self.assertTrue(started.wait(timeout=1))
            try:
                with self.assertRaises(HTTPException) as pending:
                    second.candles("AAPL")
                self.assertEqual(pending.exception.status_code, 503)
                self.assertEqual(pending.exception.headers["Retry-After"], "5")
            finally:
                release.set()
            overview.result(timeout=2)
            chart = second.candles("AAPL")
        self.assertEqual(chart["symbol"], "AAPL")
        self.provider.history.assert_called_once()

    def test_query_and_symbol_validation_never_reach_upstream(self):
        for query in ("https://bad.example", "", "x" * 51, "abc?symbol=AAPL"):
            with self.subTest(query=query), self.assertRaises(HTTPException):
                self.service.search(query)
        for symbol in ("^RUT", "https://bad", "AAPL?x=1", "../../secret", ""):
            with self.subTest(symbol=symbol), self.assertRaises(HTTPException):
                self.service.candles(symbol)
        self.provider.history.assert_not_called()
        self.provider.search.assert_not_called()

    def test_closed_session_cache_remains_fresh_overnight_and_weekend(self):
        friday_close = datetime(2026, 10, 23, 21, 0, tzinfo=UTC).timestamp()
        next_refresh = self.service.refresh_after(friday_close, "2026-10-23")
        self.assertEqual(
            datetime.fromtimestamp(next_refresh, UTC), datetime(2026, 10, 26, 13, 35, tzinfo=UTC)
        )
        after_close = datetime(2026, 10, 20, 21, 0, tzinfo=UTC).timestamp()
        value = payload(now=after_close)
        value["_refreshAfter"] = self.service.refresh_after(after_close, value["dataDate"])
        self.cache.put("candles:AAPL", value, after_close)
        self.now = after_close + 6 * 3600
        result = self.service.candles("AAPL")
        self.assertFalse(result["isStale"])
        self.provider.history.assert_not_called()

    def test_cached_partial_bar_never_turns_final_without_a_refresh(self):
        self.service.overview()
        self.now = datetime(2026, 10, 20, 21, 0, tzinfo=UTC).timestamp()
        self.provider.history.side_effect = UpstreamError()
        self.assertTrue(self.service.candles("AAPL")["isPartial"])


class MarketRouteTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_market_service] = lambda: MarketService(None, source="mock")
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_overview_search_and_details_stay_anonymous(self):
        for route in ("/api/stocks", "/api/stocks/search?q=AAPL", "/api/stocks/SPX/candles"):
            with self.subTest(route=route):
                response = self.client.get(route)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["isMock"])
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)

    def test_long_queries_rejected_and_symbols_case_normalized(self):
        self.assertEqual(
            self.client.get("/api/stocks/search", params={"q": "a" * 51}).status_code, 422
        )
        response = self.client.get("/api/stocks/aapl/candles")
        self.assertEqual(response.json()["symbol"], "AAPL")
        self.assertEqual(self.client.get("/api/stocks/notfound/candles").status_code, 404)


if __name__ == "__main__":
    unittest.main()
