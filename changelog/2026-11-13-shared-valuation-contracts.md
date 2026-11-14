# Compatible holdings facts and valuation contracts

Date: 2026-11-13

## Summary

Add pure shared contracts for cost-aware editable holdings, bounded quote/FX snapshots and
independent display-currency/follows preferences. Existing consumers and frozen encrypted
schemas remain unchanged; compatible readers must ship before new facts writers.

## Changes

- Define the distinct holdings-facts v2 resource format with market identity, quantity, nullable
  native/CAD costs, field provenance/edit times, original reported values and immutable original/previous snapshot references.
- Add explicit trusted-context reader validation, preserving the current private byte budget and
  old P1/persistent container versions without widening their original validators.
- Define public-only quote/FX batches, positive decimal strings, actual dates/times, explicit
  same-date rate routes, bounded missing/stale states and exact client valuation/coverage arithmetic.
- Preserve strict three-field v1 UI preferences; define separate currency CAS/semantic generations
  and ordered manual FX follows with persistent default suppression and pure read composition.
- Package the schemas and document adoption order, source/licensing boundaries and no-migration scope.

## Validation

- Synthetic facts/history/context, legacy strictness, decimal/FX direction, missing/stale coverage,
  large-value rounding, preference CAS/default/suppression and schema-isolation tests.
- All292 common tests passed (two existing skips), including13 new cases and independent native Intl
  decimal-string rounding checks; built wheel includes and loads the new schema.
- Normal root `npm run check` required before publication; no live market or production validation.
- No consumer, environment, capacity, paid-source or cloud-resource change.
