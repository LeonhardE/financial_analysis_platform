# Encrypted result writes, revisions and original receipts

Date: 2026-10-29

## Summary

Authorized personal agents can save encrypted results against an existing frozen Run and
append revisions without replacing earlier content. Exact retries recover the original
receipt, allowing uncertain outcomes to be resolved without generating duplicate reports.

## Changes

- Add scoped initial-result, revision and receipt HTTP endpoints with immutable encrypted
  revisions, atomic Run/result/idempotency relationships and server-derived connection provenance.
- Preserve one initial result per Run and require revision CAS. Distinguish current write
  authority from the narrow, original-authorization exception for previously saved receipts.
- Extend the foreground memory-only helper with restricted result encryption, exact packet
  retry and receipt verification using existing formal contracts and owner/recovery recipients.
- Keep content private to authorized clients; no shared-schema, cloud configuration, resource,
  owner Inbox or model execution change is included.

## Validation

- Full repository `npm run check` passed on the final source, including 285 Hub tests.
- Added 48 cases: 19 domain, 6 actual Firestore SDK, 9 production HTTP and 14 actual Worker
  tests. The encrypted helper/backend loop covers initial save, exact replay, revision,
  receipt recovery and owner/recovery decryption.
- Independent review reran all 48 new cases and passed three additional adversarial probes
  for the final expiry boundary, access-token revocation and corrupt historical root proof.
- Helper 1.2.0 builds reproducibly, with unchanged dependencies and shared schemas.
