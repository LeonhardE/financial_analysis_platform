# Batch Hub discovery and account for the complete read path

Date: 2026-11-13

## Summary

Resource discovery no longer issues separate state/projection requests for every holding source.
The existing response profile remains compatible with current Web clients and Portfolio APIs.

## Changes

- Use one bounded state batch and an active-subset projection batch, with per-source binding checks
  and bounded error isolation for refused batches; keep two joined upstream workers.
- Batch local source fences and reuse exact static registry verification within one read while
  rereading current context before and after producer work.
- Include both context checks and credentials in the cooperative ten-second read budget, reserve
  finalization margin and emit closed stage timings on successful and failed reads.

## Validation

- Synthetic catalogue tests cover 1/2/10-source batching, reordered/duplicate rows, partial failure,
  concurrent fences/registry updates, clock changes, full-path budgets and private diagnostics.
- Real SDK tests verify bounded fence batches; normal pre-commit runs root `npm run check`.
- No wire/storage format, capacity or infrastructure changes; production business validation is deferred.
