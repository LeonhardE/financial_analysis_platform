# Select CI checks by service and client

Date: 2026-10-23

## Summary

Frontend-only PRs no longer install or test backend services. Each service change validates that
service, while shared Python changes validate all backend consumers. The existing required
`Quality checks` name remains the final merge gate.

## Changes

- Detect PR changes against the actual base branch and main pushes against their previous commit,
  including both sides of renames and safe full-check fallbacks when comparison is unavailable.
- Run frontend types, behavior tests and the production build only when Web is affected. Run lint,
  isolated shared/service suites, an independent Docker build and runtime health check for each
  selected backend, using only that service's development dependencies.
- Keep repository formatting and CI routing tests as common checks, and select deployment guard
  tests for infrastructure/tooling changes. Preserve the full local `npm run check` command.
- Aggregate actual job results and reject failed, cancelled or unexpectedly skipped selected checks;
  documentation-only PRs complete without application builds.
- Document path ownership and the separation between GitHub validation and existing Cloud Build
  deployment triggers. No cloud resource or application behavior is changed.

## Validation

- 29 CI routing, aggregation and suite-runner unit tests passed, including single-target, shared,
  rename, deletion, stacked PR, push and comparison-fallback scenarios.
- `npm run check` and `npm run build:web` passed.
- `actionlint` v1.7.12 passed; a clean root-only dependency install excluded frontend dependencies.
- GitHub Actions validates the workflow and builds/smoke-tests the selected service images.
