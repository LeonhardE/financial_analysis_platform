# Confidential executor original-key recovery core

Date: 2026-11-09

## Summary

Add an independent build-only Confidential VM target that recovers the original
Agent signing/encryption and TLS keys inside the measured workload, with current
Policy authority and authenticated encrypted state. Business MCP tools remain
closed pending their separate executor integration.

## Changes

- Restore-only startup verifies Root/Policy pins, a complete boot-bound challenge,
  current recovery lease, sealed DEK and exact latest snapshot, then confirms all
  original keys before enabling in-boundary TLS 1.3.
- New operation leases recheck live authority; immutable encrypted snapshots and
  Policy head CAS preserve exact outbox/receipts. Unknown commits require restore,
  while missing state never generates a replacement identity.
- Separate Root-permitted, create-only first-key ceremony produces encrypted
  genesis state, original TLS CSR and attested public enrollment evidence. Code
  upgrades retain the original keyring; a new epoch cannot relabel old state.
- Add non-root Docker, 46-distribution hashed production dependency lock,
  build-only Cloud Build/registry metadata, closed offline probe and service guides.
  Registration tests include the required VM probe and test omitted-runtime defaults
  independently of this first explicit VM registration.
  No cloud resources, consuming service or Web implementation are changed.

## Validation

- Target tests cover actual subprocess/backup restoration, TLS 1.3, JOSE/AES and
  authority negatives, operation/outbox CAS recovery, code/epoch transitions,
  KMS protobuf/CRC and create-only cloud-storage boundaries.
- Local cross-process integration with the merged Policy implementation verifies
  real Authlib authorization, key recovery/confirmation, operation leases, state
  CAS, restart fencing and revocation with synthetic cloud attestation.
- Full root `npm run check`, required pre-commit checks and independent CI image/
  offline probe checks are recorded in the delivery evidence. Real cloud/native/
  private/offline acceptance remains separate.
