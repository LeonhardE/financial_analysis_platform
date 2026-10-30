# Encrypted MCP v2 protocol adapter

The Hub-only producer implements exactly seven tools at `POST /mcp/v2`, using the official
Python SDK `mcp==2.3.0` and `mcp-types==2.3.0`. It supports the SDK's modern per-request protocol
and handshake-era clients over JSON Streamable HTTP. Application data always uses
`folioview.agent-workspace.v2.0`; MCP protocol revisions are a separate negotiation.
The dependency follows the [official SDK v2.3.0 release](https://github.com/modelcontextprotocol/python-sdk/tree/v2.3.0)
and its public [ASGI/Streamable HTTP API](https://py.sdk.modelcontextprotocol.io/run/asgi/).

Both existing flags, `HUB_OAUTH_ENABLED=1` and `HUB_ENCRYPTED_ADAPTER_ENABLED=1`, are required.
The existing explicit issuer/client/consent configuration also must be valid. Nothing in this
change enables deployed settings, creates a service/database/key, or deploys cloud resources.
With either flag off the endpoint returns a bounded, uncached 503. SDK/store construction is lazy;
invalid configuration leaves the adapter unavailable while health remains accessible.

## Tools and authority

All arguments are closed JSON objects containing the exact `contractVersion` above. There are no
owner, arbitrary URL, plaintext holdings/rules/report, private-key or model API key parameters.
Signed write operations take their task/operation identity from the signed artifact itself; the
existing domain service verifies the actual signature and all authenticated bindings.

| Tool                    | Additional inputs                              | Result                                     | Required OAuth scope |
| ----------------------- | ---------------------------------------------- | ------------------------------------------ | -------------------- |
| `list_tasks_v2`         | optional `limit` 1–50, `cursor`                | `TaskMetadataPage`                         | `tasks:read`         |
| `get_task_v2`           | `taskId`                                       | `EncryptedTaskWithKeyProofs`               | `tasks:read`         |
| `begin_run_v2`          | `signedIntent`                                 | existing `folioview.agent-run.v1` response | `runs:create`        |
| `get_run_inputs_v2`     | `runId`, optional `cursor`                     | `ManifestComponentPage`                    | `runs:read`          |
| `submit_task_result_v2` | `runId`, `signedObject`                        | original `ResultReceipt`                   | `results:create`     |
| `get_receipt_v2`        | `runId`, `stableOperationId`                   | `ResultReceipt` or null                    | `receipts:read`      |
| `revise_task_result_v2` | `resultId`, `expectedRevision`, `signedObject` | original `ResultReceipt`                   | `results:revise`     |

Begin returns the already implemented Run profile: `contractVersion`, `profile`, `run`, `manifest`,
`manifestFingerprint`, `componentPath`, `registryProofs`, `authorProofs`. It retains the proofs and
frozen manifest needed by the foreground helper, rather than silently dropping them to a bare
Run descriptor. The other non-null structured tool results use existing formal shared DTOs.
There is one short static text label beside structured data, avoiding duplicate ciphertext.
A missing receipt has text `null` and no structured object, because the SDK only accepts an object
for `structuredContent`. Tool errors are `isError:true` with a fixed public error code. Unexpected
errors become `authorization_unavailable`, without internal exception text or private arguments.

List includes only the current bearer's approved, active tasks with a committed preparation for
that same connection/grant. Unprepared tasks are absent until the owner publishes their encrypted
delivery. It reads current public authority, task heads and preparation descriptors, without source
calls, owner task carriers or preparation ciphertext. Existing per-owner limits bound enumeration
to 32 tasks. Pages sort by task ID and have bearer-, limit- and snapshot-bound opaque cursors;
an authority/delivery change requires restarting pagination. Cursors grant no authority, are not
stored business state, and cannot select another connection or user.

Get returns the actual committed agent delivery, including its delivery revision, fingerprint and
key epoch, rather than the owner's original task carrier. Its compact `KeyProofs` is one current
root-signed registry checkpoint plus certificates. The full consecutive proof chain is available
through authenticated resource reads. Prepared resource candidates are only version pointers;
no plaintext source or owner content is embedded. Content reads retain source freshness checks,
before/after authority checks and the existing connection's read-observed behavior. Metadata/proof
reads do not mark a result saved, and no read marks Inbox content read.

## Bounded continuation resources

`resources/read` supports only these exact selectors. IDs follow the formal identifier syntax;
registry sequences are canonical positive decimals, at most four digits. There is no HTTP fetch,
redirect following, wildcard host, query string, fragment or caller-selected upstream.

| MCP URI                                                          | Existing domain operation                       |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| `folioview://tasks/{taskId}/preparation`                         | preparation metadata and pinned root/proof refs |
| `folioview://preparations/{preparationId}/objects/{objectId}`    | one authorized prepared ciphertext              |
| `folioview://preparations/{preparationId}/registries/{sequence}` | one prepared registry bundle                    |
| `folioview://runs/{runId}/registries/{sequence}`                 | one Run registry bundle                         |

These URIs map to the same guards as fixed REST paths documented in [PREPARATIONS.md](PREPARATIONS.md)
and [RUNS.md](RUNS.md). Proof metadata already includes the corresponding REST paths; a consumer
can map those fixed selectors to the URI forms above. Per-kind resource scopes still apply to
prepared objects, and Run reads require `runs:read`. Resource failures return a JSON object with
`contractVersion` and `error.code`, preventing arbitrary internal errors or submitted URIs from
becoming diagnostics. Resource results are JSON text with MIME type `application/json`.

## Per-request security and transport bounds

Every request requires one exact `Authorization: Bearer …` opaque Hub token. Ordinary Google
identity, workload identity, `X-FolioView-Delegation` and `X-Serverless-Authorization` cannot replace
it. OAuth checks the token's exact `/mcp/v2` resource, expiry, family and connection on every HTTP
request. Domain methods additionally check their own scopes, owner, connection, grant, task,
Run, manifest and operation relationships inside their transactions. The SDK principal includes
connection and authorization identity; no principal or token is retained between requests.

There is deliberately no global new-execution guard. A legitimate original connection can recover
or exactly replay an already saved receipt after a task pause, source outage, later relevant key
revocation or Run expiry while its bearer remains valid. That narrow historical exception remains
inside `ResultService`; it cannot authorize a new write, revision, resource read, another agent,
another user or an explicitly revoked connection/grant.

Only the configured issuer's exact Host is accepted. An Origin, if supplied, must be that exact
issuer origin; other/duplicate origins and hosts are refused. No forwarded host is trusted.
Only the exact `/mcp/v2` route is exposed: no old `/mcp`, SSE listener, persistent session,
subscription bus, dynamic registration or mounted metadata alias. The authoritative protected
resource document remains `/.well-known/oauth-protected-resource/mcp/v2` on the main app.

Requests use one exact JSON media type, bounded strict JSON (including duplicate-key rejection),
no content encoding and the existing 589824-byte write ceiling. Full serialized responses,
including resource JSON escaping and echoed protocol IDs, cannot exceed 1048576 bytes. Responses
and failures use `Cache-Control:no-store`; SDK diagnostics are suppressed and expected/unexpected
domain exceptions are sanitized before reaching SDK handlers. No request body/token/URI logging
is added. Transport guards do not enable CORS for arbitrary browser origins.
Legacy SDK protocol validation errors are also reduced to a numeric JSON-RPC code and a fixed
safe message; raw Pydantic diagnostics, error data and unrecognized method names are not returned.

## Delivery boundary

This is a protocol producer subphase of HUB-009. It does not implement the trusted UI, owner
pairing/review screens, a durable ciphertext outbox controller, automatic foreground-session
recovery, background decryption, private-key persistence, scheduling, real Muse acceptance or any
other integration. The helper's existing nonextractable in-memory model and [result contracts](RESULTS.md)
remain unchanged. The overall HUB-009 ticket remains partial until its remaining consumer work.
