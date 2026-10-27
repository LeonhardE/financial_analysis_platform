# Shared private storage and scoped access modules

Date: 2026-10-26

## Summary

Provide narrowly scoped infrastructure building blocks for future private service data without
instantiating resources or changing existing services and permissions.

## Changes

- Add a protected named Firestore database module with explicitly scoped TTL fields and composite
  indexes. TTL remains asynchronous cleanup rather than an authorization or revocation mechanism.
- Add a fixed database-type/name IAM condition and optional additive runtime grants. Existing IAM
  owners can consume only the condition while retaining their resource addresses.
- Add fixed-purpose access to an existing KMS CryptoKey: delegation signing, public-key reading or
  the Firestore managed service agent's CMEK use. No key creation, secret payloads, user content
  keys or arbitrary project roles are exposed.
- Reuse existing exact-secret references and numeric-version validation. Production module
  instances, API enablement, administrative permission migrations and SDK allow/deny smoke checks
  remain separate target work.

## Validation

- Native Terraform format, readonly/backend-disabled initialization, validation and 80 mocked
  plan tests across the three modules; independent cross-review passed.
- Anonymous-credential Firestore SDK 2.34.1 checks construct correct named/default document and
  buffered-write paths without network requests. This does not establish live IAM enforcement.
- Root `npm run check`; existing guarded ownership regression uses a localhost fake API, without
  real cloud credentials or cloud resources.
