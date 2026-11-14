# Reduce repeated workspace reads and preserve resource state

Date: 2026-11-14

## Summary

Task-list navigation waits to discover Agent connections until a task detail or new/edit workflow
needs executors. Resource navigation reuses scoped successful data and reports stale refreshes
without erasing rows. Retrying unlocked holdings failures now performs the actual source read.

## Changes

- Keep task metadata and real report unread feeds fully loaded; request Agent discovery and the
  resource catalogue for task details, creation and editing, with owner/vault-generation fences.
  Wait for catalogue confirmation before applying a resource handoff; retain source retry states.
- Preserve report-provider attribution through the existing light Owner connection list, independent
  of credential discovery. Scope labels to the current vault, retain revoked history, prefer v3
  attribution and keep unknown actors unknown; display labels never grant authority.
- Reuse resource display snapshots for 30 seconds, invalidating on identity/vault/source changes
  and writes. Preserve rows with explicit stale/error state; block stale selections and writes.
- Recover visible writable shared-unlock resumes with one original source read per Owner/vault
  generation/selected source when metadata and content are both absent. Do not retry automatically
  after failure or scan hidden/read-only sessions.
- Expose task-list readiness only after current metadata, names, complete unread/report feeds,
  provider attribution and capability receipt; details and resources do not claim aggregate ready.
- Preserve independent cancellation, unknown-write recovery and fresh authority checks. Keep
  locked-vault recovery separate from unlocked holdings-source retry.
- Cover real hooks/components for navigation, executor demand, unread preservation, cache expiry,
  refresh failures, writes, late replies, owner/vault changes and actual Portfolio retries.

## Validation

- Focused real Web hooks/components cover complete versus partial/slow/error/loading states,
  current identity changes, actual shared-resume source recovery and unchanged vault validation.
- Full repository checks, exact-head CI and production release verification remain required.
- These changes do not establish the production UI 2-second or API 500-millisecond targets.
