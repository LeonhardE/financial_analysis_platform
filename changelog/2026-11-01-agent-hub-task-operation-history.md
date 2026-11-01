# Read original saved tasks by owner operation ID

Date: 2026-11-01

## Summary

Owners can confirm that a specific task operation was saved even after its author certificate
expires. The new read-only endpoint returns the existing historical encrypted task, allowing
clients to inspect the original result without replaying or signing a write.

## Changes

- Add owner-only `GET /api/v2/tasks/{taskId}/operations/{operationId}` with the existing
  `EncryptedTask` response and operation identifier rules.
- Bind the persisted operation to its owner/vault/task/version/author and signed stable operation
  ID, validating immutable task history in the same read-only transaction. Missing operations are
  `404`; corrupt or incomplete committed associations fail closed.
- Preserve original ciphertext across later task versions, state changes, certificate expiry,
  revocation and renewal. Do not fetch source metadata or mutate indexes, cursors or write packets.
- Reject query/body/write-author/delegation selectors and duplicate protocol identity headers.
- Fix the existing outbox conflict test's random no-op mutation: its replacement ciphertext
  character always differs from the original. Helper runtime and generated bundles are unchanged.

## Validation

- All 61 focused task operation, task/HTTP/Firestore, foreground storage and API boundary tests passed.
- Deterministic storage-only fixtures exercise both `A` and non-`A` initial ciphertext characters.
- Repository `npm run check` passed through the required pre-commit hook.
