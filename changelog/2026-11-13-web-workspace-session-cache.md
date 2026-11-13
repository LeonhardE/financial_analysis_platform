# Reuse verified workspace display data during navigation

Date: 2026-11-13

## Summary

Returning to Tasks, Resources or Inbox retains already loaded content and local view state.
Switching to a cached holding source shows its own content before the background check finishes.

## Changes

- Separate internal navigation from identity/lock/visibility boundaries; preserve task editors,
  sealed draft progress, verified names, resource lists, report selection/filters and route scroll.
- Add shared bounded memory-only display LRUs, exact source/version invalidation and independent
  cancellation for opt-in coalesced display GETs. Fresh operation checks and writes do not use them.
- Keep report provenance verification, current authority/source checks, original encrypted draft
  and outbox recovery. Clear private displays on hidden/lock/owner/vault/generation boundaries.
- Keep source authority unavailable after a failed metadata check while displaying prior content
  with a localized stale/update state.

## Validation

- Controller and integration tests cover navigation/draft races, LRU entry/byte limits, streamed
  shared reads, independent cancellation, current-version/revocation invalidation and lock/hide.
- Normal pre-commit runs root `npm run check`; production Web build is checked separately.
- No shared contracts, storage formats, service configuration or infrastructure changes.
- Production first-frame p95 and future manual Run recovery remain separate acceptance gates.
