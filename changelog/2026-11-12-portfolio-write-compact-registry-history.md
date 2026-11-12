# Store complete public authority history with compact encoding

Date: 2026-11-12

## Summary

After compatible Portfolio readers are fully deployed, use canonical UTF-8 bytes in the same
existing unindexed authority-history field to avoid Firestore nested-map overhead.

## Changes

- Check both the full logical JSON and actual serialized Firestore document against the
  unchanged budget, using the same encoding for validation and committing.
- Restore exact arrays for normal signature/fence verification; retain legacy reads, SQLite
  logical JSON, signed history, APIs and existing cloud resources/configuration.
- Keep the compatible reader release as the rollback floor after the first compact write.

## Validation

- Actual Firestore SDK/RPC tests verify a complete valid signed authority history that exceeds
  the legacy wire encoding budget fits both unchanged budgets and remains fully verifiable.
- Equivalent legacy reads, encrypted writes, malformed/oversized input, signature tampering
  and atomic authorization/fence retries remain covered.
- Run complete repository checks before committing.
