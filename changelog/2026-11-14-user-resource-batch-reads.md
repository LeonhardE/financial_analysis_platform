# Batch User content and version reads

Date: 2026-11-14

## Summary

User source metadata, channel follows and initialization now fetch independent
records in one bounded transaction batch, reducing serial database round trips
without changing current content/version, owner or receipt checks.

## Changes

- Batch2/4 resource metadata records,3 initialization records and2-record channel
  follows/watchlist mutation prerequisites inside existing transactions.
- Match exact document names and require complete, unique responses before parsing;
  interrupted reads never become uninitialized data.
- Preserve API responses, source identities/epochs, CAS, no-op/replay semantics,
  current retry reads and existing timeout/retry bounds. No process document cache.

## Validation

- Seven new real SDK/synthetic RPC tests;73 focused regressions passed, including
  peer update conflict recovery, owner partitions and private metadata responses.
- Existing parser tests retain behavior assertions with an explicit BatchGet fixture.
- Normal root `npm run check` before commit and exact-head CI before merge.
- No cloud resources, capacity/rollout change, warming or online acceptance.
