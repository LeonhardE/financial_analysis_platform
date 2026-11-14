# Bounded daily reference FX batches

Date: 2026-11-13

## Summary

Market can produce latest available Bank of Canada reference FX in bounded public batches,
including inverse and same-date CAD cross rates. Existing chart contracts are unchanged.

## Changes

- Add a closed 4KiB/20-pair POST API and cache-only first paint using FND-013 contracts.
- Reuse existing shared cache, logical refresh limits and charged storage operations; separate
  provider availability cooldowns while preserving the same total budget.
- Preserve actual observation/collection dates and explicit missing/stale states. Same-currency
  requests use no storage/provider; provider work has a whole-process deadline and reap.
- Document daily indicative timing, required attribution and remaining stock-quote delivery.
  No resource, capacity, dependency, paid subscription or credential change.

## Validation

- Offline Market HTTP, parser, arithmetic, cache, provider isolation and deadline tests.
- Root `npm run check` before commit.
- No live upstream or online business/performance acceptance.
