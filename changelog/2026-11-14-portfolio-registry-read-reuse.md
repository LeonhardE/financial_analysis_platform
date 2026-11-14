# Reuse Portfolio registry verification across clock seconds

Date: 2026-11-14

## Summary

Reduce repeated public signature verification when resource metadata reads contain
long registry histories or multiple sources with identical history.

## Changes

- Use a new bounded `RegistryCertificateMemo` for each history verification,
  preserving every checkpoint signature and all schema and authority checks.
- Reuse identical verified history within one metadata transaction attempt even
  when source processing crosses a clock second. Every reuse still requires a
  strict nonnegative safe integer time and rejects a checkpoint issued in the future.
- Preserve each source's current root validation, row, epoch, active state, latest
  head and lifecycle checks. Reuse never crosses requests or conflict retries.

## Validation

- Twelve metadata regressions, including real Firestore SDK reads, cover 23-generation histories,
  cross-second reuse, fresh requests/retries, backward clocks, root/history changes,
  current source fences and unchanged read-only transaction behavior.
- Two sources with identical 23-generation history require one history verification
  and 70 JWS checks; a new request independently performs those checks again.
- Required repository checks run through the commit hook before publication.
