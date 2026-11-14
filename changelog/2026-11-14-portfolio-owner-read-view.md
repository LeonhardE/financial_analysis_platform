# Combine matching owner holdings reads

Date: 2026-11-14

## Summary

Add a bounded owner read view to avoid repeated network and database round trips
when the current verified Hub context already matches the Portfolio replica.

## Changes

- Add `POST /api/v3/holdings/sources/{sourceId}/view/query` for public read
  preconditions. Verify current authority, source and live owner ACL; return the
  original metadata/snapshot DTOs from one transaction without sync or writes.
- Keep non-active, pending or mismatched state on the original metadata-first
  recovery path. Only a valid combined-size overflow may use a separate-read hint.
- Reuse the original snapshot validation body for both new and existing routes,
  and extend closed contract error framing to the new owner v3 route family.

## Validation

- Seventeen focused cases cover actual SDK two-phase reads, SQLite parity, unchanged
  DTOs, retry freshness, incomplete/duplicate streams, owner and live ACL binding,
  historical/empty sources, lifecycle recovery, head/receipt association, budgets,
  platform identity compatibility and independent owner authentication.
- Complete Portfolio service suite: 172 passed. Repository checks are required
  before commit; production latency requires deployment and real UI measurement.
