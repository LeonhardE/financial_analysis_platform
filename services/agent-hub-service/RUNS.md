# Encrypted Runs and immutable manifests

The Run producer reuses committed encrypted preparations, current OAuth authority and the formal
v2 Run/manifest/Begin/component contracts. It freezes opaque inputs; it does not run a model,
schedule a task, decrypt private content or save results. The foreground helper adds restricted
Begin signing and Run verification; result operations remain separate work.

## Protocol

All routes require the exact `X-FolioView-Contract` header and Hub opaque bearer credentials.
The existing adapter flag and OAuth configuration remain required and disabled by default.

| Request                                            | Purpose                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /agent/v2/tasks/{taskId}/runs`               | Create a Run from a signed Begin intent, or return the original Run on an authenticated retry |
| `GET /agent/v2/runs/{runId}`                       | Read the formal Run/manifest wrapper and retained author-proof descriptors                    |
| `GET /agent/v2/runs/{runId}/inputs?cursor=...`     | Read one complete manifest-bound task/resource carrier                                        |
| `GET /agent/v2/runs/{runId}/registries/{sequence}` | Read one root-signed proof bundle                                                             |

Begin requires `runs:create`, relevant source-read scopes and the matching signed key grant.
It does not implicitly require `tasks:read` after the committed preparation is already known.
Its closed body is `{contractVersion,signedBeginIntent}`; `Idempotency-Key` must equal the signed
stable operation ID. Reads require `runs:read` plus relevant source-read scopes. Callers cannot
supply the owner, Run/manifest/result IDs, private keys or replacement manifest/inputs.

The response profile is `folioview.agent-run.v1`, containing `contractVersion`, `profile`, `run`,
`manifest`, `manifestFingerprint`, `componentPath`, `registryProofs`, `authorProofs`. The nested
Run, manifest and input pages use the existing formal shared schemas. New creation returns 201;
authenticated replay returns 200 with the original stored Run and manifest.

## Independent identity and retries

The helper retains its signed Begin intent and computes IDs before sending it. For each label,
compute full lowercase SHA-256 of canonical JSON for:

```text
[label, ownerSubject, vaultId, connectionId, authorizationId,
 grantId, grantEpoch, taskId, stableOperationId, beginIntentFingerprint]
```

Use labels `folioview.run-allocation.v1`, `folioview.manifest-allocation.v1` and
`folioview.result-allocation.v1`, with prefixes `run_`, `manifest_`, `result_` respectively.
The Begin fingerprint is the shared JWS signing-input fingerprint, excluding signature bytes.
These service-profile IDs are routing pins, not access credentials or a new shared schema.

Idempotency is partitioned by authenticated owner/vault/connection/grant/task and operation.
Validate the incoming signature and current authority before accepting a retry. Valid ES256
high/low-S signatures with the same protected header and payload have the same operation identity
and return the original stored manifest, including its original signed intent. Changed signing
input conflicts; an invalid signature never qualifies for replay. Clients still cache and resend
their exact original intent. A missing operation index cannot overwrite an existing deterministic
Run or extend its lifetime.

## Freezing and current permission

Begin uses the committed shared task carrier fingerprint and delivery revision, rather than the
original owner TaskMetadata fingerprint. The manifest fixes source reference/incarnation/revision,
epoch, copy object ID, ciphertext fingerprint and key epoch in signed resource-selection order.
It keeps the complete original carriers and retained public author proofs in the same Hub database.
The reserved initial result ID does not mean a Result exists.

All ciphertext is already locally prepared. The service obtains fresh source metadata outside
the transaction, then checks current bearer/family/connection/grant/task/source/key fences and
publishes the Run, manifest, components, proofs, operation and quota records atomically. No
background preparing worker, lease takeover or network request in a retried transaction is needed.
Partial/failed admission does not publish a ready Run.

Metadata-only state probes reuse the existing bounded `browser_catalog` / `resources:catalog`
delegation after agent authorization. They do not fetch financial plaintext or Run-bound source
content, forward an agent token to a producer, or relax the producer's rejection of `agent_run`.
Actual Run inputs come only from committed client-encrypted Hub copies. This is not an
implementation of a new cross-service Run-content projection.

New admission requires current prepared task/source versions. A saved Run keeps its original
task/resource bytes when ordinary content revisions advance; its read guard verifies the frozen
grant version rather than wrongly requiring that version to equal today's task version. It still
checks active task status/execution epoch, source incarnations/epochs, current scopes, grant and
key qualifications. Pause, explicit revocation, relevant key changes, expiry or source failure
can stop further reads; none rewrites the frozen input selection. Result-receipt recovery has
different rules and is not implemented by these endpoints.

Retained author signatures are checked against the authenticated historical registry and the
Run issuance time. A source writer's later expiry/revocation does not erase a previously accepted
signature. Current agent/grant/recipient authority remains a separate mandatory check. Cursors
bind the original Run/manifest/component position; each page contains one complete carrier and
is bounded by the shared whole-response budget.

## Limits and remaining work

Run lifetime is at most two hours and cannot outlive its grant/consent/refresh-family authority.
Access-token renewal does not extend it. Durable admission limits are 20 new Runs per connection
per minute, 200 per owner per UTC day and 32 lifetime Runs per grant/task. Exact retries do not
consume new capacity; reads and revocation do not depend on remaining creation quota. Capacity
and quota conflicts use the existing closed error vocabulary. No TTL deletion is needed for
correctness, and no new database/service or cloud setting is created here.

The helper verifies its independently derived IDs, retained Begin fingerprint, formal manifest,
exact component order and original author proofs before decrypting typed private inputs.
Before Begin it requires every confirmed input to pass typed decryption and the private policy.
Partial/unknown coverage requires `allowPartial`; missing source-as-of and unknown freshness require
`allowUnknownAsOf`. Stale inputs, future fetched-at timestamps and fetched age beyond the selected
maximum are rejected by this conservative helper profile. Begin evaluates age at trusted client
time; frozen input reads evaluate policy at Run creation time while current authority/expiry still
use current time. It stores only policy and minimal source facts in memory and clears them on lock.
These are client checks: the backend never sees private rules or claims to validate financial
freshness/equivalence. Online checks and controller lock on failures remain required; cached
content cannot be remotely recalled.

The trusted controller authenticates the Hub API transport. Local manifest verification proves
the selected input/author/recipient/intent bindings, not backend persistence, model execution or
analysis quality. There is no additional server content signature or KMS decryption path; future
result writes must still find and authorize the stored Run.

HUB-006 supplies initial-result uniqueness, encrypted submissions, revisions and receipts.
The remaining HUB-009 integration and real Muse/trusted-controller acceptance stay explicit;
this producer does not claim those deliveries or unattended execution.
