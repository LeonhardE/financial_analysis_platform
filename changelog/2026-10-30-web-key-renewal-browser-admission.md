# Repair native key renewal and recovery in the Web client

Date: 2026-10-30

## Summary

The browser rejected key-renewal requests before they reached the existing Web forwarding
routes or local acceptance service. Settings can now read renewal status, recover an original
renewal receipt and submit the root-approved renewal packet through the fixed owner boundary.

## Changes

- Admit only the three existing key-renewal route and method combinations, with bounded
  operation identifiers and no query parameters.
- Require the exact renewal body and idempotency header, bound both root-signed commands
  independently and preserve the aggregate request limit. Device-author, authority and
  alternate credential headers remain disallowed.
- Preserve Worker and Hub cryptographic validation and the existing account/session fences.
- After explicit recovery-device approval, load the saved holdings automatically for a
  holdings session. Inbox-only approval still makes no Portfolio requests; locked,
  signed-out or switched accounts cannot display late snapshot responses or plaintext.

## Validation

- Actual AuthProvider tests exercise real crypto renewal packets through both same-origin
  forwarding and development loopback transport.
- Negative tests reject alternate paths, methods, queries, bodies, credential overrides and
  oversized commands or packets before retrieving a user token or sending a request.
- Workspace tests cover recovery-device auto-read, separate Inbox-only approval and delayed
  snapshot bodies/decryption across lock, sign-out and account changes. Native acceptance
  observed the earlier manual-reload behavior; this follow-up UX change is verified synthetically.
