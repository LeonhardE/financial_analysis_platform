# Cached daily market data and public stock search

Date: 2026-10-20

## Summary

Replace the default fictional market feed with Yahoo daily data through yfinance, while keeping
anonymous access and the existing Google sign-in. Visitors can browse three major US indices and
the Magnificent Seven, search other US stocks, and open their daily candlestick charts.

## Changes

- Map SPX, IXIC and DJI to the actual Yahoo index symbols; display indices as points and stocks as
  USD. Calculate daily changes against the preceding trading day, with consistent split and dividend
  adjustments for OHLC.
- Validate and cache daily bars, expose trading/fetch dates and partial/stale states, and return
  missing data or errors when no real cached prices exist. Fictional fixtures require explicit mock
  mode and remain clearly labeled.
- Share production data, refresh leases, cooldowns and atomic upstream budgets through Firestore.
  Use SQLite locally and refuse per-instance production limits. Bound Firestore RPCs, reuse brief
  in-process reads, and avoid unnecessary off-hours upstream refreshes.
- Add bounded, cached US-equity search with default-symbol aliases, input validation and negative
  caching. Public market requests omit identity credentials.
- Debounce search, cancel superseded requests, protect against stale price responses, sequence the
  initial overview/chart load and keep independent error/retry states. Enable chart pan and zoom.
- Document production database/IAM configuration, data semantics and the limits of cost controls.
  No paid market-data subscription, API key, Redis or scheduled worker is introduced.

## Validation

- Repository checks cover authentication regressions, frontend request races and rendering states,
  provider validation, cache persistence/concurrency, shared budgets and bounded Firestore RPCs.
  All 15 frontend and 49 backend tests pass, along with type, lint and formatting checks.
- Production frontend build succeeds.
- Local live API smoke tests returned all ten default instruments, actual daily candles, and NFLX
  search/detail results. Browser QA verified index points, extra-stock charts and a 390 px layout
  without horizontal overflow.
- A fresh-cache browser load reserves exactly ten upstream units for ten default instruments; its
  initial chart reuses the batch result without another reservation.
- Firestore IAM and Yahoo connectivity from Cloud Run require production acceptance after Console
  configuration and deployment. Local tests do not establish production availability.
