# Reuse the unlocked owner workspace

Date: 2026-11-07

## Summary

Refreshing library status or enabling changes from Agent, Tasks or Inbox reuses the current owner unlock instead of asking for the same Passkey again.

## Changes

- Revalidate the latest vault, lifecycle and device authority inside the existing crypto Worker.
- Keep ordinary refreshes and read/write views on the same unlock generation.
- Preserve explicit device approval and clear keys on trust failures, locking, sign-out or account changes.

## Validation

- Workspace regression tests cover repeated entry, refresh, device review, trust failures and explicit locking.
- Full repository checks and production Web build.
