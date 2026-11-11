# Agent connections and reports

Persistent and legacy foreground connections coexist behind independent capabilities.
The persistent route retains account connectivity and selected-resource permissions, uses the
existing shared owner unlock and publishes approved new versions while visible and unlocked.
Native schedule installation, protected-host restart and cross-day execution require real acceptance.

The old foreground helper remains a compatibility path with explicit session limits. The
legacy-specific details below do not describe the lifetime of a persistent connection.

## Independent executor owner flow

The independent route reuses the same Owner Worker, resource/task publication outbox and
persistent Inbox. It is default off. Set the server-only
`FOLIOVIEW_INDEPENDENT_AGENT_ENABLED=true` and `FOLIOVIEW_INDEPENDENT_AGENT_CONFIG`
to a closed public JSON selection with exactly:

```json
{
  "connectionId": "reviewed_connection_id",
  "clientId": "reviewed_native_client_id",
  "issuer": "https://policy.example.com",
  "audience": "https://executor.example.com/mcp",
  "policyJwk": { "kty": "EC", "crv": "P-256", "x": "PUBLIC_COORDINATE", "y": "PUBLIC_COORDINATE" },
  "nativeRedirectUris": ["https://chatgpt.com/connector_platform/oauth/callback"]
}
```

The coordinate strings above are deliberately invalid placeholders. Use the actual public
fixed KMS signing-version key and exact independently reviewed native callback. Invalid,
private-key-bearing or extra-field configuration disables only this new module. The public
`/api/private/independent-agent/config` response contains this selection, never a credential,
Root private key, financial data or proof that the connection is active.

Initial deployment, explicit Root bootstrap, measured two-phase original-key creation,
certificate provisioning and Root/Hub enrollment are administrator prerequisites from the
[Policy operations](../../../services/agent-policy-service/docs/operations.md) and
[executor operations](../../../services/agent-executor-service/docs/operations.md).
The UI consumes that prepared original identity; it does not initialize a missing witness,
generate replacement Agent keys, silently adopt a prototype identity or impersonate an
administrator. Actual initial setup and activation have not been executed by source checks.
There is no daily public-key import, helper card, separate Passkey session or copied recovery secret.

Before any Google credential is sent to Policy, the Worker verifies the destination against the
current Owner Root approval read through the existing Hub Owner transport. The exact approved
issuer is also asserted against the freshly loaded server selection immediately before credential
retrieval, so a configuration reload cannot switch the destination. Terminal revocation may use
the original historical Root approval for this address check; this never grants new execution.

Before displaying a usable connection or publishing another approved version, the Worker
checks the current account/Vault Root, original device-signed Agent binding and Root registry,
the exact independent Root approval, Policy issuer/resource/client/key, bounded resource scope,
current Owner-only recipients and a fresh Policy-signed checkpoint matching the current
state/head/authorization epoch. Within an unlocked Worker, lower versions/epochs or conflicting
same-version heads are refused. Unavailable, expired, revoked or incompatible-epoch state
stops new publication and authorization; it never widens scope or resets authority.
A verified binding is not a browser claim of live TEE or native schedule acceptance.

The ciphertext Owner BFF admits the separate Hub `/api/v2/executor-connections/...` parent,
consent, original-operation receipt and publication paths. Existing immutable packet/receipt
verification is reused. An unknown response retains the original sealed packet; reconciliation
reads its original receipt first. Resource delivery continues only for already approved logical
resources and already assigned tasks while the page is visible and unlocked. New scope and task
reassignment require explicit review. Scope outside the finite Root-approved parent requires
an explicit new approval/identity adoption; this UI cannot mutate the original parent or migrate
an existing Muse connection automatically.

Policy OAuth consent goes directly to the deployment-selected independent issuer with the
current verified Firebase token and its Secure HttpOnly consent cookie. Only exact Owner
connection/checkpoint/revoke and bounded pending/approval endpoints are allowed. No Agent token,
refresh grant, arbitrary issuer/JWKS or financial payload is accepted. The existing session guard
checks both before and after credentials/network/body reads. The Owner explicitly reviews the
request; the Worker signs only `oauth_approve` or terminal `revoke`, bound to current version/head
and exact parameters for 120 seconds. OAuth approval does not create or renew the original finite
Root approval. No automatic retry creates another grant after a lost response.

The return URL must match an exact configured native callback, contain one code/state/issuer
and the pinned issuer, with no credentials or fragment. `/agents` sends `Referrer-Policy:
no-referrer`. Restrictive browser cookie policy or missing independent CORS/invocation readiness
fails closed; real browser/account acceptance remains separate from these source tests.

Pause withdraws current resource consent. Re-approval inside the same Root scope is explicit.
Terminal revoke stops Policy authorization/key recovery and OAuth families; it does not delete
historical reports or ciphertext. Inbox continues verifying the original Run, author, recipients
and receipt before decryption. Existing Muse connections and older Inbox history remain available.
Native schedule installation/execution stays **not observed**, and offline/overnight continuous
execution stays **pending acceptance**, independently of UI task expectations or a successful
connection. No live deployment, ChatGPT installation, scheduling or acceptance is performed here.

The Web image copies both shared public-verifier distributions, and both integrity manifests
participate in the Owner Worker compatibility name. The Web-only infrastructure consumer now accepts the exact public pair from the reviewed
profile-v5 managed projection, and its existing image trigger includes the additional dependency.
Use that pinned projection and full saved-plan approval flow when selecting actual values; source
checks do not perform configuration apply or backend activation. Other services keep their own
separate deployment configuration.

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

## Owner first-key preparation and certificate renewal

The unlocked Owner's Settings has a collapsed **Independent executor administration**
entry. It accepts public preparation files only; Root/device private key handles
remain in the existing Owner Worker. Preparation itself performs no network write,
deployment, CA issuance or native schedule installation. Every action needs a
separate visible review/confirmation. Ordinary daily connection controls remain
unchanged. Do not provide private JWKs, account tokens or financial plaintext.

Each file contains `configuration` (the configured independent public channel) and
`policyConfig` (the exact reviewed Policy public config). Its Root must match this
unlocked library; its domain digest covers the selected witness/storage/KMS/client
configuration. Action-specific fields are closed:

| Operation               | Additional public fields                                   | Result                                                                                                                |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `inspect` / `bootstrap` | none                                                       | Domain/destination review, or fresh purpose-limited Root bootstrap control                                            |
| `initialize`            | `draft`                                                    | Fresh Root initialize permit, exact draft digest and public Root pin                                                  |
| `review_pending`        | `pendingOffer`, `review`                                   | Verify fresh independently signed Policy review and remember original keys in this Worker                             |
| `finalize`              | `pendingOffer`, `hubAudience`, `approvalExpiresAt`         | Original-key certificates/registry update, actual device Hub binding, finite Root approval and fresh finalize control |
| `register`              | `pendingOffer`, `finalOffer`, `review`, `certificateChain` | Exact reviewed Hub/Policy registration plus public core/native configs                                                |
| `certificate`           | `policyState`, `review`, `certificateChain`                | Fresh certificate-only Root control bound to the existing original-key binding and current version/head               |

Obtain the pending public offer through the narrow Executor Owner publisher. The
**Request live public-artifact review** button is an explicit online read of
Policy's fixed authenticated review route, using the configured issuer after
Worker domain inspection. It does not enroll or release keys. The returned receipt
must be verified while fresh (120 seconds); no caller `verified` flag, supplied
Google keys or invented VM response substitutes for Policy's actual verifier.
The complete pending offer, draft, original keys and reconstructed statement are
bound by the signed receipt. The Worker remembers the verified observation through
the bounded creator window; the initial Root permit timestamp conservatively caps
that window at 600 seconds. It never backdates a new verification.

Keep this page unlocked and avoid reload through this administrator ceremony.
Review the pending receipt immediately, use the original CSR to obtain a public
CA chain while the creator waits, finalize the actual original keys, then request
and verify the fresh final review **with that chain** before preparing registration.
The Root approval expires at the explicitly reviewed `approvalExpiresAt` (at most
30 days); it does not infer task schedule acceptance. Native configuration hashes
are calculated from the actual Root directory containing these original keys and
included in the final workload environment before DEK sealing. The actual Hub
binding fingerprint is derived from the real device-signed command, never invented
in a provisional draft. No Muse/native pairing offer is fabricated for this flow.

Preparation results are public files; save each for the narrow operator handoff.
Use the bootstrap result's `command` as Policy CLI input, initialize result's
`permit`/`draft`/Root public pin as creation inputs, and finalize result's
`finalization` as the create-only inbox payload. Never send the whole wrapper where
a signed control is expected. The Executor's
[public-artifact tool](../../../services/agent-executor-service/docs/operations.md#owner-public-artifact-tools)
validates these exact controls and CAS paths; none runs automatically from the UI.
Actual resources/images/workload claims and keyless publisher permissions must
already have passed the separately approved deployment stages.

**Publish approved registration** is an explicit later action. It refreshes the
Root directory, applies only the selected pending directory update when needed,
submits the exact original Hub approval/scope/device binding, verifies its closed
registration receipt, then submits the exact Root Policy registration. There is
no automatic retry or second binding/key generation. A failed/unknown publication
keeps the original prepared packet; replay the same bytes and reconcile actual
receipts. Preparing again in this Worker preserves its exact registration packet.
A lock, reload or expired creator window clears/stops this transient ceremony;
there is no private-key export or silent identity reset. Preserve any reservation,
final encrypted genesis and original receipts and use an explicitly reviewed
recovery procedure rather than erasing them to start over.

Renewal uses the current Policy state and a fresh original-key certificate review.
The Worker checks exact PEM-byte digest, pinned domain/binding and current
version/head before signing only the `certificate` purpose. **Publish certificate
approval** does not publish config or replace a TLS key. After the actual Policy
receipt is reconciled, the separate Owner publisher CAS-updates the same public
core-config URI with the approved chain. Missing/expired proofs, wrong original
keys, changed bytes or stale state fail closed. The UI never accepts CA terms,
starts Certbot, deploys, resumes a schedule or claims online/cross-day acceptance.
