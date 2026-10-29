# Agent Hub encrypted vault authority and source fences

The build-only Hub stores one opaque, passkey-sealed vault archive and its root-signed public
key directory per verified Google owner. It owns up to ten public holdings-source references.
Portfolio holds the encrypted snapshots; Hub never receives CSV, positions, account labels,
content keys, passkey PRF output or private JWKs. The owner resource catalogue composes only existing
User/Portfolio discovery metadata. Neither capability implements agent authorization, encrypted Run
evidence delivery, Run execution, broker login or inbox delivery.

`GET /health` remains `{ "status": "ok", "service": "agent-hub" }`. Import, startup and health
need no Firebase/Firestore/KMS credentials, clients or network. Those dependencies are lazy.

## Owner APIs

Every owner request requires the existing verified Firebase Google identity and exact
`X-FolioView-Contract: folioview.agent-workspace.v2.0`. Bodies are closed strict JSON;
requests cannot supply an owner UID or overwrite an existing root/archive. Write operations also
require one bounded `Idempotency-Key`; source creation requires `X-FolioView-Author-Key`.

| Endpoint                                                    | Behavior                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/v2/vaults/current`                                | Current owner vault and public sources, or `vault:null`                                |
| `POST /api/v2/vaults`                                       | First enrollment only: public root, signed initial registry and opaque archive         |
| `PUT /api/v2/vaults/{vaultId}/registry`                     | Root-pinned, consecutive signed registry CAS                                           |
| `POST /api/v2/vaults/{vaultId}/holdings-sources/{sourceId}` | Current owner-device `manual_source_create` control; derived incarnation, epoch 1      |
| `POST /api/v2/vaults/current/authority-token`               | Fixed Portfolio caller/Hub audience, holdings metadata delegation valid for 60 seconds |

Bootstrap and registry writes return `{contractVersion,vault,sources}`. An exact operation replay
returns the current verified aggregate, never an old directory or archive replacement; these are
not immutable historical response receipts. Source-create replay returns its stable source.
Every replay still authorizes the current owner/root, and source replay rechecks the current
signing device/directory before returning. Account separation uses the shared owner hash, not body
fields or filenames.

The initial directory must have root/registry/key epochs `1/1/1`. Public roots are authenticated
owner enrollment on first use. The client independently protects its root pin within its
passkey archive and must refuse substitution. Ordinary Web delivery still trusts its publisher;
this does not claim protection against a malicious replacement frontend.

The archive has exactly `profile`, `ownerSubject`, `vaultId`, `rootKeyId`, `credentialId`,
`prfSalt`, `iv`, `ciphertext`. Profile is `folioview.passkey-vault.v1`; credential ID is canonical
base64url at most 2048 characters, PRF salt is 32 bytes, IV 12 bytes, and opaque ciphertext is
16–24576 decoded bytes / at most 32768 encoded characters. AES-GCM and WebAuthn PRF derivation are
client responsibilities. The backend cannot decrypt or establish whether a client encrypted
honestly; it validates bounds and public bindings only. Private keys and PRF outputs have no
accepted plaintext fields. There is no password/backup-key override, platform recovery key,
archive replacement/reset, second vault, device management UI or broad key-recovery endpoint.

## Owner resource discovery

`GET /api/v2/resources/catalogue` requires the same verified Firebase Google owner and exact v2
contract header. There is no query/body owner, upstream URL, resource selection or recipient
override. External agent/delegation credentials and `X-Serverless-Authorization` cannot replace
owner identity. Responses and failures are `no-store`.

The closed response has `contractVersion`, `profile`, `readAt`, `groups`;
`profile=folioview.owner-resource-discovery.v1`. Groups always occur in this order:

| Group kind        | Source      | Discovery source                                                       |
| ----------------- | ----------- | ---------------------------------------------------------------------- |
| `holdings`        | `portfolio` | Hub-owned signed source refs, then existing state/projection reads     |
| `watchlist`       | `user`      | Existing delegated metadata catalogue, without list content            |
| `channel_follows` | `user`      | Same metadata catalogue, without channel names, URLs or video contents |

Each group has exactly `kind`, `sourceService`, `status`, `items`. A group status is `available`,
`uninitialized`, `partial` or `unavailable`. An empty holdings group is `uninitialized`, never a
claim of zero financial positions. User groups have one entry even when their source state is
`uninitialized`; a producer outage has an `unavailable` entry rather than a fabricated empty list.
The two User kinds share one producer request, so an invalid/unavailable User response makes both
groups unavailable. Portfolio refs are checked independently; one missing replica does not hide
other registered sources or User metadata. There are at most ten holdings refs and two User entries.

Each item contains exactly `ref`, `revision`, `sourceEpoch`, `state`, `snapshotId`, `updatedAt`,
`encryptedEvidence`. Ref/revision/epoch/timestamp can be null when not initialized or unavailable.
User metadata state is `ready`, `empty` or `uninitialized`; revision zero is permitted for an empty
initialized list, not a ready one. Holdings states are `active`, `revoking`, `disconnected`,
`deleted`, `pending` or `unavailable`. `pending` means the observed producer epoch does not match
the current Hub fence. `snapshotId` is only a source pointer, never a ciphertext or decryption grant.

`encryptedEvidence=not_prepared` for User sources because this slice does not store trusted-client
encrypted list evidence. It does not fetch the plaintext list and then encrypt it on the server.
For holdings, only a successful active current-epoch projection with no snapshot pointer establishes
`not_prepared`; pointer-present, pending, terminal and unavailable states remain `not_checked`.
Neither value proves current recipient/key-epoch authorization, authenticated decryption, financial
freshness or readiness for an agent Run. No amounts, labels, symbols, counts, content digests,
registry/archive material, private keys or source credentials are returned.

This owner discovery DTO is intentionally **not** shared `ResourceCatalogueMetadata`. That encrypted
contract requires genuine key epochs and envelope fingerprints, which these producers do not expose.
The Hub does not invent those fields or return a placeholder encrypted catalogue. Future encrypted
Run consumers must obtain and validate actual prepared evidence and current recipient permissions.

The request uses lazy server-only settings `HUB_USER_ORIGIN`, `HUB_PORTFOLIO_ORIGIN` and
`HUB_CATALOGUE_CALLER_EMAIL`, plus the existing fixed Hub issuer/KMS signing configuration. The caller
email is the **Hub runtime identity**, not reverse `HUB_PORTFOLIO_CALLER_EMAIL`. Every downstream
request uses a fresh target-audience Google workload token plus a 60-second Hub-signed
`browser_catalog` / `resources:catalog` delegation with the verified owner, exact target audience
and only that producer's kinds. Browser Firebase tokens are never forwarded. Missing configuration,
producer 401/403, redirects, malformed/oversize/private-field responses and timeouts make the affected
source unavailable; they do not sign the owner out or expose upstream diagnostics.

Credential preparation and upstream metadata calls share a cooperative 12-second admission budget,
at most four request-scoped joined workers, and no more than eleven jobs. Queued work and target-lock
waits check the same budget. Metadata and producer HTTP use fixed URLs, no ambient proxies, no
redirects, identity encoding, streaming byte limits and at most four seconds per I/O. Optional KMS
timeouts use remaining budget for cold public-key retrieval and signing with `retry=None`; existing
signing/JWKS calls retain their four-second defaults. This is **not** an exact twelve-second wall-clock
guarantee: SDK client/ADC discovery and credential refresh, a final blocking read and the separate
bounded Hub database transactions are not a fully cancellable asynchronous operation. There is no
detached worker, retry loop, scheduler or persistent owner/token/metadata cache.

Hub verifies its current vault, signed registry checkpoint/key epoch, source refs and source fences
before RPCs and again afterward in separate read transactions. Changes return a conflict rather than
old active discovery. The initial epoch recorded on a vault source is only registration metadata;
fresh Portfolio metadata is compared with the actual Hub fence and cannot reset it to epoch one.
Terminal local fences are shown without reading old source data. No network call runs inside a
database transaction. The result is not a globally atomic snapshot across User, Portfolio and Hub:
later grant/Run/result consumers must recheck current source state, task/grant fences, key authorization
and transaction-bound fence guards.

Only source APIs are consumed: User `GET /internal/v2/resources/catalogue`, Portfolio
`POST /internal/v2/resources/states/read` and `POST /internal/v2/resources/projections/read`. This
change reads only Hub's own database and does not initialize lists, synchronize Portfolio authority,
read encrypted snapshots or create copies of User's mutable masters. Actual cloud trust and deployment
remain separate work; the new settings are examples, not activated cloud configuration.

## Public authority and signing

`POST /internal/v2/portfolio-authorities/read` accepts exactly
`{contractVersion,sourceId}` behind both the configured Google Portfolio workload identity and
existing FND-001 `browser_catalog`/`resources:catalog` delegation for `portfolio/holdings`.
It derives owner from the verified delegation. Agent Run tokens, other scopes, caller substitution
and self-reported root/owner fields are refused.

The response is `{contractVersion,authority}` using Portfolio's existing exact public replica
fields. Writers and device/recovery recipients derive from the current active signed directory,
maximum eight each. No archive, key packet or private data is included. Source epoch stays 1 in
this slice. Portfolio must preserve its independently advanced local source fence and compare Hub
projection version separately from its local replica version; this API cannot reset that fence.

Current owner registry updates must retain an authorized device writer plus device and recovery
encryption recipients within the budget. Replacing/revoking an old device alongside a valid new
device is supported. Revoke-all, vault locks, registry-to-source propagation, archive rewrap and
server-side retention/reset remain outside this slice. Source invalidation and immutable ACKs
are implemented separately below; this does not complete user key-management or cloud acceptance.

The owner authority-token endpoint accepts only `{contractVersion}` and signs a fixed claim set:
verified UID, configured Portfolio caller, configured Hub issuer/audience, holdings metadata only,
random operation ID and 60-second lifetime. No caller/audience/scope overrides exist.
`/.well-known/jwks.json` exposes only RSA verification fields. HTTP caching stays `no-store`;
KMS public material is cached in process for at most 60 seconds.

Production signing uses only the explicitly configured existing KMS asymmetric key **version**,
RSA PKCS1 SHA256 with a 2048/3072/4096-bit key. No private signing key is loaded from environment or
files. Public-key/signature resource names, CRC32C, digest acknowledgement and the final signature
are verified; KMS RPCs have `timeout=4,retry=None`. Missing configuration/dependency access returns
fixed 503. Tests inject fresh synthetic signing RPCs; no deployed signer or KMS key is created.
See [Google KMS integrity guidelines](https://docs.cloud.google.com/kms/docs/data-integrity-guidelines)
and [asymmetric signing](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign).

## Source invalidation and exact ACKs

`POST /internal/v2/source-fences` is a narrow reverse callback from the configured Portfolio
workload. It requires a **full signed Google ID token in Authorization**, the fixed Hub audience,
and an exact numeric service-account subject/email pin in the existing
`HUB_TRUSTED_PORTFOLIO_CALLERS` configuration. Cloud Run's potentially signature-stripped
`X-Serverless-Authorization`, Firebase identities, external agent tokens, self-reported owner
headers and additional delegation headers do not authorize it. Missing configuration fails closed;
there is no new KMS signing requirement or user-login fallback.

Unlike Hub-to-source reads, this reverse callback intentionally requires no Hub owner-delegation
JWT: it can only invalidate `portfolio/holdings`, not read data, mint grants, reactivate sources or
write results. Portfolio is trusted to report its own owner's source metadata. Its `ownerSubject`
is the existing 64-character lowercase SHA256 owner partition, **not a raw UID and not hashed a
second time**. This metadata must never be accepted from a browser or agent as authority.

The request has exactly `contractVersion`, `ownerSubject`, `mutationId`, `ref`,
`expectedSourceEpoch`, `newSourceEpoch`, `reason`. `ref` is the shared full ResourceRef;
mutation IDs use the shared 22–128-character OperationIdentifier. Epochs are strict positive safe
integers, with `newSourceEpoch = expectedSourceEpoch + 1`. Reason is one of
`account_scope_changed`, `disconnected`, `deleted`; body size is at most 8192 bytes, including
chunked requests, and the common five-second body deadline/strict JSON parser applies.

The response has exactly `contractVersion`, `mutationId`, `ref`, `acknowledgedSourceEpoch`,
`acknowledgedAt`. Fence and immutable operation ACK are written in one transaction. The operation
namespace is owner/source-service/mutationId; canonical request fingerprints bind the full owner,
resource/incarnation, epochs and reason. Same-operation/same-content replay returns identical
original ACK fields **and response bytes**, even after a later fence or restart. A historical ACK
is not the current fence. Changed content returns 409 `idempotency_conflict`; a new operation with
the wrong current expected epoch returns 409 `version_conflict`, never a replacement higher ACK.

Each owner/full resource incarnation starts at implicit epoch 1. An absent fence is read within
the transaction and cannot bootstrap at a caller-selected higher epoch. Disconnect/delete are
terminal for ordinary scope changes; disconnect may only advance to delete, while deleted sources
cannot advance again. A recreated source needs a new incarnation. Existing old fences and ACKs
are retained; no TTL or delete/reset API can silently resurrect old bindings. At most 128 mutations
are accepted per incarnation, reserving the last two slots for disconnect and deletion. Exact
receipt replay remains available at capacity.

The source must already be locally `revoking` before calling Hub. In a later independent
Portfolio consumer PR, map its pending `operationId`→`mutationId`, `resourceRef`→`ref`,
`sourceEpoch`→`newSourceEpoch`; preserve `expectedSourceEpoch` and the owner partition.
Actions fence/disconnect/delete map to the three reasons above. Only an authenticated reply matching
the current pending mutation/ref/epoch permits source-side CAS finalization. ACK loss or a crash
after ACK needs the same durable mutation, not a restarted broker session or new operation ID.
That remote Portfolio adapter and real cloud trust are not installed by this Hub-only change.

`app.fences.require_current_bindings(unit, ownerSubject, bindings)` is the integration seam for
future Run/Result transactions. It reads the same fence documents (including absent epoch-1
documents), rejects outdated epochs and terminal incarnations, and must execute **inside the same
transaction as the write**. It does not replace a fresh external active-source/epoch precheck or
current task/grant/recipient-key checks. Source `revoking` or unavailable must already fail that
external precheck; no network call belongs inside a retried DB transaction. The guard does not
mint a grant or publish a Run/result endpoint. Resource-free tasks may pass an empty binding list.

The vault/public-authority API above still reports enrollment metadata with its initial source
epoch; it must not be used as a substitute for current source status or this separate transaction
fence. HUB-002/005/006 will consume these boundaries in their own implementations.

## Storage, bounds and local verification

SQLite is local-only: private file mode 0600, immediate atomic transactions and bounded lock wait.
Cloud Run requires Firestore and an explicitly selected named database; `(default)`, SQLite and
Firestore emulator configuration are refused. `hub_vaults` contains the public directory, opaque
archive and bounded source list. `hub_operations` stores only owner/kind/fingerprint metadata.
`hub_source_fences` holds owner/full-ref/epoch/state metadata; `hub_fence_mutations` holds bounded
validated mutation metadata, a canonical request fingerprint and its original ACK. No private
positions, task/report content, user/agent keys or tokens enter these records.
No background workers, post-response tasks or database scans are used.

A vault allows at most 32 consecutive registry bundles, ten sources and 64 operation records.
There is no automatic root reset when capacity is reached; writes fail closed. Actual serialized
Firestore document/name overhead is checked against the shared storage budget, so the byte ceiling
can be reached before the count ceiling. Private success/error bodies use `no-store`; v2 errors
follow the closed shared error DTO, with no token, key, body or SDK diagnostic reflection.

From repository root:

```bash
services/market-data-service/.venv/bin/python scripts/test_services.py --service agent-hub-service
npm run check
docker build --file services/agent-hub-service/Dockerfile --tag folioview-agent-hub:test .
```

Local runtime settings are documented in `.env.example`. Health needs none of the private settings.
Tests use freshly generated synthetic keys, actual SQLite restart/concurrency and actual Firestore
SDK serialization/retry against an in-memory RPC boundary. Controlled collisions cover a writer
reading an absent epoch-1 fence before invalidation commits, retrying and rejecting stale input;
the reverse commit order; competing mutations; lost ACKs and exact operation recovery. A synthetic
writer marker tests the transaction guard, not an implemented result API. Tests do not use cloud credentials,
real broker data, a live KMS signer or an authentication bypass environment setting.

## Build-only delivery

The source registry keeps this target `build_only`. Its existing Cloud Build configuration
publishes an image and invokes the shared release helper with `_DEPLOY_SERVICE=false`; it refuses
an attempted deployment override. The container runs as UID 10001 with access logging disabled.
Its health smoke check runs with networking disabled and removes its test container.

No Cloud Run service, database, KMS key, IAM grant or trigger is created here. INF-006 and explicit
future trust/configuration approval still govern any cloud activation. MCP, OAuth, agent grants,
Tasks/Runs/Results/Inbox and broker access remain unimplemented and fail closed.
