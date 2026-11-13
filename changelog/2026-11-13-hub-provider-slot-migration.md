# Add reviewed unique-provider connection cutover

Date: 2026-11-13

## Summary

The existing Hub can atomically install one current logical connection per Owner
and Agent provider after exact Owner review, retaining immutable actor history.
Compatible producer APIs remain default-off; no account is automatically migrated.

## Changes

- Combine existing signed credential installation, intent consumption, unique-slot
  CAS, exact legacy retirement and original receipt in one existing-store transaction.
- Preserve valid old state on failure; fence superseded generations and reject
  legacy approval bypasses even when the feature gate is later disabled.
- Keep selected tasks/resources as an exact fresh-grant restoration plan, never
  union permissions; report unsupported legacy/cross-vault records as explicit blockers.
- Add Owner-only capabilities/state/commands/receipt routes and an optional Owner
  source SDK without changing pinned native bundles or old wire formats.

## Validation

- Real synthetic signature/native-setup/SQLite tests cover concurrent connections,
  rollback, exact retry, different-actor retirement, disconnect and scope boundaries.
- Closed HTTP/default-off behavior and SDK paths/original-body/no-auto-retry tests pass.
- Normal pre-commit runs full root `npm run check`; no production business validation,
  account migration, schedule change or resource/capacity provisioning is performed.
