# User source versions and restricted metadata

Date: 2026-10-27

## Summary

User lists now expose consistent resource identity and version metadata for
future Hub integration, while retaining their original editable APIs and keeping
list content out of internal v2 responses.

## Changes

- Update actual watchlist mutations and version metadata atomically; preserve
  existing response shapes and reject inconsistent old-writer changes.
- Add explicit user-authenticated initialization for legacy and empty resources,
  with stable source identity and bounded atomic initialization receipts.
- Add metadata-only v2 catalogue, projection and current-state interfaces behind
  verified Google workload identity and a separate signed Hub catalogue
  delegation. Trust configuration is explicit and closed by default.
- Enforce current owner/ref/incarnation checks, kind restrictions, whole-body
  budgets, shared v2 error framing, and private response headers. No content,
  content digest, database IAM, Run consumer or real caller is added to Hub.

## Validation

- Synthetic User regressions cover legacy migration, two owners, concurrent
  initialization, receipt capacity/replay, transaction rollback, stale/corrupt
  metadata and real synthetic Google/Hub signature boundaries.
- Tests preserve existing watchlist/follows behavior, reject plaintext/v1 and
  unsupported agent-run consumers, and validate errors against the shared schema.
- User Ruff checks/formatting pass; no real accounts or cloud resources are used.
