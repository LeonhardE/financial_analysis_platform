# Persistent Agent APIs

The persistent identity, resource-consent and content profiles extend workspace v2.0 without
upgrading legacy P1 grants. APIs, fixed runtime and Web consumers are implemented. The producer
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

The independent adapter reuses persistent content v1, frozen Runs and encrypted report storage.
It has a separate parent namespace and does not read Muse OAuth configuration or create OAuth
connections, access tokens, refresh tokens, decrypting proxies or keys. Existing native/foreground
routes retain their original parents and gates. An independent identity is never implicitly
adopted by those routes.

### Activation and trusted public channel

`HUB_EXECUTOR_CIPHERTEXT_ENABLED=1` and `HUB_EXECUTOR_CIPHERTEXT_CONFIG` are both required for
registration, resource approval, publication and Agent requests. Invalid/missing configuration
fails closed before opening storage or resolving producers. Owner history and signed terminal
identity/resource revocation remain available with this gate off or the approval expired.
The adapter is disabled by default; this change performs no deployment or activation.

The configuration is a closed JSON object with exactly these public string fields:

| Field                            | Meaning                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `hubAudience`                    | Exact HTTPS Hub origin for Agent request proofs, with no path, port, query or fragment.   |
| `clientId`                       | Preregistered independent executor client; separate from Muse registration.               |
| `issuer`, `audience`             | Pinned independent policy issuer origin and executor audience URL from executor-trust v1. |
| `provider`, `providerClientId`   | Pinned model provider and provider client identifiers.                                    |
| `policySigningKeyId`, `tlsKeyId` | Distinct canonical public key thumbprints, never private keys or credentials.             |
| `workloadDigest`                 | Exact lowercase SHA-256 digest of the approved workload.                                  |

The Hub compares these pins to the Root approval; it never fetches a supplied URL. These public
pins do not establish runtime provenance, TLS/encryption-key possession or attestation. The
independent policy/execution services must separately implement current checkpoints, one-use
leases, workload verification, key custody and model credentials before private production use.
This adapter does not mint or accept a Hub token as plaintext authority.

### Owner registration and controls

Owner paths start with `/api/v2/executor-connections/{vault}/{connection}`. They require verified
Google ownership, `X-FolioView-Contract: folioview.agent-workspace.v2.0`, no query or delegated
author selector, and an `Idempotency-Key` on mutations.

POST `/bindings` takes exactly `{contractVersion, command, approval, scope}`:

- `command` is the existing device-signed `PersistentAgentBindingPayload`, matching current
  Root-certified Agent signing/encryption keys, owner, vault and configured client.
- `approval` is a Root-signed executor-trust v1 `ExecutorApprovalPayload`, with the same operation
  ID as the command and header. Hub constructs its expected binding independently from the
  verified identity, configured channel, current complete owner device/recovery recipient set
  and `scopeDigest`. Caller-selected approval claims cannot replace these expectations.
- `scope` is exactly `{profile: "folioview.hub-executor-ciphertext-scope.v1", purpose: "analysis",
resultPolicy: "owner_inbox", resourceBindings: [{ref, sourceEpoch}, ...]}`. It contains 1–10 unique
  resource references, ordered by the UTF-8 bytes of each canonical JSON `ref`. The SHA-256 digest
  covers the whole canonical scope. Resource epochs and incarnations are exact.

The scope is an immutable ceiling. Resource-consent policies still supply revision/history
permissions and current revocations; even a broader policy cannot expand this ceiling. Tasks
and resource publications must fit the ceiling. Each new read/write checks the current parent,
Root approval expiry, configured channel, Agent certificates and complete owner recipient set.
Approval expiry, channel drift or recipient rotation requires a separately reviewed new enrollment;
there is no implicit update, migration, trust reset or reactivation of a used connection slot.

The owner has at most 16 independent connection IDs, including terminal tombstones. Registration
atomically creates `hub_executor_connections`, its bounded `hub_executor_owners` index and the
existing identity/original identity-operation rows. Existing OAuth parents and identity/operation
slots cannot be overwritten. The registration receipt binds the complete canonical request
digest. An exact retry returns the original receipt even after revocation and never revives it.
GET on the base path returns current public state, original approval, scope and registration receipt.

Additional suffixes use the existing signed controls/carriers and operation semantics:

| Method and suffix                                        | Body or result                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| POST `/revocations`                                      | `{contractVersion, command}`; fresh device-signed terminal identity revocation.     |
| GET `/identity-operations/{operation}`                   | Original signed identity operation receipt.                                         |
| GET `/resource-consent`                                  | Current public consent state and bounded operation IDs.                             |
| POST `/resource-approvals`, POST `/resource-revocations` | `{contractVersion, command}`; Root approval or existing bounded revocation control. |
| GET `/resource-operations/{operation}`                   | Original signed consent command, source-state evidence and receipt.                 |
| POST `/publications`                                     | `{contractVersion, envelope}`; Root-signed encrypted task or resource carrier.      |
| GET `/publication-operations/{operation}`                | Original publication receipt and exact encrypted envelope.                          |

The original encrypted owner task API and GET
`/api/v2/persistent-content/{vault}/tasks/{task}/authority` continue to supply task creation and
authority CAS state. This adapter preserves the same global task authority, so reassignment
fences previous Agents across both parent namespaces.

### Agent ciphertext flow

Agent paths start with
`/agent/v3/persistent/executor/owners/{owner}/vaults/{vault}/connections/{connection}`.
Every endpoint is POST with closed JSON `{contractVersion, proof, request}` and the contract
header. The existing persistent-content v1 Agent proof binds the exact HTTPS Hub audience,
method, full independent path, body digest and current identity for at most 120 seconds.
Bearer credentials, author/delegation/operation headers and queries are rejected.

| Suffix                 | Exact `request` fields                                         | Result                                                                   |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `/session`             | `{}`                                                           | Public identity, device binding, Root JWK, registry history and consent. |
| `/consent-receipts`    | `{operationId}`                                                | Original signed resource control and receipt.                            |
| `/tasks`               | `{}`                                                           | Current assigned task publication references within the scope ceiling.   |
| `/runs/begin`          | `{taskId, triggerId, operationId, taskPublicationFingerprint}` | Original frozen manifest, fingerprint and Run state.                     |
| `/runs/receipt`        | `{runId}`                                                      | Original manifest and current submitted/result pointer.                  |
| `/runs/input`          | `{runId, publicationId}`                                       | One exact task or resource carrier named by that manifest.               |
| `/runs/submit`         | `{runId, operationId, envelope}`                               | Immutable original encrypted report receipt.                             |
| `/runs/result-receipt` | `{runId}`                                                      | Original report receipt for unknown-outcome recovery.                    |

Begin reuses the deterministic owner/vault/task/trigger Run ID, immutable operation intent and
2-hour manifest. It checks current task authority/version, current producer source revisions,
permission epochs, source fences and request proof again before writing. Quotas remain 20 new
Runs per connection/minute and 200 per owner/day. Frozen input reads check current authorization
but retain the exact manifest-named ciphertext when a newer source publication arrives; they
never silently follow its latest pointer. There is no pre-Run task-content read in this namespace.

Report submission verifies the current Agent signature, exact manifest and authority, complete
current owner device/recovery recipients, source/task fences and create-only Run/result CAS.
It atomically saves the original envelope, result, operation, owner history page, observed Run
evidence and submitted pointer. Only one report can be created per Run. Same-operation changes
to any envelope/JOSE string conflict, including an alternate valid signature of the same signing
input. HTTP whitespace and a fresh short-lived request proof do not change the encrypted artifact.
An exact committed retry bypasses producer RPC and expired Run checks, while still requiring a
currently active parent, approval and Agent. Revocation denies Agent receipt access; separately
authenticated owner history remains available at `/api/v2/persistent-results`.

Requests stop reading at 64 KiB for ordinary Agent operations, 544 KiB for report submission and
24 KiB for result-receipt queries. Owner registration is capped at 68 KiB (64 KiB for its three
business fields), consent controls at 96 KiB and publications at 528 KiB. Existing 512 KiB carrier,
manifest, serialized Firestore document and 1 MiB response limits still apply. All routes return
closed errors and `Cache-Control: no-store`. Report ciphertext continues using the existing
opaque `carrierJson` storage/index exemptions; no additional private-content collection is added.

Synthetic tests cover real JOSE end-to-end encryption, original retries, wrong identities and
recipients, expired approvals, changed channels, owner rotation, source/task fences, size limits,
SQLite concurrency and real Firestore SDK commit collisions. They establish no production
attestation, native schedule, deployment or private-content activation evidence.

## Stable identity

The opt-in owner API stores the shared `folioview.persistent-agent-identity.v1`
binding independently of OAuth family deadlines. It is not an execution API.
No tokens, private keys, plaintext, content permissions or new cloud resources are
created by this slice. Existing foreground OAuth and P1 grant validation stay unchanged.

### Stable identity: Owner API

All paths below start with `/api/v2/persistent-agents`. They require the normal
Google owner, exact `X-FolioView-Contract`, no query, no delegated owner selector,
and no separate author header. Mutations require an `Idempotency-Key` matching the
signed command's `stableOperationId` and closed JSON `{contractVersion, command}`.

| Method and suffix                                  | Behavior                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/capabilities`                                | Explicitly reports enrollment, resource consent and execution readiness separately.                                                    |
| GET `/{vault}/{connection}`                        | Public identity plus original signed binding/revocation and authoritative parent-disconnect status; null identity means no enrollment. |
| POST `/{vault}/{connection}/bindings`              | Fresh device-signed enrollment, matching current root-certified Agent pair and preregistered Muse client.                              |
| POST `/{vault}/{connection}/revocations`           | Fresh device-signed terminal revocation, even when enrollment or the parent OAuth connection is disabled.                              |
| GET `/{vault}/{connection}/operations/{operation}` | Immutable original result for resolving an unknown outcome under current owner authorization.                                          |

Enrollment requires `HUB_PERSISTENT_AGENTS_ENABLED=1` and valid existing Muse OAuth
configuration. It defaults off. Deployment does not set it. Enable only after a
trusted first-pairing path has passed review and validation; possessing a public
key card or a model-transcribed fingerprint is not runtime provenance. History and
revocation remain available without that flag or live OAuth configuration.
The independent [resource-consent producer](#resource-consent) has its own approval
activation gate. Execution readiness is computed from its own producer gate and prerequisites.

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

The store contains only public signatures and identity metadata. Old connections
are not migrated or silently upgraded. Owner clients must verify the original
signed binding and root-checkpoint history rather than treating an API DTO as
cryptographic authority. The separately gated [atomic identity recovery producer](#identity-recovery)
consumes exact Agent proofs and returns identity-only original receipts. The trusted runtime and resource/Run execution consumers are implemented and
independently enforce current authority.

Validation uses real synthetic signatures on SQLite and the actual Firestore SDK
with synthetic RPC conflicts, plus HTTP gate and strict-transport checks. No live
user connection or resource permission is changed by these tests.

## Identity recovery

The Hub producer adopts the existing shared
`folioview.persistent-agent-identity.v1` challenge/proof contract. It proves
possession of the **current enrolled Agent signing key**, consumes the challenge
atomically, and returns an original identity-only recovery receipt. It does not
issue an OAuth bearer, resource permission, Run grant or decryption capability.
The new receipt is not a `VerifiedGrant` or an authentication cache for later writes.
Existing OAuth, foreground and content consumers do not accept it.

### Identity recovery: Closed Agent API

Both POSTs use `/agent/v2/persistent/identity-recovery`, exact
`X-FolioView-Contract`, no query and no caller Authorization/author/delegation/
idempotency selectors. Cloud Run workload ingress remains a separate front-door
control; it cannot substitute for an Agent proof. These calls do not take an
owner Google token or UID.

| Suffix        | Closed JSON fields                                             | Response                                                                               |
| ------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/challenges` | contractVersion, ownerSubject, vaultId, connectionId, clientId | Current shared `AgentSessionChallenge`.                                                |
| `/proofs`     | The preceding fields plus proof                                | `folioview.agent-identity-recovery.v1` receipt with authority exactly `identity_only`. |

Challenge requests are bounded to 4 KiB and proof requests to 32 KiB, with the
shared closed DTO/signature budgets enforced afterward. IDs are public routing
metadata, not proof. No private task/resource data is returned. Public challenges
contain only the stable public binding, audience and random nonce.

Both `HUB_PERSISTENT_AGENTS_ENABLED=1` and
`HUB_PERSISTENT_IDENTITY_RECOVERY_ENABLED=1` plus the existing valid preregistered
Muse OAuth configuration are required. Both default off. Disabled recovery loads
neither storage nor OAuth configuration. Deployment does not activate the flags.
The fixed audience is the configured issuer plus the recovery base path; callers
cannot select a key URL, callback, audience or transport expiry.

### Identity recovery: Atomicity and bounds

Each transaction resolves the current root-pinned vault/registry, original owner
OAuth index, matching client and original connection, stable identity, both active
Agent certificates and recovery bucket. Parent disconnect or terminal identity
revocation denies even an old valid signature. Ordinary OAuth/family expiry and
the original enrolling owner device's expiry do not erase the stable identity or
require an owner unlock. Current Agent key expiry/revocation still stops recovery.

The service generates the ID and canonical 32-byte nonce with a CSPRNG outside a
retrying callback. Each identity has at most one unconsumed live challenge; repeated
public requests reuse it. Challenges last at most 120 seconds. The proof uses the
exact shared canonical ES256 control with its distinct artifact and purpose.
Only a verified Agent signature over the stored challenge can consume it.

`hub_agent_recoveries` keeps at most eight bounded entries per stable identity.
Inside the **same** Firestore transaction, the producer checks the current challenge
is unconsumed, verifies the signature/current fences, records the complete original
public proof and immutable receipt, then consumes that entry. Concurrent proofs
produce one original receipt. Invalid proofs leave the entry unconsumed; a winning
revocation/disconnect prevents a racing proof from committing after retry.
No producer network RPC, KMS operation or credential exchange occurs in the callback.

Receipts contain the public exact identity binding, challenge ID, proof fingerprint,
acceptance time, original expiry and `identity_only`. Expiry is at most five minutes,
and no later than either current Agent certificate's expiry. A retry authenticates
the current Agent signer and returns the unchanged original receipt, including an
already elapsed deadline; it never extends authority or consumes a second challenge.
The signing-input fingerprint treats valid signature-byte variants as the same proof.

Unused expired challenges are pruned when issuing another challenge. Consumed
entries retain their original short receipt through expiry plus two minutes of
retry grace, then may be pruned. Capacity exhaustion fails unavailable. This bounded
**authentication handshake state** is not the permanent identity/policy/Run audit
history; those stores and their original operation receipts remain unchanged. Once
a handshake has expired or been pruned, a fresh proof can recover the same identity
without recreating a connection or content consent. It cannot create a second Run.

### Identity recovery: Adoption boundary

This producer does not establish that a public key originated in a protected Muse
runtime, or that its encryption private key survived a process/VM restart. Trusted
first pairing and protected runtime lifecycle remain separate production gates.
No real connection, resource selection, SDK session or schedule is enabled here.

The persistent execution consumers authenticate their own requests and recheck
current identity, permissions, task/Run/source fences and immutable delivery evidence
inside the committing transaction, and keep durable original Run/result receipts.
Do not authorize execution by deserializing this public receipt or by extending a
legacy foreground grant. Owner historical Inbox access remains independent.

Validation uses real synthetic signatures, an already expired enrolling owner
certificate and transport, SQLite and actual Firestore SDK retries, exact-receipt
replay, challenge expiry/capacity, identity/disconnect races and strict HTTP gates.
No real user key, credential or resource is used.

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
