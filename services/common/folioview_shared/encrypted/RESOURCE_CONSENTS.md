# Persistent logical-resource consent v1

`folioview.persistent-resource-consent.v1` is an opt-in shared extension under
the exact `folioview.agent-workspace.v2.0` contract. It builds on the stable
[Agent identity](PERSISTENT_AGENTS.md), without changing that profile, legacy P1
grants, OAuth expiry, certificate validity or existing service/Web consumers.
No HTTP endpoint, database mutation, content key, encryption or runtime is enabled.

## Permission meaning

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

## Packaged DTOs and entry points

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

## Owner controls and deterministic updates

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

## Per-resource revocation and later explicit reapproval

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

## Current resource gate and adoption

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

Adopt separately: this foundation; Hub identity/recovery and resource-policy stores,
receipts and guarded APIs; trusted runtime and narrow execution consumers; Web
unified consent/automatic authorized-version publication; real scheduling and
cross-day encrypted delivery. Existing P1 grants are not upgraded or extended.
VAL-005's protected lifecycle, first-pairing and real encrypted cross-day gates
remain open. No real Muse connection or user resource permission is created here.
