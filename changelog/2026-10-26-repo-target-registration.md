# Registered targets and guarded first-provision workflow

Date: 2026-10-26

## Summary

Make new backend delivery discoverable and independently testable without
extending a hardcoded three-service list or accidentally provisioning a service
through normal application publication.

## Changes

- Add a closed source-target registry containing only the three existing
  backends and Web. Validate source inventory, required files, safe paths and
  historical transitions; new targets start build-only in their own target PRs.
- Derive CI selection, backend job paths and isolated test suites from the
  registry. Reject empty/all-skipped suites and verify each selected matrix
  child's critical steps through current-attempt read-only Actions evidence.
- Make existing-service publication honor the registry and block enabled
  deployment for build-only targets before cloud access. Preserve existing
  GET/etag-PATCH behavior and404 refusal; bind enabled releases to exact images.
- Include the registry dependencies in saved-plan configuration hashes so an
  approved plan cannot silently execute a changed imported release-policy module.
- Add an offline first-provision request preparer/validator that binds successful
  build/source/trigger/configuration/image-digest material. Requests never grant
  approval; actual creation stays in reviewed target infrastructure saved plans.
- Add synthetic repository/Git/CI/release tests and an operator guide. No new
  service source, cloud resource instance, permanent IAM grant or infrastructure
  provisioning command is introduced.

## Validation

- CI, runner, registry and infrastructure tests use temporary repositories,
  generated fixtures and fake APIs without provisioning resources.
- Root `npm run check` and PR CI cover existing services, Web, repository checks
  and offline Terraform validation before merge.
