# Verify Root-approved Confidential Space environment claims

Date: 2026-11-09

## Summary

Policy can accept explicitly Root-approved runtime configuration supplied through
Confidential Space metadata. Google measures the full container environment and
operator-supplied overrides separately; rejecting every nonempty override made
approved deployment configuration unusable.

## Changes

- Continue matching the complete measured environment exactly to the enrolled
  Root-approved workload. Permit only an override object whose keys and exact
  values are already in that same approved environment.
- Reject extra, changed, malformed or wrongly typed override values. Keep fixed
  image/arguments, empty command override, Google signature/nonce, production/debug,
  original keys, current VM and current-authority checks.
- Document the official launcher/claim semantics without changing shared contracts,
  Root scope, OAuth grants or any deployment/key-release gate.

## Validation

- 83 Policy tests passed, including real RS256 Google evidence fixtures, exact
  approved override subsets, extra/changed variables and matching overrides that
  cannot conceal a changed full environment or command.
- Full root `npm run check` and required commit checks precede publication.
- No cloud resource, real attestation acceptance or authority activation is implied.
