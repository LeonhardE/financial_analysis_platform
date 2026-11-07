# Shared browser persistent contract implementation

Date: 2026-11-07

## Summary

Extract the reviewed pure persistent cryptographic contract implementation into a
shared browser package so the owner Web and Agent runtime can use the same rules.
No service, frontend consumer, wire format or P1 behavior changes in this foundation.

## Changes

- Share Root registry/identity checks, signed resource policy reconstruction,
  encrypted publication/Run validation and exact request-proof primitives.
- Provide a locked, reproducible dependency-free ESM distribution with adjacent
  TypeScript declarations, schema snapshot, notices and integrity hashes.
- Keep private keys, storage, network, Worker dispatch and UI in their consumers.
- Add mandatory offline browser contract tests to root checks and repository CI.

## Validation

- Public independent Node/Python fixture, actual nonexportable WebCrypto decryption,
  original signatures, tampered identity/ciphertext/pins, strict JSON and schemas.
- Distribution hashes and isolated import without installed packages or network.
- Full repository `npm run check` before commit; consumers ship in separate PRs.
