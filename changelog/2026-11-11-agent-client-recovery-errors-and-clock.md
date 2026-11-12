# Recover Agent client task failures accurately

Date: 2026-11-11

## Summary

Agent task-policy and report-format failures now explain the needed correction without
incorrectly asking the user to authorize again. A new run can wait briefly for a host
clock lag before applying the same strict manifest checks.

## Changes

- Publish client 1.0.1 with fixed error messages for policy, report, state, run-time and
  temporary service failures; credential failures remain closed.
- Wait at most two seconds for real monotonic time before fully reverifying a new
  manifest. Keep original expiry, binding, consent and replay checks unchanged.
- Preserve exact sealed outbox retries, including when later report arguments differ.
- Retain the original 1.0.0 client, integrity manifest and notices at their original
  versioned URLs and independent digest. No automatic host update or credential rotation.

## Validation

- 15 targeted Hub tests passed, including six CLI error-boundary cases, old download
  immutability, real encrypted transactions, timing rejection boundaries and outbox retries.
- The new-run clock-lag regression failed before the fix with `run_expired`.
- Root `npm run check` passed through the normal pre-commit hook.
