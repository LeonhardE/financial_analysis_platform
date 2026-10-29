# Encrypted preparations and foreground helper 1.0.0

This is the first HUB-009 implementation slice. It reuses OAuth, resource discovery and formal
`folioview.agent-workspace.v2.0` / P1 envelopes. Its local orchestration profile is
`folioview.agent-preparation.v1`, **not** a Run, manifest or result receipt. It does not start a
model, schedule an agent or implement result encryption/writeback without a Run.

## Explicit sharing and publication

Private protocol use requires both the existing OAuth configuration and
`HUB_ENCRYPTED_ADAPTER_ENABLED=1`. Public fixed helper assets require the adapter flag and contain
no owner data. Both surfaces are disabled by default; no deployment configuration is changed here.

| Request                                                                                      | Purpose                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/v2/agent-authorizations/{requestId}/prepare-encrypted`                            | Explicit selected-current-version sharing consent                         |
| `GET /api/v2/agent-connections/{connectionId}/tasks/{taskId}/preparation-intent`             | Read-only public encryption/routing expectations                          |
| `PUT /api/v2/agent-connections/{connectionId}/tasks/{taskId}/preparation/objects/{objectId}` | Stage one client-encrypted, device-signed object                          |
| `POST /api/v2/agent-connections/{connectionId}/tasks/{taskId}/preparation/commit`            | Atomically publish the complete preparation                               |
| `GET /agent/v2/tasks/{taskId}/preparation`                                                   | Authorized preparation metadata and bounded proof/object descriptors      |
| `GET /agent/v2/preparations/{preparationId}/objects/{objectId}`                              | Read one committed encrypted object                                       |
| `GET /agent/v2/preparations/{preparationId}/registries/{sequence}`                           | Read one root-signed registry bundle                                      |
| `GET /agent/v2/helper/{asset}`                                                               | Fixed public artifact allowlist, never user data or a decryption endpoint |

Owner requests require the verified Google owner, exact contract header and closed JSON.
Consent retains the existing trusted-origin/HttpOnly flow-cookie binding. Its fields are
`contractVersion`, `taskIds`, `connectionId`, `approvedScopes`, `historyPolicy`; the latter must
explicitly be `selected`. The server selects current task versions and positive current source
revisions. The device signs the matching formal AgentKeyGrant before the normal decision endpoint
approves it. Original `prepare` / `historyPolicy=none` flows remain compatible and cannot implicitly
add an agent to a previously stored task.

The intent derives stable preparation/copy identities and the next task delivery from current
authority. Each stage body is exactly `{contractVersion,envelope}`, with `Idempotency-Key` and
`X-FolioView-Author-Key`; each commit body is `{contractVersion,objects}`, with an idempotency key.
Commit objects contain only `objectId` and `envelopeFingerprint`. Stage objects remain invisible
to agents until every selected descriptor is validated and publication commits atomically.
Exact retries preserve original metadata; changed bytes/fingerprints under the same operation
conflict. These confirmations do not provide HUB-006 result-receipt recovery semantics.

The original owner task stays unchanged. Task delivery follows formal `reshare_delivery` with a
previous fingerprint and increasing delivery revision. Separate authorized agents retain their
own committed preparations: A1 delivery 2 is not replaced by A2 delivery 3. Agent recipients are
exactly the selected grant's agent encryption key plus its explicitly approved owner/recovery
writeback set; registration alone never adds recipients. The shared maximum of eight recipients
still applies, and no required owner recipient is silently removed to fit it.

## Source and authorization limits

Resources are device-encrypted, owner-attested copies linked to existing full source references,
incarnations, revisions and epochs. Their copy object identity differs from the producer's
snapshot identity. The decrypting client must create matching private snapshot/evidence identities.
The server verifies signatures, bounds and public bindings; it cannot establish that private
financial contents match a broker/User source or that two ciphertexts contain equal plaintext.
It does not fetch source plaintext, re-encrypt content or generate substitute financial data.

Discovery status alone does not make a resource prepared. Positive current producer revisions
are required; revision zero, unavailable sources, missing encrypted evidence or stale selected
revisions fail closed. Resource-free tasks remain supported. This slice requires selected source
versions to remain current at new preparation reads; it does not provide arbitrary historical
source retrieval. Task edits, source fences, expired/replaced keys and revoked grants/tokens are
rechecked rather than inferred from a previously valid signature.

Each transfer is bounded by the formal carrier/write/read limits. Registry history is transferred
one bundle at a time rather than embedding all bundles into every response. All reads validate
bearer/family/connection/task/grant/key/source state, obtain fresh source metadata outside the
transaction and recheck current authority afterward. A successful object read records only an
authorized API read observation. It is not proof of decryption, model execution or complete input
consumption; metadata/proof reads do not set it. No result-saved observation is invented.

The same Hub named database owns `hub_preparations`, `hub_preparation_objects` and
`hub_task_deliveries`. Staging is bounded to eleven objects, 32 operations per object and 32 task
deliveries per task version, subject to the existing owner/connection/authorization and byte caps.
Current authorization is still required for exact retries; new capacity is not obtained by
deleting revocation history. There is no background preparation worker or additional service.

## Helper trust and execution

The Hub-owned [helper package](helper/protocol.json) fixes version 1.0.0, schema/dependency/source
hashes, a self-contained worker and third-party notices. Public distribution accepts only
`worker.mjs`, `integrity.json`, `protocol.json` and `THIRD_PARTY_NOTICES.md`. No dynamic key URL,
module fetch, filesystem access, user upload or server decrypt path is exposed. The container
copies public artifacts only; it never executes the helper with user keys.
Manifest file names such as `dist/worker.mjs` are package-relative paths; the public HTTP alias is
`/agent/v2/helper/worker.mjs`, using the flat allowlist above.

A trusted owning page creates the module Worker and separate owner/agent message channels.
The owner channel initializes the independently confirmed root/checkpoint and confirms the exact
committed preparation, including **all** object fingerprints. The model-facing agent channel
cannot initialize/replace that trust, confirm a different delivery, import/export private keys or
request arbitrary signing. The Worker generates non-extractable agent keys in memory; public keys
are paired through the existing root directory and task-grant process. Root/checkpoint or delivery
pins fetched only from the same backend are not independent trust anchors.

The helper verifies the complete signed authority, immutable carrier fingerprints, recipients,
AAD/context and typed private payload before returning approved plaintext. Lock, expiration and
known relevant revocation invalidate the session; generation checks discard late asynchronous
results. Keys are not persisted, so closing the owning page requires fresh pairing. The owning
controller must terminate the Worker and clear its views on lock, account switch or navigation.

The Worker has no network and cannot independently discover an OAuth/connection revocation.
The trusted controller must use current online APIs and lock on authorization/fence failures.
Known registry changes are revalidated locally, but an offline cache is not live server authority.
Revocation stops new API/key distribution; it cannot recall plaintext or keys already disclosed
to an authorized endpoint. This package does not prove OS isolation or physical memory erasure.

## Delivery and remaining work

Python-discovered tests execute the checked helper through Node, using formal Python-generated
envelopes, actual non-extractable agent keys and the preparation APIs. Missing/incompatible Node
fails the helper checks; it is not silently skipped. The served artifact's source/schema/lock and
dependency hashes are verified, without runtime package downloads or unsafe-eval compilation.

This phase supplies reusable protocol/helper components. It does not supply the trusted owning
page, full Web/BFF consent handoff or a new real Muse acceptance run. Real Muse evidence from
VAL-004 remains historical and bounded. HUB-005 adds the formal Run/manifest producer; HUB-006
adds results/revisions/receipts; HUB-009 then completes their helper integration and real consumer
acceptance. HUB-009 stays partially delivered until that remaining scope passes. No cloud resource
or public enablement is authorized by this implementation.
