# Owner-only encrypted holdings snapshots

Date: 2026-10-27

## Summary

Portfolio validates and persists immutable signed ciphertext snapshots, advances an atomic latest
pointer and recovers original write receipts. It accepts no plaintext CSV or brokerage credentials.

## Changes

- Require independently verified Firebase ownership, the exact shared v2.0 contract and a trusted
  public authority/source replica. Roots and registries cannot be enrolled through HTTP or env.
- Add SQLite local and isolated named-Firestore stores with atomic snapshot/receipt/operation/CAS,
  current authority/fence checks on retry, immutable versions and same-operation replay.
- Bound request bytes/time, complete responses and actual Firestore SDK Document encoding. Keep
  all v2 errors in the shared closed DTO without private diagnostics; retain historical author proofs.
- Keep delivery build-only. Trusted Hub projection, approved runtime permissions/invocation and
  index policy precede live enablement; client key/CSV UX remains frontend work.

## Validation

- Synthetic tests cover real crypto, owner separation, SQLite restart/concurrency/rollback, real
  Firestore SDK retry/serialization against an in-memory RPC boundary, replay/conflicts, source
  locks/key revocation/registry rollback, budgets, slow uploads and fixed formal diagnostics.
- Health remains independent of credentials, storage configuration, networking and other services.
- No cloud mutation, real account, brokerage connection or plaintext financial payload was used.
