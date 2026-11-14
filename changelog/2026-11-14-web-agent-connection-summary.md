# Read Agent connections in one verified display snapshot

Date: 2026-11-14

## Summary

Agent Management consumes Hub's compatible display endpoint to remove repeated vault, capability,
provider and credential network reads while preserving the original local verification.

## Changes

- Read one Owner-only display containing current vault, capabilities and the connection summary.
  Feed the unchanged vault response through the existing bounded parser and Worker before inspecting
  credential states. Keep explicit credential operations on their original fresh-read route.
- Validate the closed seven-field display and nested summary, exact candidate set, identities,
  32-connection limit and complete current-slot credential reference in browser and proxy. Reuse
  original formal response schemas. A separate transport hint uses all original independent reads;
  it never publishes a partial snapshot or increases the one-MiB response limit.
- Preserve Worker signature/authority checks, two-worker verification, the 14-second action deadline,
  cancellation and atomic publication. Failed refreshes retain the verified connection/slot pair
  with an error. A truthful Agent loading state becomes ready only after current full verification.

## Validation

- Real AuthProvider and Next proxy boundaries cover the exact GET routes and reject selectors,
  writes, delegation, half-hints and malformed nested replies.
- Real hook regressions cover one complete display GET, separate fallback, original vault adoption,
  streamed byte limits, two-worker verification, stale slot references, missing/duplicate/foreign
  candidates, crypto failure, cancellation, owner changes, deadlines and atomic retention.
- Complete local verification does not establish the production UI two-second target; release and
  online request/timing acceptance remain separate checks.
