# Batch current Portfolio metadata reads

Date: 2026-11-12

## Summary

Existing source-state and projection requests read up to ten sources in one transaction instead
of repeating storage round trips and identical public registry-history verification per source.

## Changes

- Read authority, latest head and lifecycle documents in one bounded SDK batch, preserving current
  source checks and retry-time revocation checks without changing HTTP request or response formats.
- Reuse identical registry verification only inside one transaction attempt; retain current rows,
  root/owner/vault/time bindings and all historical continuity checks.
- Emit closed stage timings containing counts and durations only, without source or owner IDs.

## Validation

- Portfolio tests cover 1/2/10 sources, actual SDK batching, changed authority on conflict retry,
  tampered/missing history, time changes, bounded input and private diagnostics.
- Root `npm run check` is required before commit; no live business validation is included.
