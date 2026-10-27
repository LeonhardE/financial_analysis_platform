# Prepare isolated Agent Hub infrastructure without provisioning

Date: 2026-10-27

## Summary

Register Agent Hub as an inactive infrastructure target and provide the independently reviewable
configuration for its future execution, first service creation and post-creation IAM stages.
Merging the preparation does not create cloud resources or activate agent features.

## Changes

- Add a disabled target with an independent future state bucket and stable execution addresses.
- Gate administrator-owned execution/build resources and later service/database/Rules IAM behind
  explicit additive stages; keep image builds deployment-disabled with no runtime impersonation.
- Compose protected runtime, named database and private scale-to-zero Cloud Run service from the
  existing modules, using only nonsecret configuration and a digest-pinned creation image.
- Deny client SDK access to the named database separately from exact-database server IAM. Keep
  content keys, signing keys, speculative collections/indexes and agent functionality out of scope.
- Include database operation polling only in the exact-database apply metadata role so the
  pinned provider can wait for a metadata PATCH; keep plan read-only and defer actual async
  authorization verification until real provisioning.
- Document full preparation plans, provenance approval, first-create ordering and later live checks.

## Validation

- Native credential-free Agent Hub and bootstrap stage plan tests.
- Full saved-plan review and root repository checks are recorded with the PR; no apply is run.
