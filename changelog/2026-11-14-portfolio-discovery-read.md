# Combine Portfolio discovery metadata reads

Date: 2026-11-14

## Summary

Provide one bounded read for the state and projection metadata that resource discovery previously
requested separately, avoiding a second service round trip and repeated storage/authority work.

## Changes

- Add delegated `POST /internal/v2/resources/discovery/read` for one to ten distinct resource
  references, returning the existing state and eligible projection views from one transaction.
- Preserve both credentials, owner partition, incarnation and current authority/lifecycle checks.
  Historical-epoch and non-active projections are omitted explicitly; an eligible empty source
  still has its original null snapshot pointer. Storage/reference failure refuses the entire batch.
- Keep original state/projection routes and their failure behavior for independent rollout.

## Validation

- Signed API regressions cover original-view equality, owner/incarnation boundaries, missing
  authority, non-active lifecycle states, stale epochs, credential/scope and transport budgets.
- Real Firestore SDK tests verify one batch for 1, 2 and 10 sources in request order, with no writes.
- Complete Portfolio suite and repository checks are required before commit.
