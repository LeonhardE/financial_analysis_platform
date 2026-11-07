# Persistent Agent execution inputs

Date: 2026-11-07

## Summary

Add opt-in current Agent proof reads and immutable analysis Run allocation without
extending the old OAuth family, granting a bearer capability or weakening legacy P1.

## Changes

- Authenticate every fixed method/path/business body using the current certified
  Agent signing key, registered client and original owner-indexed connection.
- Read only assigned active Root-published tasks and exact authorized resource copies.
  Recheck task authority, permission epochs and source fences in the same transaction.
- Freeze one manifest per task/trigger with stable IDs, immutable input versions and
  fingerprints. Source updates cannot rewrite an existing Run; unknown outcomes return
  original receipts before source RPCs, without extending deadlines.
- Apply bounded connection/minute and owner/day allocation quotas. No result producer,
  scheduler or private key storage is enabled by this change.
- Keep execution gated and disabled by default; expose capability readiness from the
  actual gate. All legacy task grant checks remain unchanged.

## Validation

- Synthetic real-signature execution, replay, isolation, current-revocation and route checks.
- Full root `npm run check` before delivery.
