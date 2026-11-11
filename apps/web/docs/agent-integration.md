# Agent connections and reports

Persistent and legacy foreground connections coexist behind independent capabilities.
The persistent route retains account connectivity and selected-resource permissions, uses the
existing shared owner unlock and publishes approved new versions while visible and unlocked.
Native schedule installation, protected-host restart and cross-day execution require real acceptance.

The old foreground helper remains a compatibility path with explicit session limits. The
legacy-specific details below do not describe the lifetime of a persistent connection.

## Persistent owner flow

The persistent owner operations compose the shared browser contracts inside `VaultCore`. They use
the existing ordinary owner session and nonextractable Root/device/recovery handles. They expose no
generic signing, key import, key export or caller-selected network operation. The Web orchestration, Agent UI and Inbox consume these operations through the existing
shared unlock. The independent feature gates default off.

Each request independently selects a connection and client. Enrollment checks the actual nonce-bound
key offer; registration does not grant content access. Continuing resource approval remains explicit,
and publication derives its content from a verified saved task or owner resource. Task reassignment
requires an explicit review flag. Historical report reads pin the requested result ID, the owner's
Root chain and the original signed Run bindings; later permission withdrawal does not erase history.

`EncryptedVaultSession` reuses the ordinary Worker and stores one unresolved operation per
connection. A caller must load and recover an existing operation before preparing another. The
original packet is sealed with the owner's wrapping key before transport, and a concurrent insert
loser cannot replace it. Read-only lists expose public locators only. Receipt verification precedes
compare-and-delete. Key renewal and archive changes retain the same atomic pending-operation fence.

Publication callers should first read the operation receipt and submit the original packet only
when no receipt exists. A receipt read includes its original encrypted envelope. For the same logical
publication, the Worker independently checks its Root proof, payload digest, business bindings and
issuance directory, allowing an already committed publication to be recognized after local retry
state has been cleared. Producer idempotency and immutable ciphertext are unchanged.

The checked Web build includes `packages/encrypted-workspace`, and the shared integrity manifest is
part of owner Worker compatibility. The ordinary server receives no decrypted content or owner key.

### Persistent owner flow: Closed owner transport

The Web BFF admits only the named persistent identity/consent/publication/setup,
connection history/revocation, plan history and encrypted Inbox endpoints. Bodies
and responses use closed structural DTOs from the shared contract; Root and Agent
signatures remain Worker checks. Persistent Inbox cursors use their producer's
opaque page ID plus bounded offset, independently of legacy Inbox pagination.

Native account OAuth approval is deliberately absent from the BFF. A branded,
source/origin/request/nonce-bound MessageChannel to the original Hub window permits
only `pending` and `approve` with a vault locator. It severs the opener before a
transient Google credential is sent, preserves AuthProvider session-generation
checks, and never returns an OAuth code, token, callback URL or financial grant to
the Web consumer or model. This transport prerequisite does not enable feature
gates or grant any real account access.

### Persistent owner flow: Persistent workspace consumer

The workspace owns one persistent orchestration hook alongside its existing shared
vault session. It never creates another vault session or automatically asks for a
Passkey. Native account linking and one-time runtime enrollment lead to an explicit
review of selected tasks and their logical resource inputs. Continuing permission
includes future versions of those same resources; changing source incarnation,
epoch or task inputs requires review. Task reassignment is a separate explicit
choice. Connection IDs and key fingerprints live in expandable details.

When the signed-in page is visible and unlocked, reconciliation checks current
Root consent and task assignment, encrypts current approved resource versions and
updates already-assigned task authority. It neither grants another resource nor
assigns a new task automatically. Manual-resource operation IDs exclude retrieval
timestamps, so an unchanged version recovers its original ciphertext receipt
instead of creating a fresh publication each poll. New versions can only be
published while owner keys are available; native execution can continue with
already synchronized, approved versions after sign-out.

One pending operation per connection is restored before any new mutation. Registry
registration distinguishes an already-applied directory from a conflicting one;
identity, consent and publication recovery read original receipts before sending
original bytes. Account change, lock and visibility changes fence in-flight work
and immediately mask private views. No recovery path silently replaces keys or
approves resources.

Persistent reports share the Inbox route with expandable foreground report history.
The existing Worker verifies historical Root/Agent issuance, frozen Run and receipt
before decrypting; state changes use a separate closed device-signed operation.
Unknown state updates retain their exact pending command while the view remains
open. Report sources use the existing safe Markdown/link renderer.

Requested schedules, independently verified Agent statements and Hub run/result
observations have separate labels. A report receipt never claims Muse installed a
native schedule. Activation flags default off; reviewed configuration enables owner-led real Muse,
restart and cross-day acceptance.

## Legacy foreground consent

Agents is an additional bottom-sidebar view; Markets remains the default. Muse is the enabled
provider, with ChatGPT, Gemini and Claude visibly unavailable. The view lists owner-scoped
connection metadata, selected immutable task versions, independent API/content-grant facts and
authorization attempts. Revoke requires a fresh review and owner check. A lost response reloads
authoritative metadata rather than automatically sending another revocation. Revocation stops
future platform access; it cannot remove material already retained by a third party.

Consent uses two separate fixed protocols. The Hub's same-origin consent shell keeps its OAuth
flow cookie and origin checks, then opens the existing Web origin for Google owner verification
and Passkey use. The Web validates its known Hub origin, actual opener, one-use nonce and request
before accepting a MessagePort; it then severs the opener reference. Only claim, encrypted
preparation and decision are allowed. A fresh owner token travels on that private consent port
for each operation, never through the model, helper port, URL or persistent browser storage. The
owner BFF still excludes cookie-bound authorization endpoints. The no-store agent-link metadata
endpoint derives its destination from the existing validated `FOLIOVIEW_HUB_ORIGIN`; no new cloud
configuration is needed.

The foreground helper has a separate public-only port with initialize, confirm-delivery, status
and lock operations. The client pins the reviewed Worker release independently, inspects the
public offer, shows fingerprints and requires explicit review of replacement keys. A public
setup card and public offer support assisted use in another browser without copying private keys
or tokens. This helper profile binds one task per connection. OAuth access and content decryption
are reviewed separately, with explicit scopes, immutable task/source versions, recipient key
epochs and independent delivery fingerprints. An active connection alone does not prove an
agent received keys, decrypted data or ran a model.

Registration precedes the authorization snapshot. The shared Passkey Worker signs certificates
and content grants, authenticates source data and encrypts task/resource copies. Holdings use
their exact producer snapshot; User watchlist/follows copies require before/after catalogue
stability checks and remain owner-attested copies. The watchlist response has no independent
producer revision proof, and unknown source-as-of remains unknown. Source or registry changes
require a new review instead of silently changing an approved input.

Registration, approval and preparation retries are PRF-sealed in IndexedDB and bound to the
owner/vault/task. Registration and ciphertext retries reload the original operation and exact
bytes, use optimistic versions and preserve the record on conflict. OAuth decision is sent once:
if its acknowledgement is lost, recovery reconciles the original sealed approval against fresh
connection/grant metadata and resumes delivery without resending approval. Recovery also works
from a normal Web URL after signing in and unlocking. Prepared copies are confirmed against
fresh committed metadata before the independent helper delivery pin is accepted; manual-helper
recovery requires explicit confirmation that the original helper still holds those keys.

Private content is masked on lock, logout, account or unlock-generation changes, navigation and
hidden pages, and late work is fenced. An initialized paired helper receives a public status
heartbeat while its owner workspace remains unlocked; an abandoned owner port expires at the
helper. Closing or locking that helper ends its memory keys. Locking the library does not revoke
an independent manual helper or agent authorization; use explicit connection revocation to stop
future service access. No unattended schedule or remote Muse execution is claimed by this UI.
Real browser/Google/Passkey/Muse acceptance and cloud enablement remain separate from these
synthetic controller, cryptographic and producer/consumer protocol checks.

### Owner connection management and Muse availability

The Agent page reads `/api/v2/agent-capabilities` through the same authenticated,
fixed Hub owner bridge as its connection list. This closed, non-sensitive profile
separates owner management from the existing Muse OAuth/adapter rollout gates. A
configured Hub destination alone does not enable new Muse connections or prove
real provider interoperability.

Connection history and capabilities load independently, including their deadlines,
errors and account fences. A failed or slow capability request cannot discard a
successful owner list or prevent its explicit revocation controls. Only a
successful empty list renders the empty state; real list failures remain retryable
errors. Disabled or unverified new-connection availability suppresses MCP address
copying and consent entry while retaining owner history.

## Foreground helper release

The Muse approval flow pins helper 1.3.0 to its reviewed Worker digest and opens
`/agent/v2/helper/1.3.0/controller.html` on the configured Hub origin. Manual setup shows this
fixed address for Muse's own browser and retains explicit public-key and delivery-pin review.
After encrypted inputs are published, Muse obtains the Hub's encrypted foreground transport
packet and connects that same helper session before reading the task and saving its report.
The helper confirms an authenticated server receipt before the owner checks Inbox. Legacy
1.2.0 offers remain verifiable only with their original reviewed digest. This Web-only change
does not register a client, enable OAuth or approve content access automatically.

<a id="independent-executor-owner-flow"></a>

## Retired independent executor route

The unused standalone Policy/Confidential VM owner ceremonies and their public
configuration endpoint have been removed. Existing Passkey unlock, Hub
connections, resource/task publication and historical Inbox decryption remain.
The original operator design is available in Git history; it is not a deployment
prerequisite for personal Agent-owned credentials. No VM, TCP proxy or additional
service is required by the current Web integration.

## Agent-owned credential pairing foundation

The default-off `/api/v3/agent-credentials` Owner transport is separate from native
OAuth bootstrap and financial PoP. The existing unlocked Owner Worker decrypts a
10-minute host offer, verifies its exact issuer/provider/Owner/vault/connection,
client, authorization, generation and public-key signature, then appends fresh
Agent certificates and signs a maximum 90-day lease. It encrypts the Root and
checkpoint anchor back to the same pending host. Agent private keys stay in that
host, never in Web state or a user-managed recovery file.

The new credential packet has its own sealed original outbox and exact receipt
checks. Read-only signature verification supports expiry/7-day notices and prior
consent history after old Agent keys expire. Preparing or cancelling a replacement
does not commit a directory or revoke current credentials. Root certificate
publication precedes the Hub's atomic lease replacement; old public keys remain
available for Owner historical report verification.

These Worker methods and closed DTOs prepare the later simplified authorize and
reauthorize interface. No deployment, real Passkey/host migration or native-plan
acceptance is implied by local crypto or transport tests.
