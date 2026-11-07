# Durable owner publications

Date: 2026-11-07

## Summary

Add an opt-in Hub producer for Root-approved encrypted task and resource deliveries,
independent of short-lived legacy task grants.

## Changes

- Bind task authority to the exact current task version, execution epoch and owner
  ciphertext fingerprint. A single authority slot across Agents prevents namespace
  resets and fences task reassignment through compare-and-swap.
- Check current resource permission, trusted producer revision and source invalidation
  in the commit transaction. Ordinary source updates reuse the same resource policy.
- Keep original operation receipts and exact ciphertext for safe unknown-outcome retries
  before producer RPCs. Receipts do not grant current execution or revive revocations.
- Keep publication writes disabled until explicitly activated; owner receipt and authority
  reads remain available. No Agent read or Run endpoint is enabled in this change.

## Validation

- Synthetic cryptographic producer/policy/CAS and route boundary regression checks.
- Full root `npm run check` before delivery.
