# Provider connection management

Date: 2026-11-13

## Summary

Agent management presents one current connection per provider, keeps old records
in folded history, and links task configuration back to the task center.

## Changes

- Prefer the exact canonical credential; require review for ambiguous legacy
  connections. Preserve history and explicitly label unsupported providers.
- Add local typographic provider badges and scoped, short-lived slot read caching.
- Consume the existing gated provider activation API with a fresh Agent offer,
  complete retirement review, sealed original request and atomic receipt recovery.
- Reauthorization creates no task grants or automatic permission union. Existing
  disabled capabilities retain the compatible credential route.

## Validation

- Real local Worker, Hub and private-host pairing through two credential generations,
  original-receipt recovery, forged-receipt rejection and replaced-credential fencing.
- Provider grouping, connection UI, closed proxy and no-writer-fallback tests.
- Web build and full repository check before commit; no online business validation.
