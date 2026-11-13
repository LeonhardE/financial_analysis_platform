# Owner-only encrypted source names in Hub

Date: 2026-11-13

## Summary

Provide small encrypted holdings-source names without rewriting source data,
permissions or Root history. The Web consumer can adopt the API separately.

## Changes

- Add closed authenticated Owner capability/list/current/write/original-receipt
  routes with bounded bodies, independent CAS and atomic original-operation storage.
- Bind names to current Owner/vault/Root/full source incarnation, enforce deletion
  fences in the transaction and preserve immutable Owner receipts without rollback.
- Batch at most ten names and fences from the existing store, without producer
  requests. Cache only static Root signature verification by fresh complete history.
- Add no Agent endpoint, migration, rollout setting or cloud resource.

## Validation

- Synthetic SQLite signature/CAS races, Owner isolation, original replay after
  rename/expiry, deletion/recreation and corrupt-record tests.
- Actual Firestore SDK batch/retry tests, including a racing delete and ten sources;
  closed FastAPI route/auth/body checks.
- Normal root `npm run check` in the commit hook; no online business validation.
