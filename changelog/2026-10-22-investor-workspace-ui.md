# FolioView investing workspace and chart ranges

Date: 2026-10-22

## Summary

Rework the existing market browser as FolioView, a compact investing workspace. The chart is the
primary view, and selecting a stock on a phone returns directly to that chart instead of requiring
scrolling through the instrument lists. Portfolio connections and creator research remain future
work.

## Changes

- Replace the large landing-page layout with a graphite market workspace, compact index strip,
  desktop symbol/search/watchlist sidebar, and an accessible native mobile symbol dialog.
- Keep public browsing, Google sign-in, private watchlist ownership, save/remove feedback, and
  unavailable/stale/simulated data states visible and distinct.
- Add selectable 1D, 1W, 1M, 3M, and 1Y ranges. The latest session uses 5-minute candles, the latest
  five sessions use 30-minute candles, and longer ranges use daily candles. Intraday charts show
  New York times and daily change remains relative to the preceding session, when available.
- Keep default 1M API behavior compatible, isolate range caches, and retain the shared upstream
  request cap and hourly snapshot policy. This change does not add a live market feed.
- Handle late and incompatible range responses without displaying the wrong chart; retain
  visible retry states during staggered API/web deployments.

## Validation

- Root `npm run check`: 33 frontend, 84 backend, and 22 deployment tests pass.
- Production frontend build passes.
- Browser checks at desktop and phone widths: picker selection closes the dialog and focuses the
  chart, search selection works, all five ranges display, and there is no horizontal overflow.
- Visual checks use explicitly labeled local mock data; no production account writes or deployments.
