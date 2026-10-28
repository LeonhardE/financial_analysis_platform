# Hub encrypted CSV vault authority

Date: 2026-10-28

## Summary

Add the Hub producer prerequisite for owner-controlled, encrypted CSV persistence. Only passkey-
sealed archives and signed public authority are stored; no CSV, holdings or user content key is
accepted in plaintext.

## Changes

- Add authenticated immutable first-vault enrollment, root-pinned registry CAS and signed
  manual-source creation with a server-derived incarnation; bound history, sources and receipts.
- Add owner-scoped public authority projection behind both Google workload identity and existing
  FND-001 catalogue delegation. Root/account substitution and broader agent/Run scopes fail closed.
- Add fixed 60-second metadata delegation using an explicitly configured existing KMS RSA signing
  version, strict response integrity checks and public-only JWKS. Missing configuration stays 503.
- Add bounded SQLite/Firestore storage, actual SDK serialization checks and formal private errors;
  preserve credential-free health and build-only deployment. No shared contracts or cloud resources
  are created or activated.

## Validation

Synthetic tests cover owner isolation, concurrent bootstrap, root/registry rollback/substitution,
operation replay, source limits, signatures, dual-token authorization, KMS integrity checks,
actual Firestore retry/encoding and missing configuration. Full root checks are recorded separately
before delivery. No broker login, cloud signer, production database or new cloud resource was used.
