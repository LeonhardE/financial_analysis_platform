# Explicit Config deployment configuration

Date: 2026-10-28

## Summary

Move Config deployment-instance values into an explicitly selected private projection while
preserving its existing service, authentication, default database and deployment boundaries.

## Changes

- Require seven typed Config deployment inputs; derive service/account imports and validate the
  same-project/region/repository immutable Config image and canonical HTTPS Web origin.
- Read Config bootstrap runtime IAM references, Firebase metadata membership, artifact repository
  and existing build-trigger anchor from its reviewed projection, retaining existing resource
  addresses, filters and permission scopes.
- Register only Config for trigger-sourced execution and require explicit region/repository
  image-build substitutions. Update the target's private compilation and complete-plan guidance.
- Preserve strict Firebase authentication/revocation, owner isolation, default-database condition,
  service/revision caps, disabled new delegation trust and image/traffic ownership. Add no resources.

## Validation

- Existing Config service suite: 28 passed with synthetic storage/identity and mocked dependencies.
- Config Terraform mock plans: 23 passed, including two synthetic deployment instances, all three
  original adoption guard failures, invalid origins and mixed-instance image rejection.
- Backend-disabled Terraform validation, target formatting and diff checks pass.
- Full `npm run check` passed after rebasing onto the reviewed Repo configuration foundation,
  using Node 24 and the checksum-pinned Gitleaks executable. These checks perform no production
  plan/apply or cloud mutations.
