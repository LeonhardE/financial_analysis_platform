# Persistent Agent runtime cryptography and durable key storage

Date: 2026-11-07

## Summary

Add the independently verifiable browser foundation for a persistent Agent identity
and reusable resource consent, without enabling new production access.

## Changes

- Verify original Root registry, identity bindings, resource control chains, encrypted
  publications, immutable Run inputs and exact request proofs under the shared contracts.
- Persist only nonexportable private CryptoKey handles, public pins and original encrypted
  retry carriers; restore and concurrent creation preserve one identity.
- Add a locked, reproducible, dependency-free browser distribution and integrity manifest.
  Legacy foreground helper bytes and flows remain unchanged.

## Validation

- Live Python/Node JOSE verification and decryption for all five persistent content types.
- Signed consent approval, device revocation, explicit reapproval and rollback/tamper denial.
- Real WebCrypto plus isolated IndexedDB model: restart, concurrency, key nonexportability,
  original encrypted retry and exact Python request-proof verification.
- Full repository `npm run check` before commit.
