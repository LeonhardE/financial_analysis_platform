# Native executor MCP and original encrypted report delivery

Date: 2026-11-09

## Summary

The confidential executor can serve separately enabled ChatGPT native MCP tools
with independent provider, account and current Root authority checks. Approved
inputs stay frozen per Run; reports leave the boundary only as Owner-encrypted
ciphertext, with original-byte recovery after uncertain responses.

## Changes

- Verify actual TLS 1.3 provider client chains/SAN/clientAuth using reviewed public
  OpenAI CA anchors. Pin native configuration in the Root-approved environment;
  keep all image gates disabled by default.
- Add bounded stateless MCP discovery/profile/tasks/input/report, fixed Policy
  OAuth discovery and distinct expired-token/insufficient-scope challenges.
- Verify Root registry and original consent history with durable monotonic pins,
  original Agent proofs, exact frozen publications and current permission leases.
- Persist begin/manifest and encrypted report before external writes; restore the
  Policy-selected state and retry original operations/ciphertext/receipts.
- Split first creation into attested pending keys/CSR and fresh Root finalization,
  allowing the actual device-binding fingerprint and native-config hash to be
  known before DEK wrapping and final identity-bound genesis sealing.

## Validation

- 68 executor tests passed, including real mTLS handshakes/rotation and negative
  identities, frozen versions, revocation-before-decryption, rollback, unsafe
  reports, unknown Hub/Policy acknowledgements and same-key recovery.
- Cross-process integration with actual merged Hub and Policy implementations
  passed frozen input, Owner-only decryption, exact submit retry and revocation.
- Root `npm run check` and commit checks are required before publication.
- Cloud attestation/KMS in fixtures are synthetic. Actual provider installation,
  provisioning and private/offline/overnight acceptance remain separate work.
