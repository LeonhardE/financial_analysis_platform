# Reconnect Muse through an already unlocked owner page

Date: 2026-11-06

## Summary

The Hub consent page supports the Web reconnect entry point delivered separately. An owner
can copy the public pending-request link into their already unlocked Agent page, which opens
an origin- and source-bound Hub bridge without replacing the owner's in-memory library session.

## Changes

- Show a copyable public request locator alongside the existing first-time sign-in/unlock path.
  The original pending request, expiry, OAuth cookie and server approval checks remain in force.
- Add an explicit owner-initiated reuse mode. It offers only the request identifier and random
  nonce to the actual opener at configured owner origins, then binds the existing owner-only
  MessagePort to the verified ready message. No owner window is opened or navigated in this mode.
- Retain opener isolation, exact message validation, one-use ports, callback validation and
  owner credential boundaries. Failed initialization and closed owner pages clean up the bridge.
- Rebuild the fixed consent asset without changing either released private-key Worker or its pin.

## Validation

- Thirteen controller-wire/page tests pass, including forged messages, missing/closed openers,
  first-time flow compatibility, exact public links, reuse mode and rejected query extensions.
- Native Chrome with synthetic localhost origins verifies two successive new requests while
  retaining one non-extractable-key Worker. Only the temporary fixture's origin allowlist is
  adapted for localhost; production origin restrictions remain unchanged.
- Full root `npm run check` passes; the helper distribution builds reproducibly.
