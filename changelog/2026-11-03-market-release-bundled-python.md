# Restore the Market automatic release interpreter

Date: 2026-11-03

## Summary

Restore the Market deployment container's entrypoint after the official Cloud CLI slim image
stopped providing a system `python3` executable on `PATH`.

## Changes

- Pin only the Market deploy step to the verified official immutable image digest and invoke its
  bundled Python interpreter by absolute path.
- Document interpreter compatibility and the existing release gates. Deployment arguments, the
  shared release guard, workload identity, IAM and trigger configuration remain unchanged.

## Validation

- Reuse the exact official OCI image inspection and successful Python/TLS/gcloud runtime smoke.
- Run repository-root `npm run check` through the required commit hook.
- Verify the normal post-merge automatic build and exact ready image/traffic independently.
