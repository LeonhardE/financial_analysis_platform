# Authenticated foreground Muse transport

## Versioned browser handoff window

Helper 1.4.0 uses the additive `get_foreground_transport_v3` tool and
`folioview.foreground-transport.v2` packet profile. Its handoff lasts at most 300 seconds,
clipped to the existing access token, task grant and connection expiry. This accommodates
the actual Muse file-permission and browser handoff latency observed in production.
It never refreshes or extends a credential, grant, Run or foreground Worker session.

The tool still accepts only `contractVersion` and `taskId`; callers cannot choose a lifetime,
recipient or URL. The new Worker rejects expired packets, a validity window over 300 seconds,
wrong profile/bindings and model-port token access. It authenticates the original bearer
against the same issuer before use. Profile v1 and helper 1.3.0 remain a matched, unchanged
60-second path; sending one version's packet to the other helper fails closed.

The explicit new config is `/agent/v2/controller/config/1.4.0`, with assets under
`/agent/v2/helper/1.4.0/`. The Web consumer must independently pin the new Worker in a separate
PR. Existing open helpers keep their original Worker and expiry; upgrading requires a new
helper and explicit recipient review. The owner library's private keys never migrate through
the helper or this packet. A fresh-packet retry after expiry preserves live original helper
keys, Run and ciphertext outbox; a locked or expired Worker cannot be revived.

## Legacy 1.3.0 path

Helper 1.3.0 adds a browser-consumable connection to the existing approved OAuth grant. Legacy
1.2.0 default config/asset paths and Worker bytes remain available. The new config is
`/agent/v2/controller/config/1.3.0`; assets use `/agent/v2/helper/1.3.0/`. A separate Web delivery
must independently pin the new Worker before using it. Neither release enables OAuth or the
encrypted adapter, registers a production client, or approves an owner grant automatically.

Bootstrap allows up to sixty seconds to download and read the fixed public Worker bundle before
any credential is installed. The two-MiB limit and independently pinned SHA256 still apply before
Worker creation; lock cancels the transfer immediately. This download budget is separate from
the unchanged twenty-second authenticated request budget and does not extend any grant or token.

## The connection packet

`get_foreground_transport_v2` accepts only the v2 contract and selected `taskId`. The same
OAuth connection must already have a current root-approved grant and committed encrypted
preparation. The producer rechecks token, task, grant, registry and source fences. It seals the
existing bearer to the grant's certified `agent_enc` key, without minting, persisting or extending
a credential. Callers cannot choose an owner, recipient key, callback, network URL or token.

The response is a bounded object containing `contractVersion`,
`profile:folioview.foreground-transport.v1`, `taskId`, `connectionId`, `preparationId`, and a
compact `credential` JWE. It contains no plaintext bearer or user content. The entire response
fits 8 KiB. The handoff expires within 60 seconds and never exceeds the token/grant/connection
expiry. This controls handoff freshness; the original bearer keeps its original expiry.

The JWE uses the existing library algorithms `ECDH-ES+A256KW` and `A256GCM`, with the distinct
type `fv-foreground-transport+jwe`, `application/json` content type and the exact recipient key
ID. Its closed plaintext binds issuer, owner/vault/root, client/connection/authorization, task,
preparation/grant/epochs, recipient, validity and original bearer. This is a
Hub-owned transport control message; shared P1 content contracts and crypto algorithms remain
unchanged. It cannot be used as an arbitrary content decryption API.

Only the trusted owning Worker port accepts `openTransport`. It validates the exact header,
decrypts using its non-exportable agent key, and checks the independently supplied root and
delivery pins, issuer, recipient and freshness. The controller immediately authenticates the
opaque bearer against its fixed same-issuer authorization endpoint before installing it. The
model port has no transport-setup or token-read operation. The page receives public status only.
Tokens never enter the DOM, URLs, outbox, logs or model tool response. As with existing code,
JavaScript string memory does not provide a physical erasure guarantee.

## Basic browser flow

After explicit owner setup, recipient review and encrypted delivery confirmation, Muse calls
the tool and transfers its original six-field encrypted response through the helper's JSON file
input or connection text field. File selection does not read or upload the file or connect the
session. **Connect approved session** reads one file locally (at most 12 KiB) and passes the parsed
packet to the same controller and Worker checks. A file and nonblank pasted packet together are
refused. Both inputs clear before reading/connecting, on lock, when hidden and on page exit;
a late file read cannot connect after a lock or hide/show cycle. The file is not persisted or
uploaded. This avoids model transcription of opaque ciphertext and does not extend the 60-second
handoff, bearer or session lifetime. Prepare the file input before requesting a fresh packet,
then upload the original tool artifact and connect promptly. One explicit action reads approved preparation,
starts a signed Run and decrypts its frozen input pages. Muse reads those inputs and fills a
report title, summary, analysis and limitations. The explicit save action encrypts to the
existing approved owner/recovery recipients and submits via the existing result API.

If starting the analysis is interrupted, **Continue the original analysis** retains the same
operation. The controller keeps one unresolved signed Begin Run request in memory. After receiving
a server response, continuation rechecks those identical bytes in the Worker without another
Begin Run POST. When the POST outcome is unknown, it replays the original signed request under
the same operation. Another operation is refused until that Run is accepted or the session ends.
Every continuation still performs the original lifetime, signature and scope checks; it cannot
extend an expiry or turn an untrusted Run into an accepted one. These records do not survive a
closed, locked or expired helper session and contain no decrypted input or report.

The UI says saved only after an authenticated, verified server receipt. A lost response retains
the existing exact signed ciphertext outbox and original operation; check/retry never reseals
another report. Hidden/locked/closed sessions clear private views and late callbacks cannot
restore them. Private keys remain memory-only and TTL-bounded. No unattended execution is added.

## Access-token renewal within the approved session

The authenticated authorization response supplies the access token's expiry. Before each HTTP
request using the installed token, the 1.3.0 controller reserves its full existing 20-second
request budget. An expired token, or one with too little time remaining, is cleared locally and
returns `access_token_refresh_required` without issuing that request. The original grant identity,
Worker keys, delivery pin, Run and encrypted retry records remain available within their original
lifetimes. A multi-page preparation read can stop between registry pages and be explicitly retried
after renewal; previously verified registry pages still undergo the original history checks.

On that prompt, the authorized trusted host performs an ordinary same-grant OAuth refresh,
obtains a fresh encrypted connection packet, imports the original packet file and reconnects
the existing controller. Authentication must match the original connection, authorization, client,
tasks and scopes. Continue the original analysis/report operation after reconnecting. A partially
read frozen Run resumes its input pages without another Begin Run; an already loaded report draft
is protected against another read. The helper
does not acquire a refresh token or extend any grant, key, Run or Worker lifetime. Server-side
401/403 denials and authority conflicts retain their existing session-ending behavior.

## Rollout and evidence

Deliver the Hub producer and versioned assets first, then the Web version/hash consumer in a
separate PR. Production client callback/registration and flag activation require exact current
Muse configuration, followed by a real user-approved foreground session. Synthetic tests do not
certify that production integration is connected.

Tests use actual OAuth/SQLite authority, Python JOSE encryption, the real non-exportable Worker,
controller HTTP routes and independently decrypted owner/recovery results. They also verify
model-port denial, fixed recipient/scope/issuer/freshness, ciphertext integrity, legacy release
compatibility, gated distribution, explicit UI saving and original receipt/retry behavior.
