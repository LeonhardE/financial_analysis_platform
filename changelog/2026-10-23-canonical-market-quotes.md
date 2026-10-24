# Provide one daily quote alongside every chart range

Date: 2026-10-23

## Summary

Expose a common daily quote so clients can show consistent prices and daily
changes across stock details, market lists and watchlists without substituting
one chart interval's last bar for another interval's quote.

## Changes

- Add a nullable `quote` to candle responses using the existing 1M daily cache;
  preserve every historical OHLC and legacy range field.
- Keep the quote's own session date, collection time, staleness and adjustment
  basis, with a previous close only when an actual prior daily bar exists.
- Reuse the current 1M result or mock daily fixture; other ranges only read an
  existing daily snapshot. Missing or unavailable quote data does not fail charts.
- Leave cache writes, upstream requests, refresh leases, TTLs and budgets unchanged.

## Validation

- Market service tests cover cross-range identity, cached and fresh responses,
  unchanged legacy fields/cache values, missing/expired/unavailable daily data,
  independent staleness, honest missing prior closes and explicit mock behavior.
- Market Ruff lint and formatting checks pass. Tests use mocked Yahoo/Firestore
  boundaries and do not make live market-data requests.
