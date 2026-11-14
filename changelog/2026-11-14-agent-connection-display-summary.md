# Bound Agent connection display reads

Date: 2026-11-14

## Summary

Agent connection discovery could exceed the browser display deadline when several
Owner requests repeatedly verified a long vault registry history. Add a compatible
read-only snapshot for upgraded clients and reuse identical certificate signature
checks within each complete history verification.

## Changes

- Add Owner-only `GET /api/v3/provider-connections/{vault}/summary`, composing the
  existing native connections, provider states and selected credential states in
  one transaction with at most three bounded read phases.
- Preserve current slot selection, legacy ambiguity, cross-vault blockers,
  credential expiry/revocation, retained selections and complete failure on bad
  storage. Keep original endpoints and disabled-write-gate reads available.
- Consume the shared bounded `RegistryCertificateMemo` only within a history
  verification. Recheck every checkpoint, schema and current authority; retain all
  existing response, transaction and resource limits.

## Validation

- Focused Hub tests cover real SQLite/Firestore SDK equivalence, one verification
  per summary, 1/2/32 connections, fresh expiry/revocation and conflict retry,
  malformed/cross-owner/incomplete reads, empty accounts and closed HTTP transport.
- History tests prove identical verified results and schema checks, reduced
  certificate signature work, fresh independent verification, and refusal of
  changed signatures or future checkpoints.
