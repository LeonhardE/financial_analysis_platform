# Persistent content and fixed-request proofs v1

`folioview.persistent-content.v1` is a separate, opt-in extension under the exact
`folioview.agent-workspace.v2.0` contract. It depends on the stable Agent identity
and persistent logical-resource policy, and leaves every legacy P1 schema,
primitive, grant and consumer unchanged. No service, runtime or Web consumer is
enabled by importing this module.

## Purpose and authority

The original P1 grammar binds Agent work to short-lived task grants. It cannot be
made persistent by treating a resource policy decision or identity recovery receipt
as a `VerifiedGrant`. This extension authenticates exact Root-approved deliveries
and fixed current Agent requests; consuming producers separately enforce business
authority and atomic fences.

| Object   | Signer and meaning                                                                                                             | Additional current consumer checks                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Task     | Pinned vault Root approves exact task/version, original task fingerprint, selected Agent, resource bindings and output policy. | Current active owner task/head, assignment, authority version/digest CAS and exact original task fingerprint.                 |
| Resource | Pinned Root approves exact logical ref/incarnation, source version/epoch, permission ID/epoch and original source fingerprint. | FND-004 current resource policy, authoritative source/fence and immutable publication slot.                                   |
| Result   | Currently certified Agent signing key authenticates exact Run/manifest, task authority/version and result revision.            | Current identity/task/resource/Run/source fences, allowed report policy, recipient selection and original result/receipt CAS. |

Task `purpose` is `execute_task` and `resultPolicy` is explicitly `none` or
`owner_inbox`. Saving/enabling a task may create this Root authorization inside the
already unlocked owner Worker, without repeating resource permission. The current
per-task authority slot must retain one stable authority ID and advance its version
with expected prior version/digest; changing the assigned Agent replaces that
current binding. A new ID or an old signed task must not reset an occupied slot.
Ordinary resource updates do not change that task authority.

Resource `purpose` is `analysis`; publication is independent of a task. It carries
one exact permission ID/epoch and source revision. A normal future version is
published under the existing FND-004 policy; changed incarnation/account/source
scope still requires explicit new approval. Revocation of B cannot invalidate an
unchanged A. The original source fingerprint is a Root-signed assertion; it does
not prove a historical producer object exists. Consumers verify actual immutable
source evidence and must not copy routing/permission expectations from this claim.

Result `purpose` is `save_report`. A Root task configured with `none` cannot grant
report writes. The consuming producer must check that policy, as well as the frozen
Run and current authority; the signature alone does not make a write authorized.

## Closed wire and cryptography

`persistent_content.json` packages closed DTOs and uses local legacy primitives.
`load_content_schema` composes them without adding names to the legacy validator.
`validate_content_schema` is structural; semantic, signature and current-state
checks remain separate.

A carrier is exactly `{contractVersion, profile, proof, jwe}`. `proof` uses the
existing canonical flattened ES256 `fv-control+jws`, with an explicit independent
artifact/profile and `{context, ciphertextDigest}`. The digest is SHA-256 of the
canonical complete JWE. Large ciphertext is outside the signed-control payload,
so a 196 KiB financial object does not become a 64 KiB control.

The General JSON JWE uses exactly ECDH-ES+A256KW and A256GCM, with `typ` equal to
`fv-persistent-private+jwe`, JSON content type and external AAD equal to JCS(context).
Fresh library-managed CEK, IV and per-recipient ephemeral keys are required.
Headers, key IDs, public P-256 points, canonical base64url, recipient order,
wrapped-key/IV/tag lengths, private byte budgets and the AAD are checked. Key URLs,
private public-JWK fields, compression, unknown headers and algorithm fallback are
not supported. JOSE performs the standard algorithms; no custom KDF/cipher is used.
See [RFC 7518](https://www.rfc-editor.org/rfc/rfc7518) and
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).

Task/resource recipients are exactly the selected Agent encryption key and one
Root-certified owner recovery encryption key. This gives the owner an independent
copy of the delivery and interoperable per-recipient General JWE headers. New
publication checks the current owner recovery certificate. An Agent reading an
original Root-approved delivery does not lose it merely because that old owner
receiver later expires/rotates; current Agent certificates and business fences still
apply. New publications must use the current certified owner recovery key.

Results contain only owner device/recovery recipients, including recovery. Their
current certificates are checked at write time; no temporary foreground session
or original enrolling-device signature authorizes unattended report encryption.
Current Root registry recipient selection is a producer responsibility. This profile
does not extend any certificate's expiry or implement key repair/rotation.

The new private wrapper has schema version 1, explicit profile, object ID/type,
revision and payload. Content fields and their semantic/Markdown/URL checks reuse
the existing private schemas, without forging a P1 context or grant. Backends
verify only public data and cannot claim private schema/AEAD success. Trusted
owner/Agent clients validate the plaintext again after authenticated decryption.

## Public verification snapshots

`PersistentEnvelopeExpectation` requires independently supplied owner/vault/
connection/client, object type/ID/revision, exact recipient IDs and complete current
kind-specific task/permission/Run bindings. Extra binding keys cannot override the
trusted owner or identity. Required authority/output-policy bindings cannot be
omitted. Source-origin fingerprints may be compared to independently verified
producer evidence, or treated as explicit verified Root assertions; they are not
an incoming authorization selector.

`inspect_persistent_carrier` returns detached structural context/ciphertext and
checks their digest/AAD consistency only; it never authenticates a signature or
permission. It is suitable for bounded original-operation lookup before a source
RPC, with current owner authorization and immutable stored fingerprints.

`verify_persistent_carrier` checks the pinned Root, current/issuance identity and
checkpoint, signature, exact bindings, recipient constraints, ciphertext digest and
JWE structure. Returned context/carrier bytes are immutable snapshots, not bearer
capabilities, a `VerifiedGrant` or an authorization cache.

- `new_publication` requires current checkpoint/key epoch, fresh issue time (300
  seconds), active current Agent pair and current certified recipients.
- `agent_read` permits an earlier known Root checkpoint for an original publication,
  but still requires the current active Agent pair and independently current
  resource/task/Run/source authorization in the consumer.
- `owner_history` is trusted decrypting-client-only. It requires independently
  verified issuance registry and original identity snapshots plus immutable owner
  Run/receipt expectations. It verifies keys at issuance; it never authorizes a
  current operation. Never select this mode from an HTTP query or use a supplied
  snapshot as proof of global freshness.

`seal_persistent_content` and `open_persistent_content` are trusted endpoint
primitives, not remotely exposed signing/decryption APIs. Callers verify proof and
purpose before opening. Sealing is randomized: persist the original encrypted
request before transport, and check/replay that original on an unknown outcome.
Never regenerate ciphertext or a Run to resolve uncertainty.

## Fixed current Agent request proof

`PersistentAgentRequestPayload` binds the exact current identity, configured HTTPS
audience, actual method/path, canonical body digest, request ID, canonical 32-byte
nonce and an issue/expiry window of at most 120 seconds. Paths are fixed relative
`/agent/v3/persistent/...` paths without query, credentials, traversal or double slash.
The trusted runtime generates nonces/request IDs with a CSPRNG. No proof/token is
placed in model prompts, URLs or credential files.

`verify_persistent_request` selects the current certified Agent key from trusted
state, verifies the distinct artifact/purpose and compares the actual request
expectations. Root/device signatures cannot replace it. A nonce/time window is
not a one-use store. Writers must atomically retain original business operations
and receipts; readers/writers must recheck current permission and revocation state.
The public identity-only recovery receipt from HUB-013 is not accepted as authority.

## Frozen Run manifest

`PersistentRunManifest` freezes the exact current task publication, task authority
and output policy, ordered source/permission epochs, source versions, publication
IDs and fingerprints. Run lifetime is at most the existing two-hour ceiling.
`persistent_run_id` derives a stable owner/vault/task/trigger identity. A retry of
one trigger must not create a new Run, even if task assignment changes; actual
creation/lookup, current-actor isolation, quotas and durable receipts are producer
responsibilities. The manifest fingerprint is canonical SHA-256, not a signature
or proof that the input is current/authorized.

## Adoption and validation

Hub publication/execution/result producers, the fixed runtime and owner Web consumers
implement this profile. Feature gates and real Muse scheduling/cross-day acceptance remain
separate. Protected-host lifecycle and first-pairing gaps are explicit acceptance requirements.

Tests use real synthetic keys and signatures, every content type, large encrypted
resources, immutable expectations, wrong owner/client/authority, current revocation,
issuance-only owner history, unsafe private content, profile separation and exact
frozen manifests. A public Node-produced vector is always verified/decrypted in
Python using a documented public test scalar; optional live reverse tests verify
all content types with independent Node JOSE. No private JWK is stored in fixtures.

## Task center extension

The additive `folioview.task-center.v1` profile is packaged separately in
`task_center.json` with pure `task_center` helpers. Old task/content/manifest/JWE
profiles and browser distributions remain unchanged. No consumer, migration,
scheduler, dispatcher, purge job or cloud resource is enabled by these contracts.

A `CenterTaskDefinition` belongs to Owner/vault/task, independent of Agent identity.
Its business task/execution versions match the authoritative encrypted task head;
`definitionVersion` provides CAS, `ruleVersion` fences changed rules, and
`lifecycleEpoch` fences deletion/recovery. Schedule is nullable: null means manual
only, while scheduled tasks also accept separately approved manual intents.
Schedules use user-selected daily/weekly ISO weekdays, HH:MM, IANA timezone,
grace and effectiveFrom. Daily uses an empty weekday list; weekly is sorted and
nonempty. DST gaps skip, repeated wall times select the first fold and one stable
slot. Rule change fences the old rule on commit; new automatic occurrences start
at effectiveFrom. Saving a schedule does not create or attest any native plan.

`plan_task_rules`, `plan_assignment` and `plan_task_lifecycle` require distinct
current Owner-device controls, exact Root/checkpoint/freshness, closed fields and
expected versions. Assignment creation and manual intent additionally require
`task_grant`; a control-only device cannot add an executor. The shared internal
Owner-control verifier accepts a named schema validator while retaining its exact
legacy default and byte limit. There is no general unauthenticated sign endpoint.

Each canonical task/provider-slot pair has one stable assignment ID, its own
monotonic assignmentVersion and independently approved exact authority fingerprint.
Assignments bind current credential fingerprint/generation, physical actor,
canonical provider slot/generation, task/execution/rule/lifecycle versions. At
most 32 are represented per request; zero current assignments is normal. A
removed assignment remains a tombstone, does not affect another task/Agent or
delete prior history, and a later approval increments its existing version.
Slot replacement requires fresh reviewed assignment approval and grants; it does
not implicitly inherit task access. These metadata predicates issue no grants,
create no ciphertext and do not replace current PoP, lease expiry, source epochs,
input/delivery checks or atomic consumer CAS.

### Runs, triggers and recoverable state

The existing persistent Run hash uses Owner/vault/task/trigger. Thus consumers
must namespace a task-center trigger with `assignment_trigger_id` using exact
assignment/version/rule/lifecycle and the base trigger kind/ID before deriving
the old Run ID. Two Agents executing the same slot then have separate Runs and
receipts. Do not rewrite a trigger only on the server: pinned clients compare the
manifest trigger with their request. A compatible client must agree on the
namespaced trigger, or explicitly use the legacy path for unenrolled tasks.
Never rename an old failed Run or fill its receipt with a new execution.

`bind_task_run` freezes assignment, actual actor, original manifest fingerprint,
input-version digest and trigger context as a separate `CenterRunBinding`; it
leaves the old manifest format intact. `validate_run_binding` validates historical
binding/manifest consistency without requiring the actor still be current.
`require_run_current` is an additional current assignment/slot/rule/lifecycle
write fence. Consumers still validate the original manifest and resources,
recheck all authority at final commit and atomically store the immutable binding,
result and original operation receipt. A removed/replaced assignment or restored
task must never authorize a late old write.

A manual trigger requires `verify_manual_intent`: a fresh Owner signature, exact
current definition and selected nonempty assignment versions, stable request ID
and at most 600-second admission window. The returned snapshot is deeply frozen.
Consumers persist/consume each intent per assignment atomically; one intent can
target multiple Agents without sharing their operation/receipt namespace. Its
expiry gates admission, not cancellation of an already accepted valid Run.
Manual dispatch/provenance adoption remains separately gated consumer work.

A scheduled trigger needs both a policy-valid slot and `TrustedScheduleSource`
created only by a trusted adapter after actual source verification. This type is
not a wire DTO, a supplied verified flag, an Agent statement or proof that any
provider supports the needed source. This package supplies no native-source
adapter. Without such proof the consumer must use `legacy_unknown`, including
when a native-looking trigger ID or a report is present. Real dispatch/provider
acceptance must be established separately before enabling attribution.

`CenterProgressSnapshot` uses the same stable request ID across navigation and
refresh and contains independent executor stages: waiting, awaiting_confirmation,
running, result_received, failed and cancelled. Aggregate output keeps partial
failures and unresolved acknowledgements explicit. A report receipt is named
`result_received`, not native-cycle success. Closing a view is not a cancellation
command and cannot create a replacement intent or reset execution. Consumers
build these snapshots from durable evidence, never an HTTP busy flag or model text.

### Coupled deletion and history

Trash advances the parent lifecycle epoch and gives the task and all associated
Runs/results the same effective hidden state. Restore is allowed strictly before
30 days, advances the epoch again, restores Owner history and reactivates no old
assignment, plan or Run. Historical actor/assignment attribution is immutable and
need not match a currently active executor. Parent visibility and current-write
fences are separate checks. Purge at/after the deadline keeps the minimal version
and lifecycle tombstone; it cannot restore/recreate generation one or delete
another task's shared Root/certificate/history. The consuming service must prove
its atomic tombstone, physical content/index cleanup and real purge trigger
separately; these pure plans do no deletion or background scheduling.
