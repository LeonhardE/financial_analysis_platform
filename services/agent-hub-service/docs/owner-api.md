# Owner workspace API

Google owner identity, current certified control authority and encrypted content are distinct.
This reference covers vaults, sources, tasks, legacy connection management and owner Inbox reads.
Persistent Agent endpoints are in [Persistent API](persistent-api.md); Root archive changes are in
[Key management](key-management.md).

## Owner APIs

Every owner request requires the existing verified Firebase Google identity and exact
`X-FolioView-Contract: folioview.agent-workspace.v2.0`. Bodies are closed strict JSON;
requests cannot supply an owner UID or implicitly overwrite an existing root/archive. Vault/source writes also
require one bounded `Idempotency-Key`; source creation requires `X-FolioView-Author-Key`.

| Endpoint                                                    | Behavior                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/v2/vaults/current`                                | Current owner vault and public sources, or `vault:null`                                |
| `POST /api/v2/vaults`                                       | First enrollment only: public root, signed initial registry and opaque archive         |
| `PUT /api/v2/vaults/{vaultId}/registry`                     | Root-pinned, consecutive signed registry CAS                                           |
| `POST /api/v2/vaults/{vaultId}/holdings-sources/{sourceId}` | Current owner-device `manual_source_create` control; derived incarnation, epoch 1      |
| `POST /api/v2/vaults/current/authority-token`               | Fixed Portfolio caller/Hub audience, holdings metadata delegation valid for 60 seconds |

The separate [vault lifecycle API](key-management.md#archive-lifecycle) adds root-signed opaque archive replacement,
Passkey-change intent, bounded recovery approval/revocation and immutable operation receipts.
It keeps this legacy response shape and the existing directory/source version unchanged.
Root-approved cloud archive removal retains the vault and its public authority, projecting
`archive:null` only after an explicit signed deletion. Independent recovery requires a fresh
root-approved recovery authorization; deletion does not revoke devices or remove private content.

The [owner key renewal API](key-management.md#operational-key-renewal) atomically accepts root-approved successor
device/recovery certificates and a client-encrypted archive, with original receipt recovery.
Certificates remain immutable; renewal advances local key generations under the same pinned
root. The Web keyring and Settings renewal flow consume this API.

Bootstrap and registry writes return `{contractVersion,vault,sources}`. An exact operation replay
returns the current verified aggregate, never an old directory or archive replacement; these are
not immutable historical response receipts. Source-create replay returns its stable source ref
with the current fence epoch.
Every replay still authorizes the current owner/root, and source replay rechecks the current
signing device/directory before returning. Account separation uses the shared owner hash, not body
fields or filenames.

The stored source creation anchor remains epoch `1`. Current reads, bootstrap/registry replies,
source-create replies and Portfolio authority reads project the validated current source fence
epoch within the same database transaction as the vault and signed registry. Fence changes do not
rewrite creation anchors, change vault/registry versions or make an old operation replay return
an old epoch. Corrupt fence state fails closed instead of falling back to the creation anchor.
In Portfolio authority, `active` describes the owner's current vault/key authorization; a
disconnected or deleted source does not lock that vault or remove owner history access. The
source producer and downstream delegated operations still enforce their own terminal source
state and current fence checks.

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
accepted plaintext fields. Archive replacement requires the verified Google owner and a signature
from the existing pinned root; recovery cannot reconstruct that root from Google login. There is
no platform recovery private key, archive reset, second vault, root rotation or server decryption.
New Passkey ceremonies and independent recovery-kit UX remain client responsibilities.

## Owner connections and rollout capabilities

`GET /api/v2/agent-connections` and the existing connection/grant revoke routes use an
owner-only management service. They require the same verified Google owner and exact v2
contract header even when Muse OAuth and the encrypted adapter are disabled. Their response
shapes, authorization-attempt history, owner isolation and revocation semantics remain unchanged.
Turning off new OAuth issuance does not hide existing connections or prevent their owner from
revoking them. Storage or identity-verification failures remain real errors, not empty lists.

`GET /api/v2/agent-capabilities` uses the same owner authentication and contract transport, with
no query selectors. Its closed, no-store response contains exactly:

```json
{
  "contractVersion": "folioview.agent-workspace.v2.0",
  "profile": "folioview.owner-agent-capabilities.v1",
  "ownerConnections": true,
  "museConnectionEnabled": false
}
```

`ownerConnections` identifies the independent management capability, not storage health.
`museConnectionEnabled` is true only when both existing `HUB_OAUTH_ENABLED` and
`HUB_ENCRYPTED_ADAPTER_ENABLED` equal `1` and preregistered OAuth configuration validates.
This signal does not create storage/issuer clients, expose OAuth configuration or secrets, or
prove actual remote Muse interoperability. OAuth/MCP/agent requests retain their original
explicit fail-closed gates; Web consumes this profile separately from ordinary owner availability.

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
The Hub does not invent those fields or return a placeholder encrypted catalogue. Encrypted
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
redirects, identity encoding and streaming byte limits. Producer response reads allow up to eight
seconds, capped by the remaining admission budget, to tolerate a cold source; connection, pool,
write and credential I/O retain their four-second caps. Optional KMS
timeouts use remaining budget for cold public-key retrieval and signing with `retry=None`; existing
signing/JWKS calls retain their four-second defaults. This is **not** an exact twelve-second wall-clock
guarantee: SDK client/ADC discovery and credential refresh, a final blocking read and the separate
bounded Hub database transactions are not a fully cancellable asynchronous operation. There is no
detached worker, retry loop, scheduler or persistent owner/token/metadata cache.

Closed catalogue refusal diagnostics retain WARNING visibility even when the MCP SDK configures
the root logger at CRITICAL. Only the fixed source, stage and closed error code are logged;
identities, resource references, credentials, response bodies and exception messages are excluded.

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
discovery operation reads only Hub's own database and does not initialize lists, synchronize Portfolio authority,
read encrypted snapshots or create copies of User's mutable masters. Producer trust and cloud configuration are managed separately by per-target infrastructure.
Example settings alone do not activate them.

## Encrypted owner tasks

Task APIs use the existing verified Firebase Google owner, exact v2 contract header and `no-store`
responses. Writes also require one `Idempotency-Key` and `X-FolioView-Author-Key`. A browser owner
cannot supply another owner partition, an agent/delegation header or a workload token as owner
authority. Unknown fields, duplicate JSON members, duplicate resource refs and unsupported queries
fail closed through the existing bounded body/error transport.

| Endpoint                                                              | Behavior                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/v2/tasks`                                                   | Bounded public metadata page; `limit` and `cursor` only |
| `GET /api/v2/tasks/{taskId}`                                          | Current encrypted version                               |
| `GET /api/v2/tasks/{taskId}/versions/{version}`                       | One immutable encrypted historical version              |
| `GET /api/v2/tasks/{taskId}/operations/{operationId}`                 | Original encrypted version bound to a saved operation   |
| `POST /api/v2/tasks/{taskId}/operation-cancellations`                 | Root-approved final decision for one original upload    |
| `GET /api/v2/tasks/{taskId}/operation-cancellations/{cancellationId}` | Original validated cancellation decision                |
| `POST /api/v2/tasks`                                                  | Create active version 1 with expected version 0         |
| `PUT /api/v2/tasks/{taskId}`                                          | CAS rule/scope edit with a newly signed envelope        |
| `POST /api/v2/tasks/{taskId}/transitions`                             | Signed pause, resume or terminal archive                |

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
an agent by this API. Formal agent grants and Run delivery are independently authorized APIs. New writes
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

The operation read returns the existing `EncryptedTask` DTO for the exact original saved version,
even after later edits, pause or archive. It binds the operation record's owner, vault, task,
version and author to the immutable signed envelope's original stable operation ID and author,
using the same historical signature/checkpoint verification as version reads. It needs the verified
Google owner, not a currently valid task writer or live resource catalogue. An unknown operation
returns `404`; a committed operation whose associated history or bindings are missing/corrupt fails
closed as a storage error. It never substitutes the latest task or changes task/index/cursor state,
and does not replay a write, sign a replacement, cancel an operation or authorize a new write.
The operation ID uses the existing 22–128 character base64url form, including `_` or `-` as the
first character. This read rejects query selectors, request bodies, author/idempotency headers,
delegation/serverless selectors and duplicate contract/identity headers. It returns the existing
historical task proof, not a new receipt for the complete original transition-intent body.

### Root-approved upload cancellation

An unlocked owner root can permanently deny one unresolved task upload without replaying that
upload or granting an expired device another write. Both cancellation endpoints require the
verified Firebase Google owner and the exact v2 contract header. POST has one `Idempotency-Key`
equal to its cancellation ID and exactly `{contractVersion,command}` in at most 8192 JSON bytes.
`command` is a pinned-root `fv-control+jws` with this closed service-owned payload:

```text
artifactType: "task_upload_cancellation_intent"
contractVersion: "folioview.agent-workspace.v2.0"
profile: "folioview.task-upload-cancellation.v1"
ownerSubject, vaultId, rootKeyId, rootEpoch: 1, cancellationId
target: {taskId, operationId, mode, expectedVersion, authorKeyId,
         envelopeFingerprint, requestFingerprint, packetDigest}
```

`mode` is `create`, `update` or `transition`; task and operation IDs retain their existing rules.
`requestFingerprint` is the existing original write fingerprint, including its mode, expected
version, resource bindings, envelope fingerprint, transition-intent fingerprint when applicable
and author. `packetDigest` is the owner's SHA-256 digest of the canonical complete local
`PendingTask`; Hub validates its signed declaration and echoes it, without reconstructing that
client-only packet. The profile adds no shared control action or shared DTO. It has no TTL or
registry checkpoint binding: it only denies one immutable operation under the pinned vault/root
epoch `1`. A future root reset must use a new vault/root epoch.

POST and GET return HTTP `200` and exactly `{contractVersion,profile,command,receipt}`. The original
root command is preserved. Receipt fields are exactly `cancellationId`, `ownerSubject`, `vaultId`,
`rootKeyId`, `rootEpoch`, `target`, `commandFingerprint`, `outcome`, `acceptedAt`; `acceptedAt` is
integer Unix seconds. `outcome=saved` validates the original operation and encrypted historical
task against the target; clients still read and verify that original task before resolving their
local packet. `outcome=cancelled` atomically places a strict tombstone at the original
`hub_task_operations` path, so the original or a changed packet reusing that operation is refused.
Rolling older writers also fail closed on that unknown row shape; an in-flight writer conflicts
on that same document before committing. The saved operation row keeps its old shape.

The per-owner/vault `hub_upload_cancellations` ledger retains at most 32 cancellation IDs, counting
both outcomes and multiple IDs for the same exact target. Records contain the root command and
immutable receipt; the serialized storage budget also applies. There is no TTL eviction and no
task, index or version is created merely to cancel an unknown task. Exact cancellation-ID replay,
including a legal root signature variant with the same signing input, returns the original full
response even at capacity. Changed commands or changed target/packet bindings conflict. Expired,
revoked or renewed device keys cannot remove a fence; cancellation itself needs no current device
certificate or source RPC and does not edit, pause or archive the task.

Each receipt read rechecks the stored root proof and its original tombstone or saved-task
association. Corrupt or incomplete associations fail as storage errors. A true cancelled original
operation returns `404` from the existing operation read; an orphan tombstone returns `503` from
that original-operation read, upload or cancellation POST. If the entire ledger is absent, a
cancellation-ID GET can only return `404`, which is not a cancellation proof and must preserve
the local pending packet. Queries, author/delegation/serverless selectors and duplicate protocol
headers are rejected; GET also rejects bodies and idempotency headers. Every response is no-store.

Lists return only shared `TaskMetadataPage`, never private task text or encrypted carriers. They
default to 20 entries, allow at most 50, and sort by opaque task ID. A cursor is a persistent random
reference bound to this authenticated owner/vault, page size and exact metadata snapshot, expiring
after 15 minutes. Updates invalidate that snapshot; foreign, expired or malformed cursors fail.
It is not an authorization credential. Search, title sorting, status filters and offsets are not
accepted. At most 32 live cursor records are retained per owner/vault, without a new server secret.

The task store retains at most 32 tasks, 50 versions per task and 128 operation records per task, with
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

The source must already be locally `revoking` before calling Hub. The Portfolio adapter maps its pending `operationId`→`mutationId`, `resourceRef`→`ref`,
`sourceEpoch`→`newSourceEpoch`; preserve `expectedSourceEpoch` and the owner partition.
Actions fence/disconnect/delete map to the three reasons above. Only an authenticated reply matching
the current pending mutation/ref/epoch permits source-side CAS finalization. ACK loss or a crash
after ACK needs the same durable mutation, not a restarted broker session or new operation ID.
The Portfolio adapter is implemented; actual cloud trust and workload identity remain
independently configured and verified.

`app.fences.require_current_bindings(unit, ownerSubject, bindings)` is the shared fence guard for
Run/Result transactions. It reads the same fence documents (including absent epoch-1
documents), rejects outdated epochs and terminal incarnations, and must execute **inside the same
transaction as the write**. It does not replace a fresh external active-source/epoch precheck or
current task/grant/recipient-key checks. Source `revoking` or unavailable must already fail that
external precheck; no network call belongs inside a retried DB transaction. The guard does not
mint a grant or publish a Run/result endpoint. Resource-free tasks may pass an empty binding list.

The vault/public-authority API above still reports enrollment metadata with its initial source
epoch; it must not be used as a substitute for current source status or this separate transaction
fence. Task, Run and result consumers enforce these boundaries independently.

## Owner Inbox

This surface uses verified Firebase Google identity and the existing Hub result database.
An agent bearer, workload identity, known ID, ciphertext or cursor is not owner authorization.
Reads return approved metadata or already saved encrypted objects, never report plaintext or
private keys. They do not mark content read, synchronize sources, run models or infer a private
schedule. An unlocked client still authenticates and decrypts content and uses a safe renderer.

### Inbox: Routes and closed responses

Every request requires exactly one `X-FolioView-Contract` header for the existing formal v2
contract. Unknown or duplicate query parameters are rejected. Owner routes reject delegation
and serverless-authorization headers rather than exchanging them for user identity. Responses
and errors are `no-store`. These owner capabilities are independent of the agent adapter flag
and OAuth configuration; health remains credential-independent.

| Request                                                                     | Query/body                                | Response                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `GET /api/v2/results`                                                       | `limit?`, `cursor?`, `filter?`, `taskId?` | Formal `ResultMetadataPage`                                  |
| `GET /api/v2/results/counts`                                                | `taskId?`                                 | Closed counts profile below                                  |
| `GET /api/v2/results/{resultId}`                                            | `revision?`, `deliveryRevision?`          | Formal `EncryptedResult`                                     |
| `GET /api/v2/results/{resultId}/revisions`                                  | `limit?`, `cursor?`                       | Formal `ResultMetadataPage`, newest revision first           |
| `GET /api/v2/results/{resultId}/revisions/{revision}/evidence`              | none                                      | Closed evidence profile below                                |
| `GET /api/v2/results/{resultId}/revisions/{revision}/registries/{sequence}` | none                                      | One formal `RegistryBundle`                                  |
| `PATCH /api/v2/results/{resultId}/state`                                    | `{contractVersion,command}`               | Formal `ResultMetadata`, status 200 for new/known operations |

The default page size is 20, bounded to 1–50. `filter` is one of `all`, `unread`, `starred`,
`archived`: the first three exclude archived results, while `archived` includes only archived
ones. `taskId` is an opaque exact filter. Unknown/foreign task IDs return only the caller's
matching rows/counts, often empty; they do not look up another owner's task. Inbox order is
original `receivedAt` descending, then result ID descending. Content revisions retain the initial
arrival time rather than masquerading as new arrivals. Text search, title sorting, body queries,
period expectations and inferred model failure are unsupported.

The counts profile has exactly `contractVersion`, `profile=folioview.owner-result-counts.v1`,
`asOf`, and `counts`. Counts contain exactly `all`, `unread`, `starred`, `archived`, `total`;
the first four use the list predicates, and `total` includes archived results. `taskId` scopes
every count. These visible counts/times/connection relationships are accepted metadata leakage,
not encrypted financial or report content. An uninitialized owner gets an empty list/zero counts
without creating a vault, source, task or result.

### Inbox: Bounded queries and cursors

Discovery reads the bounded registered vault anchor, existing owner result-ID index and small
result heads, with the producer's 1,024-result limit. The vault document contains public directory
data and a sealed archive; it is not decrypted. Head reads use bounded transactional batches,
avoiding one network round trip per item. List/count calculations load no report carriers, Run
bodies or source data and use no private keys. History reads only the requested revision window and uses a fixed
Firestore field projection for `ownerSubject`, `resultId`, `revision`, `receipt`; ciphertext is
not downloaded for metadata history. SQLite applies the same projection after bounded local
document decoding, without a migration.

Cursors are random 192-bit tokens backed by at most 32 entries per owner/vault in
`hub_inbox_cursors`. They bind owner, vault, query kind, result/filter/task selection, page size
and a metadata snapshot, with a logical 15-minute upper expiry. The bounded query cache may
evict an older continuation at capacity, while preserving forward pagination even when page
count exceeds retained tokens. An evicted token requires restarting the view; the expiry is not
a guaranteed minimum retention period. Business state operations and receipts are never evicted
by this query-cache policy. A changed retained snapshot returns
`version_conflict`; clients restart pagination and must not silently mix old/new pages. Tokens
are repeatable across service restart while retained and their snapshot remains valid. Cursor storage is
bounded query metadata; no TTL deletion of owner indexes or immutable business records is needed.

### Inbox: Historical content and evidence

Details return the selected immutable signed carrier and one accepted historical checkpoint with
its certified public keys. `deliveryRevision` currently supports only 1; future/unknown business
or delivery revisions return not found rather than substituting another version. Selected
revision/fingerprint/key epoch coexist with current logical read/star/archive state and
stateVersion, because those states belong to the logical result.

The evidence profile has exactly `contractVersion`,
`profile=folioview.owner-result-evidence.v1`, `run`, `manifest`, `manifestFingerprint`, `receipt`,
`agentKeyGrant`, `authorizationExpiresAt`, `provenance`, `authorProof`, `registryProofs`.
`authorProof` contains the accepted `registrySequence` and `verifiedAt`; proof descriptors contain
sequence, checkpoint digest and the exact owner/result/revision-bound proof path. Each proof page
returns one complete root-signed bundle, keeping a full chain out of the encrypted detail response.
The exact stored device-signed AgentKeyGrant accompanies the evidence so clients can verify task
authorization as well as the agent certificate. Context/grant references may legitimately predate
the final accepted checkpoint; use the supplied chain rather than requiring accidental equality.

Verify registry, grant, original Run/manifest, signatures and carrier bindings against an
independently pinned root before decryption. Use the selected receipt's `receivedAt`/author
`verifiedAt` as the historical verification time, not metadata's initial arrival timestamp.
Later-revision certificates may not have been valid at that initial arrival. Neither a receipt
nor connection provenance authenticates a model name, proves analysis quality or establishes
that every input was read. The stable receipt resultPath is navigation metadata, not a key.

Reads reuse the existing result producer's historical proof/signature checks at acceptance time
and the registered immutable root pin. They do not require current agent connection/grant state,
task status, source availability, Run lifetime or current decryption/signing-key eligibility.
Revoking an agent stops future agent access/writes without erasing the owner's retained history.
This API confers no missing private key or automatic history resharing to a new device.

### Inbox: Signed state and concurrency

PATCH requires the current root-certified `device_sig` with `control_write`, one
`X-FolioView-Author-Key`, one `Idempotency-Key` and a formal signed ControlCommand. The command
must use `result_state_update`, the exact result ID, matching stable operation ID,
`expectedSourceEpoch=null`, current `expectedVersion=stateVersion`, and a nonempty subset of
boolean `read`, `starred`, `archived`. It cannot modify report content, recipients, provenance,
arrival time or history. Current checkpoint/key eligibility and the actual signature are checked
before both new writes and saved acknowledgements; the result-submission historical receipt
exception does not apply to these current owner controls. An old command after an unrelated
registry advance can be rejected; owner GET retrieves current state for a freshly signed CAS.

Head state and the original operation acknowledgement commit atomically. Every new operation,
including a logical no-op, advances stateVersion once. A body revision uses the same head,
advances stateVersion, resets unread and preserves star/archive. Transaction retry therefore
rejects an old mark-read command rather than marking unseen new content as read. Clients resolve
CAS conflicts against fresh state rather than blindly retrying.

Exact replay returns the original acknowledgement without changing current metadata. Valid
ES256 high/low-S signatures share the same signing-input fingerprint; an invalid signature
cannot replay an operation. A client receiving an old acknowledgement must not overwrite a
newer stateVersion/revision in its cache. This service profile retains at most 128 distinct
state operations per logical result in `hub_result_state_operations`. New operations are refused
at capacity without evicting replay records; known operations and owner reads remain available.
