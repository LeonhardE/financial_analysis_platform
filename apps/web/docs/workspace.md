# Workspace behavior

Routes, source handling and private views use one owner workspace. Persistent Agent behavior
is documented separately in [Agent integration](agent-integration.md).

## Workspace routes

`/` and `/market` both open Market. Resources, Tasks, Agents, Inbox and Settings have their own
`/resources`, `/tasks`, `/agents`, `/inbox` and `/settings` pages. Sidebar links support ordinary
navigation, copied/bookmarked URLs and opening another tab. Direct loads and refresh stay on the
selected page; unknown paths return the normal 404 rather than becoming Market.

The `(workspace)` layout keeps one `WorkspaceShell` mounted across these pages. It owns the
existing encrypted workspace and Market selection state, so internal navigation preserves the
current Worker/session. Supported browsers also retain one memory-only owner session across
reloads and same-account tabs. Logout, owner changes and explicit lock invalidate every connected
private view. Remembering a route does not persist private key material or replace authentication.

Automatic token refresh for the same verified Firebase SDK user revalidates the account without
replacing this owner session or interrupting current private requests and consent responses.
Each private request still obtains a current SDK token. Failed or timed-out account verification,
an authentication rejection, a different SDK user and explicit account retry invalidate the
previous session. This keeps normal credential rotation from causing another Passkey prompt
inside the workspace, across normal reloads and same-account tabs while the browser retains
the shared runtime. Reentry verifies the account and current vault, lifecycle and device authority
before exposing private content. New device rights still require explicit review.

### Unlock lifetime

A same-origin SharedWorker runs the existing closed crypto protocol. The broker only
routes the closed RPC protocol and public availability/lock notifications; it never exports keys.
Private handles and Passkey PRF output remain outside browser storage and cross-tab broadcasts.
A runtime-content/dependency fingerprint separates incompatible deployed worker scripts.

SharedWorker's browser-controlled extended lifetime provides bounded reload handoff; it is not
durable key storage or an unattended Agent runtime. Closing the browser process or losing the
worker ends the unlock. Unsupported browsers use the existing per-document dedicated Worker and
may require another unlock after reload. A changed runtime version starts a new memory session.
See the [HTML worker lifetime rules](https://html.spec.whatwg.org/multipage/workers.html#the-worker's-lifetime).

Legacy `#inbox/result/...` links normalize to `/inbox` while retaining the fragment. Existing
`agent_request`/`agent_nonce` handoffs normalize to `/agents` while retaining the query; this
handoff keeps its prior precedence over an Inbox fragment. Login stays on the selected path.

## Memory-only display reuse

Internal navigation preserves the mounted workspace, task editor/selection, sealed draft queue,
resource lists and Inbox filters/selection. It does not lock the Worker or cancel an Agent's native
work. Hidden documents, explicit lock, logout and owner/vault/generation changes clear private
display caches; reentry revalidates through the current Worker. Task names are reused only for the
exact verified task version/fingerprint. A changed background head makes the old editor read-only.

One owner workspace shares bounded LRUs:32 task names,100 legacy report heads,10 report payloads
with a16MiB accounted budget,and2 holdings payloads with a32MiB budget. Accounting includes UTF-8,
UTF-16 and conservative object/key overhead; it is not a browser heap measurement. No decrypted
content or keys are persisted by these caches. Existing encrypted drafts/outboxes remain unchanged.
Reports require fresh authority and exact authenticated record/evidence equality before skipping
decryption. Holdings selection can immediately show a previously verified exact source while its
current authority/head/lifecycle is checked; changed versions,epochs or revoked/deleted sources
invalidate reuse. Explicit refresh rereads and verifies stored ciphertext. Network failure can keep
previous display content with an update-failed state,while actionable authority metadata is cleared.

Only opted-in display GETs share in-flight transport,with per-subscriber cancellation,16 keys and8
subscribers per key. Responses are cloned for independent bounded body readers and are never kept
as a fulfilled network cache. Operation/permission checks and writes retain fresh transports and
existing signed-packet/CAS/acknowledgement rules. Route changes retain draft sealing in flight;
lock/identity/hidden boundaries still cancel it. Manual Run persistence/dispatch remains gated by the
later task/Run contracts and provider validation; this change creates no local Run or schedule.

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
   the current unlocked session; lock, logout or account change terminates the shared crypto
   Worker and clears private views in every connected document.

Google login establishes identity; it is not content-key derivation material. The system Passkey
PRF protects the cloud archive containing the owner's root/recovery keys. Browser device keys
are distinct and locally sealed, and runtime private key handles are nonextractable. Losing every
usable copy of the protecting Passkey can make the existing library unrecoverable by the platform.
Provider support and synchronization must be tested on each supported browser/device combination.

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

## Private task editor

Tasks is an additional bottom-sidebar view; Markets remains the default. It uses the same owner
workspace and Passkey Worker as Resources and Inbox, with Hub-only capability support. Brief and
custom templates edit private goals, output sections, language and delivery expectations on the
device. The existing unified catalogue supplies holdings, watchlist and YouTube references; a
watchlist task needs no broker connection. A selected source is discovery metadata, not evidence
that agent-encrypted inputs are already prepared or access has been granted.

Task-list and resource-catalogue reads publish independently. Each keeps its last successful
metadata during refresh or failure, displays its own loading/error state and offers a local retry.
A stale or refreshing catalogue cannot seed or select resources; saves still fetch current authority,
head and catalogue before sealing. Read failures do not replace the editor or successful task rows.
Brief non-actionable feedback expires after 4.5 seconds; refresh/reentry also clears old notices.
No new persistent cache is introduced here.

These two reads each have an 11.5-second browser budget covering token acquisition, response bodies
and backoff, inside the unchanged 12-second Web proxy limit. Hub reserves finalization time inside
its cooperative 10-second catalogue budget. A Web GET deadline adds only the fixed
`X-FolioView-Read-Failure: deadline` header to the existing closed error DTO; upstream headers cannot
forge it. Cancellation is silent, while timeout, pre-forward admission, service/network failure and
permission/session rejection have separate fixed UI messages. No server exception text is shown.
Only a GET rejected before forwarding with the existing safe-admission marker and exactly a
one-second retry hint may retry automatically, once, inside its original browser budget. Longer
hints, downstream failures and writes do not retry automatically. Write deadlines, exact signed
retry packets, idempotency and acknowledgement verification retain their existing behavior.

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

## Holdings lifecycle and recoverable changes

Resources provides explicit review and confirmation for invalidating previous source access,
disconnecting future use, and logically deleting a holdings source. Disconnect preserves unlocked
owner history; deletion hides it, including while acknowledgement is pending. Neither action recalls
already decrypted copies or claims physical erasure of retained ciphertext/backups. Reimporting after
a terminal action requires an explicitly created independent source; creation anchors retain the
existing ten-source limit. Source selection never silently reconnects an old source.

The controller reads Portfolio state before authority synchronization, so a locally advanced pending
fence remains recoverable while Hub still reports the old epoch. A request is not presented as
completed until its exact receipt is acknowledged and current state is reread. A remotely accepted
operation can resume with its owner-authenticated receipt even without a local retry packet.
Unknown state disables saving and access changes. Fresh account-scope comparisons require explicit
invalidation or independent data before changing the saved account set; invalidation retains the CSV
preview for a separate explicit save. Known revoking/terminal state cannot produce a new upload.

The Worker signs only closed source actions. Public creation/mutation packets are persisted before
network submission and replayed unchanged after interruption; no CSV, holdings plaintext or private
key is added to those records. Creation recovery reuses its original source ID and derived incarnation.
Same-source uploads and lifecycle packets stage atomically across tabs. Receipt verification and
local cleanup compare the full original row and respect account/session cancellation. Historical
signature verification permits recovery after renewal without granting old keys new signing rights.
Local cleanup of an unaccepted stale mutation requires a newer epoch or authority version and a
fresh missing receipt; stale creation cleanup requires a cryptographically advanced registry and
the complete current directory. These actions clear local public retry state, never server data.

The Portfolio owner bridge adds only the fixed source-operation synchronization POST with a closed
1 KiB body and exact acknowledged-response validation. Mutation and upload receipt reads accept the
full existing operation-ID alphabet; source and snapshot identifiers retain their own constraints.
No backend, shared contract, cloud permission, broker connection or Muse activation changes are
part of this Web delivery. Synthetic crypto/storage/controller checks and local responsive previews
remain separate from real Google/Passkey and cloud-workload lifecycle acceptance.
