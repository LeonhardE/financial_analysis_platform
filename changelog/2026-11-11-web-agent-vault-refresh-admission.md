# Recover Agent authorization vault refresh admission

Date: 2026-11-11

## Summary

Agent authorization can now wait for a marked local admission denial while refreshing
the vault after public-key registration, instead of stopping before the signed approval.

## Changes

- Route initial and controller-triggered vault refreshes through the Agent action's
  existing bounded, cancellable admission transport.
- Preserve the vault response size/schema checks, Owner/session fences, Worker
  verification, exact pending approval and original action deadline.
- Keep request limits, generic error handling and the decryption runtime unchanged.

## Validation

- 97 focused Web tests passed, including real controller registry/approval ordering,
  initial/post-registration admission recovery, response validation and late-account fencing.
- Root `npm run check` passed through the normal pre-commit hook.
