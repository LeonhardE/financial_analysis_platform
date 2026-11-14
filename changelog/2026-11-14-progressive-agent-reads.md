# Show Agent connections without scanning every task

Date: 2026-11-14

## Summary

Connection management displays one verified credential/provider snapshot without first decrypting
all tasks or recovering every policy and native plan. Route revisits retain the display snapshot,
and refreshes no longer occupy the explicit-operation lane.

## Changes

- Atomically pair provider slots/current credentials and keep prior verified data on read failure.
- Verify only exact current connections when slots exist; preserve bounded legacy verification,
  history, fresh vault checks and one local pending-journal read per eligible connection.
- Read only the explicitly opened legacy task; retain fresh grant/write checks and recovery paths.
- Cancel inactive/replaced display work, fence deletion/identity/visibility changes, and settle
  hard deadlines without retrying unknown writes or clearing their sealed originals.
- Remove the independent provider-slot hook and activate discovery only for its consuming views.

## Validation

- Deferred-response regressions cover atomic snapshots, two-worker bounds,32-row current-only
  verification, route reuse, cancellation, deadlines, mutation preemption and task deletion.
- Existing controller, UI, privacy and exact-original admission/recovery regressions retained.
- Production Web build and normal root checks before commit; exact-head CI before merge.
- Web only; existing automatic release must be Ready before the next ticket. No live acceptance,
  Agent-host operations, cloud resources, capacity or rollout changes.
