# Complete checks for retired source removal

Date: 2026-11-10

## Summary

Let independently scoped retirement PRs delete old target directories without
making repository tests assume that every metadata tombstone has source files.
Remove the unused Confidential VM release preparation command.

## Changes

- Validate existing source only when present; retain terminal registry ownership
  and verify removed targets are excluded from executable CI metadata.
- Keep synthetic first-provision fixtures independent of actual retired-source
  counts, while proving that only their extra synthetic target was introduced.
- Remove the dedicated VM release utility and tests; preserve a retired reference
  guide and general supported-target release/saved-plan tooling.

## Validation

- Root `npm run check`.
- Repository and infrastructure unit suites in a disposable copy after removing
  both retired source/infra targets; no cloud access or resource deletion.
