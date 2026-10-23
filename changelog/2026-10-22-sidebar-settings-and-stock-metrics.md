# Refine workspace navigation, settings, and stock metrics

Date: 2026-10-22

## Summary

FolioView now uses a collapsible left sidebar and a compact settings panel. Market indices align
with the chart and symbol panel. Stock detail pages also show optional valuation and volume data.

## Changes

- Move the brand/slogan to the top of a left sidebar, with Markets, Settings, account avatar, and
  sign-in/out arranged at the bottom. Collapsed actions retain icons, names, and tooltips.
- Use a narrow rail on mobile and an expandable overlay with focus containment, Escape dismissal,
  and an inert background. Keep the symbol picker and chart focus behavior.
- Remove the public-browsing/private-watchlist footnotes while retaining Refresh and useful status
  feedback. Replace settings border legends with inset headings, tighter rows, proportional
  controls, and a separate select chevron with adequate right padding.
- Show TTM P/E, latest-session volume, and market capitalization. Volume reuses daily candles or
  sums the latest New York session's available intraday bars; indices and missing volume remain
  unavailable. Keep incomplete-session and source timestamps accessible in metric details.
- Retrieve optional P/E and capitalization after usable chart data exists, through an independent
  cache probe/refresh. Cache fundamentals for 24 hours, permit dated stale data for up to seven days,
  reuse the shared refresh budget, and bound one nonqueued local Yahoo worker to 15 seconds.
- Keep absent/nonpositive valuation fields nullable, suppress capitalization without a currency,
  and distinguish fundamentals fetch time from candle data time. Mock/index requests do not make
  fundamentals calls; changing chart range does not refetch known symbol fundamentals.

## Validation

- Root `npm run check`, production frontend build, and formatting checks.
- Focused regression coverage for icon-only navigation, mobile focus/inert cleanup, authentication
  controls, settings semantics, metric ownership/formatting/session volumes, and cache/budget rules.
- Backend worker timeout test verifies the child is terminated and reaped. One read-only AAPL
  lookup returned optional TTM P/E and market capitalization successfully in about one second.
- Browser checks cover expanded/collapsed desktop navigation, 390/360 px mobile layouts, source
  labels, English/Chinese and light/dark settings, and preserved symbol selection/chart focus.
