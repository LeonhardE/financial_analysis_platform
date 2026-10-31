# Recover saved holdings uploads after certificate expiry

Date: 2026-10-31

## Summary

A library key renewal review can now verify an earlier saved holdings upload even when its
operational signing certificates have expired. The owner separately confirms clearing the local
retry copy before continuing renewal. The saved encrypted snapshot remains unchanged.

## Changes

- Add bounded, read-only Worker verification for the original packet, operation receipt and
  exact saved snapshot using root-trusted history and certificate validity at the saved time.
- Recheck server evidence on confirmation and clear only the complete unchanged local row through
  an atomic transaction fenced by session lock and competing archive or renewal changes.
- Keep unknown/missing outcomes and task uploads blocked, without ordinary content access,
  automatic resubmission, resigning, re-encryption or data deletion on the server.
- Add localized review, confirmation, retained-packet guidance and focused adversarial coverage.

## Validation

- Complete root `npm run check`, including the repository security/type/lint/format checks and
  existing backend/infrastructure suites.
- Web regression suite: 606 tests, with 31 added crypto, Worker/storage, controller and UI cases.
- Production Web build and independent review of historical-key validity, exact-row CAS and
  session/capability races.
- Physical Passkey and production IAM acceptance remain separate from synthetic regression tests.
