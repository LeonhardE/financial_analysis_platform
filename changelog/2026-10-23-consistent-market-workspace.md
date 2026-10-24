# Align market quotes and balance the desktop workspace

Date: 2026-10-23

## Summary

Keep the chart and market radar in a consistent proportion on desktop screens, and align quote presentation across the market workspace.

## Changes

- Allocate desktop space at roughly three parts chart to one part market radar, with a 280px minimum for the radar.
- Remove fixed radar widths that made the chart dominate wider screens.
- Preserve the full-width workspace, adaptive chart height, expandable navigation and compact-screen instrument picker.
- Share one canonical daily quote across the headline, index strip, market radar and watchlist;
  prefer the Market API's optional nested quote and accept legacy quotes only from the 1M daily range.
- Keep historical OHLC intact and display a separately labelled daily-snapshot reference line.
- Merge snapshots by trading-session date, then collection time, preserving usable prices on errors
  and reflecting expiry even when an older fresh response arrives later.
- Coordinate explicit refreshes. Missing or stale selected-symbol quotes use the existing bounded,
  cached-first 1M flow; hidden watchlists remain idle and no polling or provider budget change is added.

## Validation

- Frontend type checks and all 138 Web tests passed, including the screenshot's conflicting prices,
  range switches, anonymous fallback, expiry, scope changes, refresh coordination and unchanged OHLC.
- Browser checks cover desktop proportions, expanded navigation, the compact picker and mobile overflow.
- Production build and root `npm run check` results are recorded in the PR.
