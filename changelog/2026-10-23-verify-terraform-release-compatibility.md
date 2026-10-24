# Verify Terraform ownership against image releases and rollback

Date: 2026-10-23

## Summary

Reproduce the pinned Cloud Run provider's release-ownership hazards before adopting any production
service. Validation identifies blockers rather than silently weakening lifecycle management or
claiming that an ignore list makes concurrent Terraform and image updates safe.

## Changes

- Run the real locked Google provider against a localhost wire fixture to inspect image, revision,
  traffic and etag behavior across releases, configuration changes, saved plans and rollback.
- Integrate expected-blocker regression checks into the existing credential-free Terraform CI.
- Add a separate explicit Cloud Shell live reproduction using existing image digests and a unique
  temporary private service and keyless account, with identity-checked cleanup and private reports.
- Document the remaining ownership choices. Keep production adoption gated; existing service
  modules, image release behavior, resource instances, IAM and execution targets remain unchanged.

## Validation

- Root `npm run check` passed, including 17 live-runner safety unit tests.
- All 56 native mocked Terraform tests and five real-provider localhost blocker reproductions passed.
- Live Cloud Run evidence is recorded separately from offline wire tests; offline results do not
  certify GCP IAM or reconciliation behavior.
