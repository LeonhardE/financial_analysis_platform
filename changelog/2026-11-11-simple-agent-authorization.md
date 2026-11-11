# Simple Agent authorization and recovery

## Summary

Make the personal Agent-owned route the Agents page for Muse and ChatGPT, with ordinary authorization and reauthorization instead of credential management.

## Changes

- Add a closed temporary authorization handoff, existing Passkey review, task selection, friendly expiry/reminder states and access management.
- Verify historical Root bindings, original consent receipts and credential lineage in the Owner Worker before restoring still-approved scope and prior task assignments. Newer revocations, changed sources and other Agent assignments fail closed.
- Resume exact original confirmations; preserve expired uncommitted credential journals internally before allowing a fresh reviewed link. Keep historical Inbox access.
- Remove foreground UI fallback from navigation and periodic Agent API polling. Share information on explicit Owner actions and distinguish plan reports from actual result arrival.

## Validation

- Root `npm run check`.
- Real Owner crypto tests for expired renewal, historical scope, revocation floors, changed sources, task reassignment and invalid replacement journals.
- Authorization fragment, exact retry, locked/hidden/account generation, both-locale expiry/privacy and historical Inbox navigation tests.
