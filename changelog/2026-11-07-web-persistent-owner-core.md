# Persistent owner cryptography and sealed operation recovery

Date: 2026-11-07

## Summary

Add the trusted Web Worker operations needed for lasting Agent resource permissions and encrypted
report history, reusing the existing signed-in owner's unlock.

## Changes

- Independently bind enrollment offers and continuing resource permissions to the selected
  connection, client, owner and pinned Root. Sign resource/task publications from verified existing
  owner content, and verify historical reports against their original Run and directory proofs.
- Keep keys in the existing owner Worker. Persist only sealed original operations before transport;
  block replacement attempts and clear pending data only after checking the corresponding receipt.
- Recognize an already committed, Root-authenticated resource publication without sending conflicting
  replacement ciphertext. Keep key renewal and archive changes blocked by unresolved operations.
- Include the shared browser library in the Web build and Worker compatibility hash. These internal
  operations do not activate persistent Muse connections or change the current product interface.

## Validation

- Real Worker dispatch and IndexedDB exercise one-unlock enrollment, sealed restart recovery,
  receipt substitution rejection and archive/key-change fences.
- Independent Node/Python owner/Agent transactions cover enrollment, continuing permission, version
  advancement, withdrawal, unknown report outcomes and retained report decryption; substituted
  actors, resources, ciphertext and result IDs are rejected.
- Existing encrypted browser behavior, type checking and required full repository checks.
