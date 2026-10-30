# Foreground agent controller and owner consent bridge

Date: 2026-10-30

## Summary

Add Hub-owned foreground controller and same-origin consent shell using the existing encrypted
helper, OAuth and Run/result contracts. Web keeps its Passkey origin and independent owner pins.

## Changes

- Provide fixed pinned assets, explicit configured owner origins, exact cross-window role/nonce
  checks and closed owner OAuth operations with registered callback validation.
- Keep model and owner operations separate, remove paired manual controls, sever opener references
  and enforce owner-presence/key TTL boundaries. No token/private-key entry exists in model UI.
- Add trusted-host fixed authenticated orchestration and bounded ciphertext-only IndexedDB outbox
  for original-operation replay, revisions and independently fetched receipts.
- Preserve the existing helper 1.2.0 Worker bytes and algorithms. Same-browser/manual public cards
  do not claim remote Muse pairing or unattended execution. No cloud configuration/resources change.

## Validation

Actual pinned WebCrypto Worker with synthetic production FastAPI routes, independent owner
decryption, original-body replay and receipt recovery, current-authority isolation, token renewal,
native MessageChannel role/redirect checks and offline IndexedDB transaction-model regressions.
Root `npm run check` passed, including 351 Hub and 344 Web tests, security/lint and formatting.
Physical browser/Muse/production acceptance remains separate.
