"""Bounded daily/intraday chart ranges, with no live upstream or database calls."""

import tempfile
import unittest
from datetime import UTC, date, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.market_cache import SQLiteMarketCache
from app.market_data import MarketService, get_market_service
from app.yahoo_provider import (
    DEFAULT_BY_SYMBOL,
    DEFAULT_INSTRUMENTS,
    HISTORY_RANGES,
    YahooProvider,
    calendar_start,
    candle_payload,
    valid_candles,
)

NOW = datetime(2026, 10, 20, 15, 0, tzinfo=UTC).timestamp()


def frame_for(dates):
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


def daily_frame():
    return frame_for(pd.bdate_range("2025-09-01", "2026-10-20"))


def intraday_frame():
    return frame_for(
        pd.DatetimeIndex(
            [
                "2026-10-19 15:55",
                "2026-10-20 09:30",
                "2026-10-20 10:50",
                "2026-10-20 10:55",
            ],
            tz="America/New_York",
        )
    )


def range_payload(symbol, chart_range):
    frame = intraday_frame() if chart_range in {"1d", "1w"} else daily_frame()
    return candle_payload(DEFAULT_BY_SYMBOL[symbol], frame, NOW, chart_range)


class ChartRangeProviderTests(unittest.TestCase):
    def test_daily_ranges_crop_calendar_months_and_keep_daily_day_change(self):
        values = {key: range_payload("AAPL", key) for key in ("1m", "3m", "1y")}
        self.assertLess(len(values["1m"]["candles"]), len(values["3m"]["candles"]))
        self.assertLess(len(values["3m"]["candles"]), len(values["1y"]["candles"]))
        self.assertEqual(values["1m"]["candles"][0]["time"], "2026-09-21")
        self.assertEqual(values["3m"]["candles"][0]["time"], "2026-07-20")
        self.assertEqual(values["1y"]["candles"][0]["time"], "2025-10-20")
        self.assertEqual(
            {value["changePercent"] for value in values.values()}, {values["1m"]["changePercent"]}
        )
        self.assertTrue(all(value["interval"] == "1d" for value in values.values()))
        self.assertEqual(calendar_start(date(2024, 2, 29), 12), date(2023, 2, 28))
        self.assertEqual(calendar_start(date(2026, 3, 31), 1), date(2026, 2, 28))

    def test_one_day_is_latest_session_with_utc_time_and_previous_session_change(self):
        result = candle_payload(DEFAULT_BY_SYMBOL["AAPL"], intraday_frame(), NOW, "1d")
        self.assertEqual(result["range"], "1d")
        self.assertEqual(result["interval"], "5m")
        self.assertEqual(result["dataDate"], "2026-10-20")
        self.assertEqual(len(result["candles"]), 3)
        self.assertEqual(
            result["candles"][0]["time"],
            int(datetime(2026, 10, 20, 13, 30, tzinfo=UTC).timestamp()),
        )
        self.assertEqual(result["changePercent"], round((104 / 101 - 1) * 100, 2))
        self.assertFalse(result["isPartial"])
        self.assertTrue(
            candle_payload(DEFAULT_BY_SYMBOL["AAPL"], intraday_frame(), NOW - 120, "1d")[
                "isPartial"
            ]
        )

    def test_week_selects_at_most_five_available_trading_sessions(self):
        dates = pd.bdate_range("2026-10-12", "2026-10-20", tz="America/New_York")
        frame = frame_for(dates + pd.Timedelta(hours=10))
        result = candle_payload(DEFAULT_BY_SYMBOL["AAPL"], frame, NOW, "1w")
        self.assertEqual(result["interval"], "30m")
        self.assertEqual(len(result["candles"]), 5)
        self.assertEqual(result["dataDate"], "2026-10-20")

    def test_intraday_rejects_future_extended_hours_and_naive_times(self):
        frame = intraday_frame()
        invalid = frame_for(
            pd.DatetimeIndex(
                [
                    "2026-10-20 08:00",
                    "2026-10-20 11:05",
                    "2026-10-19 16:00",
                    "2026-10-18 10:00",
                ],
                tz="America/New_York",
            )
        )
        result = valid_candles(pd.concat([invalid, frame.iloc[::-1], frame.tail(1)]), NOW, "5m")
        self.assertEqual(len(result), 4)
        self.assertEqual([row["time"] for row in result], sorted({row["time"] for row in result}))
        self.assertEqual(valid_candles(frame.tz_localize(None), NOW, "5m"), [])

    def test_latest_session_remains_available_on_weekends(self):
        frame = frame_for(
            pd.DatetimeIndex(
                [
                    "2026-10-22 15:55",
                    "2026-10-23 09:30",
                    "2026-10-23 15:55",
                ],
                tz="America/New_York",
            )
        )
        saturday = datetime(2026, 10, 24, 15, 0, tzinfo=UTC).timestamp()
        result = candle_payload(DEFAULT_BY_SYMBOL["AAPL"], frame, saturday, "1d")
        self.assertEqual(result["dataDate"], "2026-10-23")
        self.assertEqual(len(result["candles"]), 2)
        self.assertFalse(result["isPartial"])

    def test_one_session_does_not_invent_a_previous_close(self):
        result = candle_payload(DEFAULT_BY_SYMBOL["AAPL"], intraday_frame().tail(1), NOW, "1d")
        self.assertEqual(len(result["candles"]), 1)
        self.assertIsNone(result["changePercent"])
        self.assertIsNone(
            candle_payload(DEFAULT_BY_SYMBOL["AAPL"], intraday_frame(), NOW + 8 * 86400, "1d")
        )

    def test_provider_uses_only_supported_bounded_periods_and_intervals(self):
        for chart_range, (period, interval) in HISTORY_RANGES.items():
            with self.subTest(chart_range=chart_range):
                frame = intraday_frame() if interval != "1d" else daily_frame()
                with patch(
                    "yfinance.download",
                    return_value=pd.concat({"AAPL": frame}, axis=1),
                ) as download:
                    result = YahooProvider().history([DEFAULT_BY_SYMBOL["AAPL"]], NOW, chart_range)
                self.assertEqual(result["AAPL"]["range"], chart_range)
                self.assertEqual(download.call_args.kwargs["period"], period)
                self.assertEqual(download.call_args.kwargs["interval"], interval)
                self.assertFalse(download.call_args.kwargs["prepost"])
                self.assertEqual(download.call_args.kwargs["ignore_tz"], interval == "1d")
                self.assertEqual(download.call_args.kwargs["timeout"], 6)


class ChartRangeServiceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cache = SQLiteMarketCache(str(Path(directory.name) / "ranges.sqlite3"))
        self.provider = MagicMock()
        self.provider.history.side_effect = lambda items, now, chart_range="1m": {
            item.symbol: range_payload(item.symbol, chart_range) for item in items
        }
        self.service = MarketService(self.cache, self.provider, clock=lambda: NOW)

    def test_ranges_have_independent_payloads_and_share_daily_upstream_budget(self):
        for chart_range in ("1m", "1d", "1w", "3m", "1y"):
            result = self.service.candles("AAPL", chart_range)
            self.assertEqual(result["range"], chart_range)
        self.assertEqual(self.provider.history.call_count, 5)
        for chart_range in HISTORY_RANGES:
            self.assertEqual(self.service.candles("AAPL", chart_range)["range"], chart_range)
        self.assertEqual(self.provider.history.call_count, 5)
        self.assertEqual(self.cache.get("candles:AAPL").value["interval"], "1d")
        self.assertEqual(self.cache.get("candles:AAPL:1d").value["interval"], "5m")
        self.assertEqual(self.cache.get("candles:AAPL:1w").value["interval"], "30m")

    def test_new_range_cannot_bypass_exhausted_shared_budget(self):
        self.cache.daily_limit = len(DEFAULT_INSTRUMENTS)
        self.service.overview()
        with self.assertRaises(HTTPException) as failure:
            self.service.candles("AAPL", "1d")
        self.assertEqual(failure.exception.status_code, 429)
        self.provider.history.assert_called_once()

    def test_unsupported_range_is_rejected_before_cache_or_upstream(self):
        for invalid in ("1M", "2y", "1min", "../../", ""):
            with self.subTest(invalid=invalid), self.assertRaises(HTTPException) as failure:
                self.service.candles("AAPL", invalid)
            self.assertEqual(failure.exception.status_code, 400)
        self.provider.history.assert_not_called()

    def test_existing_default_cache_gains_interval_without_new_download(self):
        value = range_payload("AAPL", "1m")
        del value["interval"]
        self.cache.put("candles:AAPL", value, NOW)
        result = self.service.candles("AAPL")
        self.assertEqual(result["range"], "1m")
        self.assertEqual(result["interval"], "1d")
        self.provider.history.assert_not_called()

    def test_failed_intraday_request_never_falls_back_to_cached_daily_bars(self):
        self.service.overview()
        self.provider.history.return_value = {}
        self.provider.history.side_effect = None
        with self.assertRaises(HTTPException) as failure:
            self.service.candles("AAPL", "1d")
        self.assertEqual(failure.exception.status_code, 503)
        self.assertIsNone(self.cache.get("candles:AAPL:1d"))
        self.assertEqual(self.service.candles("AAPL")["range"], "1m")


class ChartRangeRouteTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_market_service] = lambda: MarketService(None, source="mock")
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_public_range_routes_and_fictional_fixtures_are_explicit(self):
        counts = {}
        for chart_range, (_, interval) in HISTORY_RANGES.items():
            response = self.client.get("/api/stocks/AAPL/candles", params={"range": chart_range})
            self.assertEqual(response.status_code, 200)
            value = response.json()
            self.assertTrue(value["isMock"])
            self.assertIn("Fictional", value["warning"])
            self.assertEqual(value["range"], chart_range)
            self.assertEqual(value["interval"], interval)
            self.assertIsInstance(value["candles"][0]["time"], str if interval == "1d" else int)
            counts[chart_range] = len(value["candles"])
        self.assertEqual(counts["1d"], 78)
        self.assertEqual(counts["1w"], 65)
        self.assertLess(counts["1m"], counts["3m"])
        self.assertLess(counts["3m"], counts["1y"])
        self.assertEqual(self.client.get("/api/stocks/AAPL/candles").json()["range"], "1m")

    def test_invalid_range_is_a_validation_error(self):
        for invalid in ("6m", "1M", "5m"):
            response = self.client.get("/api/stocks/AAPL/candles", params={"range": invalid})
            self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
