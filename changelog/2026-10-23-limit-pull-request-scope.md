# Keep implementation PRs within one service or frontend

Date: 2026-10-23

## Summary

Future implementation PRs isolate one backend service or the frontend so changes can be
reviewed, merged, and deployed independently.

## Changes

- Record the single-target PR rule in `AGENTS.md`, including related tests, dependencies,
  deployment configuration, documentation, and changelog requirements.
- Keep shared foundations and repository-wide infrastructure or workflow changes in separate
  PRs without consumer changes.
- Require ordered, backward-compatible PRs for work spanning multiple components.

## Validation

- `npm run check`: passed.
