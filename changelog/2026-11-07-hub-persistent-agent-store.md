# Durable Agent identity storage

Date: 2026-11-07

## Summary

Agent Hub can retain an explicitly approved public Agent identity independently
of short-lived OAuth transport credentials. Enrollment remains disabled by default
until trusted first pairing is ready; existing connections are not upgraded.

## Changes

- Add owner-only state, signed enrollment/revocation and original-operation receipt APIs.
- Commit create-only identities and immutable original receipts atomically; retain
  revoked tombstones and honor the original OAuth parent's disconnect fence.
- Keep history and revocation available while enrollment is disabled; expose
  separate readiness for enrollment, resource consent and execution.
- Add SQLite and actual Firestore SDK race tests with synthetic signatures and strict HTTP checks.

## Validation

- Focused identity storage and transport suites.
- Full repository `npm run check` before commit.
