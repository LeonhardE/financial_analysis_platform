# Restore the automatic User deployment interpreter

Date: 2026-11-03

## Summary

User's automatic deployment step depended on a system `python3` executable in the moving
Cloud CLI `slim` image. Use the verified official builder's bundled interpreter so the existing
release guard can start reliably.

## Changes

- Pin only the User deployment step to the official Google Cloud CLI image digest and select
  its bundled Python with an absolute path.
- Keep release arguments, the guard, deployment enablement, runtime identity, IAM and trigger
  configuration unchanged.

## Validation

- Mandatory root `npm run check` through the pre-commit hook, including existing infrastructure
  and guarded deployment regression tests.
- YAML and documentation formatting checks. The official image and bundled interpreter reuse
  the independent OCI and real-builder smoke verification from this compatibility rollout.
