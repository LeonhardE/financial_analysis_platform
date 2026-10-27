# Limit Market runtime access to the default database

Date: 2026-10-26

## Summary

Prepare the existing Market Datastore User membership for database-scoped access before private
data domains are introduced. This source change does not apply production permissions.

## Changes

- Keep the existing administrator-owned IAM address, member and role; derive its fixed database
  type and exact `(default)` name condition from a scope-only shared module with zero IAM grants.
- Create the conditional membership before removing its old unconditional predecessor. Update the
  final conditional import identity without silently remapping existing state.
- Document separate administrator inventory, adoption, source-pinned single-target saved plans,
  migration, read/write/transaction checks, cross-database denial checks and narrowly scoped
  rollback. Ordinary Market execution still rejects IAM deletion/replacement.
- Leave service identity, UID, image, traffic, application behavior and other targets unchanged.

## Validation

- Bootstrap mock plans and native format/validation pass; assertions cover exact database scope
  and zero duplicate grants. Market runner regression rejects both replacement orders/deletion.
- Root `npm run check` passes, including existing Market tests.
- No apply, cloud permission mutation or new cloud resources. Effective IAM and actual runtime
  SDK checks remain rollout acceptance, with named-database denial pending real target creation.
