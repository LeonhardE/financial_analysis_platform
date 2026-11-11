# Pin backend-distributed client test runtime

Date: 2026-11-11

## Summary

Give isolated backend checks the same explicit Node.js runtime used by repository
and Web checks before running their distributed-client interop tests.

## Changes

- Set up Node.js 24.12.0 in each isolated service check instead of depending on the
  hosted runner's incidental default installation.
- Preserve independent Python dependency installation, image builds and isolated
  health checks; no deployment workflow changes.

## Validation

- Root `npm run check`.
- CI workflow selection/aggregation and current backend client interop suites.
