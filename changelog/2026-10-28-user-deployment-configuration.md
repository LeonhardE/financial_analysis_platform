# Explicit User deployment configuration

Date: 2026-10-28

## Summary

Move User deployment-instance values into explicitly selected private configuration, retaining its
existing identity, strict authentication, database and deployment boundaries.

## Changes

- Require eight typed User instance inputs, deriving service/account imports and preserving fixed
  service names. Validate the regional same-project/repository image digest and distinct canonical
  HTTPS Web and Market origins; accept no arbitrary runtime environment configuration.
- Use the reviewed User projection for bootstrap runtime IAM references, Firebase metadata grant,
  artifact repository and existing image-trigger anchor. Register only User for trigger-sourced
  execution, and require explicit image-build region/repository substitutions.
- Remove the original production project from User's local environment example. Document private
  candidate compilation and complete no-change plan review, without provisioning resources.
- Preserve the default database and exact IAM conditions, Firebase token/revocation verification,
  credential-free Market client, closed Hub trust, service/revision caps and image/traffic ownership.

## Validation

- User service suite: 89 passed, using synthetic identities, temporary storage and mocked services.
- User Terraform mock plans: 24 passed, covering two synthetic instances, adoption guards,
  cross-instance images and invalid Web/Market origins.
- Backend-disabled Terraform validation, target formatting and diff checks pass.
- Full `npm run check` passed after rebasing onto the reviewed Repo configuration foundation,
  using Node 24 and the checksum-pinned Gitleaks executable. These checks perform no production
  plan/apply or cloud mutations.
