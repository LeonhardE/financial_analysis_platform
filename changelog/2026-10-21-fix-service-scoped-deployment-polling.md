# Check Cloud Run deployment status with service-scoped access

Date: 2026-10-21

## Summary

The first automatic deployment submitted its Cloud Run update, then failed with HTTP 403 while
polling a separate regional operation resource. Check readiness through the service resource so
the documented service-scoped build-account permissions remain sufficient for status checks.

## Changes

- Poll the Cloud Run service after an accepted update instead of requesting the operation URL.
  Keep immediate operation errors, service permission errors, and startup failures visible.
- Require the expected build, revision and image, completed reconciliation, matching generations,
  and 100% observed traffic before reporting success. Pending or inconsistent state times out.
  Accept short and full revision names, including canonical project-number references in status.
- Report a failed new revision even when the previous revision is still serving. Preserve etag
  and newer-build guards, and avoid a duplicate update after a stale read of an accepted deployment.
- Make the deployment test double reject operation requests and model real asynchronous service
  state, including old readiness, failure, traffic changes, concurrent builds, and timeouts.

## Validation

- `npm run check`: 30 web, 70 backend and 22 deployment tests pass, along with types, lint, and
  formatting. Deployment coverage includes 14 additional regression tests.
- Read-only production checks confirm the new watchlist route and page are serving; public daily
  data and search respond successfully, unauthenticated watchlist access returns 401 with
  `no-store`, and the PUT CORS preflight succeeds.
- A successful cloud build using this fix still needs verification after the fix PR merges.
