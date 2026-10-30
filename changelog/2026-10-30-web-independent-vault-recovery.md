# Passkey replacement and independent encrypted recovery

Date: 2026-10-30

## Summary

The Web encrypted-library settings can replace the current Passkey and export/import an
independent encrypted recovery file with a separately retained random recovery code. The existing
Hub lifecycle APIs receive root-approved ciphertext; the original root and encrypted resources
remain usable.

## Changes

- Add owner-fenced recovery UX, fresh-credential PRF confirmation and explicit new-device approval.
- Keep root/recovery private material in the Worker and clear transient export state on lock,
  logout and account changes.
- Add precise lifecycle BFF routes and bounded closed response validation without widening the
  generic proxy or accepting a device-author override for root-approved operations.
- Verify complete signed lifecycle history and local high-water marks. Persist the exact encrypted
  candidate before HTTP, recover original receipts and resume using the new Passkey after reload.
- Rewrap the eligible local device seal; block unresolved private drafts/operations and guard
  cross-tab writes with an atomic transition fence and the current archive binding.
- Document recovery limits, including retained old recovery material and future root renewal/rekey.

## Validation

- Synthetic crypto, storage, hook and UI tests; actual existing Hub SQLite producer interoperability.
- Web typecheck, root checks and production build recorded in the delivery evidence before merge.
- No cloud configuration changes or new resources.
