# Scoped Firestore runtime IAM guidance

Date: 2026-10-27

## Summary

Deployment guidance now requires the exact database IAM condition used by the existing
firestore-access module, instead of directing operators to unconditional project-wide data access.

## Changes

- Align the root and GCP guides with fixed database resource-type/name conditions and existing
  single-owner Terraform grants.
- Explain additive/inherited permissions, server SDK versus browser Rules, and the remaining
  collection-level exposure of the legacy shared database.
- Require actual SDK permission checks against existing databases, preserving separate
  authorization for provisioning or data migration. No IAM resources or runtime settings change.

## Validation

- Checked examples and database boundaries against the current module and target definitions.
- Root `npm run check` validates repository documentation and the existing regression suites.
