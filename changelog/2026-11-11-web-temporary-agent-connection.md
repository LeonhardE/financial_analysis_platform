# Offer a temporary personal Agent connection

Date: 2026-11-11

## Summary

Owners can choose a 15-minute temporary connection during authorization or
reauthorization. The existing 90-day duration remains the default.

## Changes

- Add one bilingual duration choice and show expiry time for near-term connections.
- Bind the Owner-selected lifetime to the signed approval in the existing Worker;
  reject other durations and preserve the existing maximum and certificate bounds.
- Retain the exact selected duration in the sealed pending approval and freeze it
  during retries, without replacing unresolved authorization operations.

## Validation

- 22 targeted Web tests passed, including signed short leases, exact expiry,
  unsupported inputs, immutable pending retries, lock/resume storage and both locales.
- Root `npm run check` passed through the normal pre-commit hook.
