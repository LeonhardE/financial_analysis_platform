# Workspace behavior

Routes, source handling and private views use one owner workspace. Persistent Agent behavior
is documented separately in [Agent integration](agent-integration.md).

## Workspace routes

`/` and `/market` both open Market. Resources, Task Center, Agent Management and Settings use
`/resources`, `/tasks`, `/agents` and `/settings`. The retained `/inbox` route opens Task Center. Sidebar links support ordinary
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

## Shared layout and feedback

The shell and sidebar keep their DOM during navigation, including Settings. A single account-area
Lock action replaces the full-width unlock banner and repeated page controls. Agent navigation is
labelled Agent management. Holdings lifecycle actions and device/key controls use native expandable
sections; pending device/archive/renewal conditions remain visible or open automatically.

Reads taking more than150ms show a localized spinner and an initial skeleton, without invented
percentages. Existing content stays visible while refreshing; failed first loads offer retry rather
than empty-state copy. Unread counts use red corner badges and unread rows use a soft dot. Persistent
reports mark read only after verified opening and a signed state acknowledgement; lost replies keep
the original retry command available even after the report dialog closes. No automatic write retry
or replacement signing is added, and older acknowledgements cannot roll back newer loaded state.

Both report readers use one native modal with a keyboard trap,Escape/backdrop dismissal and focus
restoration without scrolling. User closure animates160ms; lock,hidden/route or identity changes
remove private modal content immediately. New selections cancel an older exit. Sidebar transitions
use240ms,views180ms,buttons100ms,loaded content140ms and report entry200ms. Animation never gates data
publication;system reduced-motion disables movement/loops and closes without an animation timer.
The RunIndicator primitive accepts only a real Agent waiting/running state; owner HTTP activity is
never presented as an Agent Run. Task-center Run wiring remains with HUB-028/WEB-022 after their
contract/provider gates. No new connection migration or manual dispatch is enabled here.

## Memory-only display reuse

Internal navigation preserves the mounted workspace, task editor/selection, sealed draft queue,
resource lists and Inbox filters/selection. It does not lock the Worker or cancel an Agent's native
work. Hidden documents, explicit lock, logout and owner/vault/generation changes clear private
display caches; reentry revalidates through the current Worker. Task names are reused only for the
exact verified task version/fingerprint. A changed background head makes the old editor read-only.

One owner workspace shares bounded LRUs:32 task names,100 legacy report heads,10 report payloads
with a16MiB accounted budget,and2 holdings payloads with a32MiB budget. Two source-scoped valuation
sets share a4MiB accounted budget and are cleared by the same private-session boundary. Accounting includes UTF-8,
UTF-16 and conservative object/key overhead; it is not a browser heap measurement. No decrypted
content or keys are persisted by these caches. Existing encrypted drafts/outboxes remain unchanged.
Reports require fresh authority and exact authenticated record/evidence equality before skipping
decryption. Holdings selection can immediately show a previously verified exact source while its
current authority/head/lifecycle is checked; changed versions,epochs or revoked/deleted sources
invalidate reuse. Explicit refresh rereads and verifies stored ciphertext. Network failure can keep
previous display content with an update-failed state,while actionable authority metadata is cleared.

Task list names use the Owner-only packet query in batches of at most four tasks and two workers.
For32 ordinary packets this takes eight requests, while every packet still passes the existing
Worker verification/decryption and exact full metadata match. A verified name can appear before
another item finishes. Missing, stale or malformed entries stay unavailable; exact remaining-ID
suffixes must shrink, and one item failure cannot relabel another task. Queue ownership survives
metadata refresh without creating extra workers; owner/unlock/hidden/deletion guards remain.
No task editor, draft, grant or command is created by this display work. The existing proxy
request budget remains unchanged, and read-only batch POSTs share the same two-transport pool.

Only opted-in display GETs share in-flight transport,with per-subscriber cancellation,16 keys and8
subscribers per key. Responses are cloned for independent bounded body readers and are never kept
as a fulfilled network cache. Operation/permission checks and writes retain fresh transports and
existing signed-packet/CAS/acknowledgement rules. Route changes retain draft sealing in flight;
lock/identity/hidden boundaries still cancel it. Manual Run persistence/dispatch remains gated by the
later task/Run contracts and provider validation; this change creates no local Run or schedule.

## Resource library

Resources presents holdings, the existing Market watchlist, and a manually maintained YouTube
creator list in three tabs. The watchlist reuses the shell's Market controller and existing
User `/api/v1/watchlist`; add/remove acts on that same list without a duplicate list read. Rows carry no
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
creates no task automatically. Current-source changes do not rewrite historical task/Run evidence. The holdings settings dialog
uses the same Task Center handoff; it never grants access automatically.

Reads enforce actual streamed response limits and deadlines, and never cache private rows in
browser storage. Reentry from Market, tab visibility restoration, creator saves and holdings
snapshot changes refresh the relevant source metadata. Account changes/logout mask rows during
render, abort old fetch/body reads, clear editor drafts and reject stale callbacks. A conflict,
malformed response or uncertain write requires explicit successful reload before another save;
there is no automatic write retry and the local draft remains available for review.

### Holdings names and settings

The compact holdings selector displays an Owner-only encrypted alias or the existing numbered
fallback, plus the import source and loaded timestamp. Data settings opens the shared animated,
keyboard-accessible dialog: rename, update CSV, use in task, verified related task titles, sharing,
and folded access/deletion controls with their existing impact confirmation. Unsupported broker
adapters and the page-wide resource-version explanations are omitted.

Aliases use `folioview.private-display-name.v1` through the fixed Owner-only v3 display-name routes.
The Worker verifies the pinned Root, full source reference/incarnation, original registry checkpoint,
Owner signature, original operation fingerprint and JWE context before displaying a name. Names
are encrypted for the existing Owner recovery recipient; Agent grants, financial versions, source
epochs, historical task bindings and registry history do not change. The browser cannot supply an
unwrapped key or arbitrary upstream route.

A rename seals its original packet into the existing local encrypted storage before submission.
An uncertain result blocks a second candidate. Original-receipt lookup or replay clears it only
after Worker verification. A separate, confirmed Resume editing action first checks that original
result; if absent, it clears only the sealed local retry, explicitly warning that an already sent
request may still complete. It does not cancel a server operation; the next rename uses fresh
current-state CAS. A fresh current read follows recovery so
an older original receipt cannot relabel a newer name. Display names live only in memory, scoped
to Owner/vault/Root/unlock generation/visibility, bounded to ten sources; 30-second display reuse
avoids reloading names on every navigation. Authority used for writes is freshly checked.

## Import and privacy behavior

1. Sign in with the existing Google/Firebase flow.
2. Create or unlock the system-managed Passkey that protects the encrypted owner archive. There
   is no manual key file or additional password fallback. Unsupported PRF capabilities fail closed.
3. Choose or drop one holdings CSV (up to 4 MB). Both paths use the same importer. Parsing,
   decimal/currency checks, preview and account selection happen
   in the browser. The original file is not uploaded.
4. Optionally name the first import and confirm the selected holdings. Source creation and its
   original receipt precede naming; a failed name confirmation stops the financial upload without
   creating a second source. Cancelling the preview does not upload it. A Worker produces the exact formal v2.0/P1 JWE/JWS carrier;
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

New imports retain selected account labels, stocks/ETFs, exact decimal quantities, native currencies,
native book costs and their derived unit costs, reported prices/values/returns, and conservatively
verified reported cash in the additive holdings-facts profile. An available MIC is retained;
unresolved markets remain unknown. CAD book cost is separate and never treated as USD book cost.
A date-only report label is retained separately from import time; saved `sourceAsOf` remains unknown.
Cash that is not reported stays unknown, buying power is not inferred, and CAD/USD are never
combined without an explicit FX source. Unsupported assets/directions remain visible as exclusions.

### Manual holdings and edits

The resource view can add a position or edit an existing imported position with ticker, quantity,
unit cost and native currency. Ticker lookup uses the public Market instrument search with only
the entered query. Multiple or incomplete matches require an explicit market selection. A retained
legacy position with unknown market/cost may keep that identity; editing never invents its cost.
Multiple accounts stay separate. Zero quantity requires explicit removal confirmation.

Edits are local until the owner reviews and saves the resulting holdings. Reimports offer replacement
or merge; replacement requires consent before overwriting manual values, while merge preserves
manual values by default. New ciphertext snapshots retain per-field import/manual provenance and
the previous snapshot reference. Existing historical snapshots and pinned task inputs are unchanged.
Saving as independent data uses only the selected new import, without copying the prior manual edits.

Saving checks the same owner/unlock generation, source incarnation, authority version and current
snapshot revision before sealing. The existing exact sealed outbox is replayed unchanged after an
uncertain write; edits never bypass source invalidation, signature, AAD or current-permission checks.
No plaintext holdings draft is persisted. The shared profile enforces the existing 192,512-byte
plaintext limit and at most 1,000 positions; number inputs use exact bounded decimal arithmetic.

Legacy payload readers remain supported. The additive profile uses the typed P2 browser validator
and the typed P1 owner publication path supported by SDK 1.3.0. Updating a saved position does not
automatically reshare it with an Agent. Native Agent hosts must be reviewed and upgraded before
acceptance with new-profile inputs; deployment alone does not upgrade those hosts.

### Holdings valuation and allocation

Saved holdings show securities value, item values and weights in the default portfolio currency.
The selector offers exactly that default followed by native position currencies in the selected
source. A temporary choice never changes the saved facts or account setting; changing the default
or source resets an invalid choice. Stock-market quote pages keep their native currency.

Public price requests contain only canonical instruments or currency pairs, without holdings
quantities, account/source identifiers, unit costs or credentials. Quote cache reads use batches of
50 and at most two concurrent transports. One refresh pass is bounded to four groups of four
instruments, within the producer's existing quotas; large/cold sources may remain partially priced.
Explicit refresh checks the server cache again and can update remaining missing rows. There is no
unbounded refresh loop, new worker, background timer, higher quota or paid subscription.

One Bank of Canada daily-reference observation supplies CAD legs for native/default currencies.
All display crosses are derived locally from that observation. Changing display currency therefore
does not reread ciphertext or fetch another FX date. Exact decimal arithmetic calculates quantity,
price, conversion, portfolio totals and the common allocation denominator; rounding happens only
for display. Native per-unit prices and recorded costs retain their original currency and precision.

Missing quotes/FX remain unknown and show a priced subtotal with N/M coverage. Weights and both
charts use that same securities subtotal; reported cash, including signed or unknown balances, is
separate. Older quotes/reference rates are identified, and failed refreshes retain dated values
with an error rather than replacing them with zero. Source dates and attribution live in a closed
details section. Daily reference FX is not advertised as real-time or as an execution rate.

The animated allocation dialog switches between accessible pie/bar views without network work.
Dense legends group the tail after eleven positions while the table retains every position. Tiny,
zero and unpriced rows have explicit displays. Narrow tables scroll internally with the security
column retained. The valuation module loads only after the saved private view is visited; leaving
the resource page aborts pending price requests while retaining the view and scoped memory.

Revisits reuse bounded owner/unlock/source-version memory and valid temporary currency selections.
Price reads are revalidated after60 seconds, with explicit refresh available immediately.
Lock, hidden-document clearing, logout and owner/vault/generation changes
drop these display sets. They grant no write authority and never reshare Agent inputs. This is a
code/cache policy, not proof of a production latency target; cold/warm/provider timing requires
the separately authorized acceptance window.

### Followed FX and the Market layout

The Market page places followed exchange rates below the radar. A non-USD default currency derives
one USD/default pair; USD derives none. Manual pairs remain when the default changes. Dismissing
the automatic pair is remembered for that default/generation; a changed default starts a new
context. A manually followed pair matching the default stays manual, and removing it also dismisses
the current automatic equivalent. An older action cannot erase a newer context's dismissal.

Manual follows use the existing authenticated User store with at most12 pairs. The automatic entry
can make13 displayed pairs; one public batch remains within the existing20-pair producer bound.
The browser derives the default without a Config-to-User RPC. Preferences and rates load separately
from stocks, and neither changes an individual stock's native price currency.

Confirmed preferences survive internal navigation in account-scoped memory. Reentry/foreground
restoration revalidates metadata after60 seconds without clearing existing rows; there is no polling
timer. Explicit refresh checks the saved follows/default and rates. Config display refreshes are
read-only and cannot resume an uncertain settings mutation. Account changes mask old data before
effects run; uncertain FX writes are read back before another CAS, and conflicting add/remove
intents rebase on the latest pairs rather than overwriting another device's work.

Public FX requests contain currency pairs only, without credentials or portfolio facts. A small
reader validates closed fields, dates, requested identities and exact CAD reference-rate routes,
without loading private crypto. One cache read may be followed by one bounded refresh; failed or
older responses retain dated stale values. Checking authentication/preferences does not invent a
guest, empty list or default. Source/date/staleness remain visible and daily reference rates are
never described as real-time. Bank of Canada supplies these rates without a paid subscription.

Desktop radar and FX cards share the entire left quote panel height, including expanded details.
Only each list scrolls; search, actions and source footer stay outside those regions. The existing
watchlist's inner scroll is removed only inside the radar. Narrow screens stack quote/radar/FX,
with capped card heights and keyboard-focusable lists. Reduced-motion mode removes row animation.

## Private agent Inbox

Results now live in each Task Center detail, grouped by their actual historical
Agent connection. Removing an executor does not remove its history. The sidebar
has no separate Inbox or foreground-report section. `/inbox` and the existing
result/revision fragments resolve to the owning task and open its report dialog.
Unsaved task edits take precedence over a pending deep link.

Persistent and original foreground ciphertext retain their separate verification
adapters and original evidence. The Worker verifies the pinned root, registry,
Run/manifest/receipt, recipient and AEAD before returning report text. Historical
revisions remain read only; old scheduling claims display Unknown unless the
producer supplies verified trigger provenance. Current assignment does not infer
which Agent produced a historical report.

Metadata loads independently with visible progress, bounded pagination and local
retry. Loaded unread counts show a lower bound until all pages are loaded.
Title verification preloads visible rows through a three-item pool without marking
reports read. Bodies use the owner/vault/generation scoped memory-only LRU
(10 reports, 16 MiB); metadata/title indexes are bounded to 2,048 resident rows.
List filters, selected row and scroll survive internal navigation. All private
content is hidden on lock/account/generation/visibility changes, and task deletion
invalidates open reports across same-root tabs. An explicit fresh ordinary-task
read precedes displaying a cached report.

Only a successfully presented current report may request its signed read-state CAS.
Prefetching, failed verification, historical reading and hidden dialogs cannot mark
it read. State changes retain the exact original signed packet after an unknown
response; explicit retry replays it rather than creating a replacement operation.
Conflicts require fresh metadata. Star/archive remain available within the dialog;
opening an old revision does not mark the latest revision read.

Background and fresh private reads share a two-transport queue, preserving distinct
fresh authority requests. Only opted-in display GETs coalesce; writes never do.
Queued cancellation cannot dispatch a late request after account change. Task-center
and provider route tables are shared by the browser boundary and server proxy.

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

### Task center

The unlocked task view shows verified private names with a three-item decryption
pool and a version/scoped memory cache. Name loading does not select the editor or
create a draft. Each failed name can be retried independently. Safe metadata
revisits reuse their brief display cache; writes still fetch fresh authority.

The editor uses Goal → Resources and execution → Review. Advanced output options
stay collapsed. Optional Hub capabilities enable zero or more provider assignments,
Manual/Scheduled modes, user-selected days/time/IANA zone, task-local manual
requests, and Trash/restore. Schedule previews skip DST gaps and choose the first
fold occurrence. An Agent-reported enabled plan is distinct from a proven native
schedule or a completed Run. Existing rollout gates remain unchanged.

Root-bound controls are signed only in the Worker and sealed into a separate
IndexedDB outbox before transport. Unknown saves retrieve the original receipt,
replay the identical request, or explicitly cancel a never-submitted operation
using the Hub's atomic fingerprint fence. Committed operations cannot be undone by
that recovery action. Task deletion and restore leave old assignments inert.
Manual requests select one or more current executors, survive navigation and
reload, and display actual pickup/Run/result stages. Explicit copy-to-Agent
continuation is offered while waiting; this release does not claim automatic
native dispatch. No production migration or online acceptance is performed.
