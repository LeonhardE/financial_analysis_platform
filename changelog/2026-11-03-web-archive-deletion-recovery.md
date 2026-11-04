# Confirm cloud archive removal and recover unknown outcomes

Date: 2026-11-03

## Summary

Web Settings now consumes the released Hub archive-removal, check and withdrawal APIs, with
explicit backup confirmation, durable unknown-outcome recovery and independent restoration of
a removed cloud key archive.

## Changes

- Require a fresh verified review and saved-recovery acknowledgement before root signing;
  stage the original public request atomically before HTTP and retain it through response loss.
- Verify signed lifecycle proof and snapshot fences before cleanup; expiry alone stays unknown.
  Explicit Passkey-authorized withdrawal is durable and becomes the only retry intent.
- Distinguish removed archives from absent libraries, block ordinary content actions and reuse
  independent recovery with a fresh Passkey and separate explicit device approval.
- Preserve root/content/registry and existing device ciphertext; fence stale tabs and unresolved
  local changes. Add bilingual review, withdrawal, recovery and error states.
- Document scope and test-account acceptance; reset and historical rekey remain separate work.

## Validation

- Root `npm run check` and production Web build.
- Actual Web crypto/Worker/IndexedDB → released Hub SQLite integration, including restoration
  of old holdings/tasks/results, races, replay, rollback and interrupted recovery cancellation.
- Auth/BFF, controller and bilingual UI tests for exact retries, account changes, lost replies,
  readonly checks, backup confirmation and invalid proof. Native remote acceptance remains pending.
