# Manual holdings and position editing

Date: 2026-11-14

## Summary

Owners can create holdings manually and edit imported positions without another broker export.
Quantity, native currency and unit cost are reviewed before saving a new encrypted snapshot.

## Changes

- Add an animated, keyboard-accessible four-field editor with explicit instrument selection,
  account separation, zero-quantity removal confirmation and exact decimal validation.
- Preserve import/manual provenance, native costs, separately reported CAD costs and original
  reported values. Unknown legacy facts remain unknown. Merge imports preserve manual values;
  replacement requires consent before overwriting them.
- Bind review and save to the current owner, unlock generation, source and snapshot. Preserve
  existing ciphertext replay, cryptographic verification, historical snapshots and Agent inputs.
- Adopt the shared typed holdings-facts profile for encrypted P2 storage and P1 owner publication,
  retaining legacy readers. Do not automatically reshare data or upgrade native Agent hosts.

## Validation

- Synthetic editor, importer, revision/conflict and immutable provenance tests.
- Real browser-crypto round trips and isolated owner/Hub/SDK 1.3.0 frozen-input/report loop.
- Local English/light and Chinese/dark layouts, including 390px review with no page overflow.
- Production Web build and repository checks before commit; no online acceptance performed.
