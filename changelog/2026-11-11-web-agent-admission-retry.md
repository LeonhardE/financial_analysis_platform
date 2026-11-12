# Continue Agent authorization after bounded admission cooldown

Date: 2026-11-11

## Summary

Loading existing connections and reviewing tasks could exhaust the original
per-Owner request budget during a legitimate Agent authorization. The UI stopped
with a generic connection failure even though no request had reached Hub.

## Changes

- Keep the existing global, per-Owner concurrency and 30-per-minute limits.
- Mark only local admission rejections with a bounded safe retry hint; strip
  upstream hints and preserve existing generic service errors.
- Wait once and resend the exact read or operation-ID-bound sealed request, under
  the existing action deadline and account/visibility/lock cancellation fences.
- Show a simple service-busy message while waiting, without credential details.

## Validation

- Proxy tests prove denied requests never reach Hub, the unchanged minute budget
  recovers after its window, and upstream errors cannot forge retry hints.
- Browser hook tests cover exact sealed-body replay, cancellation, generic and
  malformed responses, unbound writes and the single-retry bound.
- Full root `npm run check` and normal pre-commit checks.
