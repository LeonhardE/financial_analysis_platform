# Bound repeated browser registry certificate verification

Date: 2026-11-14

## Summary

The shared browser registry verifier avoids repeating identical certificate signature checks
across generations of one loaded history, reducing work while preserving the original authority.

## Changes

- Keep a private successful-certificate memo within each `Registry.load`, keyed by the complete
  Root, pinned key ID, verification profile and complete flattened JWS. Checkpoints still verify
  individually, and all existing schema, chain, identity, active/revoked, time and epoch checks run.
- Snapshot verification inputs before awaits and isolate stored/returned payloads with copies.
  Never retain pending promises or failures, and fall back to ordinary verification after 128
  entries or 1 MiB of encoded key/payload bytes. No wire, public API or cross-load cache changes.
- Rebuild the checked self-contained browser bundle and integrity manifest while retaining the
  existing third-party notices.

## Validation

- Eight real WebCrypto regression groups cover 598→70 signature checks for a 23-generation history
  with the same 621 schema checks and equivalent authority, exact signed-input/Root/profile
  isolation, both capacity limits, asynchronous mutation and copy isolation, fresh checkpoint
  verification, expiry, revocation, rollback and key epochs.
- The source and bundled verifier pass the same authority comparison; new tests remain usable
  without installed runtime/build dependencies or generated validator files.
