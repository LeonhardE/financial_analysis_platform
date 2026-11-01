# Add recoverable holdings lifecycle controls

Date: 2026-11-01

## Summary

Owners can explicitly invalidate previous holdings access, disconnect a source or hide its history,
reviewing the effects before confirmation. Interrupted operations resume their original request.

## Changes

- Add translated source selection, lifecycle confirmation/recovery and independent-source creation.
- Persist public signed packets before sending, preserve original source IDs, and reconcile exact
  receipts without re-signing or clearing another tab's operation.
- Guard account-scope changes, unknown state, concurrent fences, terminal sources and stale responses.
- Keep source mutation/upload staging atomic; allow historical recovery after key renewal and bound
  local obsolete-request cleanup to proof that the original request can no longer commit.
- Add the closed Portfolio synchronization bridge and correct operation-ID handling for receipt reads.

## Validation

- Targeted Worker/crypto/IndexedDB, owner bridge, controller and bilingual UI regressions.
- Local desktop/narrow-screen synthetic previews; real owner/workload acceptance remains separate.
- Root `npm run check`, production build and exact-head CI are required for delivery.
