# Shared encrypted workspace v2.0 contract

Date: 2026-10-26

## Summary

Add the production shared foundation for encrypted resources, tasks and result
revisions. Services and clients can adopt one explicit format and independently
verify ciphertext without giving backend runtimes user content keys.

## Changes

- Package closed public/private JSON schemas under
  `folioview.agent-workspace.v2.0`, with P1 General JSON JWE
  ECDH-ES+A256KW/A256GCM, canonical external AAD and separate ES256 object/control
  signatures using mature JOSE/JCS libraries.
- Validate root-pinned key directories, checkpoint history, certified roles/key
  epochs, limited device grants, exact task/source selections and fixed controls.
  Require current authorization snapshots and trusted consumer-supplied bindings;
  keep retained intent/author proofs separate from new-write permission.
- Bind manifests, complete component pages and results to owner/vault, task/Run,
  connection/grant, resource and recipient metadata. Support stable original
  ciphertext replay, immutable receipts, revision CAS and delivery reshares.
- Enforce strict JSON/base64url, explicit version rejection, fixed safe errors
  and whole-message/storage budgets. Keep private payload/tag checks on trusted
  decrypting endpoints and require actual SDK document bytes for storage budgets.
- Add independent Node/WebCrypto vectors and optional reverse interop tooling,
  synthetic isolation/revocation tests and consumer integration documentation.
  Existing consumers, v1 routes, cloud configuration and key storage are unchanged.

## Validation

- Shared unit/integration tests, including independent Node-to-Python and actual
  Python-to-Node signature verification/decryption.
- Root `npm run check`: type checks, lint, service/Web/infra/CI tests and formatting.
- Local wheel build verifies the schemas and modules are packaged and tests are
  excluded. No service, tunnel or cloud resource is created by this change.
