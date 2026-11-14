# Batch persistent Owner report metadata reads

Date: 2026-11-14

## Summary

Persistent report lists read the selected metadata rows and task lifecycle in one
bounded database batch, removing one network or SQL lookup per report.

## Changes

- Feed the original stored-result and lifecycle validators detached rows from the
  same transaction attempt; retain Owner/current Root checks, ordering and cursors.
- Keep ciphertext, historical Actor attribution, read/star/archive state and
  authorization behavior unchanged, with no new endpoint or cross-request cache.

## Validation

- Eight focused tests cover actual Firestore SDK serialization,1/2/20-row query
  counts and exact original DTO parity, SQLite parity, corruption/partial refusal,
  Owner isolation, conflict freshness, pagination and zero writes.
- Ordinary Firestore reads decrease from N+4 to4 phases; SQLite performs four
  SELECTs, including a single bounded batch for rows and lifecycle.
- The complete Hub service suite passes953 tests across four isolated workers;
  Hub lint and format checks pass.
