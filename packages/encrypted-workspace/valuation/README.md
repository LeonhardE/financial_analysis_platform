# Opt-in holdings facts and valuation

This additive JavaScript module implements the shared `folioview.valuation.v1` schema and
`folioview.holdings-facts.v2` reader. Import `valuation/dist/index.mjs` explicitly; the frozen parent
core, exports, integrity manifest and strict legacy payload validators are unchanged. It has no
network, storage, provider or authentication behavior. No consumer is enabled by this foundation.

`openHoldings` accepts only a holdings context, then performs the same carrier, recipient, algorithm,
authenticated context, canonical JSON and byte-limit checks as the frozen reader. New facts use a
dedicated validator; historical holdings keep their original validator. The caller must **first**
verify the signed carrier, registry, identity and current authorization with the frozen core.
Decryption alone does not establish authority. `sealHoldingsFacts` is an explicit Owner-side writer;
do not use it until all required consumers support the format. Task/result readers are unchanged.

`holdingsFacts`, `quoteBatch`, `fxBatch`, currency and follow preference readers apply schema and
semantic checks. Facts preserve instrument market/native currency, quantity, nullable costs,
field provenance and original import references. They never reinterpret imported market value as a
current quote. `valueHoldings` uses decimal strings and BigInt arithmetic, sums before rounding,
reports unavailable positions and stale sources, and computes weights over the same valued set.
Balances remain separate from the positions subtotal. `roundDisplayAmount` rounds half-even for
presentation only. Quotes retain native currency; `displayCurrencies` returns the configured
portfolio default followed by the selected source's distinct position currencies.

The FX validator requires one observation date and checks CAD direct/inverse/cross legs against
the declared rate. This does not make reference rates real-time or grant data redistribution rights.
Default subscription composition is read-only and preserves manual pairs and generation-scoped
removal. Defaults apply only to absent preference namespaces; malformed saved data fails closed.

Build with `node packages/encrypted-workspace/valuation/build.mjs` using the parent's locked build
dependencies. The build copies the Python schema exactly and pins its hash, frozen core and all
add-on source/distribution/test files independently. Distribution imports only the frozen core;
AJV validation code is bundled (MIT, see the parent's `THIRD_PARTY_NOTICES.md`). No extra runtime
dependencies are required. Regenerate synthetic Python parity vectors with
`services/market-data-service/.venv/bin/python packages/encrypted-workspace/valuation/reference-vectors.py`.
Run `npm run test:contracts` and root `npm run check`.

Agent clients should import `valuation/dist/holdings.mjs`, the smaller holdings-only entry point.
It does not include public valuation or preference validators. Web consumers should load the full
valuation entry point only on routes that need it. Both entry points use the same facts validator
and frozen core; choosing the smaller module does not weaken any checks.
