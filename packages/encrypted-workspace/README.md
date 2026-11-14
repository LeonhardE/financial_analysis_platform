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

Each `Registry.load` reuses successful certificate JWS verification only within
that single load. Its key binds the complete public Root, pinned Root key ID,
verification profile and complete protected/payload/signature bytes. Private input
snapshots and result copies prevent mutations across an asynchronous verification
or a later hit. At 128 entries or 1 MiB of encoded key and payload bytes, new entries
fall back to ordinary verification. Pending work and failures are never retained.
Every checkpoint is still verified; all existing schema, identity, chain, digest,
active/revoked, time and epoch checks remain. The memo retains no Registry instance,
authorization result or cross-load/Worker/session state, and adds no public API.

`tests/registry-memo.test.mjs` uses real WebCrypto to compare original authority and
all schema checks, exercise exact signed-input isolation, both capacity bounds and
mutation during an await. It also loads the source against the checked self-contained
crypto distribution, so repository checks need no build dependencies or generated
validator files. A test-only ESM export reaches the private verifier for the defensive
byte bound; production source and distribution expose no memo interface.

The schema snapshot preserves the four shared documents without definition-name
collisions. Money/date/URL/private-content semantic checks accompany AJV structure
checks. No real account data or private key fixture is stored in this package.

Owner-approved 90-day credential leases are documented in the
[credential lifecycle contract](../../services/common/folioview_shared/encrypted/docs/agent-credentials.md). The profile is additive; consumers must
implement atomic replacement and current-generation fences before enabling it.
