# Consume the consistent Portfolio discovery snapshot

Date: 2026-11-14

## Summary

Resource catalogue discovery uses one Portfolio request for state and projection
metadata, removing a duplicate metadata transaction and its authority verification.

## Changes

- Consume the compatible, fixed `/internal/v2/resources/discovery/read` producer
  with the existing narrow workload and Owner delegation proofs and byte/deadline limits.
- Validate its exact versioned envelope, all state references and active projection
  subset. Missing or mismatched active projections remain unavailable; terminal,
  pending and empty-source states retain their original meaning.
- Preserve current Hub Root/fence checks before and after producer I/O, bounded
  source refusal isolation and original User discovery. No authority cache or writes.
- Require the Portfolio producer to be deployed before this consumer.

## Validation

- Catalogue tests cover1/2/10 references in one Portfolio request, original narrow
  proofs, malformed/foreign/duplicate metadata refusal, per-source unavailable
  handling, old-body refusal, lifecycle/epoch conflicts, time and byte limits.
- Normal discovery makes two producer requests (User plus Portfolio), down from
  three; no claim is made about production navigation latency before measurement.
- The complete Hub service suite passes953 tests across four isolated workers;
  Hub lint and format checks pass.
