# Root-authorized cancellation of an uncertain holdings upload

Date: 2026-11-03

## Summary

Owners can permanently deny one original holdings upload whose save result is unknown, including
when its device certificate expired. A cancellation races the original upload transaction: the
winner produces an immutable `saved` or `cancelled` decision, without deleting saved data or
restoring disconnected or deleted sources.

## Changes

- Add closed, bounded owner POST/GET routes for the Portfolio-only cancellation profile and verify
  the root signature against the existing trusted source authority.
- Store a maximum of 32 immutable cancellation decisions per owner/vault; cancelled uploads occupy
  the original vault-wide operation document so older in-flight writers also conflict and reject.
- Validate ledger, fence and saved-snapshot associations on recovery. Keep original history access
  rules and the separate Firebase owner / Cloud Run caller identity boundary.

## Validation

- Targeted cancellation business, HTTP and real Firestore SDK retry tests.
- Portfolio service regression suite, lint and formatting checks.
