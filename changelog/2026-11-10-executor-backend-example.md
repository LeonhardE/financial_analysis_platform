# Align Executor enrollment launch preparation

Date: 2026-11-10

## Summary

Align the synthetic Executor workload backend name with the isolated Owner lane's
fixed `-owner-tfstate` bucket. Keep `prod/agent-executor` separate from the
Owner administrator backend. The example now names the same state convention
as the reviewed runner and candidate configuration.

Fix the image's public HOSTNAME so a randomized container ID does not invalidate
the exact Root-approved environment on first enrollment or original-key restore.
The override allowlist and full Google/current-VM measurement checks are unchanged.
Actual complete image environment and cloud proof remain later acceptance.

## Validation

- Compared the example with the source-owned runner/module backend convention.
- Checked official Docker environment precedence and retained the existing closed
  launch policy; CI builds the isolated Executor image and checks runtime health.
- Required root `npm run check` before commit and exact-head CI before merge.
- No actual backend creation, initialization, migration, plan or deployment.
