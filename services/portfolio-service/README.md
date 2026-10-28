# Encrypted Portfolio snapshots

Portfolio stores immutable owner holdings snapshots as signed encrypted envelopes. It accepts no
CSV files, holdings plaintext, private keys or brokerage sessions. Local CSV parsing, decimal and
currency validation, previews, deduplication hints and encryption belong to the trusted Web client.
Accepting ciphertext does not mean the backend checked financial accuracy or the ciphertext AEAD tag.

`GET /health` remains independent of credentials, storage and other services. Private routes verify
the configured project's Firebase Google ID token with revocation checking and derive ownership
from its verified UID. All private successes and failures use `Cache-Control: no-store`.

## HTTP contract

Every private request requires `X-FolioView-Contract: folioview.agent-workspace.v2.0`. Only the exact
stable shared v2.0/P1 contract is accepted; candidate versions, v1, aliases and plaintext fallback
are rejected. No query parameters or server-side financial searches are supported.

| Method / path                                                      | Result                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET /api/v2/holdings/sources/{sourceId}`                          | Own source/vault reference, epoch, latest version and public authority-replica version |
| `PUT /api/v2/holdings/sources/{sourceId}/snapshots/{snapshotId}`   | Verify and atomically save immutable ciphertext, operation/receipt and latest pointer  |
| `GET /api/v2/holdings/sources/{sourceId}/snapshots/{snapshotId}`   | Authorized retained ciphertext, original receipt and historical public key proofs      |
| `GET /api/v2/holdings/sources/{sourceId}/latest`                   | Latest authorized snapshot, or 404 if the source has no saved snapshot                 |
| `GET /api/v2/holdings/sources/{sourceId}/operations/{operationId}` | Recover the original immutable receipt after current owner/source authorization        |

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
root enrollment, registry upload, signing, decryption, agent or brokerage endpoint**. No environment
switch or request field trusts caller-supplied keys. An empty deployment returns 503 for private
source operations until a trusted source projection exists.

`PortfolioService.install_authority` is an internal adapter seam, not an admin API. A future
authenticated Hub adapter must independently establish the root pin and source ownership before
calling it. It stores only public material: owner/source/vault bindings, pinned public root,
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
Historical reads authorize the current owner/source and return retained public proofs: a writer's
later revocation does not erase the owner's ciphertext. Clients still verify their independent root
pins/checkpoint history and retained author proofs before decrypting.

## Storage and configuration

Local development defaults to SQLite at `/tmp/folioview/portfolio.sqlite3`, overridable through
`PORTFOLIO_DB_PATH`; the directory/file are private. No env file is automatically loaded. Real
private sign-in needs explicit `FIREBASE_PROJECT_ID` and local ADC, while health needs neither.
Tests override authentication and use synthetic keys.

Cloud Run requires `PORTFOLIO_STORE_BACKEND=firestore`, explicit `FIREBASE_PROJECT_ID` and a named
`FIRESTORE_DATABASE`. Default-database use, SQLite fallback and Firestore emulator are rejected in
cloud mode. Attached runtime identity is used, without downloading a service-account key.

Collections: `portfolio_authorities`, `portfolio_heads`, `portfolio_snapshots`, `portfolio_operations`.
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
uploads, formal private errors and dependency-independent health. No live account/cloud data is used.
