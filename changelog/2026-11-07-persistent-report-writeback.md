# Persistent encrypted report writeback

Date: 2026-11-07

## Summary

Add the gated producer for one encrypted report per persistent Run and independent
Google-owner history/read-state APIs. No service decrypts a report or stores a
user/Agent private key.

## Changes

- Require the current exact Agent request proof, active task output policy, frozen
  Run/input bindings, live resource permissions and source fences for a new report.
- Atomically save original ciphertext/receipt and mark its Run submitted. Retries
  keep original operation identity and resolve saved outcomes before source RPCs;
  another initial publication cannot create a duplicate report.
- Keep owner history and signed read/star/archive state available independently of
  Agent/connection/resource revocation and all issuance flags. Return original
  manifests, signatures and public authority history for independent client checks.
- Use bounded linked index pages so daily reports do not exhaust a lifetime
  per-owner array. Store ciphertext separately from small metadata heads.
- Keep report writes disabled by default. Legacy result producers remain unchanged.

## Validation

- Synthetic cryptographic write/read, owner isolation, current authority, original
  retry, transaction rollback, bounded pagination and HTTP boundary regressions.
- Full root `npm run check` before delivery.
