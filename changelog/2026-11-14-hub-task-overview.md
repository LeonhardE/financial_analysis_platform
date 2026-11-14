# Combine Owner task overview reads

Date: 2026-11-14

## Summary

A fixed Owner task overview combines the existing task metadata, policy capabilities,
three report pages and original provider attribution inventory in one database snapshot.
Up to four original encrypted task packets can also avoid a following name request.

## Changes

- Add the closed `/api/v3/tasks/{vault}/overview/query` producer with the original
  Firebase Owner/current Root checks,32-task Web limit and three independent20-item
  report feeds. Existing standalone endpoints and their validators remain available.
- Prefetch bounded rows in three ordinary phases for Firestore and SQLite; retain
  original historical Actor/provider metadata and current task lifecycle filtering.
- Calculate both foreground cursors against one accumulated map and write once,
  preserving independent continuation, expiry and capacity semantics.
- Validate selected packets before optional delivery; only the combined response
  budget can defer valid packets to the original endpoint with an explicit null.
  Missing names still require original client verification before ready.
- Match each selected packet's complete metadata to the current head/index before
  any budget hint, so a corrupt association cannot masquerade as deferred delivery.

## Validation

- Real Firestore SDK tests cover1/2/4 packets and one current history verification,
  three ordinary batches, exact standalone DTO parity and SQLite three-query parity.
- Tests cover32 tasks, both foreground feeds with independent continuations,
  cursor capacity, retry freshness, Owner/vault/clock and malformed batch refusal,
  combined-budget deferral without hiding corrupt packets, and route/body boundaries.
- No production two-second completion claim is made before deployment measurement.
