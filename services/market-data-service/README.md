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
