# Renew encrypted library keys without losing history

Date: 2026-10-30

## Summary

Owners can explicitly renew registered browser and recovery keys, including after certificate
expiry, using the existing Hub APIs. Encrypted historical keys keep accepted holdings, tasks and
reports readable after renewal and relogin.

## Changes

- Add a versioned encrypted historical keyring with legacy archive compatibility and strict
  owner/root/certificate bindings; private keys remain in the crypto Worker.
- Add an explicitly restricted Passkey renewal session, review/confirmation, original-operation
  retry, receipt recovery and competing signed cancellation before atomic local promotion.
- Fence persistent candidates, pins and device seals across tabs, lock/logout/account changes,
  including same-credential archive updates and legitimate Passkey replacement.
- Extend only the existing fixed Hub BFF routes and closed request/response validation.
- Explain recovery-kit refresh and pending-upload limits; leave reset/delete/rekey separately scoped.

## Validation

- Synthetic crypto, controller/UI, actual Worker dispatch, IndexedDB races, strict BFF and local
  actual-Hub SQLite interoperability tests cover retained history and failure boundaries.
- Full repository checks, Web production build and target CI are required before merge.
- No cloud configuration or resources, backend/shared contracts or dependencies change.
