# Task results in Task Center

Date: 2026-11-13

## Summary

Reports now appear inside their task with historical Agent attribution, unread
badges and a smooth report dialog. The separate foreground Inbox entry is removed;
existing Inbox URLs and report/revision links retain authenticated access.

## Changes

- Read both existing persistent and foreground encrypted reports through their
  original Worker verification paths. Prefetch titles without marking reports read;
  submit signed read-state only after presenting a current verified report.
- Preserve per-task filters, selection and scroll across navigation; paginate
  metadata/history with bounded caches, local failures and honest partial counts.
- Invalidate task/report display across same-root tabs after deletion, while keeping
  sealed task recovery records. Show verified manual/scheduled provenance only.
- Share optional task-center/provider route admission between browser and BFF,
  and queue private reads at two transports without coalescing fresh authority or writes.

## Validation

- Local reader, presentation, controller, transport, lifecycle and original-state
  replay tests; frontend typecheck and production build.
- Repository `npm run check` runs in the normal commit hook.
- No production business validation, native Agent invocation, feature-gate change,
  data migration or additional cloud resource is part of this change.
