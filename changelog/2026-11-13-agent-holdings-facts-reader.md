# Read new holdings facts in the personal Agent client

Date: 2026-11-13

## Summary

Agent client 1.3.0 reads both legacy holdings snapshots and the opt-in facts/cost format, providing a
compatible reader before new Web writers are introduced. Existing versioned downloads and current
connections are preserved.

## Changes

- Select the shared holdings-only reader after the existing signature, registry, identity,
  permission, exact publication and run checks. Other resource/task/result readers are unchanged.
- Pin the valuation adapter and schema independently and retain the existing standalone asset cap.
- Freeze 1.2.0 download bytes at their prior URL, alongside the older releases.
- Report invalid new facts as a shared-data problem rather than requiring credential replacement.
- Keep Hub blind to private data; no automatic repricing, input migration, host upgrade or grant
  change is introduced.

## Validation

- Synthetic Python Owner / Node client / Hub transaction checks exercise new facts, frozen input
  reuse, result submission and invalid private provenance rejection by the trusted client.
- Existing legacy input, authority, policy and retry tests remain required.
- Asset checks cover old pins, schema/library integrity and the unchanged 2MiB distribution cap.
- Normal root `npm run check` is required before commit. Native/online acceptance remains deferred.
