# Restore authenticated FX subscription requests

Date: 2026-11-14

## Summary

The Market FX panel could not read subscriptions because the browser's authenticated request
boundary rejected its User endpoint before sending a request. Retrying repeated the same failure.

## Changes

- Admit GET and bounded CAS PUT only for User's exact `/api/v1/fx-follows` endpoint.
- Validate the version, closed preference shape, supported currency pairs and default suppression
  before obtaining a token. Preserve account/session fencing and no-store transport.
- Exercise the actual FX store through the authenticated provider, including initial read,
  subscription save, account changes and rejected routes, methods, headers and malformed updates.

## Validation

- The new integration regression failed on the initial subscription read before the fix.
- Focused FX/Auth checks: 80 passed. Full root `npm run check` passed with Node 24.12,
  including 1014 Web regressions. Production Web build passed.
- Production reread remains pending publication of this fix; no subscription was changed online.
