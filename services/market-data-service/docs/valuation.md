# Valuation data producers

## Daily reference FX

`POST /api/valuation/fx` accepts only the public FND-013 `FxRequest` shape:

```json
{
  "pairs": [
    { "base": "USD", "quote": "CAD" },
    { "base": "USD", "quote": "CNY" }
  ]
}
```

The input is bounded to 4KiB, 20 pairs and the contract currency set. Duplicate pairs are
collapsed in first-occurrence order. Unknown fields, duplicate JSON members, empty lists,
malformed/deep JSON and non-JSON media are rejected with fixed diagnostics before constructing
Market storage. Quantities, costs, accounts, credentials and arbitrary provider URLs are never
accepted. POST is added to the existing CORS method list; origins are unchanged. These public
queries still reveal the requested currency pairs to Market. Responses, including errors, are
`Cache-Control: no-store`; server-side shared snapshots remain cached independently.

The result is a validated `folioview.fx-batch.v1` batch. Every pair says **one base unit equals
rate quote units**. Direct CAD legs, inverse rates and CAD cross rates use decimal strings and
the same observation date. Same-currency requests return exactly `1` without storage/provider
work. Missing legs remain `missing` with `rate: null`; they never borrow a different day's rate
or become zero. An unrepresentable cross rate is explicitly missing. Batch identity represents
the returned public data, never an authorization or proof of execution.

`sourceDate` is the Bank's actual observation day. `sourceAsOf` stays `null`: a publication
schedule is not an observed trade timestamp. `fetchedAt` preserves when the snapshot was obtained,
including during stale fallback. Data more than seven calendar days old is not used. Weekend
publication scheduling follows the next weekday at 16:35 Toronto time; holidays or late updates
can remain visibly stale and retry after an hour rather than claiming a fresh observation.

`?cached=true` performs a cache-only first-paint read: no lease, write, wait or upstream request.
A consumer may subsequently request one bounded refresh. There is no periodic poll, scheduled
prefetch or keep-warm. The process single-flight lock returns existing data/missing immediately
when busy; the existing distributed lease handles other instances. A fixed-host, standard-library
provider child has a five-second whole-process deadline, is killed/reaped on timeout, and accepts
at most64KiB. It is transient work inside Market, not a new service or deployed worker.

The existing daily/minute logical upstream budget is shared with Yahoo. Availability cooldowns
are provider-specific so an FX outage does not disable stock quotes or vice versa. Every cache
SDK operation still passes the existing storage admission; exhausted admission never causes more
provider/cleanup work. A lease can safely expire when cleanup admission is denied. No new cache
backend, Firebase identity SDK, dependency, resource, capacity setting or paid subscription is added.

## Source and reuse boundaries

Rates derive from the [Bank of Canada daily reference rates](https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/)
through its [Valet API](https://www.bankofcanada.ca/valet-api-how-to/) and
[documented observation format](https://www.bankofcanada.ca/valet/static/swagger/api-en.yml).
The service requests the eleven supported non-CAD Valet series together and reads one common
observation date. It excludes the broad `FX_RATES_DAILY` group, whose latest-per-series response
also contains historical dates for retired currencies. It never combines independently selected
dates per currency.
These indicative daily averages are **not real-time or executable prices**. Consumers must label
Bank of Canada, show the observation date, link to the original source, and identify inversions/cross
rates as calculated. Follow the [source terms](https://www.bankofcanada.ca/terms/), including the
free-source notice where required; do not use Bank branding to imply endorsement. The API needs
no subscription, account or access key. This implementation makes no blanket license warranty.

FND-013's stock-quote batch producer is documented below as a separate MKT-001 phase.
Daily FX does not change existing chart APIs. Canonical instrument search is a separate
additive capability described below.
Yahoo/yfinance usage remains subject to its provider terms; adding code does not establish a
public redistribution license. No live upstream acceptance or production price probe was run.

## Verification

Offline tests exercise real HTTP/CORS and shared admission, contract arithmetic, snapshot timing,
missing/stale data, same-date routing, source-specific cooldowns in SQLite and Firestore seams,
malformed/oversized bodies, and the actual child process deadline and reap. Production source
coverage, timing and browser UX remain in the later explicitly authorized acceptance window.

## Native stock quote batches

`POST /api/valuation/quotes` accepts only `QuoteRequest`: `instruments` is a list of1–50
`{symbol, market, currency}` objects. The JSON body is bounded to8KiB. `symbol` is native to
its stated exchange, `market` is an explicit MIC and `currency` is the expected native currency.
For example, `{symbol:"SHOP",market:"XTSE",currency:"CAD"}` maps to Yahoo `SHOP.TO`.
A caller cannot choose a provider URL or submit portfolio quantities, accounts or costs. Duplicate
identities are collapsed in first-occurrence order. Currency is checked against the provider;
it is never inferred from the country or converted by this API.

The narrow adapter supports XNYS, XNAS, ARCX and XASE plus XTSE, XTSX, CNSX and NEOE. Canadian
suffixes follow the pinned yfinance1.7.0 MIC table; exchange codes follow its exchange groups.
Native class punctuation maps to the vendor dash form. Vendor-suffixed symbols are not silently
accepted as native Canadian identities. Actual provider symbol, exchange, EQUITY/ETF type and
currency must match. Unknown markets, unsupported identifiers, mismatches or missing actual
observation time remain unavailable. Adapter mappings and fixtures do not prove live coverage.

Prices come from unadjusted regular-market metadata after an explicitly unadjusted five-day
history request. They never reuse split/dividend-adjusted chart Close. Both observation and
collection times are retained. Date is derived only when the returned timezone is usable; no
market-close time is invented. Values more than seven days old are unusable; observations more
than24 hours old or an expired900-second cache are marked stale. A later fetch cannot overwrite
a known newer observation with an older one. Negative results can be cached for300 seconds.
These snapshots remain latest available provider data, without a real-time/executable-price claim.

Cache-only first paint uses `?cached=true`, performs one bounded cache batch read, and never
claims leases, writes or calls Yahoo. Firestore's `get_all` stream has the existing four-second
SDK timeout; every missing process-copy document is charged before the call. Positive/negative
LRU copies are free, duplicate keys are read once, and failed/incomplete streams publish no
negative cache entries. SQLite uses one parameterized bounded `IN` read. Existing single-key
chart reads remain unchanged.

One refresh request handles at most four misses, charges two logical upstream units for each
admitted identity, and uses existing per-key distributed leases and the same daily/minute budget.
It shares the existing metrics-provider process lock, starts at most two lookups in a child, and
kills/reaps the child after at most seven seconds, retaining only complete validated metadata lines.
Other symbols remain explicitly missing/stale. A ten-second soft work budget prevents starting
more work after it expires; existing bounded SDK calls/transactions already in flight can finish
later. This is not a hard end-to-end latency guarantee. No background queue, per-row browser
request, perpetual retry, prefetch or new worker/service is created.

Consumers should reuse a loaded batch and may request one bounded refresh after cache-only
first paint. Incomplete results must remain partial; they do not justify continuous polling.
Storage admission failures propagate as429 before more paid work. Provider failures retain prior
usable data and only one provider cooldown is written; unavailable cleanup can leave leases to
expire. A failed cache write does not invalidate an already verified public quote, but stops
further storage writes in that request. Existing anonymous/source usage and the provider's
personal/research restrictions still apply; this is not a public redistribution license.

The remaining MKT-001 stock-quote producer mentioned earlier is delivered by this phase; native
coverage and real timing are still unverified until the separate online acceptance window.

## Canonical instrument search for holdings entry

`POST /api/valuation/instruments/search` accepts only `{"query":"SHOP"}` (1KiB body,
1–50 query characters). The independent endpoint leaves `/api/stocks/search` and its US
browsing contract unchanged. It receives no accounts, quantities, costs or credentials.
Responses have the closed `folioview.instrument-search.v1` shape: `profile`, `items`,
`complete`, `fetchedAt`, `status` and `reason`. Each item contains native `symbol`, explicit
MIC `market`, provider `currency`, `name` and `assetType` (stock/etf).

Only the same eight US/Canadian markets supported by native quote batches are admitted.
The returned provider exchange and symbol must agree with that mapping; a suffix alone
is insufficient. An explicit search currency is reused. When omitted, bounded metadata
lookups verify the same symbol/exchange and provide the currency; country never implies it.
Class punctuation is normalized through the quote adapter. Cross-market candidates are
retained instead of silently choosing a US listing. Consumers may auto-select only one
candidate in an **available, complete** result; otherwise present the returned candidates for selection.

`?cached=true` performs one cache read without a provider request, lease, wait or write.
Fresh identities are reused for one day, empty/partial results for five minutes; usable
stale fallback is limited to seven days and preserves its original collection time.
`status:missing, complete:false` means unavailable, not a successful empty search. A complete
empty result is `status:available, complete:true`. Reasons are fixed public codes, without
raw provider diagnostics. Search results identify securities; they are not current prices.

An explicit refresh uses the existing shared provider lock without waiting and the existing
distributed lease/daily/minute budget. It reserves nine logical units before work: one search
plus at most four two-request metadata fallbacks. At most four supported candidates are
examined, with two fallback workers and a six-second whole-child deadline. The child is
killed/reaped on timeout; only completed valid lines remain usable and `complete` stays false.
This is bounded refresh work, **not** a sub-500ms production latency guarantee. A later
performance acceptance window must measure cached, cold and upstream-dependent paths separately.

Responses/errors use `no-store`; server-side snapshots use the existing cache independently.
No background poll, new resource, capacity, limit increase, identity SDK or paid feed is added.
Existing Yahoo source/personal-use restrictions apply. Tests use a synthetic provider module
and local cache/HTTP boundaries; no live source coverage or production performance was tested.
