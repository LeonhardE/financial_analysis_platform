# Distinguish loading from disconnected Agent connections

Date: 2026-11-13

## Summary

Agent management no longer labels unread connections as disconnected. A slow or failed
read cannot prompt an unnecessary reconnection.

## Changes

- Track completion and failure separately for the Owner snapshot and provider slots,
  fenced by the current Owner and unlock generation.
- Show animated loading badges, explicit retry on read failure, and retained content during
  refresh. Connection actions wait for successful reads; genuine completed empty results
  still show disconnected.
- Start four independent capability/listing reads together through the existing bounded
  display request pool, retaining all fresh authority and write checks.

## Validation

- Delayed, failed, retried and stale-generation hook tests and English/Chinese UI tests.
- Root `npm run check` and production Web build.
- No online business acceptance or live performance measurements.
