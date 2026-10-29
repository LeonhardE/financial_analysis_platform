# Encrypted owner tasks and immutable rule versions

Date: 2026-10-29

## Summary

Add owner-only task creation, encrypted rule editing, version history and signed pause/resume/archive
to the build-only Hub. Private task content remains encrypted; saving a task starts no model or schedule.

## Changes

- Reuse the formal shared TaskMetadata, EncryptedTask, carrier and transition-intent contracts with
  verified Firebase ownership, root-pinned current writer/recipient authorization and public-only checks.
- Commit task head, immutable ciphertext version, operation receipt and bounded owner index atomically.
  Enforce expected-version conflicts, exact same-envelope replay, historical proof integrity and
  current authorization on replay. Historical reads verify authority at original write time.
- Separate rule versions from execution epochs: public binding/key-epoch changes, pause and archive
  invalidate execution; ordinary encrypted edits and same-binding reordering do not. Validate current
  source selection outside transactions and source fences inside the write transaction.
- Add owner-bound, snapshot-bound metadata pagination, explicit task/version/history limits and
  reserved pause/archive capacity. Agent grants, Run delivery and client task editing remain separate.
- Add no runtime configuration, cloud resource, deployment activation, shared-library or other-service change.

## Validation

- All 112 Agent Hub tests passed, including 36 new SQLite, HTTP and actual Firestore SDK cases.
  Coverage includes real synthetic TaskContent encryption/save/history/client decryption, two-device
  concurrent edits, owner isolation, revoked/expired writers, recipient and historical-proof tampering,
  source/registry transaction races, state transitions, receipts, cursors and capacity limits.
- Full repository `npm run check` passed, including secret scanning, lint/type checks, Web/service/
  infra/CI tests and formatting. The full check also reran all 112 Hub tests successfully.
- Tests used synthetic keys/data and in-memory Firestore RPCs; no cloud resources were contacted or created.
