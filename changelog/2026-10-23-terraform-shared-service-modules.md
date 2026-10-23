# Reusable Terraform modules for individual service infrastructure

Date: 2026-10-23

## Summary

Provide tested shared building blocks before adopting each service or client in its own
infrastructure PR. Existing application infrastructure and the live repo execution target remain
unchanged; this change creates no cloud resources and needs no bootstrap or apply.

## Changes

- Add one-container Cloud Run configuration with private invocation and request-billed scale-to-zero
  defaults, digest-pinned images, numeric Secret Manager references and explicit resource limits.
- Add keyless runtime identity management with optional resource-scoped secret access and deployer
  Service Account User grants, without generic project IAM, credentials or secret payloads.
- Add main-only, path-filtered Cloud Build trigger configuration using an existing connection and
  build identity; default to disabled and build-only mode.
- Pin each module's provider lock and add native mocked contract tests automatically discovered by
  the existing Terraform CI, including first-create composition with computed account and Secret
  references behind stable IAM map keys. Document imports, resource ownership and the separate release/rollback/
  concurrency compatibility gate required before production Cloud Run adoption.

## Validation

- `npm run check` passed.
- Pinned Terraform recursive formatting, backend-disabled readonly initialization, validation and
  all 56 native mocked tests passed: 48 new module/composition cases and 8 existing foundation cases.
- No cloud plan, import or apply; no application service or frontend changes.
