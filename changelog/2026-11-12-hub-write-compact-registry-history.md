# Store complete registry history without repeated map overhead

Date: 2026-11-12

## Summary

Write canonical UTF-8 bytes to the existing unindexed Vault and persistent Run registry-history
fields after the compatible reader release. Public APIs and signatures retain the full original
arrays, while long histories avoid Firestore's repeated nested-map encoding overhead.

## Changes

- Validate the unchanged complete logical-document and exact SDK wire budgets before buffering
  writes; use the same encoding for validation and the actual Firestore commit.
- Retain SQLite logical JSON, legacy-array reads, original signed history and every security
  check. No compression, new index, collection, cloud resource or API change.
- Require the compatible reader release as the rollback floor after compact data is written.

## Validation

- Real Firestore SDK/RPC tests verify a full valid signed history that exceeds the old wire
  encoding limit fits both existing budgets and remains verifiable after exact roundtrip.
- Existing malformed, oversized, signature-tamper, transaction and legacy-read checks remain.
- Run the complete repository checks before committing.
