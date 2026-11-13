# Task-owned trash and retention fences

Date: 2026-11-13

## Summary

The optional task center can trash and restore a task together with every actor's results. Ordinary task, result and legacy history routes honor the same atomic fence. Restore preserves Owner history while requiring fresh assignments and Run requests.

## Changes

- Verify signed lifecycle controls and preserve idempotent original receipts and monotonically increasing lifecycle epochs.
- Add a paged Owner trash view and bounded, resumable retention maintenance on the existing Hub. Thirty-day expiry closes recovery; authenticated maintenance retires ciphertext copies in pages, without a new scheduler or cloud resource.
- Keep shared source publications and public authority history. Unmapped, old uncommitted preparation copies explicitly require review; cleanup does not claim completion in that case.
- No production data, rollout flags, infrastructure or native Agent schedules are changed.

## Validation

- Local synthetic signed lifecycle, race, restore, expiry, result visibility and real Firestore SDK query tests.
- Repository-wide `npm run check` before commit; exact-head CI required before merge.
