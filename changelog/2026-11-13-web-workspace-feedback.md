# Unify workspace layout, loading feedback and report dialogs

Date: 2026-11-13

## Summary

The workspace removes the repeated unlock banner, keeps navigation stable and presents progress
and failures beside their content. Reports open in a keyboard-accessible modal with smooth motion.

## Changes

- Move Lock into the account area, name connection navigation Agent management and progressively
  reveal holdings/device controls while keeping pending safety actions available.
- Add delayed loading/skeleton feedback, real unread badges/dots and controlled report-read
  acknowledgements. Original uncertain state commands remain explicitly recoverable after close.
- Share modal focus/Tab/Escape/backdrop behavior and bounded entry/exit animations. Cancel old
  exits for new selections and clear private content immediately on lock/route/identity changes.
- Keep the shell/sidebar/Settings mounted, use consistent widths and interruptible CSS motion,
  and respect system reduced-motion without delaying data or fabricating Agent Run states.

## Validation

- Offline UI/controller tests cover loading timing, failed-load recovery, unread acknowledgement,
  original-command replay, modal focus/keyboard/closure, owner boundaries and reduced motion.
- Normal pre-commit runs root `npm run check`; production Web build is checked separately.
- No backend/contracts, connection migration, cloud configuration or production business tests.
