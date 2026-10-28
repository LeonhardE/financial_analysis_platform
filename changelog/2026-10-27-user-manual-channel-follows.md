# User manual channel follows

Date: 2026-10-27

## Summary

Users can maintain a bounded list of manually provided YouTube channel handles
through independent User APIs. Entries are explicitly unverified and no video
content, remote lookup or model work is performed.

## Changes

- Add authenticated GET/PUT `/api/v1/channel-follows`, strict locator
  normalization and whole-list expected-revision concurrency checks.
- Persist one owner-isolated list with its version metadata atomically in local
  SQLite or the existing configured Firestore database. Reject inconsistent
  storage and retain the existing watchlist behavior.
- Bound raw requests and error diagnostics, preserve no-store, and add service
  configuration/usage documentation.

## Validation

- User service tests cover existing auth/watchlist behavior and synthetic manual
  follows CRUD, two-owner isolation, concurrent CAS, atomic rollback, malformed
  data, strict request budgets and Firestore transaction boundaries.
- User service Ruff checks and formatting pass.
