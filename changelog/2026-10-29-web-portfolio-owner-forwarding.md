# Add restricted Portfolio owner forwarding

Date: 2026-10-29

## Summary

The Web server can forward encrypted Portfolio owner requests to its fixed private service
using separate Firebase user authentication and runtime service identity. Deployed browsers
use same-origin routes and no longer select a remote Portfolio destination.

## Changes

- Add fail-closed runtime capabilities and named Portfolio routes using the existing REPO-002
  configuration contract. No infrastructure or deployment activation changes are included.
- Verify signed Google/Firebase claims before obtaining an audience-bound metadata identity;
  preserve user authentication, strip external identity headers and keep content encrypted.
- Bound paths, methods, body shapes, headers, JSON, actual streamed bytes, request lifetime,
  concurrency and per-user attempts. Preserve original signed bytes and never retry writes.
- Preserve independent Google/User/Config behavior and account-switch/logout fences; keep the
  existing direct Portfolio local-development exception restricted to both loopback endpoints.

## Validation

- Full root `npm run check` passed, including 221 Web tests, 174 shared tests and all existing
  backend, infrastructure and CI-tooling checks.
- Seventeen real synthetic RSA/JWKS transport cases and 42 client cases passed; independent
  review added two adversarial probes and verified typed-subject rejection.
- Web typecheck, production build and five loopback production-runtime checks passed.
