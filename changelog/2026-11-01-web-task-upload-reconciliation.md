# Reconcile saved task uploads before key renewal

Date: 2026-11-01

## Summary

Users with expired signing certificates can check whether an interrupted task save already
succeeded, then explicitly clear its local encrypted retry copy before renewing keys.

## Changes

- Add a fixed owner-only bridge for the original task-operation GET, with closed, path-bound responses.
- Verify the original task packet, historical authority, encrypted saved version and transition intent
  in the Worker without decrypting content, renewing authority or replaying any write.
- Require a fresh review and explicit confirmation before atomically replacing the exact local outbox
  row with a revision-advanced tombstone. Preserve drafts, server tasks and other pending work.
- Add English and Chinese task checks, account/session fences and recovery regression coverage.

## Validation

- Worker, IndexedDB, owner bridge, controller and bilingual UI regressions use synthetic data.
- Existing task and holdings behavior remains covered by the full Web suite.
- Full repository checks, production build and exact-head CI gate delivery.
- Native expired-certificate/cloud-workload acceptance remains separate; no real credentials are expired.
