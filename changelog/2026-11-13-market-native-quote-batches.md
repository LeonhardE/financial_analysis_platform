# Native quote batches and bounded cache reads

Date: 2026-11-13

## Summary

Market produces bounded native-currency stock quote batches without serial per-symbol cache
reads. Missing data stays explicit and existing chart contracts keep their original behavior.

## Changes

- Add a closed public8KiB/50-instrument batch endpoint using explicit MIC/native currency,
  actual provider identity/time checks, decimal strings and cache-only first paint.
- Add charged bounded Firestore batch reads and parameterized SQLite reads, reusing positive
  and negative process copies without changing existing single-key paths.
- Refresh at most four misses through existing shared leases, provider lock and total budget;
  use a two-lookup child with a whole-process deadline and complete partial result recovery.
- Preserve stale/missing states and newer observations, stop new work after a soft budget,
  and keep actual source times. No paid source, cloud resource, capacity or dependency added.

## Validation

- Offline real HTTP/CORS, cache admission/batch stream, canonical identity/currency/time,
  missing/stale recovery, subprocess argument and deadline/reap coverage.
- Root `npm run check` before commit.
- No live provider/production business acceptance or live latency measurement.
