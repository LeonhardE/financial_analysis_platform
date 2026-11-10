# Independent Agent in the existing Owner workspace

Date: 2026-11-10

## Summary

Connect the existing shared Owner unlock, resource/task delivery and encrypted Inbox
to a prepared independent Policy/executor identity behind default-off Web configuration.

## Changes

- Verify the current Owner Root, original Agent keys, bounded approval/scope/recipients
  and fresh Policy checkpoint inside the same Owner Worker before new publication or OAuth approval.
- Reuse original ciphertext/outbox receipts on the separate Hub executor parent; preserve
  existing Muse and historical reports. New scope and reassignment remain explicit.
- Add bounded direct Policy consent and terminal Root revocation, including revocation
  after approval expiry or issuance shutdown. Never forward Agent tokens or financial plaintext.
- Clearly separate expected task schedules, unobserved native installation and pending
  offline/overnight acceptance. Initial administrative creation/enrollment and deployment remain separate.
- Include the executor trust distribution in the Web image and shared Worker compatibility hash.

## Validation

- Web type checks, full Web regression suite and dedicated adversarial crypto/transport/UI tests.
- Browser-generated Root control verified by the actual Python Policy verifier, including changed-parameter rejection.
- Root `npm run check` through the required pre-commit hook; no live deployment or online acceptance.
