# Read compact registry history before enabling writes

Date: 2026-11-12

## Summary

Prepare compatible Hub readers for a bounded storage encoding that avoids Firestore map
overhead in long signed registry histories, without changing APIs or deleting history.

## Changes

- Accept canonical UTF-8 JSON bytes only in existing unindexed Vault and persistent Run
  registry-history fields; retain legacy array reads and writes.
- Restore the original arrays before normal signature verification, with strict parsing,
  canonical encoding and complete logical-document size limits.
- Document reader-first rollout and the compatible rollback floor for later compact writes.

## Validation

- Real Firestore SDK RPC fixtures cover legacy writes, equivalent single/batch reads,
  malformed and oversized payloads, complete document budgets, signature tampering and
  rejection outside the two intended collections.
- Run the complete repository checks before committing.
