# Independent executor trust contracts

Date: 2026-11-09

## Summary

Add an opt-in shared trust contract for independently authorized encrypted Agent
execution. Policy, Hub, executor and Web can adopt the same public verification
semantics in separate changes without altering P1 or existing persistent profiles.

## Changes

- Add matching packaged Python/browser closed schemas and pure verifiers for
  exact Root-approved identity, provider, workload, policy and recipient bindings.
- Bind short one-use purpose-specific leases to the authoritative current
  checkpoint, operation and challenge; reject stale, revoked or mismatched state.
- Separate original-key recovery statements, workload-only upgrades and explicitly
  approved next-epoch migration; retain immutable original operation/receipt binds.
- Add a separate checked dependency-free browser bundle, type declarations and
  integrity manifest, preserving the existing browser distribution and consumer pins; document runtime/transaction and key-possession obligations.
- Add public Node/JOSE vectors, Python-to-browser verification and negative cases.
  No consumer, credential issuer, production key, cloud resource or deployment is added.

## Validation

- Focused Python and browser trust-contract tests, including bidirectional JOSE
  verification, schema parity, rollback/revocation, recovery and migration attacks.
- Complete repository validation: `npm run check`.
