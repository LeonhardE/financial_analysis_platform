# Keep owner connection management available when Muse is disabled

Date: 2026-10-31

## Summary

A signed-in owner's Agent connection list returned 503 because its service construction
required enabled OAuth issuance, even though Muse was intentionally not open. Owner reads
and revocation now remain available independently of that rollout gate.

## Changes

- Reuse existing connection/attempt projections and revocation transactions through an
  owner management service that has no OAuth configuration dependency.
- Keep OAuth issuance and agent execution on their existing explicit gates, preserving
  Google revoked-user verification, owner isolation and existing response shapes.
- Add an authenticated, closed owner capability profile separating owner management from
  the Muse connection gate, with no storage initialization or sensitive configuration output.
- Preserve genuine storage/verification errors instead of returning an invented empty list.

## Validation

- OAuth, owner transport and service-boundary regression suites pass, including eight new
  disabled-rollout, history/revocation, identity, outage and capability-configuration tests.
- The repository's mandatory full root check runs before commit.
