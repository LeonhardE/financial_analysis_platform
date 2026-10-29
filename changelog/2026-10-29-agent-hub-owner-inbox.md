# Owner Inbox, encrypted history and signed result state

Date: 2026-10-29

## Summary

Users can query their own received results and encrypted revisions without requiring the
original agent to remain connected. Read, favorite and archive changes use authenticated
device signatures and metadata CAS, preserving immutable content and receipt history.

## Changes

- Add owner-only metadata lists/counts, encrypted details/revision history and bounded
  evidence/registry proofs, reusing the existing result and Run storage contracts.
- Bind pagination to owner, vault, filters and metadata snapshots; never mark reports read
  implicitly or provide server plaintext search/private schedule inference.
- Add current-device signed state controls with atomic version checks and original operation
  acknowledgements; stale state updates cannot overwrite newer body revisions.
- Batch metadata reads and project revision receipt fields for bounded remote queries.
  Add two collections within the existing Hub database and permit the state route's PATCH
  preflight without changing shared contracts, helper assets, cloud configuration or resources.

## Validation

- Final root `npm run check` passed, including 324 Hub tests and the existing service,
  infrastructure, repository tooling, formatting and secret checks.
- Added 39 cases: 19 domain, 6 actual Firestore SDK, 4 batch/projection and 10 production HTTP.
  HTTP coverage includes two initialized users in one store, authenticated historical
  verification/decryption and actual owner identity/CORS boundaries.
- Independent review reran all 39 cases and passed three additional authorization/cursor probes.
- Updated the legacy unsupported-POST assertion for the newly implemented GET collection;
  denial and safe error framing remain enforced. Shared contracts and helper bytes are unchanged.
