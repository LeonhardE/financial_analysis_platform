# Persistent resource consent, normal versions and revocation contracts

Date: 2026-11-07

## Summary

Add the shared prerequisite for approving logical resources once and covering
normal later versions, with explicit historical selections and independent
per-resource revocation. Keep short-lived credentials and task execution separate.

## Changes

- Package opt-in closed DTOs and real-signature verifiers for incremental root
  approval, exact version/digest CAS, deterministic public state and terminal
  per-resource revocation under one stable Agent identity.
- Permit committed normal versions from the approval floor onward; require
  explicit selected older history and a fresh permission ID for later reapproval.
  Recheck source incarnation/epoch/state and current identity/key authority.
- Preserve unaffected permission epochs when other resources change. Retain
  revoked IDs, bound state/control/history sizes and reject stale or widening
  substitutions without partially mutating caller state.
- Keep legacy P1 and stable identity contracts, OAuth/certificate deadlines,
  service/Web consumers and infrastructure unchanged. Storage, original receipts,
  verified client control chains and execution remain separate consumer work.

## Validation

- Real-signature resource/version/history, partial revocation, source/identity
  fencing, current-state substitution, root/device authority separation, expiry, bounds
  and legacy-profile tests.
- Complete root checks and isolated wheel packaging/schema resolution.
