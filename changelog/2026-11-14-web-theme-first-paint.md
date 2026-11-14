# Apply the selected theme before first paint

Date: 2026-11-14

## Summary

Refreshing a signed-in workspace briefly showed the default light theme while authentication and
Config preferences loaded, even when the account followed a dark system appearance.

## Changes

- Apply a small synchronous head bootstrap before body content paints. Use the last confirmed
  theme mode when available, otherwise use the current system appearance while the account loads.
- Keep that appearance through authentication and Config loading; apply authoritative account
  preferences before repaint and continue following system appearance changes.
- Store only `light`, `dark` or `system` as a display hint. Clear it on logout/account changes,
  retain ordinary light defaults for guests, and tolerate unavailable browser storage.
- Cover pre-hydration appearance, delayed identity/Config, explicit theme overrides, blocked
  storage, unsaved edits, account switching, logout and head-script placement.

## Validation

- Focused preference checks: 20 passed. Full root `npm run check` passed with Node 24.12,
  including 1014 Web regressions. Production Web build passed.
- All eight generated HTML pages place the theme script before body content.
- Production refresh validation remains pending publication of this fix.
