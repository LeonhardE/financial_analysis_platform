# Reconcile durable Portfolio source fences with Hub

Date: 2026-10-31

## Summary

Owners can explicitly resume a previously signed source mutation and complete it only after the
configured Hub confirms that exact operation. An interrupted request remains safely retryable.

## Changes

- Add a closed owner-only synchronization route derived entirely from Portfolio's stored mutation.
- Reuse the configured HTTPS Hub origin and runtime workload identity, with bounded response size,
  deadlines, exact ACK validation and no redirects, ambient proxies or background retry loop.
- Recheck current authority and the original mutation in the completion transaction; preserve pending
  state on failure and immutable receipts on retries, without clearing newer operations.
- Keep OAuth, adapter activation, cloud permissions and Web lifecycle controls independently scoped.

## Validation

- Portfolio tests cover authenticated wire requests, lost ACK/restart, local rollback, wrong ACKs,
  malformed/oversized responses, timeouts, owner isolation, stale operations and terminal actions.
- Root `npm run check` is required before commit; actual workload acceptance remains separate from
  synthetic test fixtures.
