# Allow same-origin owner writes behind the Web container

Date: 2026-10-31

## Summary

Fix legitimate browser writes being rejected as unauthorized when Next standalone exposes
the container address in the route handler URL. This prevented remote resource-library
enrollment after Passkey creation and would also block encrypted holdings saves.

## Changes

- Use one Web-only origin guard for Hub and Portfolio owner forwarding, comparing browser
  Origin against the incoming Host and request protocol rather than the container hostname.
- Ignore forwarded host selectors and reject cross-site requests, mismatched schemes/ports,
  opaque origins and malformed or ambiguous Host values before identity acquisition.
- Preserve Firebase verification, private Portfolio workload identity, encrypted body bytes,
  route bounds and the existing behavior for authenticated callers without Origin.

## Validation

- Reproduced the deployed failure without credentials: a public same-origin enrollment POST
  returned 403 while the otherwise identical request without Origin reached authentication.
- Hub and Portfolio owner tests: 36 passed, including four new regression tests for remote
  enrollment, snapshot forwarding, cross-origin rejection and forwarded-host spoofing.
- Full repository `npm run check` runs before the commit is created.
