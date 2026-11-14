# Batch provider connection management reads

Date: 2026-11-14

## Summary

Connection management no longer performs a separate network read per retained
connection. Normal active-vault state uses three bounded batch-read phases for
one through32 indexed connections, with unchanged response and authority rules.

## Changes

- Read vault/slot/index together, then connections and eligible identities in
  the same transaction. Skip unrelated provider and inactive historical identities.
- Retain all existing owner, connection, identity, provider slot and signature
  validators, blockers, retained selections and fresh retry behavior.
- Keep command transaction reads independent of the read-only prefetch view.

## Validation

- Six new real SDK/synthetic RPC tests cover1/2/32 connections, provider/history
  filtering, foreign vault blockers, cross-owner refusal and corrupt/conflicting streams.
  - 24 focused tests including existing provider cutover and transaction reuse coverage.
- Normal root `npm run check` before commit; exact-head CI before merge.
- No new API, cloud resources, capacity/rollout changes or online latency claims.
