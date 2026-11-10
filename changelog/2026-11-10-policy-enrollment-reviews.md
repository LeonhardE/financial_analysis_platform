# Owner enrollment and original-key certificate reviews

Date: 2026-11-10

## Summary

Provide an authenticated, fixed-purpose Policy review producer so an Owner client
can verify original public enrollment evidence before certifying the first keys.

## Changes

- Reconstruct pending/final statements and verify Root controls, original distinct
  public keys/CSR, Google production proof and actual current VM against the pinned
  domain and current witness, including when issuance/release remain off.
- Sign only bounded, short-lived public review receipts; never expose a generic
  signer, initialize state, mutate enrollment or unwrap secret material.
- Validate exact original-key certificate chains, with a separate current-binding
  renewal review that still requires fresh Root control and publication.

## Validation

- Synthetic pending/final, tampering, wrong Owner/domain, unavailable witness,
  issuance-off, HTTP boundary and current-key certificate review tests.
- Complete service suite and required root `npm run check`; exact-head CI before merge.
- No actual proof, CA request, cloud configuration, deployment or online validation.
