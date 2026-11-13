# Owner-only encrypted display-name contract

Date: 2026-11-13

## Summary

Define a small optional encrypted holdings-source alias so a consumer can rename
resources without changing financial data, task bindings or Agent permissions.

## Changes

- Add detached strict schemas, Owner/device signature verification, independent
  revision/CAS planning and exact original-operation replay comparison, bound to
  Owner/vault/pinned Root/full resource reference and incarnation.
- Define a distinct Owner-display JWE purpose/AAD and one existing Owner recovery
  recipient, with bounded Unicode names and command/envelope/request sizes.
- Keep legacy formats unchanged; enable no service, client, migration or resource.

## Validation

- Synthetic scope, signature, CAS/replay, purpose/AAD/AEAD, bounds and recipient
  negatives, plus independent native Node WebCrypto/Python bidirectional interop.
- Normal root `npm run check` in the commit hook; no online business validation.
