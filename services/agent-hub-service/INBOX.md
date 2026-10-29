# Owner Inbox, encrypted history and logical state

This surface uses verified Firebase Google identity and the existing Hub result database.
An agent bearer, workload identity, known ID, ciphertext or cursor is not owner authorization.
Reads return approved metadata or already saved encrypted objects, never report plaintext or
private keys. They do not mark content read, synchronize sources, run models or infer a private
schedule. An unlocked client still authenticates and decrypts content and uses a safe renderer.

## Routes and closed responses

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

## Bounded queries and cursors

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

## Historical content and evidence

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

## Signed state and concurrency

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

## Delivery boundary

This is a Hub-only API delivery using the same database and shared contracts, with two new
logical collections and a local transactional batching helper. No shared-schema, frontend,
cryptographic helper, deployed setting, IAM, database, scheduler or cloud resource is changed.
Web Inbox navigation/decryption/rendering, controller integration, real Muse and production
acceptance remain their existing tickets. Report, source and task private content stays encrypted.
