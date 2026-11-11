# Review original identity after creation exits

Date: 2026-11-10

## Summary

Production Confidential Space stops the VM when the create-only workload finishes.
Final enrollment review must verify its just-persisted original identity without
racing that normal shutdown.

## Changes

- Allow STOPPING/TERMINATED only for the internal closed final-creation review at
  the enrollment audience, retaining the same current numeric VM ID/account and
  every fresh Google/Root/image/environment/nonce check.
- Keep pending creation and all runtime capability, lease and key-release proof
  verification strictly RUNNING; no public flag selects the exception.
- A review still only signs bounded public evidence and cannot activate a service,
  release a secret, replace an identity or restart a VM.

## Validation

- Real synthetic RS256 signatures against fixed Google JWKS/Compute fixtures:
  completed creation, forbidden states, wrong instance/stale/debug evidence,
  runtime rejection and purpose/audience separation.
- Full Policy suite and required root `npm run check`; exact-head CI before merge.
- No cloud proof, VM operation, Root enrollment, deployment or online validation.
