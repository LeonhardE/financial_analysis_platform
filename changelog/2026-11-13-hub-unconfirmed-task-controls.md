# Recover unsubmitted task controls

Date: 2026-11-13

## Summary

Owners can safely abandon a task-center request that never reached the service, including after its signature admission window expires. Committed requests return their original receipt.

## Changes

- Add an Owner-only narrowing endpoint and atomic operation tombstone, checked by both command and manual-intent admission.
- Preserve committed grants and original receipts; no dispatch, feature gate, infrastructure or capacity changes.

## Validation

- Signed local SQLite submission/cancellation race, delayed submission fencing, receipt recovery, scope and closed transport tests.
- Repository check before commit.
