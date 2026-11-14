# Canonical public instrument search for holdings entry

Date: 2026-11-14

## Summary

Provide an additive public Market search that distinguishes supported US/Canadian listings
by explicit market and currency before manual holdings entry. Existing US browsing is unchanged.

## Changes

- Return at most four verified symbol/MIC/currency/name/type identities. Preserve cross-market
  candidates and disclose incomplete candidate sets; never infer currency from an exchange.
- Reuse search currency when present and fetch matching metadata only when needed. Bound the
  provider child and reap it on timeout; valid partial results remain explicitly incomplete.
- Reuse the existing cache, provider lock, lease and upstream budget. Cache-only reads do not
  refresh; fresh, stale, empty and unavailable responses remain distinct.
- Keep the request closed to a public search query with fixed diagnostics and no-store responses.

## Validation

- All 144 Market tests passed, including eleven new offline identity/provider/cache/HTTP checks,
  actual child execution,
  missing-currency fallback, timeout/reap and cross-market identities.
- Root `npm run check` runs through the normal pre-commit gate.
- No real upstream queries, online/native/performance acceptance, infrastructure, capacity,
  rollout flags or resource changes.
