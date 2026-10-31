# Consume pinned Hub trust in User infrastructure

Date: 2026-10-31

## Summary

Let an explicitly reviewed User deployment consume the INF-007 repo trust contract. Existing
User projections remain default-denied; this PR does not install a production configuration.

## Changes

- Add the User source opt-in marker and an optional closed four-setting trust variable.
- Preserve the legacy environment for absent/disabled trust; derive only the reviewed nonsecret
  workload/delegation settings when enabled, with no arbitrary environment or key URL override.
- Validate fixed audiences/issuer, one canonical numeric caller and a distinct same-project Hub
  runtime email. Retain User identity, storage, public access and scaling/adoption boundaries.
- Document managed-trigger migration and separate Hub/JWKS/live-identity acceptance dependencies.

## Validation

- Native mock-provider plans: all 41 pass, including 17 new trust/configuration cases.
- Existing root `npm run check` runs through the pre-commit hook before the signed commit.
- No production apply, deployed environment update or permission mutation is performed by this PR.
