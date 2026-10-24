# Adopt the existing Market infrastructure

Date: 2026-10-23

## Summary

Prepare the existing Market API and runtime identity for Terraform adoption without recreating
the service. Market gains its own state, execution identities and approved saved-plan workflow;
User, Config and Web remain disabled targets. Production adoption is deferred until review and merge.

## Changes

- Import the existing service and runtime identity into the Market root. Preserve the service UID,
  current settings, public invocation mode, service-wide instance cap and image/traffic ownership.
- Register only Market's guarded configuration controller. The first controller apply normalizes
  equivalent one-vCPU notation and creates a configuration revision, while retaining the live image
  and traffic. Subsequent image releases and pinned rollback retain their existing protocol.
- Adopt the existing Market image trigger and incremental IAM grants in administrator bootstrap.
  Give normal Market execution resource-scoped reads/configuration updates and only its own runtime
  attachment permission; keep trigger administration and IAM writes out of that identity.
- Add a read-only authenticated verifier, private local-state import plans, isolated contract tests
  and a documented post-merge rollout. Keep raw plans, state and environment-bearing inventory private.

## Validation

- `npm run check` passed, including eight Market adoption/controller/verifier boundary tests.
- Complete isolated Terraform checks passed: native mock contracts and historical/current
  image-release and pinned-rollback wire scenarios, including the new Market/root permission guards.
- Authenticated read-only plans passed: four administrative imports with no changes and 25
  Market-only additions; two business-root imports with no native changes and one local controller
  creation. Source-bound sanitized evidence is included in the Market root.
- Production service, IAM, runtime and trigger snapshots and remote bootstrap state were unchanged.
- No production Terraform apply, image release, traffic rollback or additional target activation is
  performed while preparing this change.
