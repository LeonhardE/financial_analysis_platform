# Bound anonymous Market request and storage work

Date: 2026-10-27

## Summary

Anonymous cache probes now encounter explicit process-local request, concurrency
and Firestore document-operation admission instead of bypassing Yahoo refresh
budgets with high-cardinality cache reads.

## Changes

- Add fixed-memory, thread-safe token buckets and inflight admission for public
  Market handlers, with bounded environment tuning and independent health.
- Charge actual Firestore cache misses and every transaction-attempt document
  read/queued write. Reserve write groups before staging; do not fill local cache
  or perform paid cleanup after rejection.
- Return fixed 429/Retry-After/no-store responses with existing CORS behavior.
  Keep validated non-default symbols, cached hits and shared upstream limits.
- Document burst/refill, cold-start and worker/instance multiplication boundaries;
  these controls do not claim a project-wide spending cap or new infrastructure.

## Validation

- Offline 129-symbol/two-round regression capped to 32 mock reads, 32 free
  negative-cache hits, 194 rejections, zero writes and zero upstream work.
- Market tests cover admission races/refill, actual metrics HTTP routing, batch
  work, transaction callback retries, rollback, cache expiry and normal behavior.
- Market service Ruff checks and formatting pass.
