# Legacy foreground compatibility

> Legacy financial transports, helper pages and grant creation are retired from the deployed app. This guide preserves historical signed-format and receipt compatibility; current connections use [personal Agent credentials](agent-client.md).

This guide covers the retained P1/v2 OAuth path and fixed helper releases 1.2.0–1.4.0.
Existing encrypted deliveries and history retain their original contracts. The memory-only
Agent keys, explicit handoff and bounded foreground session are distinct from the
[persistent runtime](runtime.md). Current owner history is documented in the
[owner API](owner-api.md#owner-inbox); shared wire rules belong to the
[encrypted contract](../../common/folioview_shared/encrypted/README.md).

## OAuth and legacy connection lifetime

The configured Hub origin `H` is the issuer; `H/mcp/v2` is the exact logical resource,
including for `/agent/v2/*` REST calls. Credentials from old `/mcp` or native `/mcp/v3`
resources cannot substitute. Authlib handles authorization code, S256 PKCE, registered
callbacks, rotating refresh and revocation. Content verification uses the shared JOSE
implementation, not deprecated Authlib JOSE.

| Endpoint                                             | Purpose                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-authorization-server`        | Configured authorization metadata                                               |
| `GET /.well-known/oauth-protected-resource/mcp/v2`   | Encrypted v2 resource metadata                                                  |
| `GET /oauth/authorize`                               | Validate registered client/callback/state/resource/PKCE and open a bounded flow |
| `POST /oauth/token`                                  | One-use code exchange or rotating refresh                                       |
| `POST /oauth/revoke`                                 | Revoke this client's token or family                                            |
| `POST /api/v2/agent-authorizations/{request}/claim`  | Bind the actual Google owner and vault                                          |
| `GET /api/v2/agent-authorizations/{request}`         | Cookie-bound pending status                                                     |
| `POST .../{request}/prepare`                         | Selected tasks/scopes and stable grant identities                               |
| `POST .../{request}/prepare-encrypted`               | Explicit selected-current-version sharing                                       |
| `POST .../{request}/decision`                        | Device-signed approval, OAuth-only approval, denial or cancellation             |
| `GET /api/v2/agent-connections`                      | Owner-scoped connection and attempt metadata                                    |
| `POST /api/v2/agent-connections/{connection}/revoke` | Disconnect this owner's connection                                              |
| `POST .../{connection}/grants/{grant}/revoke`        | Revoke one task grant                                                           |
| `GET /agent/v2/authorization`                        | Minimal current opaque-token authority, without content/keys                    |

Owner calls use verified Firebase Google identity and the exact workspace contract header.
Claim has only `contractVersion`; prepare adds `taskIds`, `connectionId` and `approvedScopes`;
prepare-encrypted also requires `historyPolicy=selected`; decision adds `decision` and
`signedGrants`. Selected task/version, source epochs, Agent keys and owner writeback recipients
must match the current Root directory and device-signed grant. Ordinary prepare uses
`historyPolicy=none`. OAuth-only approval never grants decryption. New task versions do not
silently extend old grants.

The HttpOnly/Secure/SameSite=Lax flow cookie and exact Hub Origin bind consent calls. The
same-origin consent shell opens the configured Web origin for owner verification/signing;
Web does not proxy these cookie-bound routes, forge Origin or copy cookies. Only closed
claim/preparation/decision operations cross the origin/source/request/nonce-bound channel.
The shell follows its own registered callback; the model receives no Firebase token or OAuth code.

`HUB_OAUTH_ENABLED=1`, the configured issuer/consent URL and up to eight preregistered Muse
clients are required. Each registration has one to four exact HTTPS callbacks and either
`none` or `client_secret_basic` authentication. Secret digests are configured privately;
raw secrets and tokens never belong in source, URLs or logs. Anonymous registration and
implicit/password/client-credentials grants are unavailable. The encrypted adapter additionally
requires `HUB_ENCRYPTED_ADAPTER_ENABLED=1`; both flags default off.

Codes last at most five minutes, access tokens ten minutes, and pending flows/cookies thirty
minutes. Refresh rotation cannot extend the family's absolute thirty-day deadline. Credentials
are stored as hashes; replay atomically revokes the family. New consent advances authorization
and grant generation. A different owner or connection cannot use the same client's authority.

Bounds are 64 active anonymous flows, 256 new flows/hour, 32 lifetime connections/owner,
32 authorizations/connection and 8192 issues/family. At most 64 attempt-display rows are retained;
evicting terminal display rows does not remove credential-reuse or revocation evidence.
Capacity fails closed. No TTL deletion is needed for correctness. Keep protocol DEBUG/body
logging disabled and review platform callback logging independently.

## Preparation

`folioview.agent-preparation.v1` composes formal workspace v2.0/P1 carriers. It records encrypted
publication to one approved Agent, not model execution or a saved report.

| Request                                                                      | Purpose                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| `GET /api/v2/agent-connections/{connection}/tasks/{task}/preparation-intent` | Public encryption/routing expectations   |
| `PUT .../{task}/preparation/objects/{object}`                                | Stage one device-signed encrypted object |
| `POST .../{task}/preparation/commit`                                         | Atomically publish all selected objects  |
| `GET /agent/v2/tasks/{task}/preparation`                                     | Authorized preparation/proof descriptors |
| `GET /agent/v2/preparations/{preparation}/objects/{object}`                  | One committed carrier                    |
| `GET .../{preparation}/registries/{sequence}`                                | One Root-signed registry bundle          |

Stage is exactly `{contractVersion,envelope}` with operation/author headers. Commit is
`{contractVersion,objects}` with an idempotency key; each item has only `objectId` and
`envelopeFingerprint`. Staged objects remain invisible until the complete publication commits.
Changed bytes under the same operation conflict; retries preserve original metadata.

The owner task is unchanged. Agent delivery uses `reshare_delivery`, a prior fingerprint and
increasing delivery revision; separate Agents retain separate committed preparations. Recipients
are the selected certified Agent encryption key and approved owner/recovery writeback set,
within the eight-recipient limit. Registration alone cannot add a recipient.

Resource copies bind full source reference/incarnation/revision/epoch and their own copy IDs.
Clients must align private snapshot/evidence IDs. Server checks establish public bindings, not
financial equivalence or AEAD validity. Only positive current committed producer revisions can
be newly prepared; unavailable/stale versions and missing encrypted evidence fail closed. The
protocol can represent resource-free tasks; the current owner task UI requires a selected resource.

Every content read authenticates bearer/family/connection/task/grant/keys, obtains current source
metadata outside the transaction and rechecks fences afterward. Discovery alone is insufficient.
A successful object read records an authorized API observation, not decryption, model execution
or complete input consumption. Metadata/proof reads do not set it. Staging is bounded to eleven
objects, 32 operations/object and 32 deliveries/task version, plus shared byte budgets.

## Runs

| Request                               | Purpose                                            |
| ------------------------------------- | -------------------------------------------------- |
| `POST /agent/v2/tasks/{task}/runs`    | Signed Begin allocation or exact original replay   |
| `GET /agent/v2/runs/{run}`            | Stored Run/manifest and retained proof descriptors |
| `GET .../{run}/inputs?cursor=...`     | One complete frozen component                      |
| `GET .../{run}/registries/{sequence}` | One retained Root proof bundle                     |

Requests require the exact contract header and current Hub bearer. Begin requires
`runs:create`, relevant source-read scopes and the matching signed grant; reads require
`runs:read` plus relevant source scopes. Begin is `{contractVersion,signedBeginIntent}` and
its idempotency header must equal the signed operation ID. Callers do not choose owner,
Run/manifest/result IDs or replacement input bytes. New creation returns 201; replay returns 200.
The `folioview.agent-run.v1` response retains Run, manifest/fingerprint, component path and
registry/author proof descriptors.

### Runs: independent identity and retries

The helper retains the original signed Begin and independently derives allocation IDs as the
full lowercase SHA-256 of canonical JSON:

```text
[label, ownerSubject, vaultId, connectionId, authorizationId,
 grantId, grantEpoch, taskId, stableOperationId, beginIntentFingerprint]
```

Labels are `folioview.run-allocation.v1`, `folioview.manifest-allocation.v1` and
`folioview.result-allocation.v1`; prefixes are `run_`, `manifest_` and `result_`. The Begin
fingerprint covers the JWS signing input, excluding signature bytes. Valid ES256 signature-byte
variants identify the same operation; invalid signatures do not. Changed signed input conflicts.
A missing operation index cannot overwrite a deterministic Run or extend its lifetime.

Begin selects the committed Agent task carrier/delivery, not the original owner task fingerprint.
Its transaction freezes exact ordered source versions/epochs/copy IDs/carrier fingerprints,
complete original ciphertext and retained author proofs. Producer metadata RPCs occur outside
retrying transactions. Metadata-only `browser_catalog` / `resources:catalog` probes fetch no
financial plaintext and never forward the Agent token to User/Portfolio.

Ordinary later source/task content revisions do not rewrite frozen input. Current task status,
execution/source epochs, scopes, grant and key qualification still govern access. Pause,
revocation, expiry or source failure can stop reads. Historical author signatures are checked at
issuance time separately from current reader/recipient authority. The reserved result ID does
not mean a report exists.

A Run lasts at most two hours and cannot outlive grant/consent/family authority. Limits are
20 new Runs/connection/minute, 200/owner/UTC day and 32 lifetime Runs/grant/task. Exact replay
consumes no new quota. The helper decrypts and checks private policy before Begin: partial/unknown
coverage needs `allowPartial`; missing as-of/unknown freshness needs `allowUnknownAsOf`; stale,
future-fetched and over-age inputs are refused. Frozen input policy uses Run creation time;
current authority still uses current time. The backend cannot inspect those private rules.

## Results

| Request                                         | Closed body                                       | Scope            |
| ----------------------------------------------- | ------------------------------------------------- | ---------------- |
| `POST /agent/v2/runs/{run}/results`             | `{contractVersion,signedObject}`                  | `results:create` |
| `POST /agent/v2/results/{result}/revisions`     | `{contractVersion,expectedRevision,signedObject}` | `results:revise` |
| `GET /agent/v2/runs/{run}/receipts/{operation}` | none                                              | `receipts:read`  |

Writes require an idempotency key matching the signed operation, current `encrypt_result`
authority and exact stored Run/manifest/initial-result identity. Report AAD uses the shared
Agent task-carrier and frozen manifest fingerprints. Its resourceBindings array is empty because
the manifest binds the complete selection. Each new write rechecks current task status,
execution/source/key/grant/family fences and deadlines at one acceptance time in the final
transaction. It requires approved active owner device and recovery recipients, never Agent
recipients or server decryption. Source-read scopes are not required to submit a report.

Initial revision, carrier, original receipt, operation/index records, Run submitted state and
`resultSaved=true` commit atomically. Revisions retain logical result/Run/evidence, use CAS and
fresh ciphertext, preserve arrival ordering and star/archive state, reset unread and advance
stateVersion. Saved submission provenance is authenticated connection identity, not a model's
self-provided name or proof of analysis quality.

### Results: exact retry identity

One operation namespace spans create/revise for the exact owner/vault/connection/authorization/
grant/epoch/task/Run. Changed ciphertext or intent conflicts. A second operation for an already
saved initial result returns `initial_result_exists`; recover the original instead of resealing.
Successful new writes return a formal receipt with 201; exact replay returns the original with 200. Lookup returns that receipt or null. The receipt's key-free `/results/...` navigation URL
is metadata, not an implemented Web route or decryption credential.

Already-saved receipt lookup/replay still requires a valid access token/family and the original
active connection/authorization/grant relationship. Explicit revocation denies it. For this
narrow saved fact, later pause/source outage/Run expiry or natural key/grant expiry does not erase
the receipt. The original signature/carrier is verified against retained acceptance-time proofs.
This exception cannot authorize a new packet, input read or revision. Owner history is independent.

Original revisions, receipts and Root registry proofs remain immutable. Limits are 1024 results/
owner and 32 revisions/result, with separate bounded proof documents and actual serialized
Firestore budgets. Missing/corrupt heads cannot authorize overwrite, and history is not pruned
to manufacture capacity. Report plaintext and safe rendering remain trusted-client responsibilities.

## MCP v2

`POST /mcp/v2` uses the pinned official Python MCP SDK and JSON Streamable HTTP. MCP protocol
negotiation is independent of workspace contract v2.0. Each closed tool requires the exact
contract, with no arbitrary owner, URL, private key or plaintext content argument.

| Tool                    | Additional inputs                        | Scope            |
| ----------------------- | ---------------------------------------- | ---------------- |
| `list_tasks_v2`         | optional limit 1–50, cursor              | `tasks:read`     |
| `get_task_v2`           | taskId                                   | `tasks:read`     |
| `begin_run_v2`          | signedIntent                             | `runs:create`    |
| `get_run_inputs_v2`     | runId, optional cursor                   | `runs:read`      |
| `submit_task_result_v2` | runId, signedObject                      | `results:create` |
| `get_receipt_v2`        | runId, stableOperationId                 | `receipts:read`  |
| `revise_task_result_v2` | resultId, expectedRevision, signedObject | `results:revise` |

The versioned handoff tools below supplement these seven financial tools. List returns only
approved active tasks with this connection/grant's committed preparation, sorted by task ID with
snapshot/bearer/limit-bound cursors; it does not fetch plaintext or source content. Get returns
the actual Agent delivery and compact current KeyProofs, not the owner's original carrier.
Read observations and saved-result facts remain distinct.

Structured results use existing domain DTOs without duplicate ciphertext text. A missing receipt
is text `null` without a structured object. Errors contain a fixed public code; unexpected errors
become `authorization_unavailable`, and SDK validation diagnostics are sanitized.

`resources/read` accepts only these bounded selectors, with no arbitrary HTTP fetch or redirects:

- `folioview://tasks/{taskId}/preparation`
- `folioview://preparations/{preparationId}/objects/{objectId}`
- `folioview://preparations/{preparationId}/registries/{sequence}`
- `folioview://runs/{runId}/registries/{sequence}`

The exact configured Host is required; supplied Origin must equal the issuer origin, and forwarded
hosts are not trusted. No SSE/subscription/dynamic-registration endpoint is implied. Every request
reauthenticates the exact opaque bearer resource/family/connection, then domain methods apply their
own current guards. Strict JSON rejects duplicates and encoded bodies. Request/response ceilings
are 589824/1048576 bytes including wrappers and JSON-RPC IDs. All replies use no-store; bodies,
tokens and raw diagnostics are not logged. Configuration failure leaves this adapter unavailable
without making health depend on credentials.

## Foreground controller

The fixed consent shell and controller use explicit owner-origin allowlists, source checks,
one-use nonces and separate owner/model MessagePorts. Public config/Worker hashes describe
served bytes; independent owner-provided Root/checkpoint/release/delivery pins establish trust.
The controller verifies the pinned Worker digest before constructing a self-contained Blob Worker.
The package exposes only fixed allowlisted assets, including required third-party notices.

The credential-bearing consent port permits claim, prepare_encrypted and decision. The separate
public-only helper port permits initialize, confirm_delivery, status and lock. It cannot obtain
Firebase credentials or acknowledge a model-pasted receipt. Paired helpers sever the public
opener reference and remove manual trust controls; an independently supplied public-card mode
remains for compatibility and does not attest a remote Muse host.

The model can read approved inputs and prepare a report through closed operations. It cannot
replace trust, import/export keys, select arbitrary signing/network destinations or read OAuth
credentials. Worker keys are nonextractable and memory-only, with an original TTL of at most
one hour. Paired owner heartbeats run at most every 30 seconds with a 90-second presence lease;
they never extend the TTL. Lock, observed owner closure/navigation and authority failures end
private work. Hidden pages mask content and reject late callbacks. Manual mode has no remote
owner-presence observer. Revocation stops future API/key distribution, not disclosed plaintext.

Named authenticated controller methods use fixed same-issuer routes and bounded requests,
without redirects/cookies. Before report POST, IndexedDB stores the exact original signed
ciphertext and public scope, never tokens, private keys, plaintext or Passkey material. Atomic
CAS preserves first bytes across tabs; caps are 32 records/scope and 256 globally. Unknown
outcomes check/replay those bytes. A matching newly approved scope may recover a prior receipt
without old private keys; it cannot revive a revision session or extend the old Run.

## Versioned handoff

| Helper | Tool / packet                             | Maximum handoff         | Config and assets                                  |
| ------ | ----------------------------------------- | ----------------------- | -------------------------------------------------- |
| 1.2.0  | Trusted host transport                    | Original session bounds | `/agent/v2/controller/config`, `/agent/v2/helper/` |
| 1.3.0  | `get_foreground_transport_v2`, profile v1 | 60 seconds              | versioned `/1.3.0` paths                           |
| 1.4.0  | `get_foreground_transport_v3`, profile v2 | 300 seconds             | versioned `/1.4.0` paths                           |

Handoff is also clipped to token/grant/connection expiry; it does not extend any credential,
Worker or Run. Version/profile mismatches fail closed. The tool takes only contractVersion/taskId
and seals the existing bearer to the approved Agent encryption key. The six-field response has
contract/profile/task/connection/preparation/credential, fits 8 KiB, and exposes no plaintext token.
The credential JWE uses ECDH-ES+A256KW/A256GCM, distinct transport type and exact issuer/actor/
recipient/delivery/time bindings. Only the trusted owning Worker port opens it; the controller
reauthenticates the same-issuer bearer before installation. The model sees public status only.

The Web consumer pins the matching release. Legacy file/text import is an explicit local action:
file selection alone does not connect, file and pasted packet cannot coexist, input is limited to
12 KiB and cleared on connect/hide/lock/exit. The helper verifies preparation, starts one signed
Run, decrypts frozen inputs, then seals and saves the explicit report. It labels success only
after an authenticated verified receipt. Interrupted Begin keeps the same signed request and
operation in memory; continuation replays original bytes or accepts the retained response without
another POST. Closed/expired sessions cannot be revived by importing a fresh packet.

Public bundle download has a separate 60-second/two-MiB budget and independent SHA-256 check.
Authenticated requests retain their 20-second budget. If the installed token cannot cover that
budget, the controller returns `access_token_refresh_required` without sending the request.
The trusted host can refresh the same grant, obtain a fresh encrypted packet and reconnect the
same live helper with identical connection/authorization/client/tasks/scopes. Original keys,
Run, draft and ciphertext retries remain within their old lifetimes; the helper holds no refresh
token. A changed identity/scope or server authority denial still ends the session.

## Verification

The Hub suites execute checked Workers, controller transport, Node WebCrypto and actual Python
FastAPI/SQLite domain flows with synthetic identities. IndexedDB transaction tests use a pinned
dev-only model. Those checks establish protocol behavior, not native host isolation, real Muse
execution, model quality or physical memory erasure. Follow the [service verification commands](../README.md#local-development-and-verification).
