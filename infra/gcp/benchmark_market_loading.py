"""Measure local cached-first loading without network calls or cloud credentials.

Run with services/market-data-service/.venv/bin/python from any directory.
Results use temporary SQLite storage and synthetic provider responses, not live
prices. They demonstrate removal of refresh work from first paint; they do not
measure browser rendering, Firestore latency, or Cloud Run cold starts.
"""

import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

SERVICE_DIRECTORY = Path(__file__).resolve().parents[2] / "services" / "market-data-service"
COMMON_DIRECTORY = SERVICE_DIRECTORY.parent / "common"
SEED_TIME = datetime(2026, 10, 20, 15, 0, tzinfo=UTC).timestamp()


def import_samples(samples):
    """Compare current startup with an explicitly simulated eager-Yahoo baseline."""
    timings = {"current_app": [], "eager_yfinance_baseline": []}
    loaded = {}
    for index in range(samples):
        modes = list(timings) if index % 2 == 0 else list(reversed(timings))
        for mode in modes:
            code = (
                "import socket\n"
                "def no_network(*args, **kwargs):\n"
                "    raise RuntimeError('Network disabled by the local benchmark')\n"
                "socket.socket.connect = no_network\n"
                "socket.create_connection = no_network\n"
            )
            if mode == "eager_yfinance_baseline":
                code += "import yfinance\n"
            code += (
                "import app.main, json, sys\n"
                "print(json.dumps([name for name in ('yfinance', 'pandas', 'numpy') "
                "if name in sys.modules]))\n"
            )
            started = time.perf_counter()
            result = subprocess.run(
                [sys.executable, "-c", code],
                cwd=SERVICE_DIRECTORY,
                env={**os.environ, "PYTHONPATH": str(COMMON_DIRECTORY)},
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            timings[mode].append(round((time.perf_counter() - started) * 1000, 3))
            loaded[mode] = json.loads(result.stdout)
    return {
        mode: {
            "milliseconds": values,
            "medianMilliseconds": round(statistics.median(values), 3),
            "dataLibrariesLoaded": loaded[mode],
        }
        for mode, values in timings.items()
    }


class SyntheticDelayedProvider:
    """Only this provider is used; it never imports or calls Yahoo's client."""

    def __init__(self):
        self.delay_seconds = 0
        self.calls = 0

    def history(self, instruments, now, chart_range="1m"):
        self.calls += 1
        time.sleep(self.delay_seconds)
        return {
            instrument.symbol: {
                **instrument.public(),
                "range": chart_range,
                "interval": "1d",
                "source": "yfinance",
                "isMock": False,
                "candles": [
                    {"time": "2026-10-19", "open": 100, "high": 102, "low": 99, "close": 101},
                    {"time": "2026-10-20", "open": 101, "high": 103, "low": 100, "close": 102},
                ],
                "latestClose": 102,
                "changePercent": 0.99,
                "dataDate": "2026-10-20",
                "fetchedAt": datetime.fromtimestamp(now, UTC).isoformat(),
                "isStale": False,
                "isPartial": True,
                "adjustment": "split_and_dividend_adjusted",
                "warning": None,
            }
            for instrument in instruments
        }


def loading_samples(delay_seconds):
    # Import the service and its shared package without requiring an installed
    # wheel, and without creating an ADC-backed store.
    sys.path[:0] = [str(SERVICE_DIRECTORY), str(COMMON_DIRECTORY)]
    from app.market_cache import SQLiteMarketCache
    from app.market_data import MarketService

    with tempfile.TemporaryDirectory(prefix="folio-loading-benchmark-") as directory:
        cache = SQLiteMarketCache(str(Path(directory) / "synthetic-market.sqlite3"))
        # Only this temporary store is affected, independently of deployment env.
        cache.daily_limit = 1000
        provider = SyntheticDelayedProvider()
        now = [SEED_TIME]
        service = MarketService(cache, provider, clock=lambda: now[0])
        original = service.overview()
        now[0] += service.fresh_seconds + 1
        provider.delay_seconds = delay_seconds

        calls_before = provider.calls
        started = time.perf_counter()
        overview = service.overview(cached_only=True)
        overview_ms = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        chart = service.candles("AAPL", cached_only=True)
        chart_ms = (time.perf_counter() - started) * 1000
        cached_upstream_calls = provider.calls - calls_before

        if not overview or not chart:
            raise RuntimeError("Seeded snapshots were unexpectedly unavailable")
        prices_preserved = all(
            current["latestClose"] == previous["latestClose"]
            and current["fetchedAt"] == previous["fetchedAt"]
            and current["dataDate"] == previous["dataDate"]
            for current, previous in zip(overview["stocks"], original["stocks"], strict=True)
        )
        if not (
            prices_preserved
            and cached_upstream_calls == 0
            and overview["refreshRequired"]
            and chart["refreshRequired"]
            and chart["isStale"]
        ):
            raise RuntimeError("Cached-first contract did not preserve a read-only stale snapshot")

        started = time.perf_counter()
        service.overview()
        blocking_ms = (time.perf_counter() - started) * 1000
        return {
            "simulatedUpstreamDelayMilliseconds": delay_seconds * 1000,
            "cachedOverviewMilliseconds": round(overview_ms, 3),
            "cachedChartMilliseconds": round(chart_ms, 3),
            "blockingRefreshMilliseconds": round(blocking_ms, 3),
            "cachedReadsUpstreamCalls": cached_upstream_calls,
            "blockingRefreshUpstreamCalls": provider.calls - calls_before,
            "pricesAndOriginalTimestampsPreserved": prices_preserved,
            "staleSnapshotRequestsRefresh": overview["refreshRequired"]
            and chart["refreshRequired"],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=3, help="Fresh processes per startup mode")
    parser.add_argument("--delay-seconds", type=float, default=2.0, help="Synthetic refresh delay")
    args = parser.parse_args()
    if not 1 <= args.samples <= 10 or not 0 <= args.delay_seconds <= 10:
        parser.error("Use 1–10 samples and a simulated delay between 0 and 10 seconds")
    result = {
        "scope": "Local processes, temporary SQLite, synthetic provider; not a cloud benchmark",
        "startupBaseline": "Simulates the former eager import with import yfinance before app.main",
        "startup": import_samples(args.samples),
        "marketLoading": loading_samples(args.delay_seconds),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
