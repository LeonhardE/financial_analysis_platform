# Restore Config automatic release compatibility

Date: 2026-11-03

## Summary

The official Cloud CLI slim image removed system python3 from PATH. Pin the reviewed immutable
builder and use its bundled interpreter so the Config deployment guard can start normally.

## Changes

- Change only Config's deployment builder image and Python entrypoint; document image upgrades.
- Preserve all existing release arguments, guards, identities, permissions and runtime settings.

## Validation

- Repository-root npm run check and existing deployment guard/infrastructure regressions.
- Exact official OCI inspection and real Cloud Build Python, Google TLS and gcloud verification.
- Normal automatic Config deployment followed by source, digest, runtime, IAM and traffic checks.
