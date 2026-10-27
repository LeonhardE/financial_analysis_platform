# Limit Config runtime access to the default database

Date: 2026-10-26

## Summary

Prepare database-scoped access for the existing Config runtime while preserving Firebase Auth
metadata access. Merging this configuration does not apply cloud IAM.

## Changes

- Keep the existing Config IAM address, member and Datastore User role; add the shared fixed
  database type/name condition in scope-only mode, creating no duplicate IAM grant.
- Add create-before-destroy and the conditional import identity. Preserve Firebase Auth Viewer,
  execution guards, service configuration, UID, runtime, image and traffic.
- Document source-pinned sequential administrator migration after Market and User, including
  state adoption, complete saved-plan review, old broad tuple removal, recovery and rollback.
- Keep actual SDK default-database read/write/transaction checks and real cross-database denials
  as explicit rollout acceptance; no claims based only on mocks or nonexistent database 404s.

## Validation

- Bootstrap native mocked plans, Terraform format/init/validate, independent cross-review and
  root `npm run check` including existing Config tests pass.
- No apply, cloud permission changes, databases, identities or new cloud resources.
