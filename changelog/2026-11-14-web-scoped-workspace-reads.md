# Reduce repeated workspace reads and browser verification

Date: 2026-11-14

## Summary

Task Center shares one typed overview for its homepage, Resources can read an already synchronized
source from one verified view, and Agent unlock skips an unrelated holdings read. The actual browser
Worker also reuses successful static certificate verification within each history attempt.

## Changes

- Share one bounded Owner/vault/unlock-generation/vault-version task overview among metadata,
  task-center capabilities, three report feeds and historical provider attribution. Keep the original
  task32/feed20 limits, independent cursors, complete nested DTO parsing, real unread totals and
  two-worker task-name verification. Only successfully decrypted name versions are bandwidth hints;
  up to four new packets can be included and missing names keep the original packet queue.
- Reuse task receipts for 30 seconds from their original arrival without extending freshness on
  navigation. Explicit list/report refreshes, More, details and writes keep their original routes.
  Soft invalidation prevents old receipt cache refill while existing subscribers retain their own
  serial/scope fences; write/scope invalidations abort pending work. No generic POST retry is added.
- Attempt the fixed Portfolio view only after fresh-vault Worker verification during an ordinary
  approved writable source read. Check actual local journals before and after the request, retain
  metadata/receipt associations and original Worker snapshot decryption, and publish the verified
  pair together. Two-null transport hints retain the metadata-first recovery protocol and the same
  fresh vault context. Malformed replies and crypto failures do not become fallback hints.
- Use result-mode Agent unlock with state enablement, preserving current/archive/current, Passkey,
  Worker and explicit device-approval checks. This removes the unrelated five-step holdings chain;
  later Resources reads retain their source authority checks.
- Consume the shared bounded certificate verifier in the actual Worker directory verifier. Each
  history attempt has private complete Root/JWS snapshots and at most 128 successful entries/one
  MiB. Every checkpoint signature and original Owner/vault/identity/role/active/revoked/time/epoch/
  digest/chain check still runs. No cross-attempt permission cache, private-key or RPC wire change.

## Validation

- Real combined task hooks and Task Center view cover one-request entry, all 32 names, original
  receipt expiry, exact list/report refresh counts, independent cursors, unread/provider attribution,
  packet budget hints, slow verification, cancellation and Owner changes. Actual browser/Next proxy
  boundaries reject closed-shape, header, nested DTO, byte-budget and deadline violations.
- Real holdings hooks and the production Worker kernel cover fresh view authority, retained snapshot
  epoch one/current epoch two, empty sources, both hint paths, local journals before/during reads,
  delayed React rendering, slow verification, crypto failure and late Owner changes without writes.
- Actual Worker regressions use a real synthetic 23-generation, 47-certificate directory: signature
  checks fall from 598 to 70, imports from 1795 to 190 and digests from 1842 to 237 with equal verified
  state. Each new attempt still verifies 70; changed signatures require another verification.
  Identity, checkpoint, clock, revocation, expiry, nested corruption, mutation and termination
  regressions retain the original boundaries.
- The previous accounting assumption that Agent already used result-mode unlock was incorrect.
  Request counts and local crypto measurements do not establish the production two-second target;
  online complete-data acceptance remains required after ordered deployment.
