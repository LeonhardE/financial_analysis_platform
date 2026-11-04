# Reconcile and withdraw unknown key archive deletions

Date: 2026-11-03

## Summary

Add the Hub prerequisite for resolving an unknown cloud key archive deletion before exposing the Web confirmation flow.

## Changes

- Add an owner/root-verified read-only check that distinguishes accepted deletion, signed withdrawal, superseded CAS and unresolved state without treating expiry or a missing receipt as cancellation.
- Add exact-target root-approved withdrawal that advances lifecycle CAS, preserves the archive and permanently prevents the original deletion identity from committing later.
- Preserve original receipts, strict request/response bounds, independent signed-history verification and transaction retry behavior; keep deployment settings and Muse gates unchanged.

## Validation

- Full root `npm run check` passed, including all 531 discovered Hub tests; 76 targeted checks passed.
- Synthetic SQLite/Firestore SDK tests cover response loss, restart, expiry, concurrent winners, malformed/foreign signatures, future counters, idempotency and corruption.
- HTTP tests verify owner authentication, strict transport, body limits and no-store framing.
