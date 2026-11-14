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
The service reads one `FX_RATES_DAILY` observation row, not independently selected dates per currency.
These indicative daily averages are **not real-time or executable prices**. Consumers must label
Bank of Canada, show the observation date, link to the original source, and identify inversions/cross
rates as calculated. Follow the [source terms](https://www.bankofcanada.ca/terms/), including the
free-source notice where required; do not use Bank branding to imply endorsement. The API needs
no subscription, account or access key. This implementation makes no blanket license warranty.

FND-013's stock-quote batch producer is a separate remaining MKT-001 delivery. This FX change does
not expose new Yahoo quote or Canadian-security lookup endpoints or change existing chart APIs.
Yahoo/yfinance usage remains subject to its provider terms; adding code does not establish a
public redistribution license. No live upstream acceptance or production price probe was run.

## Verification

Offline tests exercise real HTTP/CORS and shared admission, contract arithmetic, snapshot timing,
missing/stale data, same-date routing, source-specific cooldowns in SQLite and Firestore seams,
malformed/oversized bodies, and the actual child process deadline and reap. Production source
coverage, timing and browser UX remain in the later explicitly authorized acceptance window.
