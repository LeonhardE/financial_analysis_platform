# Retire Web legacy Agent entry points

## Summary

Remove replaced foreground, persistent-browser and executor-specific authorization entry points from the Web application while preserving historical Inbox access.

## Changes

- Remove unused foreground connection/consent panels, hooks, bridge, translations and styles. Keep only the native account-link credential transport.
- Refuse retired executor and runtime setup paths at both authenticated client and BFF boundaries. Remove old enrollment RPCs and the one-year Agent certificate branch.
- Exercise the real Web Owner approval, host-owned client, Hub consent/publication/plan/report loop with synthetic data. Keep historical cryptographic format and Inbox tests.
- Migrate durable outbox tests to current credentials, including exact retries, lock fencing and retention of an expired sealed original before a fresh reviewed offer.
- Consolidate the maintained Agent and transport guides around the current route.

## Validation

- Root `npm run check`.
- Real Worker/IndexedDB outbox, Web-to-private-host crypto loop, native identity/session fences, retired-route refusal and historical report checks.
