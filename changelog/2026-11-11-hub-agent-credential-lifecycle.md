# Add atomic Agent-owned credential replacement

Date: 2026-11-11

## Summary

Let an Owner replace a personal Agent credential through fresh approval, while
immediately fencing previous credentials and preserving readable report history.
The new admission capability remains disabled by default.

## Changes

- Add Owner-scoped setup, public lease state, atomic generation replacement and
  immutable receipt APIs. Private Agent keys never enter the Hub.
- Keep current generation/parent markers consistent, preserve legacy tombstones,
  archive original bindings and retain consent history in separate generations.
- Enforce expiry and current identity on persistent access and final result
  transactions; close legacy financial OAuth bypass while preserving Native
  bootstrap refresh.
- Resolve historical reports with their original signed identity after replacement.

## Validation

- Root `npm run check`.
- Real-signature SQLite concurrency and Firestore SDK abort/retry tests; Owner,
  audience/intent/generation, transport and expiry rejection cases.
- Real PoP/JOSE session and result flows, expiration/replacement during producer
  reads, immutable receipts and independent Owner report decryption.
- No deployment, actual connection migration or online validation.
