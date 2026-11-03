# Root-approved cancellation of unresolved task uploads

Date: 2026-11-03

## Summary

An owner can obtain a permanent, root-approved decision for one unresolved original task upload
without replaying it or restoring an expired device's write permission. A saved upload stays
saved; a cancellation that wins the transaction prevents a late upload from committing.

## Changes

- Add owner-only POST/GET task operation-cancellation APIs with a closed Hub-owned root profile,
  exact original target/digest bindings, bounded transport and immutable HTTP 200 responses.
- Atomically pair a per-owner/vault ledger with a strict tombstone at the original task operation
  document, fencing both current and rolling older writers through their existing transaction
  dependency. Saved operations preserve their original row shape and historical task result.
- Retain at most 32 cancellation IDs per vault, without TTL eviction. Exact retries and legal
  root signature variants recover the original response; new target or packet aliases conflict.
- Revalidate root proofs, tombstones and original saved history on reads. Missing or corrupt
  committed associations never become a successful cancellation proof or permission to upload.
- Preserve shared schemas, helper bundles, task state, current writer authorization and cloud
  configuration. The client-owned packet digest is a root-signed declaration, not a server guess.

## Validation

- All 90 focused cancellation, task/operation, HTTP, Firestore and API boundary tests passed.
- Tests cover both race winners, a rolling legacy writer, quota conflicts, restart/lost responses,
  signature variants, expiry/revocation/renewal, malformed proof/receipt/fence state and atomic rollback.
- Repository `npm run check` passed through the required pre-commit hook.
