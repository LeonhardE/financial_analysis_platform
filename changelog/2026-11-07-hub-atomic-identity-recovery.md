# Atomic Agent identity recovery proofs

Date: 2026-11-07

## Summary

Agent Hub can verify recovery of the same enrolled Agent identity after transport
or enrolling-device expiry, without recreating content permission. Activation stays
disabled by default; the recovery receipt grants no content or execution access.

## Changes

- Add fixed, bounded Agent challenge/proof endpoints with server-generated nonces,
  current identity/certificate checks and atomic challenge consumption.
- Retain original identity-only proof receipts through a short retry grace period;
  replay cannot extend their expiry or override disconnect/revocation.
- Keep at most eight ephemeral recovery entries and preserve all permanent identity,
  consent, Run and result stores; do not issue OAuth tokens or extend legacy grants.
- Add real-signature SQLite/Firestore SDK conflict and HTTP activation/transport checks.

## Validation

- Focused recovery, route and service boundary suites.
- Full root `npm run check` before commit.
