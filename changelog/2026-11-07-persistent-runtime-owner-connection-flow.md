# Persistent Agent runtime and native account connection pages

Date: 2026-11-07

## Summary

Add the gated runtime that restores a persistent Agent profile and consumes reusable
resource permission, without repeating owner authorization for ordinary versions.

## Changes

- Add a closed Worker/controller for verified task/resource reads, immutable Runs,
  current-owner encrypted reports, original-ciphertext retries and receipt recovery.
- Add a fixed native account page with exact owner origin/source/nonce binding and
  transient credentials restricted to two first-party account-link operations.
- Include public root/identity descriptors in bootstrap links for partial-flow recovery.
- Compute stable native schedule slots across retries, midnight grace and DST folds;
  retain explicit pending status until actual Muse installation/observations exist.
- Serve only fixed allowlisted, integrity-checked assets behind default-off gates.

## Validation

- Real WebCrypto runtime against synthetic Python Hub transactions: first Root pairing,
  restored identity, decryption, Run/report flow, lost response, restart, exact retry,
  source version advance without new consent and independent owner report decryption.
- Resource revocation blocks new work while original result receipts remain available.
- Actual Worker rejects raw crypto/storage/network RPC; native bridge rejects wrong
  origin/source/nonce/operations/callbacks and never returns OAuth codes or credentials.
- Fixed distribution, default-off routes, time-zone/grace/DST and legacy setup checks.
- Full repository `npm run check` before commit. Real Muse and cross-day acceptance follow.
