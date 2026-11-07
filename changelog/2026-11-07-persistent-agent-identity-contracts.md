# Persistent Agent identity and session recovery foundation

Date: 2026-11-07

## Summary

Separate a stable, explicitly approved public Agent identity from short-lived
session credentials, so future consumers can recover one connection without
recreating its identity or implicitly extending existing content permissions.

## Changes

- Add opt-in packaged closed schemas and stateless verifiers for owner-approved
  Agent identity bindings, terminal epoch-advanced revocation and exact one-use
  session challenges signed by the same currently certified Agent.
- Bind owner, vault, root, connection, principal, client, both Agent keys, original
  binding fingerprint and audience. Bound control freshness, challenge lifetime,
  canonical nonce, complete-message size and safe integer handling.
- Keep legacy P1 grants, certificates, OAuth deadlines, routes and consumers
  unchanged. Recovery authenticates identity only; persistent resource permissions,
  atomic storage/issuance, trusted first pairing and runtime lifecycle remain
  separate producer/consumer work.

## Validation

- Synthetic real-signature isolation, recovery/replay, expiry, revocation and
  legacy-profile regressions; complete shared and repository checks.
- Local wheel packaging and isolated packaged-schema loading.
- No private keys, OAuth secrets or content are stored by this foundation.
