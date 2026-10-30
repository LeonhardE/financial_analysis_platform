# FolioView Web

The workspace keeps Markets as its default view and groups navigation at the bottom of the
sidebar. Resources adds a Wealthsimple holdings CSV import with client-side encryption and an
explicit account/coverage preview. Robinhood and Interactive Brokers remain disabled future
adapters; a transaction ledger is not treated as a current holdings snapshot.

## Resource library

Resources presents holdings, the existing Market watchlist, and a manually maintained YouTube
creator list with type filters and current source versions. Watchlist rows come directly from
User's existing `/api/v1/watchlist`; manage them in Market, then return to refresh. They carry no
holdings quantities, valuations or portfolio weights, and need no connected broker or passkey.

Creator add/edit/remove uses only User's exact `/api/v1/channel-follows` GET/PUT. Whole-list writes
carry `expectedRevision`, at most 50 closed entries, strict YouTube handle locators and a 128 KiB
UTF-8 budget. Names, handles and notes are user-provided; the UI fetches no YouTube subscriptions,
channel metadata or videos. **Watchlist and creator text remain in User's existing plaintext
domain.** The encryption behavior below applies to CSV holdings and the encrypted workspace.

Current discovery metadata comes from Hub's fixed owner catalogue through the existing Web
forwarder. Available/empty/uninitialized/partial/unavailable/pending/revoked states are distinct;
source failure is never interpreted as an empty list. Discovery is not encrypted Run evidence or
agent authorization. An optional `onCreateTask({ref, sourceEpoch})` integration appears only for
current ready/active resources when a task consumer is present; it carries no content or keys and
creates no task automatically. Current-source changes do not rewrite historical task/Run evidence.

Reads enforce actual streamed response limits and deadlines, and never cache private rows in
browser storage. Reentry from Market, tab visibility restoration, creator saves and holdings
snapshot changes refresh the relevant source metadata. Account changes/logout mask rows during
render, abort old fetch/body reads, clear editor drafts and reject stale callbacks. A conflict,
malformed response or uncertain write requires explicit successful reload before another save;
there is no automatic write retry and the local draft remains available for review.

## Import and privacy behavior

1. Sign in with the existing Google/Firebase flow.
2. Create or unlock the system-managed Passkey that protects the encrypted owner archive. There
   is no manual key file or additional password fallback. Unsupported PRF capabilities fail closed.
3. Select a holdings CSV. Parsing, decimal/currency checks, preview and account selection happen
   in the browser. The original file is not uploaded.
4. Confirm the selected holdings. A Worker produces the exact formal v2.0/P1 JWE/JWS carrier;
   only public authority/control material and ciphertext go to Hub/Portfolio.
5. Saved holdings are verified and decrypted in the browser. Navigation within the app preserves
   the current unlocked session; lock, logout, account change or app unmount terminates the Worker.

Google login establishes identity; it is not content-key derivation material. The system Passkey
PRF protects the cloud archive containing the owner's root/recovery keys. Browser device keys
are distinct and locally sealed, and runtime private key handles are nonextractable. Losing every
usable copy of the protecting Passkey can make the existing library unrecoverable by the platform.
Provider support and synchronization must be tested on each supported browser/device combination.

The privacy model trusts the published frontend implementation. Database, backup, log and backend
operators do not receive user content keys or plaintext holdings. It does not claim to prevent
an actively malicious replacement frontend from stealing data after the user unlocks it.

IndexedDB stores sealed key material, public root/checkpoint pins and exact encrypted outbox
packets. Atomic transactions prevent cross-tab packet replacement, mismatched deletion or pin
rollback. Pending sealed device registration survives a lost response without allocating another
device key. Snapshot retries resend the original carrier; conflicting pending imports have an
explicit receipt-check and local-discard recovery flow that does not delete server history.

## Wealthsimple format and supported content

The guide follows Wealthsimple's official web export workflow:
[Request a custom statement](https://help.wealthsimple.com/hc/en-ca/articles/35654428540571-Request-a-custom-statement).
Choose **Holdings report (CSV)**, the desired date and accounts, then download the file.
The official article describes field groups but publishes no exact CSV header specification.
The current adapter matches one supplied 21-column export shape, using entirely synthetic tests.
Unknown/missing columns, malformed records and oversized input stop import rather than guessing.

The importer retains selected account labels, stocks/ETFs, quantities, currencies, reported market
values and conservatively verified reported cash. Unit-price, book-cost, return and date-only
report-label columns are not retained in the current frozen private holdings schema. A date-only
label is shown in preview, while saved `sourceAsOf` remains unknown; import time is separate.
Cash that is not reported stays unknown, buying power is not inferred, and CAD/USD are never
combined without an explicit FX source. Unsupported assets/directions remain visible as exclusions.

## Local configuration and boundaries

See [.env.example](.env.example). Portfolio owner requests use the fixed same-origin prefix
`/api/private/portfolio` followed by the canonical `/api/v2/holdings/sources/...` path. An anonymous,
bounded `/api/private/owner-config` response exposes only schema version and feature booleans.
The Hub owner prefix is `/api/private/agent-hub` followed by an explicitly allowed canonical
`/api/v2/...` path. Each target is independently disabled when its configuration is unavailable,
without delaying Google login or Markets. The public capability response contains no origins,
credentials or private configuration.

Portfolio uses the existing REPO-002 **server runtime** projection:
`FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID`, `FOLIOVIEW_PORTFOLIO_OWNER_ENABLED`,
`FOLIOVIEW_PORTFOLIO_ORIGIN`, and `FOLIOVIEW_PORTFOLIO_AUDIENCE`. The flag must be `true`, the
origin must be a canonical `portfolio-api-{projectNumber}.{region}.run.app` HTTPS origin, and the
audience must match it exactly. These are not public build arguments. A deployed browser ignores
`NEXT_PUBLIC_PORTFOLIO_API_BASE_URL`; its direct-API exception is restricted to `next dev` with
both a loopback page and loopback HTTP(S) API for the existing local CSV acceptance setup.

Hub uses `FOLIOVIEW_HUB_OWNER_ENABLED=true` and `FOLIOVIEW_HUB_ORIGIN` with the same server-only
Firebase project setting. Its fixed origin must be a canonical
`agent-hub-api-{projectNumber}.{region}.run.app` HTTPS origin. Hub forwarding adds no metadata or
workload identity token: public Hub retains authoritative Firebase revocation and owner checks.
The independent Portfolio capability and its private IAM flow remain intact. Deployed browsers
ignore both legacy `NEXT_PUBLIC_*_API_BASE_URL` values for these targets; the local exception is
restricted to `next dev` with a loopback page and a loopback HTTP(S) API. Missing values do not
fall back to Market, another target or a production direct connection. This code changes no cloud
configuration, IAM, invoker grants or resources; both rollout gates remain disabled by default.

The Node route verifies the original Firebase JWT against Google's fixed SecureToken JWKS,
including signature, configured project/issuer/audience, timestamps and Google provider. This
precheck does not replace either target's authoritative revoked-user, owner and encrypted-contract
validation. It needs no Firebase user-directory permission. Only for Portfolio,
after the precheck, Web uses its default runtime identity's fixed metadata endpoint to obtain a short-lived ID token for that
Portfolio audience. That service token goes only in `X-Serverless-Authorization`; the original
user `Authorization` reaches Portfolio unchanged. External service-identity headers and cookies
are stripped. No key file, browser service token, new cookie session or private content key is used.

The proxy only accepts named owner routes and their exact methods, body shapes and control
headers. Portfolio queries, encoded paths, internal/agent routes, caller-selected targets and
redirects are rejected. Actual streamed request sizes follow the existing 576 KiB snapshot, 65 KiB mutation
and 1 KiB authority limits; responses are bounded to 1 MiB. Duplicate JSON keys, excessive depth
and unsafe numbers are rejected. Valid ciphertext/signature bytes and operation identifiers are
forwarded unchanged, with no write retries. The total deadline is 12 seconds including bodies,
verification and identity fetches; each shared identity/key fetch has its own 4-second ceiling.
For each target, per-process admission is bounded to 16 requests, four active requests and 30 attempts per minute
per verified UID, with at most 1,024 tracked UID windows. These local bounds do not replace
separate deployment-wide cost controls. Only fixed formal application errors cross the boundary;
metadata/IAM/network/key-fetch failures become retryable service errors, not a user logout.

Hub forwarding covers owner vault enrollment/registry/source controls and authority tokens,
resource catalogue, encrypted tasks and versions/transitions, Inbox lists/counts/details/history/
proofs/state, connection listing/revocation and preparation intent/staging/commit. Only the named
list/history/detail queries (`limit`, `cursor`, `filter`, `taskId`, `revision`, `deliveryRevision`)
are allowed on their corresponding reads, with canonical numbers, duplicates/unknowns rejected and
no encoded path selection. Writes preserve only their required operation/author headers and exact
bounded original JSON. Hub state controls have the actual 65536-byte limit; preparation commit
is limited to 8192 bytes, and other writes never exceed 589824 bytes. Formal task/result responses
use existing shared schemas; custom Hub profiles retain closed top-level fields. The exact stage
descriptor and formal `ResultMetadata` state ACK have no `contractVersion` field in the current
producer and are passed unchanged only for those two named operations. Old state ACKs remain
original operation facts, not an implicit refresh of newer state.

All `/api/v2/agent-authorizations/...` browser-flow endpoints remain excluded: the existing Hub
protocol requires its own exact issuer Origin and `fv_oauth_flow` cookie. Web does not copy that
cookie, forge a Hub Origin or infer user approval. The separate owner-consent handoff is described
below.
OAuth, MCP, agent REST, discovery/JWKS, internal and helper URLs are never exposed through this
owner forwarder. Stripping browser-supplied identity/delegation headers does not make public Hub
private; its application authorization must also hold for direct clients.
Responses use `no-store` and never forward authentication headers, cookies or raw diagnostics.

The authenticated request client restricts each service's exact paths, methods, body fields and
contract headers, rejects arbitrary destinations and identity-header overrides, and fences late
responses when an account changes. Bodies, bearer/delegation tokens, PRF output and private keys
are not placed in URLs, localStorage, analytics or error messages.

## Private agent Inbox

Inbox is an additional bottom-sidebar view; Markets remains the default. Resources and Inbox
share one mounted owner workspace, Passkey unlock and terminated-on-lock crypto Worker. Inbox
needs only the independent Hub capability, so it works without a configured Portfolio target.
Sign out, account changes, lock and lost capabilities hide private content in the same render,
clear the search/decryption cache and invalidate late network bodies, crypto replies and actions.

Lists, counts and history contain bounded approved metadata. Opening a result locally verifies
the pinned root, full selected registry chain, signed agent grant, original Run/manifest, receipt,
carrier, recipient and AEAD before returning private content. Historical verification uses the
selected acceptance time and retained recovery keys; later key/agent expiry does not rewrite
history. A narrow historical unlock does not authorize current state writes. A new device can
use the existing Passkey enrollment flow to enable changes, including on a Hub-only instance.

Read, star and archive are logical result state across revisions. A latest successful authenticated
opening can mark its exact body read; opening an old revision does not mark the latest report read.
Writes use the current device and directory, a signed stateVersion CAS and a fresh stable operation.
There is no automatic write retry or replacement signing after conflict. A lost response retains
the original in-memory packet for explicit replay; the original acknowledgement is confirmed
against fresh metadata before displaying current flags. Lock/logout discards that local retry;
the next owner read retrieves the authoritative logical state.

The visible Inbox polls metadata once per minute only while active and visible. It loads at most
100 metadata rows,32 historical revisions and20 exact authenticated decrypted deliveries. Search
only covers opened reports in the currently loaded view; no private text or plaintext index reaches
the backend, URLs, logs or persistent browser storage. Counts are server snapshots from the last
refresh. Navigation back from a detail preserves list filters and scroll. A changed cursor requires
refresh rather than mixing snapshots or silently re-running old state commands.

The report viewer renders a small React-text Markdown subset with no HTML parsing, images or
automatic linked-page fetching. Links require credential-free HTTPS; citation/model conclusions
remain agent provided. Clipboard export requires a separate explicit plaintext warning. Frozen
input versions stay attached to the selected historical report, without claiming every input was
considered or the platform verified the analysis. Existing published-client trust limitations apply.

Result and revision bookmarks use the closed fragment
`#inbox/result/<resultId>[/revisions/<revision>]`. They contain opaque protocol identifiers only,
never report text, owner identifiers or credentials, and fragments are not sent to the Web server.
Opening a link still requires the current owner's login, unlocked workspace and the normal
receipt/grant/ciphertext verification. An explicit revision preserves historical reading without
marking the latest report read. A pending locked link waits for unlock; signing out or switching
accounts clears the previous session's navigation intent. Muse consent handoffs take precedence.

No cloud setting, IAM grant, database or resource is enabled by this UI change. Real remote Muse
host attachment, production activation and device acceptance keep their existing scope.

## Full journey regression

`npm run test:web` includes three complementary synthetic integration layers:

- `full-flow-crypto.test.cjs` runs the real CSV parser, both task templates, three resource types,
  owner grants, released helper, frozen Run, encrypted reports/revisions and owner decryption.
  It checks cross-owner/agent isolation, explicit CSV limitations, revocation, original ciphertext
  replay and Passkey-material restoration using actual WebCrypto. Passkey input and producer
  metadata are fixtures, not a device authenticator or a live provider.
- `full-flow-boundaries.test.cjs` joins the real AuthProvider, Next route exports and both owner
  forwarders with signed synthetic Firebase tokens and controlled upstream responses. It checks
  identity separation, exact signed bytes, fault recovery and disabled capabilities. It does not
  replace authoritative backend ownership checks or production Cloud Run IAM acceptance.
- `full-flow-workspace.test.cjs` exercises cross-view navigation, result links, session masking
  and Market behavior with real page/Inbox logic and explicit browser/network test facades.

The fixtures are test-only and introduce no demo authentication mode, production bypass, model
call, brokerage synchronization, new service or cloud configuration. Existing backend integration
tests remain part of the root check. Native browser/device, real Muse and production acceptance
are recorded separately from these synthetic checks.

## Validation

Run `npm run test:web`, `npm run typecheck:web`, `npm run build:web` and root `npm run check`.
Tests cover synthetic CSV edge cases, precise decimal/currency handling, actual WebCrypto/JOSE,
formal schema identity, Native IndexedDB-style cross-tab transactions, Passkey UV/PRF requirements,
owner/session races, exact replay/receipt recovery, and React text escaping. The extra Node/Python
interoperability case runs when the repository Python environment is available and otherwise
explicitly skips; pure browser-crypto tests remain mandatory. Physical Passkey providers and real
Google login are separate device acceptance, not claimed by synthetic mocks.

## Private task editor

Tasks is an additional bottom-sidebar view; Markets remains the default. It uses the same owner
workspace and Passkey Worker as Resources and Inbox, with Hub-only capability support. Brief and
custom templates edit private goals, output sections, language and delivery expectations on the
device. The existing unified catalogue supplies holdings, watchlist and YouTube references; a
watchlist task needs no broker connection. A selected source is discovery metadata, not evidence
that agent-encrypted inputs are already prepared or access has been granted.

Drafts, including incomplete rules, are PRF-sealed in IndexedDB with owner, vault, task and base
version binding and atomic cross-tab revision checks. The server receives only the existing signed
envelope, opaque bindings and approved metadata. Local preview checks resource requirements and
rule semantics before explicit save. Source scope, key epoch and recipient changes receive
separate confirmation from ordinary edits. New writes use the current registered device and
exact owner device/recovery recipients; saving never silently expands an agent grant.

Task versions are immutable. Explicit pause/resume/archive produces a newly signed encrypted
version and transition intent. Historical views verify the selected chain and writer at the
original time; a historical read does not enable current writes. On conflict the encrypted draft
remains, and the user can explicitly rebase it against a verified current head. A lost response
retains the original signed ciphertext operation durably; recovery resends that exact packet.
Stale keys refuse replay. A verified original acknowledgement is followed by a verified current
head before success is displayed; later failed refresh retains the retry packet and draft.

Lock, logout, hidden pages and owner/generation changes mask private editor state and invalidate
late work. No task plaintext, private key, PRF output or bearer token is written to URLs, localStorage
or logs. The published-client trust limits described above still apply: an operator able to
replace the client could change the code delivered to a user.

Expected delivery is a local time-zone-aware hint, not a provider schedule or evidence of a missed
run. Saving does not configure Muse, run a model or expose private rules through Config. Handoff
only copies an opaque task ID on explicit action; actual connection consent remains separate.
No cloud configuration, database migration or new resources are part of this change.

Resource cards can hand an opaque source reference and epoch to Tasks. The request is owner-scoped,
revalidated against the current catalogue, and requires a separate explicit start after unlock.
Unreviewed local drafts block edits and transitions until restored or explicitly discarded.
Recovered operations cannot delete a retained draft merely because its task ID matches; only a
reviewed current save clears its associated exact draft revision, and explicit discard uses CAS.

## Muse connections and owner consent

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
