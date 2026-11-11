# Keep historical Agent expiry out of Owner snapshot encryption

Date: 2026-11-11

## Summary

An expired Agent certificate left in the public registry could prevent saving
holdings and lock the workspace, even when the Owner's device and recovery keys
were valid. Holdings now use the same current Owner recipient selection as tasks.

## Changes

- Select currently valid, unrevoked Owner device and recovery recipients before
  encrypting a snapshot. Agent certificates remain outside Owner-only delivery.
- Retain historical certificates and strict checks for the current signer,
  required recovery recipient, binding, revocation and ciphertext verification.

## Validation

- Reproduced the failure with signed expired Agent certificates before the fix.
- Regression tests cover excluded expired/future recipients, Owner decryption,
  retained history and refusal without recovery or an active signer.
- Real Chrome SharedWorker/WebCrypto/IndexedDB diagnostics reproduce the original
  rejection and pass after the fix with expired Agent history retained.
- Full repository and normal pre-commit checks run before commit.
