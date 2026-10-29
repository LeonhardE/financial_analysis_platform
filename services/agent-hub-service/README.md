# Agent Hub encrypted vaults, tasks and delegated authorization

The build-only Hub stores one opaque, passkey-sealed vault archive and its root-signed public
key directory per verified Google owner. It owns up to ten public holdings-source references.
Portfolio holds the encrypted snapshots; Hub never receives CSV, positions, account labels,
content keys, passkey PRF output or private JWKs. The owner resource catalogue composes only existing
User/Portfolio discovery metadata. These owner capabilities do not deliver encrypted Run evidence,
execute Runs, log into brokers or deliver inbox results.
Owner task management stores signed encrypted rules and immutable versions without opening them.
The separately configured Muse OAuth foundation handles delegated API permissions and connection
state. It is disabled by default and does not itself grant content decryption or start an agent.
The separately gated [encrypted preparation protocol and foreground helper](PREPARATIONS.md)
publish owner-encrypted copies to one explicitly authorized agent, without creating a Run.
The [Run producer](RUNS.md) freezes those committed deliveries into formal manifests and serves
authorized immutable input pages. It does not execute a model or submit a result.

`GET /health` remains `{ "status": "ok", "service": "agent-hub" }`. Import, startup and health
need no Firebase/Firestore/KMS credentials, clients or network. Those dependencies are lazy.

## Owner APIs

Every owner request requires the existing verified Firebase Google identity and exact
`X-FolioView-Contract: folioview.agent-workspace.v2.0`. Bodies are closed strict JSON;
requests cannot supply an owner UID or overwrite an existing root/archive. Vault/source writes also
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

`encryptedEvidence=not_prepared` for User sources because source discovery does not certify
per-grant encrypted preparation copies. It does not fetch plaintext lists and encrypt them on the server.
For holdings, only a successful active current-epoch projection with no snapshot pointer establishes
`not_prepared`; pointer-present, pending, terminal and unavailable states remain `not_checked`.
Neither value proves current recipient/key-epoch authorization, authenticated decryption, financial
freshness or readiness for an agent Run. No amounts, labels, symbols, counts, content digests,
registry/archive material, private keys or source credentials are returned.

This owner discovery DTO is intentionally **not** shared `ResourceCatalogueMetadata`. That encrypted
contract requires genuine key epochs and envelope fingerprints, which these producers do not expose.
The Hub does not invent those fields or return a placeholder encrypted catalogue. Future encrypted
Run consumers obtain and validate committed prepared evidence and current recipient permissions;
the discovery DTO itself remains insufficient.

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

## Encrypted owner tasks

Task APIs use the existing verified Firebase Google owner, exact v2 contract header and `no-store`
responses. Writes also require one `Idempotency-Key` and `X-FolioView-Author-Key`. A browser owner
cannot supply another owner partition, an agent/delegation header or a workload token as owner
authority. Unknown fields, duplicate JSON members, duplicate resource refs and unsupported queries
fail closed through the existing bounded body/error transport.

| Endpoint                                        | Behavior                                                |
| ----------------------------------------------- | ------------------------------------------------------- |
| `GET /api/v2/tasks`                             | Bounded public metadata page; `limit` and `cursor` only |
| `GET /api/v2/tasks/{taskId}`                    | Current encrypted version                               |
| `GET /api/v2/tasks/{taskId}/versions/{version}` | One immutable encrypted historical version              |
| `POST /api/v2/tasks`                            | Create active version 1 with expected version 0         |
| `PUT /api/v2/tasks/{taskId}`                    | CAS rule/scope edit with a newly signed envelope        |
| `POST /api/v2/tasks/{taskId}/transitions`       | Signed pause, resume or terminal archive                |

Create has exactly `contractVersion`, `taskId`, `expectedVersion`, `resourceBindings`, `envelope`.
Update omits the body `taskId`; transition adds `transitionIntent`. `envelope` is the existing shared
Carrier, with `contractVersion` and `signedObject`. The task context binds the same task ID and
next task version, operation ID, expected version, resource bindings, current checkpoint/key epoch,
author and owner-device/recovery recipients. The server derives shared `TaskMetadata` including
status, `executionEpoch`, version, timestamps and envelope fingerprint; clients cannot set them.
Responses use shared `EncryptedTask`, preserving the signed object and original public `KeyProofs`.
Create returns 201 on first save and 200 on exact replay; update/transition return 200.

Only a current `device_sig` writer may save, with every currently authorized owner `device_enc` and
`recovery_enc` recipient. Registering an agent key is insufficient: no Task recipient is granted to
an agent by this API. Formal agent grants and Run delivery remain separate consumers. New writes
require the current root-pinned checkpoint. A state transition also requires the existing device
control signature committing the same author, operation, task, expected/next versions, next epoch
and exact next envelope fingerprint. Generic control commands cannot bypass this intent.

Every edit, including pause/resume/archive, advances `taskVersion` and retains prior ciphertext.
An ordinary encrypted rule edit keeps `executionEpoch`. Changes to the public set of full resource
refs/epochs, a current registry key-epoch change, pause or archive advance it once; reordering the
same binding set does not. Resume preserves the current epoch unless the key epoch changed, and
requires a new version. Transitions cannot simultaneously alter the public resource set: save the
scope change separately. Archive is terminal; there is no irreversible purge or unarchive API.
The server cannot inspect encrypted account selection, input policy, titles, output sections,
language, time zone or private schedule. An unlocked client must apply templates and validate
private `TaskContent`; backend signature acceptance is not private-schema or AEAD-tag validation.
An immediate execution invalidation needs an explicit pause/public scope fence. New task versions
do not silently expand an existing agent grant's allowed versions or rewrite a Run's frozen rules.

Create, changed resource bindings and resume first verify selected refs/epochs against available
current owner discovery metadata. This occurs outside the transaction. Final registry/CAS and
Hub source-fence checks occur together inside the write transaction. Same-binding active rule
edits check local fences without a source RPC. Paused rule edits, pause and archive remain possible
during source outages; pause/archive do not depend on an active external source. Zero-resource
custom tasks use the same encrypted contract with no source calls. Discovery selection is neither
prepared encrypted evidence nor an agent grant, and later Run consumers still need current
source/grant/task/key checks. No network call runs inside a retried database transaction.

The task head, immutable version, operation record and owner index commit atomically in SQLite or
Firestore. Competing expected versions return `version_conflict`. Reusing an operation with changed
ciphertext or bindings returns `idempotency_conflict`; exact same-envelope replay returns the
original encrypted version even after later edits and never rolls back the current head. Legal
signature variants are compared through the shared signing-input fingerprint. Replay still checks
current writer/recipient/key-epoch authority, so revoked keys cannot recover writes as fresh
authority. Historical reads instead verify the retained checkpoint, certificates, signature and
public recipient bindings at the original save time: an author revoked or expired today does not
make a formerly valid owner history unreadable. Historical proof or stored receipt corruption
fails closed. A backwards server clock rejects a new version before commit; saved exact replays
remain recoverable.

Lists return only shared `TaskMetadataPage`, never private task text or encrypted carriers. They
default to 20 entries, allow at most 50, and sort by opaque task ID. A cursor is a persistent random
reference bound to this authenticated owner/vault, page size and exact metadata snapshot, expiring
after 15 minutes. Updates invalidate that snapshot; foreign, expired or malformed cursors fail.
It is not an authorization credential. Search, title sorting, status filters and offsets are not
accepted. At most 32 live cursor records are retained per owner/vault, without a new server secret.

This slice retains at most 32 tasks, 50 versions per task and 128 operation records per task, with
no automatic history eviction. Ordinary edits/resume stop at version 48, reserving version 49 for
pause and version 50 for archive; archive may use either remaining slot. Reads and exact authorized
replays remain available at capacity. Limits can be reached sooner through shared serialized byte
budgets. Saving does not invoke a model, create a scheduled task, decrypt rules or send a report.
It adds no runtime settings, cloud configuration, resources or deployment activation.

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

## Muse delegated authorization foundation

This surface uses Authlib's framework-independent authorization server, authorization-code and
refresh grants, S256 PKCE and revocation endpoint. Authlib is pinned to 1.9.1 after checking its
[official release/security notes](https://docs.authlib.org/en/stable/upgrades/changelog.html).
The existing shared library continues to verify encrypted objects and signed public authority;
the deprecated Authlib JOSE implementation is not used for content or signatures.

The fixed issuer is the configured HTTPS origin `H`; the encrypted logical resource/audience is
exactly `H/mcp/v2`, including when a future consumer uses `/agent/v2/*` REST. A v1 `/mcp` approval
does not become a v2 approval. Discovery and protocol URLs are generated from configuration, never
from caller Host or forwarded headers. Encrypted preparation and formal Run reads use the gated
protocols below and in [RUNS.md](RUNS.md); MCP and result tools remain unimplemented.

| Endpoint                                                                | Behavior                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /.well-known/oauth-authorization-server`                           | Configured authorization-server metadata                                                                     |
| `GET /.well-known/oauth-protected-resource/mcp/v2`                      | The separate encrypted v2 logical resource                                                                   |
| `GET /oauth/authorize`                                                  | Validate preregistered client, exact callback, state, resource and S256; start a bounded browser flow        |
| `POST /oauth/token`                                                     | One-time code exchange or rotating refresh; URL-encoded form and the registered client authentication method |
| `POST /oauth/revoke`                                                    | Revoke a token or its refresh family, within the authenticated client                                        |
| `POST /api/v2/agent-authorizations/{requestId}/claim`                   | Bind the flow to the verified Google owner and current vault                                                 |
| `GET /api/v2/agent-authorizations/{requestId}`                          | Read the owner/cookie-bound pending authorization status                                                     |
| `POST /api/v2/agent-authorizations/{requestId}/prepare`                 | Select tasks and an approved scope subset; obtain stable server-generated grant identities                   |
| `POST /api/v2/agent-authorizations/{requestId}/decision`                | Approve device-signed grants, approve OAuth alone, deny or cancel                                            |
| `GET /api/v2/agent-connections`                                         | Owner-only connection/task authorization metadata and bounded attempt history                                |
| `POST /api/v2/agent-connections/{connectionId}/revoke`                  | Independently revoke this owner's connection                                                                 |
| `POST /api/v2/agent-connections/{connectionId}/grants/{grantId}/revoke` | Revoke one selected task grant                                                                               |
| `GET /agent/v2/authorization`                                           | Minimal opaque-token authorization metadata; no task content, resource data or content keys                  |

Owner requests retain strict Firebase Google authentication, the exact v2 contract header and
closed JSON. They cannot select an owner UID. Claim has only `contractVersion`; prepare adds
`taskIds`, `connectionId` (null for a new connection), and `approvedScopes`; decision adds
`decision` and `signedGrants`. Revoke bodies have only `contractVersion`. Approval returns a
registered `redirectUri` for the owner UI to follow, including the protocol code/state/issuer;
it never includes the Firebase credential. Repeating a decision does not issue another code.

The authorization redirect sets one short-lived HttpOnly, Secure, SameSite=Lax flow cookie.
Consent calls additionally require the exact configured origin and flow-cookie binding. The
consent URL must share the exact Hub issuer origin: this backend phase does **not** provide a
consent page or a cross-origin Web/BFF bridge. Shared CORS does not allow credentialed cross-origin
requests; do not relax the cookie/CORS boundary to disguise that missing UI integration. WEB-006
and the existing Hub adapter work must deliver and test that handoff before enabling a real client.

`HUB_OAUTH_ENABLED` must explicitly equal `1`; missing/invalid configuration fails closed before
creating storage clients. Set `HUB_OAUTH_ISSUER`, the exact same-origin
`HUB_OAUTH_CONSENT_URL`, and `HUB_OAUTH_CLIENTS_JSON`. The latter is a closed array of up to eight
preregistrations, each with `provider` (only `muse`), `clientId`, `redirectUris` (one to four exact
HTTPS callbacks), `tokenEndpointAuthMethod` (`none` or `client_secret_basic`), and `secretSha256`
(null for public clients, otherwise a SHA-256 digest of a high-entropy client secret supplied out
of band). Do not commit credentials or put them in Terraform, prompts or query parameters.
Anonymous client registration, implicit/password/client-credentials grants and other providers
are unavailable. The local example stays disabled; no deployment setting is changed here.

OAuth permission alone does not authorize decryption: an empty signed-grant list leaves content
authority unavailable. A signed grant must match the current root-pinned registry, connection,
authorization, exact selected task version/execution epoch, resource incarnation/source epochs,
agent key roles/epochs, capabilities and owner writeback recipients. Grant history is not inferred;
the original prepare endpoint approves only the selected current task version and `historyPolicy=none`.
The explicit `prepare-encrypted` path additionally authorizes selected-current-version resharing,
as specified in [the preparation protocol](PREPARATIONS.md). Private
account selection and task semantics inside ciphertext remain client responsibilities. A new task
version never silently expands an old grant. `signedGrantPresent` records a saved signature, not a
claim that its keys or task are currently usable; each consumer must validate current authority.

Future consumers must use `authorize_in_transaction` with the original token, required scope and
task **inside the same transaction as their write**. A prior public authorization response is not
an authorization cache. Consumers must also check fresh source state outside that transaction,
then recheck local task/source/key fences inside it and validate concrete Run/version bindings.
Saved-receipt recovery requires its separately specified narrower guard; this new-execution check
must not erase an already saved receipt on a later source outage or task pause. No receipt API is
implemented here. A successful authorized encrypted preparation-object read sets `readObserved`
only after the fresh-source and final transaction checks. Metadata/proof reads and OAuth success
never set it; it means an API read was authorized, not that an agent decrypted all inputs or ran a
model. `resultSaved` stays false until a result consumer actually saves a result.

Codes expire within two minutes; access tokens within ten; pending flows within ten; refresh
families have an absolute thirty-day deadline that rotation cannot extend. Only credential hashes
are persisted, and refresh reuse revokes that family atomically. New consent advances the connection
authorization identity and task grant generation so old tokens cannot regain permission. A/B
owners and A1/A2 connections share a client registration without sharing ownership or revocation.

The existing named Hub database gains bounded `hub_oauth_pending`, `hub_oauth_owners`,
`hub_oauth_connections`, `hub_oauth_codes`, `hub_oauth_access`, `hub_oauth_refresh` and
`hub_oauth_families` records. There is no new database/service, background cleanup worker or TTL
requirement. Anonymous pending state uses one fixed pool: at most 64 active entries and 256 new
requests per hour, reusing expired slots. Each owner has at most 32 lifetime connections, each
connection 32 authorizations, each family 8192 token issues; capacity fails closed rather than
deleting revocation/replay evidence. These provider bounds are not a substitute for the existing
INF-006 public-release abuse, cost and logging checks.
The owner index retains up to 64 authorization-attempt display records, including denied,
cancelled, expired, superseded and revoked outcomes. Evicting terminal display history never
removes credential reuse markers or revocation authority; this is a bounded UI history, not an
indefinite audit archive. OAuth connection metadata remains separate from encrypted private rules.

The container already disables Uvicorn access logging. Keep Authlib protocol DEBUG/body logging
disabled; future public release must verify platform request and callback log handling as well.
OAuth code/state may occur in protocol redirects; access/refresh tokens, client secrets, Firebase
credentials and decryption secrets must never occur in URLs or logs. This local delivery uses
synthetic owners/keys and does not establish real Muse, browser consent or two-account production
acceptance. Those remain explicit release gates, with integration disabled by default.

## Storage, bounds and local verification

SQLite is local-only: private file mode 0600, immediate atomic transactions and bounded lock wait.
Cloud Run requires Firestore and an explicitly selected named database; `(default)`, SQLite and
Firestore emulator configuration are refused. `hub_vaults` contains the public directory, opaque
archive and bounded source list. `hub_operations` stores only owner/kind/fingerprint metadata.
`hub_source_fences` holds owner/full-ref/epoch/state metadata; `hub_fence_mutations` holds bounded
validated mutation metadata, a canonical request fingerprint and its original ACK. No private
positions, task/report content, user/agent keys or tokens enter these records.
`hub_tasks` stores public task heads, `hub_task_versions` stores opaque carriers and original public
proofs, `hub_task_operations` binds original write responses, and `hub_task_indexes` stores the
bounded owner/vault metadata index and cursor references. Task plaintext and private keys are not
stored in these collections.
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
future trust/configuration approval still govern any cloud activation. Owner task CRUD and the
disabled OAuth foundation, encrypted preparations and formal Runs are implemented locally/build-only.
MCP, Results/Inbox and broker access remain separate consumers and fail closed; this change does not
activate those consumers or any production endpoint.
