# Restore daily FX data from supported Bank of Canada series

Date: 2026-11-14

## Summary

The Bank of Canada daily group returns each series' latest observation, including old dates for
retired currencies. The strict single-date FX reader rejected this multi-row group and returned
missing rates even though current supported currency data was available.

## Changes

- Request the fixed eleven supported non-CAD series in one Valet API call instead of the entire
  group, excluding retired series without loosening same-date or decimal validation.
- Preserve the existing response size, subprocess deadline, shared budget, refresh lease,
  cooldown and stale-data handling.
- Exercise the actual provider worker against the multi-date group response and the exact
  supported-series response. The regression fails with the previous group request.

## Validation

- The official supported-series endpoint returned one observation dated 2026-11-13, while the
  group included additional 2019 and April 2026 observations for retired currencies.
- Focused FX suite: 17 tests passed, including the new real-worker regression.
- Full root `npm run check` is enforced by the pre-commit gate; release and live reread results
  are retained in the local acceptance evidence.
