# Preserve bounded registry history when freezing runs

Date: 2026-11-12

## Summary

Starting an Agent run no longer fails when verified registry history exceeds the
size of one incoming upload while remaining inside the supported storage budget.

## Changes

- Clone the already verified registry history using the existing stored-document
  byte budget when freezing a run.
- Retain the complete original history and exact-trigger retry behavior. The
  committing store still checks the entire encoded run document.
- Keep HTTP upload, individual registry bundle, storage and read limits unchanged.

## Validation

- A regression grows real Root-signed history through the normal vault API,
  reproduces the previous `payload_too_large` failure, and verifies frozen history
  plus exact retry after another registry update and a catalogue outage.
- Targeted Hub execution tests and the normal full root pre-commit check.
- Exact-head CI before merge.
