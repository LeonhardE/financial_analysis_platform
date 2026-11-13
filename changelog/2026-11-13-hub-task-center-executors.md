# Independent task executors and task result history

Date: 2026-11-13

## Summary

Add default-off Agent Hub task assignments so a task can have zero or multiple
executors, each with independent authority, runs, receipts and plan confirmation.
Historical results remain available after an executor is removed.

## Changes

- Consume the separate task-center foundation with signed Owner controls, current
  provider/credential/version fences and per-connection task publication heads.
- Prepare assignment-namespaced triggers for the unchanged persistent manifest;
  store immutable attribution and enforce it again on content/result writes.
- Add bounded metadata-only task history across current and legacy results, plus
  recoverable per-executor progress and version-bound native plan statements.
- Ship optional private client 1.1.0 methods with signed rule verification and
  original-intent recovery; retain both prior pinned releases byte-for-byte.
- Leave the new gate off; add no cloud resources, dispatch, native jobs, live
  migration, lifecycle purge or claims of native-source attestation.

## Validation

- Real-signature SQLite and buffered-transaction tests cover multi-provider
  isolation, concurrent retries, revocation, rule changes and retained history.
- Private bundled-client tests cover signed controls and process-restart recovery;
  calendar tests cover arbitrary times, multiple weekdays and DST boundaries.
- Root `npm run check` and exact-head pull request CI are required before merge.
