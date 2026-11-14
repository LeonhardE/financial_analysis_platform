# Multicurrency holdings valuation and allocation

Date: 2026-11-14

## Summary

Saved holdings now show securities value, per-position values and weights in the default currency,
with local currency switching and a shared pie/bar allocation dialog.

## Changes

- Calculate quantities, native quotes, coherent daily-reference FX crosses and totals with exact
  decimals. Missing data shows priced coverage and a subtotal; cash stays separate.
- Keep native costs/prices and original holdings/history unchanged. Portfolio display options are
  the default plus this source's native currencies; individual stock pages keep native currency.
- Load cached quotes in bounded batches, refresh within existing producer quotas and reuse scoped
  memory on revisits. Currency/chart switches make no requests or ciphertext reads. Private-session
  changes clear valuation caches; no prices, account data or credentials are persisted by them.
- Lazy-load valuation code, add actual request-stage progress and dated stale/error states, and keep
  source details collapsed. Inactive pages cancel quote requests; revisits retain valid temporary
  currency choices. Responsive tables scroll internally; dialogs support reduced motion.

## Validation

- Exact large/fractional/multibatch arithmetic, missing FX/quotes, signed cash, tiny/zero values,
  chart consistency, transport bounds/cancellation, revisit reuse and lock/generation tests.
- Actual-component English/light and Chinese/dark local layouts,320px/390px overflow checks,
  pie/bar and empty states. No online/native/performance acceptance.
- Production Web build and normal root repository checks before commit.
