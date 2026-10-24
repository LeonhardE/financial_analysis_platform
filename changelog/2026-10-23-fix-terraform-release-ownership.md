# Preserve image releases and traffic rollback during Terraform configuration

Date: 2026-10-23

## Summary

The native Google provider can replay an older saved image and traffic configuration without an
etag. Separate create/adopt ownership from conditional configuration writes so infrastructure
changes retain the current release and any explicitly pinned rollback route.

## Changes

- Keep native service creation/adoption, identity and deletion protection; disable native updates.
- Reconcile desired configuration through a stable Terraform data controller that reads current
  release state at execution, verifies UID and uses conditional etag writes with bounded retries.
- Preserve live image, traffic, release markers and supported unowned template/container settings;
  assign a fresh configuration revision name and verify owned settings after apply.
- Detect external owned configuration drift and require explicit reviewed controller repair.
- Support attested configuration descendants in release readiness polling; retain existing short
  revision names and fit long service names within the Cloud Run API limit.
- Bind executable helper sources into reviewed-plan fingerprints. Keep execution-target policy,
  bootstrap IAM and production consumers unchanged; document the later target adoption gates.
- Retain five frozen native-provider blocker cases and add five actual-module ownership wire cases,
  concurrency/failure unit coverage and an opt-in isolated authenticated verifier.

## Validation

- `npm run check`.
- Pinned Terraform 1.16.7 / Google provider 7.28.0 module tests and both five-case wire suites.
- Authenticated isolated GCP saved-plan/release/rollback results are recorded in the compatibility
  guide and its sanitized evidence report; raw state, plans, values and credentials stay private.
- Concurrency conflicts are injected offline; the real GCP sequence is sequential and does not
  validate future per-service registered execution targets or Cloud Build triggers.
