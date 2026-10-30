# Root-approved operational owner key renewal

Date: 2026-10-30

## Summary

The Hub accepts explicit new-generation owner key renewals, including after operational
certificates expire, without changing the pinned root or receiving private keys. A root-approved
new registry and opaque encrypted archive are committed together with their history and receipt.

## Changes

- Add bounded owner renewal-state, atomic renewal and original-receipt endpoints using existing
  Google authentication, registry validation, archive profile and storage namespace.
- Require fresh device signing/encryption pairs and/or recovery keys with higher local epochs;
  preserve immutable old certificates and revoke only replaced keys. Existing grants are not
  silently reauthorized.
- Keep the existing archive rewrap action and original-operation semantics, with all registry,
  vault and archive fences checked inside one transaction.
- Document the separate Web keyring/expired-certificate UX work and retained renewal/rekey limits.

## Validation

- Synthetic service, HTTP, concurrency, persistence and Firestore SDK transaction tests.
- Full root checks and target CI recorded before merge. No cloud configuration or resources change.
