# Add an opt-in JavaScript holdings and valuation adapter

Date: 2026-11-13

## Summary

Provide a shared compatibility prerequisite for future Agent SDK and Web consumers of holdings
facts, costs, public quotes/FX and portfolio currency preferences. No consumer or default writer is
enabled by this change.

## Changes

- Add a separately pinned module while preserving the frozen legacy core, schemas and manifest.
- Validate facts, provenance, dates, bindings, requested quotes, same-date FX routes and preference
  semantics against the existing shared schema.
- Add a holdings-only authenticated decryptor for legacy snapshots and new facts, plus an explicit
  Owner writer. Signature, registry and current authorization verification remain required first.
- Use bounded BigInt decimal arithmetic for portfolio subtotals and weights, with explicit missing
  coverage/staleness and half-even presentation rounding.

## Validation

- Synthetic Python parity vectors cover exact arithmetic, missing data, stale prices, zero and
  large/fractional quantities, cross rates and rounding.
- Offline real-crypto checks cover nonexportable recipient keys, context substitution, tampering,
  legacy compatibility and strict legacy rejection of new facts.
- Distribution/schema hashes and an isolated import require no runtime dependencies or network.
