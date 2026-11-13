# Persistent Agent APIs

The persistent identity, resource-consent and content profiles extend workspace v2.0 without
upgrading legacy P1 grants. Current credential and Web/host clients are implemented. The producer
verifies public authority and stores ciphertext; it never decrypts task/resource/report content.

Owner endpoints use verified Google identity and the exact workspace contract header. Financial
Agent endpoints use current, fixed-origin request proofs rather than account OAuth credentials.
Each producer rechecks its own current fences in the committing transaction. Identity-only
recovery receipts, source metadata and historical receipts do not grant execution rights.

See [shared contracts](../../common/folioview_shared/encrypted/README.md) for wire definitions,
[runtime](runtime.md) for pairing and scheduling, and [Web integration](../../../apps/web/docs/agent-integration.md)
for the single-unlock owner flow. Feature flags default off; real Muse lifecycle/scheduling
acceptance remains separate from synthetic checks.

## Independent executor ciphertext

The independent Policy/TEE parent and its public/Owner routes are retired. The Hub
no longer serves executor binding or ciphertext forwarding APIs. Historical public
bindings, immutable Run/report receipts and Owner ciphertext are retained; the
new route uses the existing OAuth account parent plus an Owner-approved credential.
The original design is archived locally and remains in repository history.

## Stable identity

The opt-in owner API stores the shared `folioview.persistent-agent-identity.v1`
binding independently of OAuth family deadlines. It is not an execution API.
No tokens, private keys, plaintext, content permissions or new cloud resources are
created by this slice. Historical foreground signed formats remain verifiable; legacy financial transports are not mounted.

### Stable identity: Owner API

All paths below start with `/api/v2/persistent-agents`. They require the normal
Google owner, exact `X-FolioView-Contract`, no query, no delegated owner selector,
and no separate author header. Mutations require an `Idempotency-Key` matching the
signed command's `stableOperationId` and closed JSON `{contractVersion, command}`.

| Method and suffix                                  | Behavior                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/capabilities`                                | Explicitly reports enrollment, resource consent and execution readiness separately.                                                    |
| GET `/{vault}/{connection}`                        | Public identity plus original signed binding/revocation and authoritative parent-disconnect status; null identity means no enrollment. |
| POST `/{vault}/{connection}/revocations`           | Fresh device-signed terminal revocation, even when enrollment or the parent OAuth connection is disabled.                              |
| GET `/{vault}/{connection}/operations/{operation}` | Immutable original result for resolving an unknown outcome under current owner authorization.                                          |

New credentials use the [90-day lifecycle](#agent-owned-credential-lifecycle). The
create-only v1 enrollment route is retired. Identity history and revocation remain
available without enabling new approvals. Resource consent and execution have their
own gates, including the current personal Agent mode.

### Stable identity: Transactions and lifetime

`hub_agent_identities` is create-only per owner/vault/original connection. The
original connection must exist in the same owner's bounded OAuth index, have the
same vault/client and have no disconnect tombstone. An expired transport deadline
is not an identity revocation. This does not extend that deadline or let a legacy
token access tasks, sources, Runs or results.

Each identity has at most two immutable `hub_agent_identity_operations`: enrollment
and terminal revocation. The full signed commands and initial result are committed
with identity state atomically. Firestore retries reread the current vault registry,
OAuth parent, identity and operation slot before any write. No network read occurs
inside the callback. Exact unknown-outcome retries return the original receipt;
changed payloads conflict. Returning a historical active receipt after revocation
never changes current state. Callers must reread current state for any future action.

A new operation cannot overwrite either an active identity or a revoked tombstone.
Disabling enrollment, deployment, owner logout, or absolute OAuth expiry does not
delete history. The old owner disconnect endpoint still denies future use through
the authoritative parent even before a signed child-identity revocation is recorded.
Session/execution consumers check both fences in their commit transaction.
Current Agent certificates still bound every new enrollment and later recovery.

The store contains public signatures and identity metadata. Historical v1 records
are not silently overwritten. Owner clients verify the original signed binding and
checkpoint history. Current execution, plans and final report writes require a
managed, unexpired credential in the same authoritative parent. Public API readers
cannot use a legacy identity or OAuth bearer to bypass that requirement.

Validation uses real synthetic signatures on SQLite and the actual Firestore SDK
with synthetic RPC conflicts, plus HTTP gate and strict-transport checks. No live
user connection or resource permission is changed by these tests.

## Identity recovery

The browser storage recovery challenge/proof API is retired. A personal Agent that
loses its credential stops and directs the Owner to reauthorize. The platform does
not reconstruct Agent private keys or require an Agent recovery file/code. Historical
identity and original-operation records remain unchanged. Owner Passkey and archive
recovery are independent mechanisms documented in [key management](key-management.md).

## Resource consent

Agent Hub adopts the separate shared `folioview.persistent-resource-consent.v1`
profile. One aggregate belongs to an already enrolled stable Agent identity.
It grants no bearer, Run or envelope authority and does not enable background
execution. Old foreground grants remain unchanged and are not migrated.

All paths below start with `/api/v2/persistent-agents/{vault}/{connection}` and
require the ordinary authenticated owner, exact contract and no query/author or
delegation selectors. Writes use closed `{contractVersion, command}` JSON with
`Idempotency-Key` equal to the signed `stableOperationId`, bounded to 96 KiB before
shared signature/schema limits. The pinned root public key comes from the current
verified vault, never from the incoming command.

| Method and suffix                      | Result                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET `/resource-consent`                | Current public policy, ordered original operation IDs and effective parent-revoked status.              |
| POST `/resource-approvals`             | Fresh root-approved incremental current/future resource selections, optionally exact earlier revisions. |
| POST `/resource-revocations`           | Fresh root or certified owner-device narrowing of exact current permissions.                            |
| GET `/resource-operations/{operation}` | Immutable original policy result, signed command and originally observed public source states.          |

New approval requires `HUB_PERSISTENT_RESOURCE_CONSENTS_ENABLED=1`, identity
enrollment activation and valid existing preregistered Muse OAuth configuration.
It defaults off, and deployment does not change these flags. History, original
receipt checks and narrowing do not depend on approval activation or source
availability. Capabilities report policy management and execution separately; `executionEnabled`
is computed from the execution gate and its prerequisites. No live user permission is created by deploying this code.

### Resource consent: Source and transactional authority

Only the existing trusted owner-scoped catalogue supplies source revision/incarnation/
epoch observations. There is no source-state input in the HTTP command. The service
captures vault/checkpoint/client context, reads producer state outside the transaction,
then rechecks that context and current identity, parent connection, policy CAS version/
digest and local reverse-invalidation fences inside the committing transaction.
Producer RPCs are never made from a retrying database callback.

A new selection's revision floor must exactly match the observed current committed
producer revision. Normal later versions need no policy mutation. The observation
is a source read, not a distributed lock on a later producer update. The local epoch
callback fences disconnect/deletion; actual ciphertext publication and Run freezing
must independently recheck producer versions, current consent and immutable evidence.
This endpoint alone does not prove that a historical ciphertext exists or is usable.

A new consent ID cannot reset an occupied slot. Revoked permission IDs remain terminal;
explicit reapproval needs a new permission ID while retaining the old tombstone.
Only selected permissions advance their epoch; other entries remain unchanged.
Aggregate version is CAS/audit metadata, not a global execution fence.

`hub_resource_consents` retains current policy, ordered operation IDs and independent
approval/revocation counts. `hub_resource_consent_operations` retains complete original
controls, observed public source state and original next-state receipts. State and
receipt commit atomically. Exact retries resolve before any source RPC, never
reapply an old action, and remain historical after revocation. A stale approval
cannot use a fresh operation or namespace to overwrite another CAS winner.

Capacity is bounded to 64 approvals and 32 revocation commands per identity. Approval
exhaustion cannot consume the narrowing budget. The shared contract permits only
32 retained permission IDs and each can be revoked once, so this reserve covers
every possible single-permission revocation. Tombstones and audit records are never
deleted to create capacity. Disconnecting the parent blocks all remaining permissions.

### Resource consent: Consumer responsibilities

Owner encrypting clients must independently verify and pin the root-approved original
control chain and corresponding root/checkpoint evidence. Current DTOs, digests and
server-observed source metadata are not substitute cryptographic authority. An
operation receipt is available separately to keep chain reads bounded.

The resource check is only one gate. Execution consumers must authenticate
the Agent, apply current task/Run/scopes/expiry/source/delivery constraints, and reread
current consent and revocation fences in the same committing transaction. No legacy
`VerifiedGrant` is constructed here, and no content key is sent or decrypted.

Validation covers real root/device signature separation, SQLite and actual Firestore
SDK conflicts, operation collisions, parent/owner isolation, source outages and
invalidation, terminal revocation, unaffected-resource epochs and reserved narrowing
capacity. Tests use only synthetic identities and resources.

## Encrypted publications

The owner-only `/api/v2/persistent-content` producer accepts the separate shared
`folioview.persistent-content.v1` carrier. Task/resource publications require the
pinned Root signature. The service interprets public routing and fences, never
financial plaintext or a private key.

Publication writes require `HUB_PERSISTENT_PUBLICATIONS_ENABLED=1`, enabled
persistent identities/resource consents, and configured registered clients. They
remain disabled by default. This does not enable execution or extend legacy OAuth.

`/{vault}/connections/{connection}/publications` commits the original carrier and
receipt atomically. `.../operations/{operation}` retrieves that original receipt.
`/{vault}/tasks/{task}/authority` returns the current task authority for owner CAS.
Unknown outcomes must reuse the same operation and carrier; never reseal on retry.

Task authority has one owner/vault/task slot across all Agents. The exact current
task version, active status, execution epoch, source bindings and owner ciphertext
fingerprint are checked. Each replacement retains the authority ID and increments
its version with the prior authority digest. The task content revision remains
the actual producer task version, including explicit reassignment of that version.

Resource publication accepts the current trusted catalogue version only. It checks
the exact reference/incarnation, source epoch, permission ID/epoch and revision
floor under current Root-approved policy, then checks source fences in the same
transaction. A version may skip intermediate revisions. Publishing an older
selected-history version requires a future trusted historical producer API and is
not provided here. Content `revision` equals its source revision.

Publication IDs are globally immutable per owner/vault. Source heads are per
connection/reference; task heads are global across connections. Individual history
documents avoid an ever-growing per-connection array. Opaque `carrierJson` must be
exempted from Firestore indexing before enabling the producer.

Every Agent consumer must authenticate a current exact request proof and
recheck the parent connection, current identity/certificates, task authority/head,
resource permission epochs and source fences in its own transaction. Historical
receipts, identity recovery receipts and delivery existence are not authority.

## Execution inputs

This opt-in producer consumes persistent Root publications and resource consent.
It does not reinterpret a legacy grant, extend an OAuth family, decrypt content,
create a scheduler or use an identity-recovery receipt as a bearer capability.

All endpoints are POSTs under
`/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}`.
The closed body is `{contractVersion, proof, request}`. `proof` is the shared
current Agent request proof over the actual POST path and JCS SHA-256 of the exact
business `request`. Ambient Authorization, delegation and idempotency headers are
rejected; operation identity belongs inside the signed business body. Existing
Cloud Run workload ingress is a separate platform concern.

`session`, `consent-receipts`, `tasks` and `task-input` supply public identity,
Root authority history and assigned task ciphertext for independent trusted-client
verification. Root bundles are public proofs, never a Passkey or private key.
Persisted clients must pin Root and monotonic checkpoints/consent heads. A server
response alone must not establish a fresh trust anchor.

`runs/begin` accepts task ID, trigger ID, operation ID and the expected task
publication fingerprint. It authenticates before the source RPC, then repeats all
current checks in the allocation transaction. It selects current trusted source
versions and current published ciphertext, checks exact task authority, current
resource permission epochs and reverse invalidation fences, and freezes the
manifest. The Run ID is deterministic across connection reassignment for the same
owner/vault/task/trigger. Operation reuse with different intent is a conflict.

`runs/receipt` retrieves the original manifest without producer RPCs. It does not
extend the Run deadline or grant input access. `runs/input` reauthenticates and
rechecks current task authority, parent, permission epochs and source fences before
returning one exact frozen publication. Normal source version advances do not
rewrite old input or invalidate an otherwise still-authorized in-flight Run.
Unpublished newer source versions block a new Run until the owner client publishes
the corresponding approved encrypted copy.

Every Run is limited to two hours and allocation to 20 per connection/minute and
200 per owner/day. Original-operation replay does not consume another quota slot.
Native schedule occurrence IDs must be stable across retries; this producer does
not assert a native plan has been installed or observed.

Execution requires `HUB_PERSISTENT_EXECUTION_ENABLED=1` plus publication, consent,
identity and registered-client readiness. The flags default off; activation requires reviewed configuration and owner-led real
lifecycle acceptance. Firestore must
exempt the opaque Run manifest and authority-history fields before activation.
Encrypted result writeback is implemented alongside the input producer and documented below.

## Reports and owner history

`/agent/v3/persistent/owners/{owner}/vaults/{vault}/connections/{connection}/runs/submit`
consumes the same exact current request-proof transport as persistent inputs.
The business body is `{runId, operationId, envelope}`; the shared result envelope
must match the deterministic result ID, Run manifest, exact task authority and all
current owner device/recovery recipients. A new report also requires the current
Root task output policy `owner_inbox`, active parent and Agent keys, live resource
permission epochs/source fences, and a non-expired Run. It never interprets
private report content or accepts a plaintext fallback.

The first report is immutable. Report revisions are not provided in this basic
producer. A second distinct initial publication is rejected. Original-operation
retries return the unchanged receipt before producer RPCs, including after Run
expiry or resource revocation; they do not authorize new writes or disclose
plaintext. `runs/result-receipt` retrieves the saved metadata receipt under the
current Agent identity. Disconnecting/revoking that identity stops Agent requests.

The receipt, opaque content, metadata head, linked index page and submitted Run
state commit atomically. Request proof and recipient validity are checked again
at the committing write. Index pages hold at most 64 report IDs and point to the
previous page. Pagination uses owner/vault-bound page/offset selectors; no query
is performed on ciphertext, and there is no lifetime owner report array limit.

Google-owner history is deliberately a separate service with no Agent submit or
authentication method and no OAuth configuration dependency:

- `GET /api/v2/persistent-results/{vault}`: metadata and bounded pagination.
- `GET /api/v2/persistent-results/{vault}/{result}`: exact original envelope,
  receipt, manifest, issuance Agent snapshot/binding and public Root registry history.
- `PATCH .../{result}/state`: existing device-signed `result_state_update` control,
  exact operation identity and metadata CAS for read/star/archive state.

History does not require a current Agent connection, permission or unexpired Run.
Trusted owner clients must independently pin Root, verify the public authority
chain and select the exact issuance checkpoint/Agent snapshot before historical
signature/decryption checks. A historical receipt or issuance snapshot never
becomes current Agent authority. Original task/resource publication proofs can be
read through the existing owner operation endpoints without reauthorizing an Agent.

Writes require `HUB_PERSISTENT_RESULTS_ENABLED=1` and all execution prerequisites;
they remain disabled by default. Firestore indexing exemptions for opaque content,
Run manifests and linked index arrays must precede activation. Real runtime and
cross-day acceptance remains separate from synthetic producer checks.

## Plan statements and observed execution

`POST .../plans/state` and `POST .../plans/report` use the same current proof transport and
connection prefix as execution. `GET /api/v2/persistent-plans/{vault}/{connection}/{task}`
provides the owner view. The producer retains an immutable, Agent-signed plan statement under
current task authority, original-operation recovery and a separate quota. A raw native plan
reference is hashed inside the Worker and is never sent as a URL or credential.

Requested task schedules, Agent-reported native plan state and Hub-observed Run/report receipts
are separate facts. A statement is not independent Muse attestation or proof that a native plan
was installed. Delayed results cannot replace the observation for a newer Run.

## Agent-owned credential lifecycle

The additive `folioview.agent-credential.v1` lifecycle is disabled by default with
`HUB_AGENT_OWNED_CREDENTIALS_ENABLED`. Enabling it also requires the configured
persistent identity, consent, publication, execution and Native bootstrap gates.
It uses this existing Hub and storage; it provisions no separate service, VM,
proxy, key-release witness or background expiration job.

Owner-only, closed JSON endpoints under `/api/v3/agent-credentials` are:

| Method/path suffix                                 | Purpose                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /capabilities`                                | Admission status, default 90-day duration and seven-day notice     |
| `GET /{vault}/{connection}`                        | Current public identity, signed approval, lease and derived status |
| `GET /{vault}/{connection}/setups/{intent}`        | Exact Owner-scoped pending Native offer; no private keys           |
| `POST /{vault}/{connection}/approvals`             | Atomic Owner-approved first enrollment/replacement                 |
| `GET /{vault}/{connection}/operations/{operation}` | Immutable original receipt                                         |

Writes retain the existing contract and idempotency headers and accept
`{"contractVersion":"folioview.agent-workspace.v2.0","command":{"binding":{...},"approval":{...}}}`.
Both nested values are flattened JWS objects, not unsigned keys or a `verified`
flag. The approval binds the exact Owner, client, connection, fresh key pair,
identity binding, current Root registry, Native setup, audience, next generation,
previous credential fingerprint and expiry. Agent signatures cannot renew an
Owner approval. The maximum/default duration is 7,776,000 seconds; shorter explicit
Owner approvals support bounded acceptance. Expiry is checked on demand.

Only a verified Native bootstrap principal can create a ten-minute setup intent
and submit its bounded, immutable encrypted public-key offer. The platform never
receives the host's private keys or pairing secret. The reviewed host/Owner
handoff protocol must establish first-key provenance before enabling the route;
these endpoints alone do not prove host persistence or native scheduling.

An unused slot may start at generation one. A used legacy v1 slot, including a
terminal revocation record, cannot be reused as generation one; it needs a new
Native logical connection. Managed slots replace only through fresh Owner-signed
keys and a compare-and-swap transaction. The transaction archives the old binding,
consumes the setup and commits the new current record and immutable receipt.
Preparation failure preserves the previous current credential. Exact retries
return the original receipt without reactivating its generation. Missing managed
state or a mismatched parent marker fails closed, rather than becoming a new slot.

Managed consents are namespaced by binding fingerprint. A new credential needs
fresh Owner approval and resource/task ciphertext; prior grants, revocation
history and original operations remain stored. Successful replacement does not
erase ciphertext or plaintext already delivered. Existing legacy receipts remain
immutable and cannot undo a later managed generation.

Every persistent session/read/Run request and final result write rechecks the
current identity and lease, including a recheck after producer RPCs. Legacy v2
financial OAuth/refresh cannot bypass a managed connection; separate Native
bootstrap refresh continues normally. Disabling admission cannot lift existing
expiry or revocation fences. Owner history resolves the original Run binding and
retains independent report decryption after reauthorization.

After the first managed enrollment, rollback must retain a Hub version supporting
managed records. Preserve current generations, archived bindings, consents and
operation receipts. Never clear state to roll back. Keep UI recovery to login,
existing Passkey and reauthorization; do not expose key files, fingerprints,
certificate ceremonies or Agent recovery codes to users.

## Native Agent-owned pairing

With `HUB_AGENT_OWNED_CREDENTIALS_ENABLED=1`, native MCP replaces browser-runtime
bootstrap tools with `agent_connection`, `prepare_agent_authorization`,
`submit_agent_offer` and `agent_activation`. None accepts caller identity/provider
claims or returns OAuth tokens/private keys. Preregister `provider` as `muse` or
`chatgpt` against the exact client/callback; a provider name in model output is not
provenance. Plan statements must match that connection's registered provider and
remain `nativeScheduleAttested=false` until separate real-provider acceptance.

`HUB_AGENT_OWNER_URL` must be the existing Web HTTPS `/agents` URL and its origin
must be in explicit `CORS_ORIGINS`. Owner setup reads return that connection's
trusted issuer/provider alongside the closed intent. A reviewed host client
creates a local private pending profile and encrypts its signed public offer with
a random pairing secret. The Owner receives the secret only in the authorization
URL fragment, verifies the exact offer inside its Worker, then returns an opaque
AES-GCM activation in the optional approval `activation` field. Activation is
bounded to 8192 decoded bytes; private keys never enter these APIs.

Only a still-authenticated native principal for the original setup authorization
can retrieve activation. It must still refer to the current credential generation.
The activation authenticates the Owner Root/checkpoint anchor to the host, which
must independently verify the full PoP session registry, binding and signed lease
before activating its local file. Server-provided Root pins alone are insufficient.
Managed PoP sessions add public `credentialLease`, `credentialApproval` and
`provider`; legacy session shapes remain unchanged.

For a legacy create-only identity (including its tombstone), new native login
prepares a fresh logical slot. It reuses an existing pending migration slot and
keeps the old parent usable while authorization is incomplete. The new credential
commit validates the server-recorded predecessor and revokes its parent atomically;
failed approval does neither. Old identity/report records are retained. Later
managed renewal reuses the managed slot with a new generation and fresh key pair.
This is default-off source preparation, not deployed host/provider acceptance.

## Owner restoration lineage

Credential replacement atomically stores a public `hub_credential_lineage` entry
alongside the new identity, archived prior identity and original receipt. Its
predecessor is selected from the transaction's current credential or the trusted
native legacy-migration record. The Agent cannot submit this pointer. Managed
links must match the signed lease generation/previous credential fingerprint;
missing later-generation links and corrupt associations fail closed.

Owner-only reads use `/api/v3/agent-credentials/{vault}/{connection}/restoration`
for the current source descriptor, and `/restoration/{sourceConnection}/{bindingFingerprint}`
for one bounded public source. The latter contains the historical binding,
optional signed lease, original resource-consent state/operation IDs and prior
source pointer, with `historical=true` when superseded. It is limited to the same
Owner/vault/preregistered client/provider and never returns private keys, bearer
credentials or plaintext resources. Existing Owner resource-operation endpoints
return each immutable signed approval/revocation receipt, including after Agent
expiry or replacement.

A reviewed Owner client follows at most 32 unique links, verifies the Root-bound
identity/lease and exact consent chain, and lets newer revocations override older
scope. New permission requires explicit Owner approval and fresh publication to
current Agent keys. Historical reads do not authorize old Agents, restore
permissions by themselves, or reassign tasks already moved to another connection.
The Owner uses the existing Passkey and encrypted resource/task copies. Recovery
therefore does not require an old Agent key file or a pending record in the
current browser. Unfinished renewals retain predecessor references for a later
retry without resetting any consent/revocation ledger.

## Unique provider connections (compatible producer API)

`/api/v3/provider-connections` implements the additive shared Owner/provider slot
profile. Capability and writes are default-off behind
`HUB_PROVIDER_CONNECTION_SLOTS_ENABLED=1` plus existing Agent-owned/runtime gates
and Owner admission. This source/deployment does not enable it or migrate accounts.
Owner-authenticated state and original-operation reads remain available when off.
All routes require the exact contract header, closed transport/no query or
delegation headers; writes additionally require the original Idempotency-Key.

- `GET /capabilities`: exact profile/providers, enabled flag, automaticMigration=false.
- `GET /{vault}/{provider}`: current slot, exact retirement snapshots, legacy
  blockers and retained restoration selections. Resource/task names remain encrypted.
- `GET /{vault}/{provider}/operations/{operation}`: original immutable receipt.
- `POST /{vault}/{provider}/commands`: `{contractVersion, command}`; activate uses
  `{approval, review, credential}` and disconnect uses `{approval}`. `approval` is
  the distinct shared signed provider control; `credential` is the unchanged
  signed binding/90-day approval/optional encrypted activation packet. Both
  approvals bind the same operation. Persist this entire original body before send.

The existing Hub transaction reads the Owner connection index, complete current
provider inventory, current slot, native setup intent and candidate credential.
It atomically consumes setup, installs the candidate, advances the unique slot,
retires exact old actors, archives superseded bindings and records the original
receipt. Concurrent creation/replacement loses CAS or exact inventory comparison;
any verification/storage failure rolls back all writes. Same-physical-connection
renewal revokes the old generation through the current credential/slot fences;
retiring by physical connection alone must not revoke its replacement. Other
retired connections become revoked. Both current slot and original-operation
receipts survive future disconnect/replacement, including lost acknowledgements.
Signature-only JWS variants retain the same operation identity and return the
original receipt; changed review, activation ciphertext or signed input conflicts.

Review never copies old grants or creates ciphertext. Selected task versions,
execution epochs, authority fingerprints and resource IDs must still match live
Owner task state. Selections are a pending restoration plan only; fresh explicit
Owner grants/deliveries remain necessary. Unselected scopes gain nothing. Old
create-only identities without a credential lease are returned as `legacyBlockers`:
Owner must explicitly disconnect them through existing narrowing controls and
regrant on the reviewed route. They are not turned into synthetic leases or
silently ignored. Cross-vault active records block cutover; this profile cannot
implicitly rebind an Owner/provider slot to another vault. Unpaired native OAuth
bootstrap records have no identity/content authority and are not active actors.

Installed provider markers enforce the current slot on all persistent live
identity checks, including Begin, manifest/content access and final result write;
turning off the feature gate cannot remove this fence. Legacy credential and
create-only enrollment routes cannot install another identity once a slot exists.
Unmigrated connections retain their existing read path without extra slot reads.
Explicit native disconnect also denies through the existing parent-connection
check; a reviewed reconnect can replace its retained current snapshot. Historical
Owner report access, original actor identities and receipts remain unchanged.

The optional Owner source SDK is `agent-client/owner-connections.mjs`. Inject an
authenticated same-origin transport; it supplies contract/operation headers,
closed paths and one write attempt. Recover an uncertain response via the original
receipt or exact packet, never automatically sign/issue a new command. Existing
pinned native Agent client bundles and their physical actor/proof shapes are
unchanged; the server resolves the current logical slot without client claims.
No Web switch, production consent, schedule, live run or infrastructure provisioning
is performed by deploying these compatible producer APIs.

## Task assignments and task history (additive, default off)

`HUB_TASK_CENTER_ENABLED=1` additionally requires provider slots, existing Agent
runtime gates and Owner admission. Deployment leaves it off and performs no
account migration. A task may have no executor, or one assignment per current
provider slot; the same slot can serve different tasks with different resources.
Root-approved ciphertext publications and resource consents remain separate from
assignment metadata. No task title, report text or private key is stored here.

Owner routes under `/api/v3/task-center` require the normal authenticated Owner,
exact contract header and closed transport. Commands also require the original
Idempotency-Key and the distinct signed `CenterOwnerControl` from the shared
`folioview.task-center.v1` foundation:

- `GET /capabilities` advertises the gate and only the implemented actions.
- `GET /{vault}/tasks/{task}` returns signed rules, assignment versions, independent
  publication heads and plan statements. It does not fetch report ciphertext.
- `GET /{vault}/tasks/{task}/operations/{operation}` returns the original receipt.
- `POST /{vault}/tasks/{task}/commands` accepts `{contractVersion, command}` for
  `set_rules`, `set_assignment`, or `remove_assignment`. Rules bind the exact
  current business task version/execution epoch; assignment controls additionally
  bind the current provider slot, credential generation and chosen publication
  fingerprint. Initial enrollment creates zero assignments and permanently marks
  the task; it archives the old publication head for that physical actor, without
  creating or restoring any grants. Rule changes require fresh assignment approval.
- `POST /{vault}/tasks/{task}/results/query` accepts
  `{contractVersion, request:{limit,cursor}}` (1..50). New assignment results are
  followed by the captured legacy persistent history, then old foreground results
  in a single pageable feed. Each query examines at most one persistent page,
  batches metadata reads and never loads ciphertext or Run registry histories.
  A sparse legacy page can be empty with a next cursor. Continue until it is null;
  `total:null` means unknown, never zero. Historical physical actors and unknown
  trigger provenance remain unchanged; current assignment removal does not hide them.
- `POST /{vault}/tasks/{task}/progress/query` accepts the stable `requestId` (base
  trigger) and selected `assignmentIds`. Its recoverable per-executor snapshot
  distinguishes waiting/running/result receipt and unconfirmed executors, including
  partial completion. Merely viewing/leaving progress never starts or cancels work.

Agent routes under the existing owner/vault/physical-connection prefix add
`task-center/context`, `task-center/prepare`, and `task-center/plans/report`.
They use a separate closed PoP request profile (`folioview.task-center.v1`,
`task_center_agent_request`) bound to exactly these paths, original body, audience,
current certified signing key and a maximum 120-second window. OAuth alone is
insufficient. The old request/manifest/receipt contracts remain unchanged.

Context returns signed Owner controls and current assignment/rule references.
Prepare accepts the exact `taskId`, `baseTriggerId`, `operationId`, `binding`, and
`taskPublicationFingerprint`; it returns an assignment/version/rule/lifecycle
namespaced trigger for the unchanged Begin request. The durable preparation key
excludes credential generation: replacement or rule edits cannot turn retrying an
old intent into another Run. Both providers may use the same base slot while
receiving separate Runs/results. Begin freezes an attribution sidecar; content
reads and final result writes recheck current task, assignment, provider slot,
credential, rules, sources and consent. Original receipts remain observations,
never commands that reinstall authority. Removing one assignment fences only its
future reads/writes. These fences survive disabling the rollout gate; authenticated
Owner history/receipts and signed assignment removal remain available when off.

Plan reports bind the exact assignment/rule/lifecycle versions and use independent
CAS/original-operation receipts. Nullable rules are manual-only and cannot report
an enabled empty native plan. Each executor starts `unconfirmed`; saving rules is
not scheduling. Publication-only legacy plan reports cannot confirm enrolled task
rules. Agent statements always say `nativeScheduleAttested:false`; Hub Run/result
receipts do not prove what invoked the host. This implementation accepts only
`legacy_unknown` trigger attribution. Verified manual dispatch/source attribution,
trash/restore/purge consumers, Web integration and actual host acceptance remain
ordered follow-up work; no scheduler, worker, new database, VM or capacity is added.

### Task trash and request-driven retention

Signed `trash`, `restore` and `purge` commands use the same Owner endpoint. Trash
atomically increments the lifecycle epoch and hides all actors' results from both
ordinary and historical Owner entry points. Existing Begin/input/result writes
fail closed; legacy foreground writers cannot resume after a restore. Restore
within 30 days recovers Owner history only, requiring fresh assignment approval.
The explicit purge control is allowed only after that retention deadline.

`GET /{vault}/trash` returns the first task and its encrypted original (before
expiry). `POST /{vault}/trash/query` accepts `{contractVersion,cursor}` for
subsequent one-task pages with a nullable `nextCursor`. After expiry no original is returned.
`POST /{vault}/tasks/{task}/maintenance` with `{contractVersion}` processes at most
four Owner-scoped documents in one cleanup phase, in the current request. It can
be safely repeated; no background response thread, worker or scheduler is created.
The optional Web Trash view is the maintenance trigger. Thirty days is the restore
deadline, **not a promise of precise physical cleanup at that instant**. Copies
are retired as authenticated maintenance runs. Shared resource publications and
public certificates are retained. Legacy uncommitted copies without a provable
task association produce `reviewRequired:true` rather than a false completion.
Minimal task/receipt tombstones remain to prevent ID and request resurrection.
All maintenance is local-test only until separately authorized for real data.
