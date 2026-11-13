# Define one current connection per Owner and provider

Date: 2026-11-13

## Summary

An opt-in shared contract defines a stable logical Agent connection with multiple
independently authorized tasks. Explicit reviewed replacement preserves valid old
credentials until commit and keeps immutable actor/history records intact.

## Changes

- Add closed packaged schemas, deterministic Owner/provider slot identity, current
  vault fences, signed version-bound activation/disconnect controls and pure CAS plans.
- Bind the exact reviewed legacy inventory and retained task/resource selections;
  never automatically union production and synthetic scopes or issue grants.
- Keep disconnected generation tombstones and original operation identity; fence
  superseded credentials and compare uncertain retries without reinstalling keys.
- Document mandatory atomic consumer writes, independent candidate verification,
  grant/current-Run checks and backward-compatible, separately gated adoption.

## Validation

- Shared tests exercise real synthetic signatures, concurrent/stale versions, exact
  scope review, failed preparation, expiry, disconnect/reconnect and original retry.
- Normal pre-commit runs root `npm run check`; packaged JSON inclusion is checked.
- Existing wire formats and consumers are unchanged. No migration, business
  acceptance, resource provisioning or runtime/capacity configuration is enabled.
