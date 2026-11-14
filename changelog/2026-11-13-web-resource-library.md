# Named resource library and CSV drop import

Date: 2026-11-13

## Summary

Resources now has three focused tabs for holdings, the existing Market watchlist, and manual
YouTube follows. Holdings can be named without rewriting financial data or changing Agent access.

## Changes

- Replace repeated resource/provider/version panels with a named holdings selector, import source,
  timestamp and a data-settings dialog. Retain access-impact confirmations and original-operation
  recovery inside the dialog. Related tasks use verified titles rather than internal IDs.
- Add Owner-only encrypted display names through the existing Hub contract and trusted Worker,
  with closed BFF/browser routes, immutable source/Root binding and sealed original-packet recovery.
  Recovering an older receipt always reads the current name again before relabeling the source.
- Reuse the shell's Market watchlist for direct add/remove; keep creators in the existing manual
  User list with optional help explaining its storage and scope.
- Share click/drop CSV validation and preview. Add import steps, drag feedback, compact loading,
  explicit new/update actions and optional first-import naming before financial upload.
- Preserve bounded verified holding caches and latest-selection fences. Names reuse bounded
  memory-only display state and clear on visibility, Owner, Root or unlock changes.

## Validation

- Actual Owner Worker, browser encrypted storage, Python/JOSE interoperability and local Hub tests.
- Auth/BFF admission, streamed limits, uncertain rename/recovery, stale-response and account fences.
- Resource tab, shared-watchlist, file chooser/drop, settings, first-import ordering and rapid-switch tests.
- Root `npm run check` and frontend production build required before publication.
- No online business validation, production migration, feature-gate or cloud-capacity changes.
