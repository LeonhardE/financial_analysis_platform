# Simplify settings and add the default portfolio currency

Date: 2026-11-14

## Summary

Keep routine settings concise, add the independent default portfolio currency, and separate
device access, recovery and dangerous operations. Existing account preferences and security
operations retain their behavior.

## Changes

- Read/save currency through the released Config v2 namespace without changing the strict v1
  appearance/language/range payload. Preserve semantic generation, account scope and latest edits;
  reconcile conflicts and unknown writes through a read before another save.
- Use USD, English, light appearance and one month for new users. Show placeholders for unknown
  account settings and preserve confirmed currency while requests are in progress.
- Keep preference state above route changes and use a small presentation validator in the app
  shell; load security management on demand.
- Move device identifiers to verification details and group existing recovery and Root/deletion
  controls behind animated, keyboard-accessible sections. Pending operations remain visible and
  reduced-motion preferences are respected.

## Validation

- Contract, persistence, account-switch, conflict/unknown-outcome and UI interaction checks;
  18 focused security checks, TypeScript check and production Web build passed.
- Root `npm run check` runs through the normal pre-commit gate.
- Local synthetic component previews covered light/dark, desktop/narrow and expanded device review;
  no horizontal overflow observed. This is layout QA, not live acceptance.
- No backend, infrastructure, capacity or rollout-gate changes. Online/native acceptance remains
  excluded.
