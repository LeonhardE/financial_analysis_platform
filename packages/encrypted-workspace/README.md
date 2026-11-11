# Shared persistent browser contracts

Version 1.0.0 is an offline trusted-client implementation of the existing
`folioview.persistent-agent-identity.v1`, `folioview.persistent-resource-consent.v1`
and `folioview.persistent-content.v1` contracts. It introduces no wire or P1 changes.
The pure implementation is extracted from the independently checked Hub runtime
core delivered in PR #151. Hub and Web consumers adopt it in their own PRs.

It verifies Root registry chains, original owner/device identity bindings,
resource approval/revocation chains, exact encrypted task/resource/report bindings,
frozen Run manifests and request proofs. Results establish public integrity under
caller-selected trusted expectations; they do not replace current ownership,
permissions, source epochs, Run or operation fences at the service boundary.

The `owner_history` verifier purpose belongs only inside a trusted owner reader,
with independently selected issuance registry and immutable Run/receipt expectations.
Never expose that purpose as a model or HTTP selector. Likewise, raw primitives
are internal composition functions, not a generic application sign/decrypt API.

This package holds no keys, storage, network, OAuth credentials, Worker dispatcher
or UI. Private CryptoKey handles stay inside each consumer's existing closed Worker.
Root/owner private material must never reach an Agent or a page-facing interface.

## Reproduce and consume

Use the exact package lock with `npm ci --ignore-scripts`, then `npm run build`.
Build-time AJV emits standalone validators; the checked browser ESM bundle imports
no packages, CDN scripts or dynamic runtime code. The distribution manifest pins
source, schema snapshot, dependency lock, declarations, tests and bundle bytes.
Consumers may statically import `dist/core.mjs`; adjacent `core.d.mts` provides types.
Consumer builds include the checked bundle and its digest and remain independently
verifiable. Releasing a shared fix does not silently rewrite older fixed assets.

`npm run test:contracts` at the repository root is mandatory locally and in the
repository CI job. It checks the independent public Node/Python vector, actual
nonexportable WebCrypto decryption, original identity/registry signatures, tamper
and pin denial, strict JSON/schemas, hashes and isolated dependency-free import.
Existing live Python/Node and service consumer tests remain separate checks.

The schema snapshot preserves the four shared documents without definition-name
collisions. Money/date/URL/private-content semantic checks accompany AJV structure
checks. No real account data or private key fixture is stored in this package.

Owner-approved 90-day credential leases are documented in the
[credential lifecycle contract](../../services/common/folioview_shared/encrypted/docs/agent-credentials.md). The profile is additive; consumers must
implement atomic replacement and current-generation fences before enabling it.
