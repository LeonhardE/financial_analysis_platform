# Root-approved cloud key archive removal

Date: 2026-11-03

## Summary

Add the Hub producer prerequisite for WEB-010 cloud key archive removal, retaining the existing vault identity, encrypted content and independent recovery path.

## Changes

- Add a bounded owner-only archive-deletion endpoint requiring the pinned root to sign exact archive/lifecycle and registry fences.
- Atomically remove the opaque archive and retain a root-verifiable deletion history plus immutable original receipt; retries cannot delete a newer archive or resurrect an old one.
- Verify the signed deletion history before accepting a null archive, prevent rebootstrap and ordinary rewrap/renewal restoration, and require a fresh independent recovery approval for restoration.
- Reserve two lifecycle slots for recovery and keep the existing cloud resources, permissions, deployment controls and Muse rollout gates.
- This Hub-only prerequisite does not expose a Web deletion control, reset a library, revoke devices or rekey historical data.

## Validation

- Full root `npm run check` passed, including all 515 discovered Hub tests and 54 targeted checks.
- Synthetic SQLite and real Firestore SDK transaction tests cover deletion/restoration, root and owner isolation, stale commands, response recovery, competing writes, null-archive corruption and lifecycle capacity.
- HTTP checks cover authentication, closed transport, request limits, signatures, no-store responses and exact route inventory.
