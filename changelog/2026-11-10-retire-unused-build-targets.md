# Retire unused build-only execution targets

Date: 2026-11-10

## Summary

Stop the unused Policy and Confidential VM Executor targets from becoming new
production services. Keep the existing Web, five backend services and storage.

## Changes

- Add terminal retirement metadata for build-only targets. Retired targets cannot
  provision or publish through existing-service release tooling.
- Preserve checks for all remaining executable source. Permit complete removal
  in later single-target PRs while keeping a registry tombstone and excluding
  removed sources from CI jobs.
- Reject reactivation, implicit identity deletion and retirement of an existing
  production target. No cloud resource is created, updated or destroyed.

## Validation

- Root `npm run check`.
- Registry/CI lifecycle checks, partial versus complete removal, and release
  rejection before any cloud call.
