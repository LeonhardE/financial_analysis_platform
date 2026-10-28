# Repo consumes explicit operator deployment configuration

Date: 2026-10-28

## Summary

Migrate only repo execution to the verified trigger deployment contract while
retaining its state address, identities, source protection and saved-plan flow.
Other targets keep their existing deployment configuration and activation.

## Changes

- Require a closed repo `deployment` input with a valid project ID instead of an
  original-author default; mark only the repo catalog entry as `trigger-v1` and
  remove its derived instance fields.
- Require explicit bootstrap project/region/source bound to the repo projection;
  pin the same JSON and SHA in the two existing repo triggers, preserving main
  source and native approval.
- Adapt bootstrap catalog guards and default-no-op shared wiring for explicitly
  opted-in targets; keep all legacy state, identity, trigger and lock checks.
- Supply shared test-only target projections and explicit bootstrap fixtures,
  test two synthetic repo projects and reject mixed/missing/unknown inputs.
  Non-repo projections remain unused by current legacy instances. Document
  complete-plan constraints.
- Keep the cross-target state and ownership smoke tests meaningful when repo
  instance fields leave the static catalog, using explicit verified test inputs.

## Validation

- Pinned Terraform 1.16.7: all 5 provider-free repo tests and 29 bootstrap
  provider-mocked tests pass in an isolated source-only snapshot with the shared
  prerequisites. No operator configuration or state is copied into that snapshot.
- All six test-only projections pass the runtime closed-schema/canonical/size
  parser; Terraform formatting, changed Markdown/JSON formatting and Git diff
  checks pass. Nine state/ownership/adoption regressions also pass.
- Separate read-only, state-backed production review plans preserve the repo
  root with zero changes and limit bootstrap changes to the two existing repo
  triggers. No resources are created or deleted, and no apply is performed.
