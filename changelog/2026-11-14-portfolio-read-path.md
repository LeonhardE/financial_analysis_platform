# Batch Portfolio snapshot and receipt reads

Date: 2026-11-14

## Summary

Normal snapshot and original upload-receipt reads now use two bounded read phases
instead of serial point reads. Current authority is still checked before retrieving
ciphertext, and all retained receipt, source epoch and lifecycle proofs remain.

## Changes

- Prefetch independent authority/head/lifecycle rows and operation/ledger rows
  inside the existing transaction, with detached read-only views.
- Bound repeated full-document reuse to128 entries/8MiB per attempt, including
  confirmed absence; malformed batches are never partially retained.
- Preserve pending-write snapshot behavior, fresh retries and current revocation,
  deletion, upload cancellation and historical-read semantics.

## Validation

- Nine new real SDK/synthetic RPC tests and43 focused regressions passed.
- Normal root `npm run check` before commit; exact-head CI before merge.
- No live business/native/performance acceptance, resources, warming or capacity change.
