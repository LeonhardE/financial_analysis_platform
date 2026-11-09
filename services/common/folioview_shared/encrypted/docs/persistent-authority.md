# Persistent identity and resource authority

These stateless shared profiles define identity/recovery and logical-resource consent.
Hub owns transactional persistence; runtime/Web consumers independently verify the original
proof chains. See [wire contracts](../README.md), [persistent content](persistent-content.md)
and the [Hub API](../../../../agent-hub-service/docs/persistent-api.md).

Common prerequisites are workspace v2.0, current Root-pinned registry and independently derived
owner/connection/client expectations. Verification snapshots never replace per-operation
transactional authorization. Neither this contract nor a valid identity approves a new resource.

## Identity and session recovery

This additive foundation defines `folioview.persistent-agent-identity.v1` under
the exact existing `folioview.agent-workspace.v2.0` contract. It separates a
stable, explicitly approved public Agent identity from short-lived transport
credentials. Hub storage, recovery and execution, the fixed runtime and Web consume this contract.
Importing it does not enable feature gates or grant resource access.

The existing P1 task grant, OAuth family, certificate deadlines, Run and result
contracts are unchanged. An old connection, signed grant or expired helper
session is not upgraded by loading this module. There is no automatic migration.

### Identity and session recovery: Public records and controls

`persistent_agents.json` contains five closed DTOs. The Python loader composes
local packaged primitive definitions with these DTOs without modifying or
registering names in the legacy schema validator. JSON Schema consumers in other
languages must resolve the same local definitions and enforce the semantic checks
below; a structural schema pass never authorizes anything.

| DTO                                | Purpose                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PersistentAgentBindingPayload`    | Fresh owner-device-signed approval of one already root-certified Agent signing/encryption key pair, connection, client and principal. Initial identity epoch is exactly 1. |
| `PersistentAgentIdentity`          | Stable public binding, original signing-input fingerprint, registration time and active/revoked state. No OAuth family, bearer, content permission or expiry field.        |
| `PersistentAgentRevocationPayload` | Fresh owner-device control matching the exact current binding fingerprint and epoch.                                                                                       |
| `AgentSessionChallenge`            | One persisted, audience-bound challenge to recover this same identity, valid for at most 120 seconds.                                                                      |
| `AgentSessionProofPayload`         | Agent signature over the exact challenge, with a distinct artifact type and `resume_session` purpose.                                                                      |

Identity bindings include owner, vault, pinned root, connection, Agent principal,
OAuth client, identity epoch and both certified Agent key IDs. This is not a
deduplication key based only on a client ID, email, model name or provider. Two
independent connections remain separate even for the same owner and provider.

All signed controls use the existing closed ES256 `fv-control+jws` format, with
canonical JCS payloads and explicit artifact/profile discriminators. The legacy
grant/Begin/control verifiers do not accept the new payloads. Full signed messages
and extension DTOs are capped at 16 KiB; IDs and integers retain the existing bounds.
There are no arbitrary public-key URLs, private keys, PRF outputs, content bodies,
scope selectors or resource permissions in an identity record or recovery proof.

### Identity and session recovery: Enrollment

`verify_agent_identity_binding` requires the caller's authenticated owner/vault,
selected connection, Agent principal, preregistered client and current root-pinned
`VerifiedRegistry`. The owner-device control must reference that current checkpoint,
have `control_write`, be currently certified and have been issued within 300 seconds.
Both Agent keys must be active, unexpired and certified to the same selected
principal/connection with their distinct signing/encryption roles.

This verifies an explicit owner approval and public key binding. It does **not**
prove that keys originated in a trusted Muse process or that the runtime protects
them. First-pairing provenance and the protected-runtime lifecycle are separate
production gates. Model-transcribed public keys are not a trusted enrollment path.

`initial_agent_identity` derives the public record from the verification snapshot.
It refuses every occupied slot, including an active record and a revoked tombstone.
The consuming service must perform create-only CAS and keep the original signed
binding and operation receipt atomically. Exact unknown-outcome recovery uses that
original operation/receipt under fresh owner authorization; it must not manufacture
a second connection or overwrite a tombstone. Verification objects are in-process
snapshots, not capabilities to deserialize from HTTP or use as authorization caches.

### Identity and session recovery: Recovering a short-lived session

`verify_agent_session_proof` takes the **authoritative stored** identity, challenge,
used flag, current registry and trusted route/configuration bindings. None of these
expectations may be copied from the incoming proof to make it self-verifying.

1. Check the current owner/vault/root, selected connection and preregistered client.
2. Require an active identity and an unused challenge. Compare every immutable
   identity field, identity epoch and original binding fingerprint.
3. Require the exact configured HTTPS audience, without credentials, query or
   fragment. No network request or discovery follows this value.
4. Check a canonical 32-byte nonce, bounded operation ID, nonfuture issue time,
   expiry after now and lifetime at most 120 seconds. The challenge cannot predate
   registration. The producer must generate ID/nonce using a CSPRNG.
5. Verify the exact proof with the current root-certified Agent signing key, and
   recheck the current Agent encryption key, roles, principal, connection, expiry
   and revocation. Neither root nor owner-device signatures can replace this proof.
6. Inside the consuming service's same commit transaction, reread current identity,
   challenge and revocation state, verify, consume the challenge and record any
   resulting narrow session. A copied `challenge_used=False` outside that transaction
   is not replay protection. Concurrent proofs must yield at most one issuance.

The returned proof authenticates recovery of that identity only. It does not grant
access to tasks, sources, ciphertext, Run creation or result writes. Those require
their own explicit current consent, execution/source fences, scopes, expiry and
transaction checks. A downstream issuer must not turn recovery into broader rights
or reuse an authorization snapshot after a revocation. No token issuer, refresh
endpoint, persistent store, challenge generator or HTTP route is supplied here.

An OAuth expiry or ordinary owner sign-out does not delete this public binding.
An expired original enrolling owner-device certificate is not rechecked during
Agent recovery, so enrollment does not depend on a user staying online. Current
Agent certificates still bound use: expiry/loss stops execution, leaves the stable
identity intact and requires a separately approved repair/renewal path. This identity contract
does not implement key rotation or extend any existing certificate. A signing proof
alone is not proof that an encryption private key survived a process restart.

### Identity and session recovery: Revocation

`revoke_agent_identity` verifies a fresh owner-device control against the exact
current record. It returns a terminal revoked record with identity epoch advanced
by one; overflow is rejected. Revocation does not require the Agent to be online or
its keys to remain usable. Old challenges, old signatures and newly issued
challenges against a revoked record cannot recover it. There is no restore action.

The producer must atomically persist that tombstone with its original immutable
receipt and invalidate future connection capabilities. It must recheck this fence
at each protected operation. Removing a Muse connector or expiring a refresh token
is not a substitute for explicit Hub revocation. Previously disclosed plaintext
cannot be remotely recalled; owner access to historical ciphertext is separate.

### Identity and session recovery: Validation and integration

Synthetic real-signature tests cover owner/Agent separation, both key bindings,
wrong owner/vault/root/client/audience, expiry and replay, nonce substitution,
revocation fencing, immutable verification snapshots and legacy-profile rejection.
Run shared tests and the repository's complete `npm run check` before delivery.
The packaged wheel must include this JSON file and resolve its local primitives.

Shared resource policy, Hub producers, the runtime and Web consumers are implemented.
Their activation and real provider acceptance remain separate controls.

VAL-005 observed actual OAuth refresh and ordinary native scheduled REST read/write,
but did not establish protected process-restart persistence, trustworthy first
pairing or real encrypted cross-day delivery. Those gates remain open. This
foundation does not turn the current foreground helper into background execution.
The provider's [connector permission rules](https://platform.muse.ai/docs) and
[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
remain separate from content decryption consent.

## Logical resource consent

`folioview.persistent-resource-consent.v1` is an opt-in shared extension under
the exact `folioview.agent-workspace.v2.0` contract. It builds on the stable
[Agent identity](#identity-and-session-recovery), without changing that profile, legacy P1
grants, OAuth expiry, certificate validity or existing service/Web consumers.
No HTTP endpoint, database mutation, content key, encryption or runtime is enabled.

### Logical resource consent: Permission meaning

An owner explicitly approves **analysis** of named logical resources for one
stable Agent identity. Each permission binds the exact resource kind, producer,
ID, incarnation and source fence epoch. Approval is independent of a task version,
OAuth family, browser unlock or ordinary transport/session expiry.

The only version policy is `current_and_future`. A new permission's `fromRevision`
must equal the producer's authoritative current committed positive revision at
approval. It covers that revision and later normal updates in the same incarnation
and fence epoch. Updating a CSV or reusing the resource in another task does not
itself require a new resource permission. Task execution/read rights, authenticated
request scopes and actual encrypted deliveries are independently required.

Earlier versions are excluded except for the sorted, exact `selectedHistory` list.
For example, approval at revision 5 with history `[2]` covers 2 and 5 onward,
but not 1, 3 or 4. It cannot authorize a not-yet-committed revision. A policy check
does not prove that a selected historical object exists or authenticate its carrier.
Retrieval must verify the actual revision, source epoch and immutable Run evidence;
old-epoch ciphertext does not become a current delivery merely by selecting history.

Incremental owner approval can add resources or expand an active permission's
selected history. The original revision floor and source binding remain fixed;
history cannot be silently dropped or the floor lowered. An expansion advances
only that permission's epoch. Reapproving an identical scope keeps its epoch.

### Logical resource consent: Packaged DTOs and entry points

`resource_consents.json` contains closed DTOs and local primitive references.
`load_resource_consent_schema` returns a detached composition with the packaged
legacy primitives. New names are not installed in the legacy validator. A schema
pass is structural only; consumers must enforce the semantic rules below.

| DTO / function                                                                                 | Responsibility                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ConsentResourceApproval`                                                                      | One explicit resource/version/history selection with its expected permission epoch.                                           |
| `PersistentResourceApprovalPayload` / `approve_resource_consent`                               | Verify a fresh pinned-root signature and derive the next public aggregate from current state and authoritative source states. |
| `ResourcePermissionTarget` / `PersistentResourceRevocationPayload` / `revoke_resource_consent` | Revoke exact named current permissions, retaining terminal IDs and advancing their epochs.                                    |
| `ResourcePermission` / `PersistentResourceConsent`                                             | Public per-resource policy and bounded aggregate, bound to the exact stable identity and its original binding fingerprint.    |
| `ConsentSourceState`                                                                           | Trusted owner/vault/ref, current source epoch, committed revision and operational state; no private source content.           |
| `check_resource_consent`                                                                       | Check one requested revision against current identity, certificates, permission and source fences.                            |
| `resource_consent_digest`                                                                      | Canonical public-state CAS digest; not proof that a server-supplied state is authorized.                                      |

There are at most 10 active resources, 32 retained permission records and 50 selected
historical revisions per permission. A command selects at most 10 resources/targets.
Whole DTOs and signed controls are capped at 64 KiB. Integers use the existing safe
JSON range. Capacity exhaustion fails closed; consumers must not discard tombstones
to make room. There are no private keys, PRF outputs, bearer tokens, titles, holdings,
unbounded purpose strings or arbitrary scope fields in these records.

### Logical resource consent: Owner controls and deterministic updates

Both commands use the existing canonical flattened ES256 `fv-control+jws` format
with explicit artifact/profile discriminators. They bind the authenticated owner,
vault, pinned root, connection, Agent principal/client, identity epoch, both Agent
key IDs, original identity binding fingerprint and consent ID. The producer must
resolve these from trusted state rather than copying incoming claims.

Commands include an operation ID, the exact expected aggregate version **and**
canonical digest, current registry/checkpoint/key epoch and issue time. Approval requires a signature from the independently pinned vault root. The
verifier checks the supplied public root thumbprint against the current registry;
no key URL or request-supplied root can establish trust. The root stays in the
trusted owner client. It signs only the reviewed closed control; neither the
root private key nor a generic signing capability goes to Hub or the Agent.
A bounded device's `task_grant` capability must not be reinterpreted as permission
to grant indefinite resource access.

Revocation accepts either that root or a currently certified owner device with
`control_write`, because it only narrows access. The issue time must be within
300 seconds. It must not be future, precede the current checkpoint or signing
device's validity (when applicable), or predate the preceding policy state. `authorKeyId` must match the
actual verified signer. Agent signatures cannot approve or revoke owner policy.

`approve_resource_consent` requires exactly one authoritative source state for each
selected resource. A new permission cannot be approved from a stale revision or
inactive/unavailable source. A new incarnation or fence epoch is not a normal
version update. Existing active permissions cannot be silently rebound to it.

The derived aggregate increments its CAS version, retains unaffected permissions
unchanged, and records the original signing-input fingerprint and operation ID.
Timestamps are derived from the signed issue time, so identical input and trusted
prior state yield identical output even across signature-byte variants. Input
records are detached and never partially mutated if a later selection fails.

The consuming producer must keep one aggregate slot per stable identity. A missing
row in a new namespace is not evidence that legacy or revoked state never existed.
Use create-only/expected-state CAS and atomically store original complete signed
commands, deterministic next states, immutable receipts and the prior-state chain.
An exact unknown outcome is resolved through its original operation/receipt under
current authorization, not by generating new permission IDs or re-signing the action.
This pure library does not implement those transactions or a receipt store.

Trusted encrypting clients must verify and pin the root-approved control chain and
its root/checkpoint evidence before automatically wrapping new-version keys for an
Agent. A mutable server DTO or a digest alone is insufficient authority. Historical
controls may require retained certificate/checkpoint verification at issuance;
the original owner device expiry does not erase root-approved consent.
A valid old chain proves past approval, not global freshness; trusted current-state
reads and retained checkpoints remain necessary. Current operations still use
current registry and business fences.

### Logical resource consent: Per-resource revocation and later explicit reapproval

Revocation advances the selected permission's epoch and retains a terminal revoked
record and revocation fingerprint. Other resource entries stay byte-equivalent.
Aggregate version is CAS/audit metadata, **not** a global execution fence: a change
to resource B must not revoke an unchanged permission for A.

Neither old signatures, new sessions nor a reused permission ID can reactivate a
revoked record. If the user explicitly approves the resource again, it needs a fresh
permission ID, fresh current revision/history selection and expected-state owner
control. The old revoked ID is retained and remains denied. No old access snapshot
may silently switch to that new ID. At most one permission for a logical ref can be
active; a new ref/epoch approval cannot bypass an existing active record.

The owner can revoke while sources are unavailable or Agent certificates have
expired/been revoked. Disconnecting the stable Agent identity blocks **all** child
permissions through its current identity state/epoch. Expiring OAuth, normal owner
sign-out and the original owner's certificate expiry do not delete resource policy.
Current Agent certificate validity still bounds execution. Already disclosed
plaintext cannot be recalled, and owner access to historical ciphertext is separate.

### Logical resource consent: Current resource gate and adoption

`check_resource_consent` receives current trusted identity/policy/source state and
exact expected owner/vault/connection/client/consent, permission ID/epoch, ref,
source epoch, revision and purpose. It rechecks the parent, current Agent pair,
active permission and source state each time. An unavailable source fails unavailable;
inactive sources, changed incarnations/fences and unapproved history fail closed.

The returned immutable `ResourceConsentDecision` is a snapshot of **one policy gate**.
It is not a token, a `VerifiedGrant`, a Run approval or an authorization cache.
The consumer must authenticate each request, enforce scopes and current task/Run/
source/delivery rules, and reread relevant revocation state in the same committing
transaction. Never authorize a later operation from a cached decision or from
the incoming request's own state. Actual ciphertext preparation remains client-side.

Hub identity/recovery, resource policy, execution and report producers plus runtime/Web
consumers adopt this contract. Existing P1 grants are not upgraded or extended.
VAL-005's protected lifecycle, first-pairing and real encrypted cross-day gates
remain open. No real Muse connection or user resource permission is created here.

## Independent executor trust

`folioview.executor-trust.v1` is a separate opt-in public trust extension under
`folioview.agent-workspace.v2.0`. It does not change P1, identity-v1's epoch rules,
resource consent, content carriers or their existing validators. Import Python
entry points from `folioview_shared.encrypted.executor_trust`; browser consumers
use the same names in camelCase from the separate checked
`@folioview/executor-trust` bundle. Consumers adopt
it in separate target PRs. No provider, OAuth issuer, key-release service, database,
attestation verifier, credential issuer or production identity is created here.

The packaged `executor_trust.json` and browser `packages/executor-trust/schemas.json` are
identical closed schemas. `load_executor_schema` returns detached local definitions;
`validate_executor_schema`/`validateExecutorSchema` check structure and the 32 KiB
whole-object budget only. Semantic verification entry points remain mandatory.
Unknown fields, private JWKs and other profiles are not accepted as these DTOs.

### Trust and content binding

`ExecutorBinding` identifies the independently selected Owner, vault, root,
connection, Agent, client, identity epoch, original binding fingerprint, Agent
signing/encryption keys, TLS key, policy signing key, issuer, audience, provider
and provider client. It also binds the exact approved workload digest, content
scope digest and sorted owner recipient key IDs. Scope digest means the JCS SHA-256
digest of the reviewed content-policy descriptor selected by the consumer; it
is not permission to use a packet's own scope claims as authority. The descriptor
and originating Root consent, task/source fences, provider identity and actual
ciphertext recipients still need independent verification during adoption.

Key IDs use canonical RFC 7638 SHA-256 P-256 thumbprints; root, policy, Agent
signing, Agent encryption and TLS keys must be distinct, with 1–10 distinct sorted
owner recipients disjoint from those keys. The consumer resolves the actual public
keys from independently trusted enrollment/registry state, never a key URL or the
request itself. The binding alone does not prove private-key custody, ownership,
provider authenticity or enclave measurement.

This profile accepts lowercase ASCII HTTPS issuer origins without a trailing
slash and exact HTTPS audience paths containing only slash-separated ASCII
alphanumerics, underscores and hyphens (an optional final slash is distinct).
Credentials, query, fragment, explicit port, percent encoding and dot segments
are rejected, not normalized. Values are compared without discovery or network
access. Alternative URL forms require a separately reviewed contract change.

### Signed controls and verification

All controls reuse the existing closed canonical flattened ES256
`fv-control+jws` format implemented by mature JOSE libraries, with distinct
profile/artifact discriminators. JSON integers retain the safe range; times are
integer Unix seconds, no clock leeway, with `issuedAt <= now < expiresAt`.

| DTO / verifier                                             | Meaning and required trusted inputs                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExecutorApprovalPayload` / `verify_executor_approval`     | Pinned Root signature over the exact independently expected binding and operation ID. Valid for at most 30 days; cannot widen scope or replace recipients implicitly.                                                                                                                            |
| `ExecutorCheckpointPayload`                                | Independent Policy signature over binding digest, original approval signing-input fingerprint, latest state version/head, authorization epoch and revoked flag; at most 120 seconds. The complete payload must equal the caller's authoritative latest checkpoint, not merely a minimum version. |
| `ExecutorChallenge`                                        | A persisted one-use 32-byte CSPRNG nonce and operation ID, bound to the exact binding digest and one of `execute`, `write_report`, `recover`; at most 120 seconds. This library does not generate/store/consume it.                                                                              |
| `ExecutorLeasePayload` / `verify_executor_lease`           | Independent Policy signature binding that exact challenge, current checkpoint digest and exact requested operation. Rechecks Root approval and current nonrevoked checkpoint; requires `challenge_used is False`, exact purpose and expiry within all enclosing windows.                         |
| `ExecutorOperation` / `ExecutorReceipt`                    | Binding digest, immutable Run/operation IDs and SHA-256 digest of the original submitted request bytes; original receipt ID/result digest. The producer derives these from the original bytes and committed Run state.                                                                           |
| `ExecutorRecoveryPayload` / `verify_executor_recovery`     | Original Agent signing-key proof under a fresh **recover-only** lease. Recovered binding, all original keys/recipients, checkpoint/state head and the complete ordered retained receipt list must match trusted expectations. Duplicate operation/receipt IDs are rejected.                      |
| `ExecutorTransitionPayload` / `verify_executor_transition` | Fresh (at most 300 seconds) Root control over the exact prior approval fingerprint/current checkpoint and selected next binding. Explicitly distinguishes code upgrade from epoch migration.                                                                                                     |
| `check_executor_retry`                                     | Checks original operation/body binding and returns a detached original receipt. Both expected operation and original receipt must come from trusted immutable storage. This function does not authenticate a request or authorize execution.                                                     |

A lease cannot precede its checkpoint or challenge, outlive either, or extend Root
approval. A recover lease is never a content-read/write lease. A Hub signature or
self-selected issuer cannot replace Policy authority. Public fingerprints exclude
signature bytes, so valid ES256 signature variants do not create new operations.
A digest or a signed historical checkpoint alone cannot establish global freshness.

### Same-key recovery, upgrade and migration

Same-key recovery retains the complete approved binding, including the original
Agent signing/encryption and TLS key IDs, state head and original receipts.
An Agent signature proves **signing-key possession only**. Actual encryption-key
ECDH/decryption challenges, TLS-key challenges, measured workload and the hash of
restored sealed state remain executor/policy runtime obligations. Do not present
this public statement verifier as enclave attestation or proof of all private keys.

A `code_upgrade` changes only the workload digest, with the exact same keys,
epoch, scope, issuer and recipients. An `epoch_migration` advances the epoch by
exactly one and requires new Agent signing and encryption keys. It can also update
TLS/workload/original binding fingerprint, but retains stable principals, root,
provider/client, policy authority, audience/issuer, scope and owner recipients.
Retained historical receipts keep their original binding digest across approved
upgrades/migrations; the exact independently trusted receipt list is compared,
never rebound to the new binding. They do not authorize new execution.
Each transition must be explicitly Root-signed against the exact current
checkpoint and expected next binding. Neither transition automatically creates a
new approval, extends certificates, activates new keys or rewrites old receipts.

Permanent key loss is not recovery. There is no `lost_key`/implicit reset fallback.
A separately approved epoch migration may establish a new future identity; it
cannot decrypt old content or make the lost original key available again. Existing
P1/identity-v1 users are not silently migrated into this profile.

### Current-state transaction and replay obligations

Policy/Executor/Hub consumers must independently authenticate their current
checkpoint source, retain trusted pins, and in the committing transaction recheck
current approval, nonrevoked identity, checkpoint, challenge-unused flag, source
and Run fences. Consume the challenge and commit operation/outbox/receipt state
atomically; a caller-supplied `False` or a cached verification dict is not replay
protection. Missing or rolled-back trusted state must stop new work. Do not select
expected bindings, latest checkpoints or receipt lists from the incoming proof.

Transitions require expected-state CAS that installs the new approval/checkpoint
and terminally fences the prior active epoch before new work. An old lease cannot
match the current next-epoch binding/checkpoint. Restoring an old encrypted backup
must not roll back that independent checkpoint or revocation epoch. Original
operation IDs, original byte digests and receipts remain immutable; retries do not
re-sign/re-encrypt or silently generate another report. Revocation/expiry stops
new work; historical owner report reads are governed separately.

The pure verifiers return detached dicts/objects, not persistent capabilities or
an authorization cache. Release-policy management, key resolution, original-key
backup/recovery, current-state reads and atomic storage belong to separately
implemented targets. The personal trusted Owner assumption does not establish
isolation from that same ultimate Owner or future SaaS administrators.

### Independent checks

`test_executor_trust.py` verifies public Node/JOSE vectors and sends Python-signed
controls back through the actual dependency-free browser bundle. Browser tests
also enforce identical packaged schemas and attack cases covering wrong identity,
issuer/audience/provider, recipients, purpose, expiry, signatures, stale/revoked
state, nonce replay, recovery substitution and epoch/upgrade confusion. Existing
P1 and persistent-profile suites remain required. Run `npm run test:contracts`,
the shared Python suite and root `npm run check` before delivery.
