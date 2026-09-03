# Initial monorepo market watch MVP

Date: 2026-09-02

## Summary

Created the first locally runnable product slice as a service-oriented monorepo: a web watchlist
and candlestick view backed by a local mock market data API, with shared quality checks for future
development.

## Changes

- Added a Next.js web client under `apps/web` with a responsive Magnificent Seven watchlist and an
  interactive one-month candlestick chart.
- Added a FastAPI service under `services/market-data-service` with fixed OHLCV fixtures for AAPL,
  MSFT, GOOGL, AMZN, NVDA, META, and TSLA.
- Added health, stock-list, and per-symbol candle endpoints.
- Kept authentication and third-party market data integrations out of this MVP.
- Added an npm workspace and root-level commands for development, builds, formatting, and checks.
- Added Prettier for TypeScript, CSS, JSON, and Markdown formatting.
- Added Ruff formatting and linting for Python.
- Added a pre-commit hook that runs the complete repository check.
- Established the `changelog/` convention for future material changes.

## Validation

- Confirmed the root workspace resolves and builds the web application.
- Confirmed all seven symbols expose 22 mock daily candles.
- Confirmed the web page and API endpoints return successful local responses.
- Confirmed Prettier, TypeScript, Ruff linting, and Ruff formatting checks pass together.
- Confirmed the local pre-commit hook is installed and invokes the complete repository check.
