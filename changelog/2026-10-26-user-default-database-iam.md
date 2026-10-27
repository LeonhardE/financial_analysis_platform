# Limit User runtime access to the default database

Date: 2026-10-26

## Summary

Prepare the existing User Datastore User membership for exact default-database access. Production
IAM remains unchanged until a separately reviewed administrator migration is authorized.

## Changes

- Reuse the scope-only shared database condition at the existing User IAM address, keeping its
  role/member and Firebase Auth Viewer permission. No duplicate grant or database is created.
- Add create-before-destroy and the final conditional import identity; document existing-state
  adoption, deposed membership recovery and removal of residual broad permissions.
- Require the accepted Market migration first, then a full single-target saved plan pinned to
  this User change. Preserve normal execution guards, service settings, image and traffic.
- Document actual runtime read/write/transaction and later real cross-database denial checks,
  with narrowly scoped rollback. Source/mock success is not deployed isolation.

## Validation

- Bootstrap native mock plans, User adoption tests and existing User service tests pass.
- Root `npm run check`, Terraform format/init/validate and independent cross-review pass.
- No apply, cloud permission changes or new resources; actual IAM migration/SDK checks remain
  rollout acceptance.
