# Prepare isolated Portfolio infrastructure

Date: 2026-10-27

## Summary

Register inactive Portfolio infrastructure and explicit administrator stages so first creation can
be planned independently without creating resources or enabling deployment when this change merges.

## Changes

- Add the Portfolio business root with a dedicated keyless runtime, protected named Firestore
  database and private, bounded Cloud Run service using the existing shared modules.
- Keep the pipeline disabled and administrator stage at none; stage execution/build boundaries
  separately from post-creation service/runtime/database IAM and deny-all client Rules.
- Preserve build-only release guards, pin an exact Portfolio digest candidate for noninteractive plans, and document source
  provenance, single-target plan review, remote-state setup and post-creation isolation checks.
- Include exact-database operation polling only for apply after metadata updates; plan remains
  metadata-only, without content or operation-management permissions.
- Configure no content keys, brokerage secrets, KMS decryptor, application storage schema or public
  invocation. Index/TTL changes and release activation remain later scoped work.

## Validation

- Native provider-mocked plans cover inactive defaults, execution/service stages, narrow permissions,
  named-database client denial and invalid image inputs.
- Complete native plan previews and repository checks are recorded with the delivery evidence;
  no apply or cloud provisioning is part of this change.
