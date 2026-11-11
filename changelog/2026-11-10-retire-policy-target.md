# Remove the unused standalone Policy target

Date: 2026-11-10

## Summary

Retire the unused standalone Policy service and its dedicated infrastructure.
Personal Agents continue through the existing Hub, Web and storage.

## Changes

- Remove the Policy application, tests, dependency/build files and Cloud Build
  configuration.
- Remove its Terraform resource/administrator roots and target-specific infra
  tests. Keep marked historical protocol/operation references and documentation
  locations; terminal registry ownership remains in the repository foundation.
- Perform no cloud resource operation or deletion of existing data/recovery state.

## Validation

- Root `npm run check`.
- Target registration excludes this removed executable tree; existing services,
  Web behavior, infrastructure and CI checks remain verifiable.
