# Load task names in bounded encrypted packet batches

Date: 2026-11-14

## Summary

The task list loads32 ordinary names with eight Owner queries rather than32 single GETs, keeping
the existing request budget and per-task Worker verification.

## Changes

- Admit only the new closed four-ID read-only POST through AuthProvider and the fixed Hub proxy;
  bind response items and the strictly shrinking suffix to the original request, with formal
  packet validation and the existing1MiB streamed response budget.
- Keep batch reads in the two-transport read queue, without mutation headers or body coalescing.
- Use two name workers across metadata rerenders, publish verified names progressively, isolate
  missing/stale/failed items, and preserve exact version caches, ownership and deletion fences.
- Keep unknown writes, signed commands, sealed drafts and grants on their existing fresh paths.

## Validation

- Focused DTO, proxy, AuthProvider and controller tests cover32-name/eight-request reuse, shrinking
  suffixes, no malformed partial opening, per-item verification, early publication/retry,
  metadata-refresh concurrency, owner changes, and closed request/response/header boundaries.
- Production Web build and normal root checks before commit; exact-head CI before merge.
- The Hub producer was Ready before this consumer. No online/native/latency acceptance, host
  upgrade, migration, limit increase, new resources, capacity or rollout change.
