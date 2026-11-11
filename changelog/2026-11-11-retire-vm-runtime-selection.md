# Close obsolete VM runtime selection

Date: 2026-11-11

## Summary

After the unused Executor target was removed, remove its generic Docker probe
branch and refuse new runnable Confidential VM registrations.

## Changes

- Keep historical VM metadata readable for authenticated Git comparisons and
  retain nonexecutable terminal target records.
- Permit current executable runtime registration only for Cloud Run, before any
  build/credential/cloud operation.
- Remove VM-specific smoke and synthetic fixtures; preserve isolated HTTP health
  for supported services and update first-provision fixture ownership.

## Validation

- Root `npm run check`.
- Historical metadata versus runnable registration, terminal source removal and
  no-Docker rejection tests; supported Cloud Run health remains isolated.
