# Align Policy workload backend example

Date: 2026-11-10

## Summary

Align the synthetic Policy workload backend name with the isolated Owner lane's
fixed `-owner-tfstate` bucket. Keep `prod/agent-policy` separate from the
Owner administrator backend. This prevents preparation instructions from naming
a different state bucket than the actual reviewed runner.

## Validation

- Compared the example with the source-owned runner/module backend convention.
- Required root `npm run check` before commit and exact-head CI before merge.
- No actual backend creation, initialization, migration, plan or deployment.
