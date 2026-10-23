# Bilingual workspace settings with account preferences

Date: 2026-10-22

## Summary

FolioView now includes a Settings view for appearance, interface language, and the initial chart range.
Guests can try every preference during their visit; only verified signed-in accounts persist settings.

## Changes

- Add light, dark, and system appearance, including chart colors and responsive settings controls.
- Use next-intl with separate English and Simplified Chinese ICU catalogs, locale-aware number/date
  formatting, translated accessibility labels, and the matching HTML language. Market currencies
  remain unchanged.
- Keep guest preferences in memory. Restore signed-in preferences across devices, isolate account
  changes, debounce saves, and show recoverable load/save errors without overwriting a failed load.
- Add a strict, authenticated preferences API backed by the existing Firestore permissions in Cloud
  Run and SQLite locally. Responses are private and non-cacheable. Transactional version checks
  prevent delayed saves from overwriting newer changes.
- Preserve the user's manually selected chart range when account defaults arrive later.

## Validation

- Root `npm run check` and production frontend build.
- Regression coverage for guest/account ownership, late and timed-out responses, strict API
  validation, private cache headers, concurrent saves, and both translation catalogs.
- Browser verification of Chinese/light mode, mobile settings without horizontal overflow, guest
  refresh reset, and mobile selection returning focus directly to the chosen chart.
