# FolioView Web

The workspace keeps Markets as its default view and groups navigation at the bottom of the
sidebar. Resources adds a Wealthsimple holdings CSV import with client-side encryption and an
explicit account/coverage preview. Robinhood and Interactive Brokers remain disabled future
adapters; a transaction ledger is not treated as a current holdings snapshot.

## Import and privacy behavior

1. Sign in with the existing Google/Firebase flow.
2. Create or unlock the system-managed Passkey that protects the encrypted owner archive. There
   is no manual key file or additional password fallback. Unsupported PRF capabilities fail closed.
3. Select a holdings CSV. Parsing, decimal/currency checks, preview and account selection happen
   in the browser. The original file is not uploaded.
4. Confirm the selected holdings. A Worker produces the exact formal v2.0/P1 JWE/JWS carrier;
   only public authority/control material and ciphertext go to Hub/Portfolio.
5. Saved holdings are verified and decrypted in the browser. Navigation within the app preserves
   the current unlocked session; lock, logout, account change or app unmount terminates the Worker.

Google login establishes identity; it is not content-key derivation material. The system Passkey
PRF protects the cloud archive containing the owner's root/recovery keys. Browser device keys
are distinct and locally sealed, and runtime private key handles are nonextractable. Losing every
usable copy of the protecting Passkey can make the existing library unrecoverable by the platform.
Provider support and synchronization must be tested on each supported browser/device combination.

The privacy model trusts the published frontend implementation. Database, backup, log and backend
operators do not receive user content keys or plaintext holdings. It does not claim to prevent
an actively malicious replacement frontend from stealing data after the user unlocks it.

IndexedDB stores sealed key material, public root/checkpoint pins and exact encrypted outbox
packets. Atomic transactions prevent cross-tab packet replacement, mismatched deletion or pin
rollback. Pending sealed device registration survives a lost response without allocating another
device key. Snapshot retries resend the original carrier; conflicting pending imports have an
explicit receipt-check and local-discard recovery flow that does not delete server history.

## Wealthsimple format and supported content

The guide follows Wealthsimple's official web export workflow:
[Request a custom statement](https://help.wealthsimple.com/hc/en-ca/articles/35654428540571-Request-a-custom-statement).
Choose **Holdings report (CSV)**, the desired date and accounts, then download the file.
The official article describes field groups but publishes no exact CSV header specification.
The current adapter matches one supplied 21-column export shape, using entirely synthetic tests.
Unknown/missing columns, malformed records and oversized input stop import rather than guessing.

The importer retains selected account labels, stocks/ETFs, quantities, currencies, reported market
values and conservatively verified reported cash. Unit-price, book-cost, return and date-only
report-label columns are not retained in the current frozen private holdings schema. A date-only
label is shown in preview, while saved `sourceAsOf` remains unknown; import time is separate.
Cash that is not reported stays unknown, buying power is not inferred, and CAD/USD are never
combined without an explicit FX source. Unsupported assets/directions remain visible as exclusions.

## Local configuration and boundaries

See [.env.example](.env.example). The encrypted workspace requires explicit build-time origins:

- `NEXT_PUBLIC_AGENT_HUB_API_BASE_URL`
- `NEXT_PUBLIC_PORTFOLIO_API_BASE_URL`

Both may be HTTPS origins, or localhost/127.0.0.1 HTTP for local testing, without paths or trailing
slashes. Missing or malformed values disable cloud import; there is no fallback to Market's private
routes. The Dockerfile declares optional arguments, but configuring remote build substitutions and
cloud trust is a separate infrastructure change. Runtime variables alone cannot change compiled
`NEXT_PUBLIC` values. This feature does not provision or activate Hub/Portfolio.

The authenticated request client restricts each service's exact paths, methods, body fields and
contract headers, rejects arbitrary destinations and identity-header overrides, and fences late
responses when an account changes. Bodies, bearer/delegation tokens, PRF output and private keys
are not placed in URLs, localStorage, analytics or error messages.

## Validation

Run `npm run test:web`, `npm run typecheck:web`, `npm run build:web` and root `npm run check`.
Tests cover synthetic CSV edge cases, precise decimal/currency handling, actual WebCrypto/JOSE,
formal schema identity, Native IndexedDB-style cross-tab transactions, Passkey UV/PRF requirements,
owner/session races, exact replay/receipt recovery, and React text escaping. The extra Node/Python
interoperability case runs when the repository Python environment is available and otherwise
explicitly skips; pure browser-crypto tests remain mandatory. Physical Passkey providers and real
Google login are separate device acceptance, not claimed by synthetic mocks.
