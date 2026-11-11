# Owner credential restoration history

Date: 2026-11-11

## Summary

Keep prior public consent reachable after credential replacement so Owner
reauthorization can restore reviewed scope without an old Agent or browser file.

## Changes

- Atomically retain a predecessor descriptor with each new credential, validating
  managed generation/fingerprint links and original legacy migration provenance.
- Add bounded Owner-only historical source reads, preserving original identities,
  approvals, revocations and operation receipts under their original namespace.
- Keep reads separate from fresh execution permission and expose historical state
  explicitly; no private-key recovery service or new cloud resource.

## Validation

- Root `npm run check`.
- Multi-generation unfinished renewal, expiry, legacy migration, wrong Owner and
  corrupt link negatives; actual Firestore SDK conflict retry/atomic writes and
  closed Owner transport tests.
