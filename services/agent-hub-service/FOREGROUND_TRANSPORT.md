# Authenticated foreground Muse transport

Helper 1.3.0 adds a browser-consumable connection to the existing approved OAuth grant. Legacy
1.2.0 default config/asset paths and Worker bytes remain available. The new config is
`/agent/v2/controller/config/1.3.0`; assets use `/agent/v2/helper/1.3.0/`. A separate Web delivery
must independently pin the new Worker before using it. Neither release enables OAuth or the
encrypted adapter, registers a production client, or approves an owner grant automatically.

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
the tool and transfers the complete encrypted response to the helper's connection field. The
page clears this field before connecting. One explicit action reads approved preparation,
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

## Rollout and evidence

Deliver the Hub producer and versioned assets first, then the Web version/hash consumer in a
separate PR. Production client callback/registration and flag activation require exact current
Muse configuration, followed by a real user-approved foreground session. Synthetic tests do not
certify that production integration is connected.

Tests use actual OAuth/SQLite authority, Python JOSE encryption, the real non-exportable Worker,
controller HTTP routes and independently decrypted owner/recovery results. They also verify
model-port denial, fixed recipient/scope/issuer/freshness, ciphertext integrity, legacy release
compatibility, gated distribution, explicit UI saving and original receipt/retry behavior.
