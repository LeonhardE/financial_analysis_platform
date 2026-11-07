# Hub persistent resource-consent APIs

Date: 2026-11-07

## Summary

Agent Hub can retain explicit root-approved logical-resource permissions across
ordinary session expiry and normal resource revisions, with independent revocation.
New approval remains disabled by default; execution and encrypted delivery are not enabled.

## Changes

- Add owner-only current policy, signed incremental approval/revocation and original
  control/receipt APIs, backed by atomic CAS and permanent per-resource tombstones.
- Read authoritative producer revisions outside database transactions and recheck
  current identity, connection, checkpoint, policy and source fences when committing.
- Resolve exact retries from immutable originals before source RPCs; reserve a separate
  revocation budget so approval exhaustion never prevents narrowing.
- Add SQLite, actual Firestore SDK conflict and strict HTTP gate/body tests.

## Validation

- Focused policy producer, route and service boundary suites.
- Full root `npm run check` before commit.
