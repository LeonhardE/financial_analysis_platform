# Define independent task assignments and result lifecycle

Date: 2026-11-13

## Summary

An additive shared contract separates task definitions from zero-to-many current
Agent assignments and freezes actual actor/run/input attribution. Compatible
consumers can reuse existing encrypted content without colliding on shared slots.

## Changes

- Add closed task/assignment/run/progress schemas and current Owner-signed CAS plans.
- Define nullable schedules with user-selected days/time/IANA zone, explicit DST and
  effective boundaries; separate bounded signed manual intents from scheduled-source proof.
- Namespace triggers per assignment, retain old manifest formats and distinguish
  result receipt from native-cycle success or unresolved execution acknowledgements.
- Define 30-day coupled trash/restore/purge epochs; restore history without restarting
  executors, preserve tombstones and shared Root/certificate/history boundaries.

## Validation

- Synthetic signature/role/CAS, multi-provider namespace, manual intent, calendar/DST,
  provenance, manifest/input binding, restore/purge and progress tests pass.
- Normal pre-commit runs root `npm run check`; packaged JSON inclusion is checked.
- No consumer activation, native-source/dispatch availability claim, account migration,
  production business validation, data deletion or cloud resource provisioning.
