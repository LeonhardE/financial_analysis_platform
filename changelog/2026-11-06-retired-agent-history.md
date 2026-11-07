# Keep revoked Agent access in history

Date: 2026-11-06

## Summary

Revoked Muse connections and their local authorization retry records no longer crowd the active
Agent workspace. Owners can expand the retained history without reconnecting or replaying it.

## Changes

- Keep revoked connections in a collapsed history list; expired connections remain available for
  review and revocation. Collapse the selected revoked connection's details by default.
- Move local registration, consent and encrypted publication records into read-only history only
  after a successful same-owner connection read confirms revocation. Missing connections, failed
  reads and ordinary expiration do not hide unresolved operations.
- Hide a revoked connection's obsolete consent and delivery controls. Retain encrypted local
  records, server grants, saved resources, reports and audit history without deletion or new access.
- Add matching English and Chinese labels. No backend API or permission configuration changes.

## Validation

- Agent UI regression tests cover revoked history, expired/unknown connections, mixed pending
  records and account isolation in both languages.
- `npm run check` from the repository root.
