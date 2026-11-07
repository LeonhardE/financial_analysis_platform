# Independent browser protocol checks in CI

Date: 2026-11-07

## Summary

Give browser cryptography tests an explicit Python peer environment in the Web CI job.

## Changes

- Select Python 3.13 and pass its executable through the existing test configuration variable.
- Install the shared validators and Hub runtime dependencies used by synthetic protocol fixtures,
  with the same dependency cache inputs as the Hub job.
- Keep target selection, isolated backend images, aggregate checks and cloud permissions unchanged.
  These checks use fresh synthetic keys and local stores; they do not contact a live account.

## Validation

- Full repository `npm run check` before commit and complete selected-target CI before merge.
