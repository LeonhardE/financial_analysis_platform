# Durable manual task execution

Date: 2026-11-13

## Summary

The optional task center can retain a signed Owner request for selected current Agents, let each Agent pick it up independently, and recover the same Run after a retry or client restart. An accepted request is waiting for pickup; it does not imply native dispatch or execution.

## Changes

- Bound requests to current task, assignment, credential and lifecycle versions with a ten-minute pickup deadline and a sixteen-request queue. Cancel before pickup, retain original receipts, and keep manual and calendar namespaces independent.
- Persist per-Agent waiting, running and result stages. Task deletion cancels waiting requests and fences in-flight results; restoring history never replays old requests.
- Distribute private client 1.2.0 with authenticated pickup, signed intent verification, lifecycle control verification and durable retry recovery. Preserve the original 1.0.0, 1.0.1 and 1.1.0 pinned artifacts.
- No automatic wakeup, native schedule attestation, rollout flag, online run or new cloud resource is introduced. Existing unverified schedule provenance stays unknown.

## Validation

- Synthetic signed request, cancellation race, FIFO isolation, deadline, trash/restore and result attribution tests.
- Actual distributed client against synthetic Hub transactions, including a dropped response, process restart and forged control rejection.
- Full repository check before commit and exact-head CI before merge.
