# Reuse bounded static registry certificate checks

Date: 2026-11-14

## Summary

Long Root registry histories repeat the same signed certificates. Shared JavaScript
and Python verification can reuse successful static checks within one history attempt
while continuing every current identity, history, revocation and authorization check.

## Changes

- Export a fixed-profile browser certificate verifier shared by `Registry.load` and
  separately deployed trusted consumers. It returns an isolated payload, validated
  public-key thumbprint and canonical payload digest, without an authority decision.
- Extend Python's existing complete Root/JWS memo entry with successful certificate
  schema and public-key validation, without a second payload key or cross-request cache.
- Snapshot Python Root and signed inputs before deriving the key and verifying, and
  serialize bounded entry admission so concurrent verification cannot exceed capacity.
- Validate and size-bound each actual private bundle before verification, retaining
  the same schema and 131 KiB budget as the supplied JSON.
- Count static metadata toward the existing 128-entry/1 MiB limit; overflow performs
  normal validation. Keep checkpoints, entry state, current time and selection checks.
- Synchronize the checked browser bundle, declarations and integrity manifests; preserve
  frozen legacy compatibility assets.

## Validation

- Real WebCrypto and Python synthetic 23-checkpoint/47-certificate histories preserve
  full verified authority. Certificate signatures fall from 598 to 70 and repeated
  certificate schema/public-key checks from 575 to 47.
- Regression coverage includes complete Root/JWS/profile binding, malformed/private
  public keys and invalid points, isolated hits, await/thread mutation, capacity
  fallback, fresh operations, clocks, active/revoked state and epoch/chain conflicts.
