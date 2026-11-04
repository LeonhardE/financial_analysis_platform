# Restore tooling builder Python compatibility

Date: 2026-11-03

## Summary

The official Cloud CLI slim image no longer provides system python3 on PATH. Pin the verified
builder digest and invoke its bundled interpreter so the existing tooling steps can start.

## Changes

- Change only this target's builder image and Python entrypoint, plus its operating documentation.
- Preserve all arguments, guards, identities, permissions and approval requirements.

## Validation

- Repository-root npm run check and existing infrastructure regressions.
- Exact OCI hashes/executable inspection and real Cloud Build Python, Google TLS and gcloud checks.
- Read-only saved-plan generation and approval-gate checks; no infrastructure apply is authorized by this configuration change.
