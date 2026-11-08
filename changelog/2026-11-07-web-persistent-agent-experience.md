# Continuing Muse access and a shared private workspace

Date: 2026-11-07

## Summary

Add the gated owner experience for connecting Muse once, reviewing continuing
resource access and using encrypted reports with the existing shared unlock.
Real account permissions and persistent feature gates remain unchanged.

## Changes

- Add native account handoff and explicit runtime enrollment, selected task/resource
  review, withdrawal, disconnect and exact pending-operation recovery.
- Reconcile only already-approved resources and already-assigned tasks while the
  owner is unlocked; keep manual-source publication IDs stable for unchanged data.
- Reuse the existing owner session for all cryptography. Mask private state and
  fence delayed requests on account, unlock-generation and visibility changes.
- Display requested schedules, verified Agent statements and actual Hub receipts
  separately. Place technical connection details behind disclosure controls.
- Add encrypted persistent reports to the Inbox route with safe rendering and
  closed read/star/archive writes; preserve foreground history access.

## Validation

- Independent Python/Node encrypted flow including native plan proof tampering.
- Actual Worker state signing, original outbox recovery, controller interruption,
  source-race, session-fencing and bilingual presentation tests.
- Full repository `npm run check` before commit; Web production build in CI.
