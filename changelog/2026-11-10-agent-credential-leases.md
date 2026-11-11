# Bounded Agent-owned credential contracts

Date: 2026-11-10

## Summary

Add shared Owner-approved credential leases for personal Agents, with a 90-day
maximum and a seven-day renewal notice, while retaining immutable legacy bindings.

## Changes

- Add closed, versioned Python and browser schemas and signature verification for
  current-generation replacement, fresh keys, exact Owner/connection/audience,
  expiry and prior credential fingerprint.
- Define atomic replacement, trusted pairing, replay and final-write obligations
  for consumers. No service, frontend, infrastructure or release behavior changes.
- Publish browser types, distribution hashes and public Python/Node JOSE vectors.

## Validation

- Root `npm run check`.
- Independent Python/Node signatures, expiry boundaries, wrong Owner/context,
  stale replacement and reused-key rejection.
