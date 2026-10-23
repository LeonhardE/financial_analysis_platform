# Show watchlist quotes and make removal deliberate

Date: 2026-10-23

## Summary

Personal watchlist rows show prices and daily changes alongside each instrument. Swiping left
reveals a red removal action, and successful changes use a brief notification at the top right.

## Changes

- Reuse overview and selected-chart quotes, fetching other visible watchlist rows through the
  existing public Market API with a shared two-request queue, cache-first reads, deadlines,
  account-change cancellation, and no polling. Explicit refresh rechecks cached quotes.
- Provide swipe-to-reveal removal plus a keyboard and mouse action button. Swiping alone
  never deletes or selects an instrument; vertical scrolling remains available.
- Use red removal styling in both themes, including hover, and improve light-theme refresh
  link contrast.
- Replace persistent success messages with dismissible three-second notifications, including
  inside the mobile symbol dialog. Keep persistent errors and retry controls.
- Preserve the User and Market API contracts and stored watchlist data; this PR changes only
  the frontend and its supporting tests.

## Validation

- `npm run check`: passed.
- `npm run build:web`: passed.
- Focused tests cover bounded quote loading, refresh, request cancellation, ownership
  transitions, swipe and keyboard actions, and notification expiry and dismissal.
- Browser checks with disposable mock data passed at 1440px desktop and 390px mobile widths
  in dark Chinese and light English, including deletion and notification visibility/expiry.
