# Reuse verified registry prefixes in Owner task reads

Date: 2026-11-14

## Summary

Owner task packets reuse immutable historical registry prefixes already verified
by the current transaction attempt, avoiding repeated full history verification.

## Changes

- Retain prefixes only after complete history and current-row validation succeeds,
  bound to exact Owner/vault, Root bytes and complete history bytes, with bounded
  entries and encoded bytes. New requests and conflict attempts start empty.
- Preserve exact stored KeyProofs/context matching, strict original-save time,
  writer/recipient selection and every task carrier signature/permission check.
- Keep complete historical verification for legacy units, misses or full caches;
  later writer revocation does not change original historical read authority.
- Keep Hub's schema-count regression compatible with both the existing shared
  signature memo and the subsequent shared static-certificate memo prerequisite.
  Each bundle/checkpoint remains checked; fresh requests repeat all counts and
  checkpoint/signature checks remain unchanged.

## Validation

- Focused real Firestore SDK and SQLite tests cover1/2/4 packets, identical DTOs,
  fresh retries, historical revocation, clock/Root/history/corruption boundaries,
  capacity fallback and isolated immutable values.
- Existing packet budget/suffix, duplicate/incomplete batch and vault memo checks
  remain passing. No production latency acceptance claim is made.
