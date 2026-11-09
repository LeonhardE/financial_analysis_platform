# Confidential VM build and release review tooling

Date: 2026-11-09

## Summary

Allow future confidential VM backends to join the existing source/CI mechanism
without entering the Cloud Run publisher or treating local smoke as TEE proof.
This is repository tooling only; no future service or cloud resource is registered.

## Changes

- Add an optional, immutable deployment runtime to source registration. Existing
  rows retain Cloud Run defaults; VM backends stay build-only and require an
  explicit offline probe with no content/key-release/attestation claims.
- Dispatch the required CI health step by runtime, preserving existing network
  isolation and matrix evidence requirements.
- Reuse successful-build provenance validation for separate VM first-provision,
  upgrade/restore descriptors and bounded post-deployment observation records.
- Bind independently selected policy, approved digest, source, workload identity,
  prior release, original public keys and state head; reject mismatches/rollback.
- Keep requests unapproved and observations explicitly metadata-only. Real
  attestation, key release, state transactions and provisioning remain owned by
  later single-target infrastructure changes.
- Registry/publisher changes invalidate their saved-plan configuration fingerprints;
  later approved applies need fresh target plans.

## Validation

- Registry/transition, CI selection, offline smoke and Cloud Run guard tests.
- Synthetic build/source/digest, policy/baseline, health/pin and CLI negative tests.
- Complete root `npm run check` before commit.
