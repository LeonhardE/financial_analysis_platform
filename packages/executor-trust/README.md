# Independent executor trust contracts

`@folioview/executor-trust` is an additive, opt-in public browser implementation of
`folioview.executor-trust.v1`. It exports `validateExecutorSchema`,
`verifyExecutorApproval`, `verifyExecutorLease`, `verifyExecutorRecovery`,
`verifyExecutorTransition` and `checkExecutorRetry`, with TypeScript declarations.
Its `schemas.json` matches Python's packaged `executor_trust.json`.

This is a separate distribution so existing `@folioview/encrypted-workspace` bytes,
integrity manifest and consumer release pins remain unchanged. New consumers
adopt this bundle in their own PRs. P1 and existing persistent identity, consent
and content profiles are not widened or silently migrated.

## Semantics and boundaries

[Shared Python/browser protocol and transaction requirements](../../services/common/folioview_shared/encrypted/docs/persistent-authority.md#independent-executor-trust)
cover exact Root-approved independent Policy/workload/provider/recipient bindings,
current purpose-bound short leases, original receipts, same-key recovery and
explicit upgrade/epoch migration. Inputs called expected/current must come from
independently trusted enrollment/current transactions, never from the request.

The package holds no keys, network, storage, OAuth credentials, attestation service
or generic decrypt/sign capability. Agent recovery signatures prove signing-key
possession only; actual encryption/TLS challenges and workload attestation remain
runtime obligations. Consumers must recheck source/Run/revocation fences and consume
challenges atomically. Returned objects are detached snapshots, not capabilities.

## Build and verify

Run `npm ci --ignore-scripts` in this package, then `npm run build`. The build embeds
only the required primitives from the existing checked encrypted-workspace bundle
and compiles standalone AJV validators. The resulting `dist/core.mjs` imports no
installed packages, CDN scripts or dynamic code. `integrity.json` pins this source,
schema, lock, tests, declarations, output and the exact original base distribution.
Third-party notices are retained.

Root `npm run test:contracts` discovers the additional test entry in the existing
shared test directory; no root tooling change or test dependency installation is
required. The tests use the public Node/JOSE fixture and Node's built-in ES256 signer
with known public synthetic scalars. Python verifies the Node vector and sends its
own signatures back through this checked dependency-free browser bundle. A clean
copy without `node_modules` is verified as part of delivery.

For development-only vector regeneration, install this package's locked dependencies
and run `node tests/generate-executor-trust-fixture.mjs`. Stdout contains only public
JOSE controls. The generator is not loaded by tests or consumers. Run the shared
Python suite and complete repository `npm run check` before delivery.
