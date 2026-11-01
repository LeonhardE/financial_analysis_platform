# Encrypted Portfolio snapshots and source lifecycle

Portfolio stores immutable owner holdings snapshots as signed encrypted envelopes. It accepts no
CSV files, holdings plaintext, private keys or brokerage sessions. Local CSV parsing, decimal and
currency validation, previews, deduplication hints and encryption belong to the trusted Web client.
Accepting ciphertext does not mean the backend checked financial accuracy or the ciphertext AEAD tag.

`GET /health` remains independent of credentials, storage and other services. Private routes verify
the configured project's Firebase Google ID token with revocation checking and derive ownership
from its verified UID. All private successes and failures use `Cache-Control: no-store`.

## HTTP contract

Every private request requires `X-FolioView-Contract: folioview.agent-workspace.v2.0`. Only the exact
stable shared v2.0/P1 encrypted/control primitives are accepted; candidate versions, v1, aliases and plaintext fallback
are rejected. No query parameters or server-side financial searches are supported.

| Method / path                                                                  | Result                                                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET /api/v2/holdings/sources/{sourceId}`                                      | Own source/vault reference, epoch, latest version and public authority-replica version |
| `PUT /api/v2/holdings/sources/{sourceId}/snapshots/{snapshotId}`               | Verify and atomically save immutable ciphertext, operation/receipt and latest pointer  |
| `GET /api/v2/holdings/sources/{sourceId}/snapshots/{snapshotId}`               | Authorized retained ciphertext, original receipt and historical public key proofs      |
| `GET /api/v2/holdings/sources/{sourceId}/latest`                               | Latest authorized snapshot, or 404 if the source has no saved snapshot                 |
| `GET /api/v2/holdings/sources/{sourceId}/operations/{operationId}`             | Recover the original immutable receipt after current owner/vault authorization         |
| `POST /api/v2/holdings/sources/{sourceId}/mutations/{action}`                  | Owner-signed `fence`, `disconnect` or `delete`; persist a local pending fence          |
| `GET /api/v2/holdings/sources/{sourceId}/mutations/{operationId}`              | Recover one pending/completed source mutation without scanning history                 |
| `POST /api/v2/holdings/sources/{sourceId}/mutations/{operationId}/synchronize` | Explicitly deliver the stored mutation to the fixed Hub and reconcile its ACK          |

Writes also require `Content-Type: application/json`, exactly one `Idempotency-Key`, and one
`X-FolioView-Author-Key` selecting an allowed owner device signing key. The closed outer body has
exactly `contractVersion`, `expectedRevision` and `carrier`; `carrier` is the shared complete
`{contractVersion, signedObject}` DTO. The snapshot path identifies the opaque new object ID.

Authenticated owner, independently stored vault/authority/source reference and epoch, outer
expected revision, operation header, path and allowed writer/recipients must all match the signed
context. No incoming carrier claim is promoted into a trusted root, owner or recipient policy.

The raw request stream has a 576 KiB ceiling and a five-second body deadline. Excess bytes return
413; an incomplete slow body returns the formal 400 `malformed_request`. Carrier, complete response
and actual SDK Document encodings also have the shared independent budgets. All v2 failures use
the shared closed Error DTO `{contractVersion,error:{code,retryable,requestId}}`, including auth,
unknown SDK/dependency failures, CORS errors and missing routes. No input or SDK diagnostics are echoed.

Snapshot receipts are service-owned closed DTOs: `contractVersion`, `vaultId`, `resourceRef`,
`snapshotId`, `revision`, `sourceEpoch`, `stableOperationId`, `envelopeFingerprint`, `snapshotPath`
and `storedAt`. They are not Hub's result-specific ResultReceipt. They acknowledge saved ciphertext
and public bindings, not plaintext quality.

Retry an operation with the original signed carrier, snapshot path and expected revision. After
current authorization/signature checks, the original receipt returns even after a newer snapshot.
Changed ciphertext or bindings under the same operation conflict. A new operation with stale CAS
conflicts; snapshot IDs cannot be overwritten. Current source fences, revoked writers or changed
recipient authorization can reject a formerly valid retry. Fresh encryption of equivalent plaintext
is not an identical operation.

## Trusted public authority replica

Hub remains the authority for vaults, root pins and key directories. Portfolio exposes **no HTTP
root enrollment, registry upload, signing, decryption, agent content or brokerage endpoint**. No environment
switch or request field trusts caller-supplied keys. An empty deployment returns 503 for private
source operations until a trusted source projection exists.

`PortfolioService.install_authority` remains an internal test/adapter seam, not an admin API.
The explicit Hub synchronization adapter below obtains public root and source ownership from its
fixed authenticated Hub endpoint; no browser can install these values directly. It stores only public material: owner/source/vault bindings, pinned public root,
consecutive root-signed directory bundles, source epoch/active fence, and explicit owner device and
recovery key allowlists. Registry signatures, high-water/revocation continuity and update CAS are
verified. An existing source cannot change owner/root/vault/incarnation; epochs cannot decrease.
Agent recipients are not enabled by this owner-only ticket.

The retained public directory chain is bounded to 32 bundles and the shared 768 KiB document limit;
overflow fails closed instead of dropping revocation history. No private key is stored. Production
projection authorization/freshness/delivery belongs to Hub/trust work. Tests install synthetic
replicas directly through this internal interface.

Every committing transaction re-reads current authority, operation, snapshot and latest before
staging writes. Firestore conflict retries re-run authorization and verification against changed
authority. SQLite uses real immediate transactions. No fingerprint cache bypasses a lock/revocation.
Historical reads authorize the current owner and unlocked vault and return retained public proofs: a writer's
later revocation does not erase the owner's ciphertext. Clients still verify their independent root
pins/checkpoint history and retained author proofs before decrypting.

## Source lifecycle and retained history

Source mutation bodies contain exactly `contractVersion`, `expectedVersion` (the current authority
replica version), `expectedSourceEpoch` and `command` (a flattened shared `ControlCommandPayload`
JWS). The existing contract, idempotency and author-key headers are required. The route selects
`resource_fence_request`, `source_disconnect` or `source_delete`; fence parameters contain exactly
the current `resourceRef`, while disconnect/delete parameters are empty. Owner, vault, current
certified control writer, registry checkpoint, source incarnation, expected version/epoch and
stable operation ID must match independent current state. No extra scope, credential or ACK field
is accepted. Mutation requests have a 65 KiB body ceiling and five-second receive deadline.

A single transaction records `revoking`, advances `sourceEpoch` by one and stores the exact public
operation fingerprint and pending receipt. Future source writes and active projections stop before
a remote request is attempted. Exact retries recheck current authority/keys and return the stored
receipt; current key revocation or a vault lock can reject an old retry. A different command under
the same ID conflicts. `202` means the mutation receipt was accepted; callers must inspect its
`state`, and must not interpret it as completed cross-service revocation.

The owner can explicitly resume one stored operation with
`POST /api/v2/holdings/sources/{sourceId}/mutations/{operationId}/synchronize`, the contract header,
`Content-Type: application/json`, and exactly `{"contractVersion":"folioview.agent-workspace.v2.0"}`.
The route requires the existing Google/Firebase owner verification. It accepts no browser-supplied
ACK, destination, owner, resource, epoch or control override. It does not create or resign a mutation.
GETs and the initial mutation request do not initiate remote delivery.

The server derives the exact Hub `source-fences` request from the durable signed mutation. It reuses
the explicit HTTPS `PORTFOLIO_HUB_AUTHORITY_ORIGIN` and obtains an audience-specific token from its
runtime identity. Hub must independently trust the Portfolio workload for its narrow callback;
enabling OAuth or the encrypted adapter is not required. No new identity, key, IAM grant or arbitrary
upstream is installed by this implementation. Missing configuration remains a closed `503`.

Delivery uses one metadata identity GET and one Hub POST, no SDK retries, redirects or ambient proxies,
a four-second per-call timeout, a cancellable twelve-second network deadline, and an 8 KiB
uncompressed ACK ceiling. The network runs on the server event loop; timeout cancellation closes the
request stream without waiting for an SDK retry worker. Contract, operation, exact
resource/incarnation, integer epoch and UTC timestamp must match the closed Hub ACK shape. Upstream
diagnostics are never forwarded. Only then does `PortfolioService.finish_fence` recheck current
owner/vault authority and compare the original stored mutation in a new transaction. Network I/O
never runs within a transaction or its retries.

Failures, mismatches, restart, a lost Hub response or a failed local commit retain pending state.
The next explicit synchronization sends the same immutable operation to obtain Hub's idempotent ACK.
Already completed operations return the original local receipt without token/network access, and
replaying an older acknowledged operation never clears a newer pending operation. The automated
tests use synthetic identities/transports; real workload/owner acceptance is tracked separately.
Web forwarding and lifecycle controls remain independently scoped Web work.

A completed ordinary fence permits new writes at the new source epoch. Disconnect retains owner
history while denying future source use; it cannot reconnect through authority installation. The
owner can subsequently request deletion. Delete is a **logical tombstone**, immediately hides owner
snapshot/receipt history while pending, and stays terminal after ACK. Ciphertext/operation records
are retained, not physically purged from storage or backups. No purge or deletion-compliance claim
is made. Source IDs/incarnations cannot be replaced via the authority replica adapter. A future
explicit reconnect/recreation flow must use a safely new resource incarnation and preserve fences.

Source permission epochs are separate from registry key epochs and the vault `active` lock. A source
fence/disconnect does not remove the owner's access to retained history in an unlocked vault. Reads
still check immutable owner, root, vault, resource/incarnation, snapshot, revision, original source
epoch, operation and fingerprint bindings. The current vault lock still denies history, receipts
and mutations. Current writes require current registry/key epoch and source epoch; already copied
ciphertext/plaintext or private keys cannot be recalled.

Each source retains at most 128 mutation receipts, with two slots reserved for disconnect followed
by deletion after ordinary fences reach their 126-operation limit. At the ordinary limit, new
fences return `409 version_conflict`; existing receipts remain recoverable and terminal actions
remain available. This is a bounded initial retention policy, not automatic background compaction.
Mutation operations use three point reads and three atomic writes, with existing SDK RPC deadlines
and at most three transaction attempts. There is no list scan, worker, response-after-background
thread, broker refresh, lease renewal or Cloud Tasks job. Refresh remains a newly encrypted client
snapshot upload with revision CAS; real broker acquisition and refresh leases are not implemented.

## Internal source metadata producer

`POST /internal/v2/resources/projections/read` and `POST /internal/v2/resources/states/read` accept
exactly `{contractVersion, refs}`, with one to ten distinct Portfolio holdings resource references.
Requests require both the pinned Google workload token and short-lived Hub `browser_catalog`
delegation for `holdings`, plus the exact contract header and JSON media type. An `agent_run`
delegation is refused by these discovery routes. The verified signed owner UID alone selects the
data partition; no UID is accepted in a request. References/incarnations must match current stored
authority. Unknown queries, duplicate references/headers, oversized bodies and dependency errors
use the same closed v2 error format and `no-store` headers. The receive budget is 128 KiB/five seconds.

These responses are **Portfolio metadata extensions**, not the frozen shared
`ResourceCatalogueItem`, a ciphertext projection, an agent decryption grant, or an immutable Run
input manifest. Both return `{contractVersion,items}`. Each item contains exactly `ref`, `revision`
(the retained latest revision), `sourceEpoch` and `state`. Active projections additionally return
`snapshotId`; states additionally return `observedAt`. No carrier, author proofs, key packet,
recipient list, credential or content is returned. Sources are independently read in separate
transactions (at most three point reads each), not an atomic multi-source snapshot. A future Hub
must still enforce current Run/grant/source fences and exact delivery bindings.

Projection reads require an active source and a latest snapshot explicitly bound to its current
epoch. An acknowledged fence leaves old owner history readable, but active projection returns
`503 source_unavailable` until a fresh current-epoch client upload exists. Owner metadata separates
`snapshotSourceEpoch` from current `sourceEpoch`. Old four-field latest-head records remain readable;
their unknown snapshot epoch cannot be promoted into an eligible projection. States can report
`revoking`, `disconnected` and `deleted` for future fencing coordination, without granting content
access. New sources without a snapshot return a null pointer, not synthetic holdings.

Trust requires explicit `PORTFOLIO_SERVICE_AUDIENCE`, matching versioned
`PORTFOLIO_DELEGATION_AUDIENCE`, `PORTFOLIO_DELEGATION_ISSUER` and
`PORTFOLIO_TRUSTED_HUB_CALLERS` (a bounded JSON subject-to-service-email map). Empty/malformed
configuration fails closed with 503 before lookup or key fetch. This PR configures no deployed
trust or IAM and never installs authority from a metadata request.

## Storage and configuration

Local development defaults to SQLite at `/tmp/folioview/portfolio.sqlite3`, overridable through
`PORTFOLIO_DB_PATH`; the directory/file are private. No env file is automatically loaded. Real
private sign-in needs explicit `FIREBASE_PROJECT_ID` and local ADC, while health needs neither.
Tests override authentication and use synthetic keys.

Cloud Run requires `PORTFOLIO_STORE_BACKEND=firestore`, explicit `FIREBASE_PROJECT_ID` and a named
`FIRESTORE_DATABASE`. Default-database use, SQLite fallback and Firestore emulator are rejected in
cloud mode. Attached runtime identity is used, without downloading a service-account key.

Collections: `portfolio_authorities`, `portfolio_heads`, `portfolio_snapshots`, `portfolio_operations`,
`portfolio_source_states`, `portfolio_source_mutations`.
Hashed owner/source/object partitions are used. Snapshot, operation/receipt and latest pointer commit
atomically. The carrier is one opaque `carrierJson` string, rather than a deeply indexed plaintext
holdings map. Every complete write is checked against actual SDK Document bytes including its full
resource name and field encoding, as well as application JSON bytes.

Before private content is enabled, the target infrastructure work must exempt opaque carrier/public
proof fields from indexing and configure only required metadata indexes/retention. This source PR
creates no indexes, TTL, databases, IAM, secrets or other cloud resources.

## Delivery and enablement

The target stays `release_mode=build_only` and `_DEPLOY_SERVICE=false`; publishing does not update
the existing Cloud Run revision. Future enablement retains source/digest review and saved-plan
controls. This code delivery does not claim the deployed health-only revision serves these APIs.

Production also needs the planned authenticated Hub public projection/trust wiring, minimum Firebase
user lookup permission for revocation checks, reviewed index policy, and an approved invocation path
for browser Firebase tokens. A Firebase user token is not a Cloud Run IAM identity token; existing
private invocation must not change implicitly. These gates belong to existing Hub/INF-008/INF-009/
Web work, not a new generic validation prerequisite. Key management and CSV UX remain WEB-010/WEB-004.
No live Wealthsimple compatibility, broker authorization or successful client import is implied.

## Verification

From the repository root with existing development dependencies:

```bash
services/market-data-service/.venv/bin/python scripts/test_services.py --service portfolio-service
```

Tests use fresh synthetic root/device/recovery keys and real JOSE, durable SQLite restart/concurrency/
rollback, and the real Firestore SDK against an in-memory RPC boundary. They cover owner separation,
immutable versions, CAS, exact retries/original receipts, changed-ciphertext conflicts, current
fences/revocations, registry rollback, SDK retry reauthorization, raw and protobuf budgets, slow
uploads, durable source mutations, exact ACK adapter matching, old-epoch projection refusal,
dual signed metadata credentials, formal private errors and dependency-independent health. No live account/cloud data is used.

## Explicit Hub authority synchronization

`POST /api/v2/holdings/sources/{sourceId}/authority-sync` accepts only
`{contractVersion: "folioview.agent-workspace.v2.0"}` with the version header and exactly one
`X-FolioView-Authority-Delegation`. The current Firebase owner is verified first. The browser obtains
the narrow, 60-second owner catalogue delegation from Hub; it supplies no root, public key policy,
owner override, broker session or content key.

Set `PORTFOLIO_HUB_AUTHORITY_ORIGIN` to the explicit HTTPS Hub origin. Unconfigured remains 503.
Portfolio contacts only `/internal/v2/portfolio-authorities/read` on that origin with its runtime
Google workload token plus the Hub delegation. Hub verifies both credentials and derives the
owner from the signed delegation. Portfolio separately binds the returned owner hash and source,
then verifies the complete pinned-root public directory and owner writer/recipient roles.

Transport does not use ambient proxies, redirects or compressed responses. It limits the response
to the shared 1 MiB read ceiling, uses four-second I/O timeouts and checks a 12-second total
deadline (an already pending I/O can take up to its four-second bound). No response-body diagnostics,
tokens or keys are logged or returned.

Replication transactionally preserves the current root, vault, resource incarnation, source epoch
and signed history prefix. A locked replica cannot be unlocked by this read operation; a pending
or terminal local source is not reactivated. Identical projections are no-ops. Hub's projection
version is distinct from Portfolio's local CAS/lifecycle version. Ciphertext and receipts are not
rewritten. Hub's initial CSV sources stay at epoch 1; a later local source fence must be reconciled
by the separate source-fence protocol, never reset by synchronization.

This is public authority replication for an owner upload, not agent content access or a root
enrollment shortcut. It creates no cloud resources, IAM grants or database migration, does not
activate the normal Portfolio release pipeline, and does not enable brokerage login or Hub ACKs.
