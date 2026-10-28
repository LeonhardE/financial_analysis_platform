# Market snapshots and chart quotes

The public Market API serves cached Yahoo data through yfinance. A chart's bars
and its displayed daily quote have separate identities:

- `GET /api/stocks` retains its existing daily `StockSummary` rows.
- `GET /api/stocks/{symbol}/candles?range=...` retains every existing range field,
  including `candles`, `latestClose` and `changePercent`. Those legacy values
  describe the requested chart interval and may differ from another interval.
- Candle responses now also include `quote`, a daily summary from the existing
  `candles:<symbol>` 1M daily cache. Clients can use it consistently for a headline,
  market row, watchlist row or a separately labelled chart price line. They must
  preserve the chart's real OHLC rather than rewriting bars to match the quote.

`quote` contains the existing `StockSummary` fields (`symbol`, `name`,
`instrumentType`, `currency`, `latestClose`, `changePercent`, `dataDate`,
`fetchedAt`, `isStale`) plus:

| Field           | Meaning                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `basis`         | `daily_snapshot`; independent of the selected chart range                      |
| `interval`      | `1d`                                                                           |
| `adjustment`    | `split_and_dividend_adjusted` for Yahoo data, or `mock` for explicit demo data |
| `previousClose` | The actual prior daily bar's close, or `null` when that bar is unavailable     |

`dataDate` is the trading-session date. `fetchedAt` is the original snapshot
collection time, not an exchange event timestamp or a live-price guarantee.
Quote staleness belongs to the daily cache entry; it does not inherit the chart
range's freshness. A prior close is never reconstructed from a rounded percentage.

For 1M, the quote reuses the response's own daily payload without another read.
Other chart ranges only read the existing canonical daily cache. If it is absent,
older than the existing seven-day usable limit, or unavailable, `quote` is `null`
and the chart remains usable. A client needing that missing quote may separately
use the existing 1M endpoint and its normal cached-first, budgeted refresh flow.
Older API versions can omit `quote`; clients should remain compatible with that.

The response decorator never saves nested quotes back into the chart caches and
never calls Yahoo, reserves a refresh or changes the cache TTL, daily upstream
budget or cooldown rules. Mock responses derive their quote from the 1M fixture
and remain explicitly marked as fictional by the enclosing response.

## Anonymous request and storage cost controls

Registered `/api/` market handlers use constant-memory, process-wide admission
before resolving dependencies or performing storage/upstream work. It does not
trust `X-Forwarded-For`/`X-Real-IP`, allocate per-client maps or create cloud
resources. A second control charges every attempted Firestore document read and
queued write immediately before the SDK operation. Request counts alone would
not cover an overview request reading/writing multiple documents.

| Environment setting                    | Default | Versioned maximum |
| -------------------------------------- | ------: | ----------------: |
| `MARKET_REQUESTS_PER_MINUTE`           |     600 |              1200 |
| `MARKET_STORAGE_OPERATIONS_PER_MINUTE` |     180 |               600 |
| `MARKET_MAX_INFLIGHT_REQUESTS`         |       8 |                16 |

All settings must be integers from 1 through their maximum; zero, malformed and
out-of-range settings fail closed for API requests with fixed `503` diagnostics.
The service does not load env files automatically. `/health` is independent of
these controls and storage configuration. CORS preflight, docs and unmatched
routes do no Market handler/storage work and are not admitted as market API
operations.

The two per-minute settings are **token-bucket refill rates and initial burst
capacities**, not hard counts for every rolling minute. A bucket of capacity
`C` starts full and refills at `C / 60` tokens per second, up to `C`. For a
continuously running process it admits at most `C + C * elapsed_seconds / 60`
units over an interval starting full. Lowering limits can intentionally prevent
expensive refreshes from completing; it cannot disable protection. The inflight
limit rejects excess work rather than waiting in an application queue.

Admission exhaustion returns `429` with a fixed public-safe message,
`Retry-After` (1–60 seconds) and `Cache-Control: no-store`. Existing CORS policy is
preserved, with `Retry-After` exposed to permitted browser origins. The request
slot is released when a handler fails or completes. Invalid configuration
returns fixed `503`/no-store without echoing values.

## What storage accounting covers

- Process-local positive and negative cache hits do not consume Firestore units.
  Expiry, refresh invalidation and LRU eviction cause a charged SDK read.
- Each document read in `get`, `claim` and `put` consumes one unit. Reads and
  writes are charged on **each** transaction callback attempt, including SDK
  conflict retries. Lifecycle RPCs still use the existing bounded retry policy.
- A complete staged transaction/batch write group reserves its document units
  before any `set`. A failed reservation stages no writes from that group;
  transaction failure rolls back staged changes. Successful transactions alone
  update the process read cache. `fail` reserves both cooldown writes before its
  single atomic batch commit, without sending a partial cleanup batch.
- Rejections use a separate domain exception, so cache-unavailable/stale fallback
  cannot swallow them and continue paid storage or Yahoo work. Optional daily
  quote enrichment can return an already usable chart with `quote: null` when
  its extra read is denied, without another SDK call or refresh. An already issued
  refresh lease may simply expire; protection does not pay for cleanup writes
  after its budget is exhausted.

This is conservative **document-operation admission**, not an exact bill or
measurement of index entries, bandwidth, transaction lifecycle RPCs or billed
reads after a network failure. Aborted staged writes may consume local units
without being billed. The existing Firestore-backed Yahoo daily/minute refresh
budget remains independently shared across instances.

These controls are per Python worker process. Multiple workers/instances each
have their own capacity and refill; cold starts/restarts grant new initial
bursts. Instance limits and these buckets are **not project-wide spending caps,
DDoS protection or a fairness guarantee**. Sustained abuse can make legitimate
requests temporarily receive 429. Deployment capacity, monitoring and any future
edge/global controls require their own reviewed operational work. This change
adds no database, state migration, IAM grant, scheduler or external limiter.

## Validation

Run from the repository root in the existing development environment:

```sh
services/market-data-service/.venv/bin/python scripts/test_services.py --service market-data-service
```

Tests use in-memory Firestore/transaction seams, temporary SQLite, fixed clocks,
synthetic symbols and local ASGI requests. The previous 129 distinct unknown
symbol probe, repeated twice with a fixed 32-unit storage capacity, now performs
32 mock reads, 32 free second-round negative-cache hits and 194 rate rejections,
with zero writes or upstream calls. HTTP metrics coverage verifies that the
actual route cannot bypass the storage limiter. Other cases cover concurrency,
refill, batch requests, transaction retries/rollback, no partial cooldown writes,
normal search-selected non-default symbols, CORS and independent health. No
production traffic or live upstream is used.
