# Expose numeric request processing timings

Date: 2026-11-14

## Summary

Existing shared HTTP consumers expose processing and live Firebase-verification
milliseconds through Server-Timing, so later authorized measurements can separate
backend work from cold startup, proxy/network time and body transfer.

## Changes

- Enclose the final FastAPI ASGI stack, including consumer-added error middleware,
  without changing service routes, bodies, CORS or private response policy.
- Keep measurements request-local across worker threads and reset every outcome;
  retain all SDK identity and live disabled/revoked-user checks.
- Emit only fixed labels/numbers, preserve existing timing headers and add no logs,
  monitoring resources, credentials, data or authorization caches.

## Validation

- Eight controlled-clock/concurrency/actual-verifier-boundary tests and six existing
  HTTP/privacy regressions passed, including errors, cancellation and non-HTTP flow.
- Public Market runs the six dependency-independent tests without installing Firebase;
  private consumers also run both real-verifier boundary tests.
- Normal root `npm run check` before commit; exact-head CI before merge.
- Shared-only foundation change; five existing backend consumers release in the
  authorized order. No online timing pass, cloud resource or capacity/rollout change.
