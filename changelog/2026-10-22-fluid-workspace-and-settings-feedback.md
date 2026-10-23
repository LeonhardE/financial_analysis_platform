# Fill the desktop workspace and simplify settings feedback

Date: 2026-10-22

## Summary

The market workspace now uses the available desktop width and height instead of leaving large
outer margins. Chart prices and company metrics share one consistent section below the chart.
Settings confirmations are temporary and no longer reappear when returning to the page.

## Changes

- Remove the market page's width cap and let the chart grow into spare desktop height, while
  preserving readable minimum chart sizes and the existing mobile layout.
- Keep the desktop symbol picker within the viewport with scrolling when needed; chart resizing
  continues to follow sidebar expansion and window resizing.
- Combine open, high, low, close, P/E, trading-session volume, and market cap below the chart, using
  consistent labels and value typography with responsive columns and locale formatting.
- Show a successful account save as a three-second, accessible confirmation in the top-right
  corner. Restored preferences and revisiting Settings do not replay an old success message;
  loading, saving, and actionable failure feedback remain available.
- Hide the workspace footer on Settings.

## Validation

- `npm run check`: passed (91 web, 138 API, and 22 deployment tests, plus types, lint, formatting).
- `npm run build:web`: passed.
- Browser checks: 2560×1320 and 1920×1080 desktop, 1280×800 laptop, 390×844 and 360×800 mobile;
  no horizontal overflow, unified metrics below the chart, sidebar resize behavior, English and
  Chinese, dark and light themes, Settings visibility and footer removal.
- Regression tests cover save confirmation expiry, returning to Settings, cancellation on a new
  save/error/logout/unmount, selected-symbol isolation, and locale-formatted chart values.
