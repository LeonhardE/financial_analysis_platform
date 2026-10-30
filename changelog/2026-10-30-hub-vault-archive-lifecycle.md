# Root-approved vault archive maintenance and recovery approval

Date: 2026-10-30

## Summary

Add owner-and-root-authorized Hub APIs for opaque archive maintenance, Passkey-change intent,
single-use recovery approval/revocation and immutable operation receipt recovery.

## Changes

- Bind every mutation to the existing owner/root, archive and lifecycle versions, target
  ciphertext digest, registry fence, stable operation and short validity window.
- Keep current root/source/directory formats and versions while atomically replacing the
  opaque archive alongside a bounded root-approved lifecycle history.
- Return original receipts on exact retries without restoring old archives or approvals.
- Preserve the encrypted-content boundary; independent recovery material and Passkey ceremonies
  remain client responsibilities. No server decryption, root replacement or cloud change is added.

## Validation

- All 38 focused synthetic lifecycle/HTTP/Firestore tests pass, including an actual AES-GCM
  root rewrapping round-trip and atomic transaction races.
- Complete root `npm run check` passes: 389 Hub tests, 458 Web tests and existing backend,
  infrastructure and CI suites. The existing Common suite retains one optional interop skip.
