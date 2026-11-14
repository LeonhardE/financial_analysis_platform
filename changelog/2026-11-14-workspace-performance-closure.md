# Workspace loading and request lifecycle

Date: 2026-11-14

## Summary

Reduce initial Web code and unnecessary historical reads while preserving the unlocked workspace,
verified display state and original pending writes.

## Changes

- Load private panels and chart modules on first use, retain visited panels, and offer localized
  in-place chunk retries. Initial private routes do not start Market overview/chart downloads.
- Load one results page per source and selected task; share verified Task Center state, keep explicit
  incomplete-history pagination, and decrypt report titles only for observed rows. Read task state
  and manual progress in parallel, publishing after state verification.
- Settle ignored SDK/transport/body cancellation, bound streamed holdings/task-state/search JSON,
  cancel inactive result reads, and retain physical read-pool capacity until an abandoned send ends.
  Unknown writes preserve their original pending packet without automatic replay.
- Reuse public Agent destination metadata on route reentry and keep its valid origin on refresh
  failure. Last verified connections remain actionable during a background summary refresh.
- Preserve only closed numeric backend Server-Timing metrics and add the complete Web proxy span,
  without additional logs, resources, authorization caching, quota or capacity changes.

## Validation

- Full Web regression suite, production build, typecheck and repository `npm run check`.
- Regressions cover retained navigation, one-page result history, no overview ciphertext preload,
  ignored cancellation, pending-write preservation, byte limits, deferred chunk failure/retry,
  public destination reuse and closed numeric timing headers.
- Static build references are compared separately from actual browser transfer/render timing.
  Production latency and native Agent acceptance remain unperformed pending user authorization.
