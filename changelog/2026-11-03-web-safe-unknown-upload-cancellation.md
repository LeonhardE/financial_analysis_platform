# Safely cancel unknown encrypted uploads during key renewal

Date: 2026-11-03

## Summary

Owners can explicitly review and confirm cancellation of an unknown task or holdings upload before
renewing expired operational keys, using the existing Passkey Root authority.

## Changes

- Add closed Worker Root controls and fixed browser/BFF cancellation routes for the independent Hub
  and Portfolio producer profiles; preserve Portfolio workload identity.
- Atomically retain the signed cancellation and complete original encrypted outbox before sending.
  Resume the same command after reload or lost acknowledgement, without re-signing content.
- Require exact Root-bound cancellation evidence. Already saved uploads additionally require the
  original historical encrypted result; missing/hidden results preserve both retry records.
- Clean up only the proven original, preserving newer tab uploads and archive/session guards;
  pending cancellation records continue blocking renewal. Explain permanent 32-decision limits in
  English and Chinese, with separate review, confirmation and resume controls.

## Validation

- Root `npm run check`, production Web build, and targeted crypto, actual Worker/IndexedDB,
  controller, browser admission, owner BFF and bilingual UI regression checks.
- Synthetic producer/consumer interoperability and interrupted-request validation; native Passkey
  and real owner acceptance are tracked separately. No shared schemas, cloud resources or IAM changes.
