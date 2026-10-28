# Explicit Market deployment configuration

Date: 2026-10-28

## Summary

Move Market deployment-instance values into an explicitly selected private configuration, while
retaining the existing service, runtime identity, database, public access and cost boundaries.

## Changes

- Require one typed Market deployment object for project, region, repository, runtime account,
  creation-image digest, inventoried service UID and Web origin. Derive declarative import IDs
  from the same values; reject malformed inputs and cross-project/region/repository images.
- Consume the reviewed Market projection for its bootstrap runtime/IAM references, artifact
  repository and existing build-trigger identity. Register only Market for trigger-sourced
  deployment configuration, and remove owner-specific image-build substitution defaults.
- Preserve service names, adoption guards, instance caps, default-database scope, image/traffic
  ownership, keyless identities and all existing release/plan protections. Provision no resources.
- Document private candidate compilation and full, unchanged-state plan review requirements.

## Validation

- Market Terraform mock plans: 25 passed, including two synthetic project/region/repository/runtime
  combinations, existing UID/access/cap rejection cases and malformed or mixed-instance inputs.
- Target Terraform formatting and validation pass with the backend disabled.
- Full `npm run check` passed after rebasing onto the reviewed Repo configuration foundation,
  using Node 24 and the checksum-pinned Gitleaks executable. These checks perform no production
  plan/apply or cloud mutations.
