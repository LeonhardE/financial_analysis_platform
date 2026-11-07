# Native runtime bootstrap and pairing intents

Date: 2026-11-07

## Summary

Add a gated MCP v3 bootstrap surface and immutable public-key offers for the new
persistent account profile. Key possession/client association does not issue any
financial permission or attest a protected host.

## Changes

- Expose only fixed runtime bootstrap and opaque offer confirmation through native
  MCP. Native credentials, owner login identifiers, financial inputs and arbitrary
  signing/decryption/network operations are absent from tool responses.
- Bind short-lived setup intents and one immutable signed offer to the exact
  native owner, vault, client, connection, authorization and server nonce. Existing
  registered identities resume; revoked identities do not create new setups.
- Require native client association and separately committed matching Root-certified
  identity before recording pairing observation. This creates no certificate,
  resource consent, task publication or Run capability.
- Keep public CSR possession routes separate from Google-owner observation routes.
  Reuse strict bounded MCP framing, exact Host/Origin and separate issuer/resource.
- Keep the entire new namespace disabled by default. Trusted host lifecycle,
  browser SDK distribution and owner Web approval remain following consumers.

## Validation

- Real synthetic signatures, current native ownership/nonce/replay and Root identity checks.
- Actual pinned MCP SDK discovery/bootstrap/confirmation, both supported client modes.
- HTTP and existing service-boundary regression checks; full root `npm run check`.
