# Agent Hub source invalidation and immutable acknowledgements

Date: 2026-10-28

## Summary

Add the Hub side of source-range revocation so a trusted Portfolio workload can obtain a durable,
exact acknowledgement. Future Run/result writers can compare the same source fence in their own
write transaction, preventing stale authorization after revocation completes.

## Changes

- Add the closed `/internal/v2/source-fences` callback behind pinned Google workload identity;
  it has invalidate-only authority for the Portfolio holdings namespace.
- Store the monotonic source fence and immutable, request-bound operation ACK atomically in SQLite
  or the explicit named Firestore database. Replays retain their original values and HTTP bytes.
- Reject conflicting operations, stale epochs, namespace substitution and terminal-source
  reactivation; preserve independent owner/incarnation boundaries and reserve terminal capacity.
- Add a transaction-bound guard for later Run/result consumers without introducing those APIs,
  changing another service, or enabling cloud configuration/deployment.

## Validation

- Agent Hub target suite: 54 tests passed, including 26 added cases over SQLite concurrency,
  actual Firestore SDK transaction retries at synthetic RPC boundaries, and signed HTTP identity.
- Ruff lint and formatting passed for the Agent Hub target.
- Repository-wide `npm run check` passed, including security scanning, lint, Web/service/infra/CI
  tests and formatting checks. No cloud operation was performed.
