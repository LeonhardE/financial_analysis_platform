# Reuse repeated certificate signature checks within one history verification

Date: 2026-11-14

## Summary

Add an opt-in shared verifier primitive that avoids repeating certificate JWS
verification when consecutive registry bundles retain identical signed certificates.
Consumers adopt the primitive separately.

## Changes

- Add `RegistryCertificateMemo` and the optional `verify_registry` keyword
  `signature_memo`. Successful results are isolated and keyed by the complete
  Root public key, verification profile, expected key ID and complete signed JWS.
- Bound reuse to 128 entries and 1 MiB of encoded keys/payloads, falling back to
  normal signature verification when full. Memo construction accepts no prefilled data.
- Preserve each checkpoint signature and all schema, identity, time, authorization,
  revocation, epoch and historical consistency checks. The memo belongs to one
  operation and does not store current registry or permission decisions.

## Validation

- Synthetic 23-generation history produces the same verified state with 70 JWS
  checks instead of 598; all 621 schema checks still run.
- Regression coverage includes signature/profile/key substitution, failed-check
  retries, mutation isolation, both capacity bounds and live authority checks.
- Repository checks run through the required commit hook.
