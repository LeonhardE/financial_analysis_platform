# Owner original-key enrollment preparation

Date: 2026-11-10

## Summary

Add an explicit administrator workflow to the already unlocked Owner client for
original-key setup and certificate renewal. Root/device private keys stay in the
existing Worker; public preparation does not perform deployment or CA operations.

## Changes

- Validate the selected public Policy domain and exact creation draft before
  signing only bootstrap/initialize/finalize/register/certificate purposes.
- Verify fresh Policy review receipts, certify the original Agent keys, derive the
  actual device binding and native directory hash, and preserve exact prepared
  packets for uncertain-outcome replay within the bounded ceremony.
- Add a collapsed, confirmed public-file workflow and explicit later review and
  registration/renewal publication. Lock/reload/expiry stops setup without an
  identity reset. No private material is stored in the page or exported.
- Extend only the named Policy review/control and Executor binding proxy grammar;
  preserve separate approval/scope bodies and closed registration receipts.

## Validation

- Synthetic actual Worker crypto flow, wrong domain/expiry/Root/scope, native hash,
  certificate-only controls, registration digest, proxy boundaries and UI gating.
- Type checking, full Web suite and required root `npm run check`; exact-head CI
  before merge. Production automatic Web release stays explicitly paused.
- No real Root, registration, proof, CA request, deployment or online validation.
