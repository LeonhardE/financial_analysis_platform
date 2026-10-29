# Encrypted Wealthsimple CSV import in Resources

Date: 2026-10-28

## Summary

Resources now guides owners from Wealthsimple's web holdings export through local CSV preview,
account selection, encrypted server save and browser-only viewing, while Markets remains home.

## Changes

- Add a bounded, broker/report-type-specific parser for a supplied 21-column Wealthsimple format,
  exact decimal arithmetic, separate CAD/USD values, verified reported cash and visible exclusions.
  Provide official export instructions and explain which content the current schema retains.
- Protect owner archive and per-browser keys using system Passkey PRF, AES-GCM sealing and a
  terminated-on-lock Worker. Use the unchanged formal v2.0/P1 JWE/JWS and public directory schemas.
  No original CSV, plaintext holdings, user private key or PRF output is sent to the backend.
- Preserve root/history pins, distinct new-browser device registration, durable sealed pending
  registration, and atomic cross-tab outbox/pin updates. Retries use original ciphertext; stale CAS
  has explicit receipt-check/local-discard recovery without deleting cloud history.
- Add closed named Hub/Portfolio request routes and optional explicit build-time origins. Preserve
  Google login and account/session fencing. Missing origins or unsupported PRF stay closed.
- Keep Resources mounted across in-app navigation, expose lock and privacy states, retain bottom
  navigation and existing themes, and provide English/Chinese and narrow-screen layouts.
  Robinhood and Interactive Brokers are future adapters, not enabled integrations.

## Validation

- Synthetic parser, browser crypto, real IndexedDB transaction simulation, UI, session-race and
  request-boundary tests cover the implementation; actual Node/Python crypto interoperability and
  the local Hub/Portfolio HTTP ciphertext roundtrip are also exercised with synthetic identities.
- All 195 Web tests, the production Next.js build and the complete root `npm run check` pass.
  Remote CI is required before merge.
- Physical Passkey provider and real Google login are not claimed as tested. No cloud resource,
  production origin/trust activation or database migration is included.
