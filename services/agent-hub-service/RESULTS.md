# Encrypted results, revisions and saved receipts

The Hub receives formal v2 `result_revision` carriers from the authorized agent. It verifies
public signatures, certified recipients, Run/manifest bindings and current authority, and stores
ciphertext. Titles, summaries, Markdown, sections, citations, limitations and private output rules
are not parsed or decrypted by the backend. A receipt acknowledges storage of the specified
ciphertext; it does not attest a model's identity, analysis quality or successful decryption.

## API

Every route requires the exact `X-FolioView-Contract` header, one Hub bearer token and the existing
enabled adapter/OAuth configuration. Query parameters are rejected. Writes require one
`Idempotency-Key`, exactly equal to the signed context's `stableOperationId`.

| Request                                           | Closed body                                       | Required OAuth scope |
| ------------------------------------------------- | ------------------------------------------------- | -------------------- |
| `POST /agent/v2/runs/{runId}/results`             | `{contractVersion,signedObject}`                  | `results:create`     |
| `POST /agent/v2/results/{resultId}/revisions`     | `{contractVersion,expectedRevision,signedObject}` | `results:revise`     |
| `GET /agent/v2/runs/{runId}/receipts/{operation}` | none                                              | `receipts:read`      |

Initial saves and new revisions return a formal `ResultReceipt` with status 201. Exact authorized
replays return the original receipt with status 200. Receipt lookup returns that receipt or null,
after authenticating the original connection/grant relationship. Owner Inbox/history retrieval and
state controls are separate work; the receipt's `/results/{resultId}?revision={revision}` is a stable,
key-free application navigation path, not a decryption credential or an implemented owner read API.

## New writes and immutable evidence

The owner, vault, connection, authorization, grant, task, Run, manifest and initial result ID come
from verified transport and stored Run state. Callers cannot replace them. The result AAD binds the
actual shared task-carrier fingerprint and frozen manifest fingerprint, not the original owner
task's separate fingerprint. `resourceBindings` is empty in this result profile; the manifest
fingerprint binds the complete frozen resource selection transitively.

New writes require `encrypt_result` and the current `results:create` or `results:revise` scope.
They do not require `runs:read`, `tasks:read` or source content-read scopes. The service checks the
Run's approved frozen task version against the signed grant while independently checking current
task status/execution epoch, current source incarnations/epochs, active author and approved owner
device/recovery recipient keys, token/family/connection/grant authority and Run lifetime. Ordinary
task content versions and source revisions may advance without rewriting the Run. Source state is
probed outside the transaction using the existing metadata-only path, then authority and the same
local source-fence documents used by invalidation are checked in the final write transaction.
Before publication the service rechecks transport and the verified grant/Run deadlines at the
single recorded acceptance time. A deadline crossed during cryptographic validation fails closed;
the stored receipt and historical proof always use that same checked time.

The exact current grant must approve all recipients. At least one active owner `device_enc` and
the approved `recovery_enc` are required; agent recipients, caller-supplied keys and server
decryption are forbidden. Public validation cannot prove AEAD tags or private semantic correctness.
The helper validates private result content; the unlocked user client must use a safe renderer.

Initial revision 1, Run→initial-result identity, original receipt, operation index, owner result
index, Run `ready`→`submitted` state and connection `resultSaved=true` are committed atomically.
`resultSaved` does not become true merely because a Run is ready, inputs were read, or a save
failed. It is submission provenance, not proof that a model completed analysis.

Revisions retain the same result ID, Run, manifest and evidence. They use a distinct stable
operation and `expectedRevision` CAS; each new business revision has delivery revision 1 and fresh
client-side encryption. Earlier carriers and receipts remain immutable. Head metadata retains
the initial result's `receivedAt` for Inbox arrival ordering; each revision receipt records its own
acceptance time. New revisions retain starred/archive state, reset read to false and always
advance the metadata state version, including when already unread. This invalidates stale owner
state controls based on earlier content. Exact replay does not advance it. The submitting identity is stored as
`authorized_connection_submission` with the authenticated provider/client/connection/authorization
and certified agent principal. A model-provided name is not accepted as authentication.

## Exact retry identity

The service reserves one operation key across create/revise within the namespace
`owner/vault/connection/authorization/grant/grantEpoch/task/Run/operation`. This stricter service
profile keeps the formal receipt lookup by Run and operation unambiguous. Reusing one key for a
different result operation or packet does not create another write.

The standard fingerprint hashes the JWS protected header and payload, excluding signature bytes.
The incoming signature is verified before comparing fingerprints. A valid ES256 high/low-S
signature variant over the same signing input returns the original receipt, including its original
`receivedAt` and URL; an invalid signature cannot use the replay channel. Changed ciphertext or
bindings under the same operation conflict. A second stable operation for the same initial Run
returns `initial_result_exists`, even if the user believes its plaintext is equivalent. The
operation is authenticated AAD, so changing it cannot preserve the same packet. Recover the
original operation rather than automatically reencrypting or inventing an alias.

Missing/corrupt head or operation records never authorize overwriting an existing immutable
revision. A racing transaction retries against the winner's state, recovering the same operation
or rejecting a different initial result/stale revision.

## Saved facts versus new execution

Saved receipt lookup and exact POST replay require a current valid access token and refresh
family, the original active connection/authorization and the original active grant ID/epoch and
token grant reference. Explicit token, connection or grant revocation denies access. Knowing a
Run/result/operation ID or possessing another connection's old ciphertext confers no authority.

For these already-saved facts only, task pause, changed execution/source fences, source outage,
Run expiry, natural signed-grant/certificate expiry and later key revocation do not erase the
accepted receipt. The replay's actual signature and original carrier are checked using the
root-authenticated directory and grant at the retained acceptance time. No current recipient or
new-write key eligibility is required to recover a storage fact. A new or changed packet with no
saved operation receives the full current-write guard. GET returns minimal receipt metadata and
does not require a new agent signature. History does not create new decryption or execution rights.

## Storage and limits

Four collections join the existing Hub database: `hub_results`, `hub_result_revisions`,
`hub_result_operations`, `hub_result_indexes`. Each revision retains its canonical carrier,
original receipt and acceptance proof; complete root-signed registry snapshots are separate,
bounded documents in `hub_result_revisions`, keyed by owner/result/revision/registry/sequence.
This supports submissions made after the original Run's registry checkpoint and later historical
verification without consulting a changed directory. The current vault already bounds history to
32 snapshots and its aggregate stored-document budget. Carriers, registry documents and exact
Firestore protobuf encoding retain the shared size limits; an atomic result batch stays below
Firestore's 10 MiB request ceiling without embedding an entire history beside a carrier.

This profile accepts at most 1,024 results per owner and 32 business revisions per result. Capacity
does not block saved receipt lookup/replay or revocation. Existing operation histories are not
deleted or recreated to evade limits. No TTL, cleanup worker, new database or cloud setting is
introduced. Before production enablement, the existing infrastructure work must cover opaque
carrier/registry JSON index exemptions and the new collection policies.

The foreground helper owns nonextractable memory-only agent keys, validates private result
content, seals to exact owner/recovery recipients and retains exact packets in its bounded session
outbox. The owning controller authenticates Hub transport and supplies verified receipts over its
trusted owner port. No automatic durable outbox, model execution, background schedule, trusted
page/real Muse acceptance, owner Inbox or cloud deployment is claimed here.
