# Admit owner-approved vault recovery requests in the browser

Date: 2026-10-30

## Summary

Passkey replacement and independent recovery now reach the existing Hub lifecycle routes through
AuthProvider. Previously, the browser rejected these paths before fetching a token, even though
the Worker, owner BFF and Hub already implemented the flows.

## Changes

- Add only the fixed archive, original-receipt and recovery authorization/revocation route shapes.
- Retain closed bodies, operation identifiers, owner-session fences, query denial and the prohibition
  on device-author overrides for these root-approved operations.
- Apply the existing producer body budgets and a bounded flattened signed-command shape before
  credential retrieval. Production still uses the configured same-origin BFF; local direct access
  remains restricted to the existing explicit development/loopback path.

## Validation

- AuthProvider tests: 40/40 passed, including actual crypto-generated archive/cancellation packets
  through the real provider request boundary for both BFF and local native-acceptance transports.
- Negative cases reject alternate routes, queries, header/body overrides and independent command/
  request size limits before obtaining a token.
- Web typecheck passed. No backend, cloud configuration or resources changed.
