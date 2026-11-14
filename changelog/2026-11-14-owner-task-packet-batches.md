# Batch Owner task display reads without raising request limits

Date: 2026-11-14

## Summary

A bounded Owner-only query returns up to four existing encrypted task packets per request, allowing
the following Web change to avoid32 separate name reads exhausting the30/minute proxy budget.

## Changes

- Add the closed4KiB read-only task query; retain fresh Google/vault authentication and all
  per-task visibility, current version, historical proof and encrypted carrier checks.
- Batch index/lifecycle, heads and versions within one fresh transaction attempt.
- Keep the1MiB response budget with an ordered prefix/exact remaining-ID suffix; distinguish
  unavailable tasks from corrupt/failed data, without private titles, commands, cursors or storage.
- Preserve all existing API and limit behavior; release this producer before its consumer.

## Validation

- Nine real-JOSE/Firestore-SDK/HTTP synthetic tests cover exact single-read equivalence, bounded
  read phases, owner/input isolation, trash, transaction retry, response progress/budgets and
  malformed/corrupt/incomplete prefetch refusal.
- Normal root checks before commit; exact-head CI and existing Hub Ready100% before the consumer.
- Hub target only. No live/native/latency acceptance, migration, capacity, resource or rollout change.
