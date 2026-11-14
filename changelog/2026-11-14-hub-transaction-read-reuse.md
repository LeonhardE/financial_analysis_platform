# Reuse Hub reads inside each transaction attempt

Date: 2026-11-14

## Summary

Repeated connection, execution and result checks read the same records multiple
times in one transaction. Hub now reuses that attempt's verified storage snapshot,
reducing repeated Firestore round trips while retaining all authorization checks.

## Changes

- Bound detached full/projection read reuse to128 entries/8MiB; validate complete
  batches before admission and fetch only uncached paths.
- Keep pending-write snapshot semantics and recreate caches on every retry/request.
- Reuse at most eight identical immutable public signature histories per attempt;
  continue independent row, time, current source and lifecycle checks.

## Validation

- Eight new real Firestore SDK/synthetic RPC regressions cover isolation,
  projections, bounded memory, failed streams, conflict revocation and actual
  provider-state behavior;17 focused tests passed including existing store/batch tests.
- Normal root `npm run check` before commit and exact-head CI before merge.
- No online timing claim, business validation, resources or capacity change.
