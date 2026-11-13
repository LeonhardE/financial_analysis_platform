# Task center and recoverable execution controls

Date: 2026-11-13

## Summary

Unlocked tasks show private names and a compact task-centered editor. Optional
capabilities add independent executors, editable schedules, recoverable manual
requests and task lifecycle actions without creating cloud infrastructure.

## Changes

- Verify names with bounded concurrency and reuse scoped, versioned memory caches.
- Use Goal, Resources and execution, Review; keep Run now inside the selected task.
- Sign Root-bound controls in the Worker, seal their outbox before sending, and
  recover the original receipt or safely fence an unsubmitted save.
- Show waiting, running and per-executor progress across navigation, with explicit
  Agent continuation. Schedules remain distinct from native execution evidence.
- Consume published Hub APIs through a closed Owner proxy. Existing feature gates,
  old encrypted contracts and deployment capacity stay unchanged.

## Validation

- Real local Worker/Hub signing loop, forged-state rejection and cancellation.
- Name cache/concurrency/draft isolation, task UI, proxy and DST schedule tests.
- Full repository check before commit; no online business validation.
