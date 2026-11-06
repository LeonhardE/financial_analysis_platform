# Allow a bounded delayed OAuth callback exchange

Date: 2026-11-06

## Summary

A real Muse callback attempted its token exchange at least 172 seconds after authorization
succeeded. The two-minute authorization code deadline had already elapsed, and the client
reported `invalid_grant`. New codes now allow five minutes for the callback exchange.

## Changes

- Store a five-minute absolute deadline for newly issued authorization codes, within the
  short-lived window described by [RFC 6749 section 4.1.2](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1.2).
- Preserve existing stored code deadlines across deployments. Expired codes stay expired;
  single use, replay-family revocation, PKCE, client/callback/resource binding and owner/task
  authority checks remain in force.
- Keep access tokens at ten minutes and retain the existing consent, grant and refresh-family
  limits. No frontend, helper release, Worker pin, cloud configuration or IAM change is needed.

## Validation

- OAuth tests cover the observed delayed exchange, replay rejection, unchanged access-token
  lifetime, required agent-key authority, success just before five minutes, exact expiry and
  a restart that does not revive an older expired code.
- Root `npm run check` passes.
