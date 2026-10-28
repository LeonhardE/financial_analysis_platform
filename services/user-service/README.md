# User service

User owns verified identity, stock watchlists, and manually maintained YouTube
channel follows. Channel follows use the existing User runtime/database and have
no video discovery, subtitles, YouTube OAuth, network fetch, or model inference.

## Manual channel follows

Both endpoints require a Firebase Google ID token. Ownership comes only from its
verified UID; callers cannot select another owner. All `/api/` responses,
including authentication, validation, and storage failures, use `Cache-Control:
no-store`. Existing watchlist routes and responses remain compatible.

- `GET /api/v1/channel-follows` returns `{revision, items, limit: 50}`. An absent
  list returns revision `0` and empty items, with no initialization/write.
- `PUT /api/v1/channel-follows` replaces the whole list using
  `{expectedRevision, items: [{name, handleOrUrl, note}]}`. Revision mismatches
  return `409 version_conflict`. The request body is bounded to 128 KiB before
  JSON parsing and a five-second total read deadline; duplicate JSON keys, extra owner/ID fields, and more than 50
  channels are rejected.

Names are 1–120 characters and notes 0–1000 characters. Locators accept only ASCII
`@handle` or `https://[www.]youtube.com/@handle`, with 1–64 ASCII handle
characters from letters, digits, `_`, `.`, and `-`. Responses normalize locators
to `https://www.youtube.com/@<lowercase-handle>`. This validates syntax, not the
existence or ownership of a YouTube channel. Every entry is marked
`verification: "user_provided"`.

Equivalent locator spellings or input reordering do not change revision or write
storage. Editing name/note retains `followId` and `addedAt`; deleting and later
readding a channel allocates new identity/time. Responses sort by `addedAt`, then
`followId`. A stale revision is rejected even when submitted content is equal.

New route errors use `{error: {code, message, requestId, retryable}}`, with bounded
fixed diagnostics. Existing routes retain their established error format.

## Storage and configuration

Cloud Run uses `USER_STORE_BACKEND=firestore`, `FIREBASE_PROJECT_ID` (or
`GOOGLE_CLOUD_PROJECT`) and `FIRESTORE_DATABASE`. No service-account key is needed.
Cloud Run refuses SQLite or Auth/Firestore emulator configuration. Client objects
may be reused, but user responses are never cached.

Local development can use `USER_STORE_BACKEND=sqlite`. Optional
`CHANNEL_FOLLOWS_DB_PATH` overrides the local path; otherwise the service reuses
`WATCHLIST_DB_PATH` with separate tables. See [.env.example](.env.example). The
application does not automatically load env files.

`user_channel_follows` stores the one mutable list. A separate
`user_resource_versions` record stores its resource reference/incarnation,
revision, source epoch, internal content digest and update time. Both records
commit in one transaction in SQLite and Firestore. No-op mutations write
neither. Reads use a consistent view and reject missing/corrupt/mismatched pairs
rather than repairing or overwriting them. The digest is an internal consistency
guard, not a public projection or confidentiality guarantee.

These user-maintained lists remain in User's existing plaintext domain. This
change does not claim encrypted holdings or agent-readable list content,
and it does not introduce a second editable list in Hub. The resource interfaces
below supply version and authorization metadata only.

## Verification

Run the service suite in a development environment with its dependencies and the
shared package available:

```sh
PYTHONPATH=services/common:services/user-service python -m unittest discover -s services/user-service/tests -v
```

Tests use synthetic identities and temporary local storage or mocked Firestore;
no real account, YouTube request, or cloud resource is used. Coverage includes
owner isolation, exact retries/no-ops, competing revisions, atomic rollback,
corruption/missing metadata, locator limits, body budgets and private errors.

## Resource versions and initialization

Watchlist writes now maintain a separate `user_resource_versions` record in the
same transaction as actual list changes. The existing watchlist wire response is
unchanged. Duplicate adds, missing deletes and GET requests do not initialize or
advance versions. A real mutation of an unversioned list establishes revision 1
for the new content; untouched legacy lists remain explicitly uninitialized.

`POST /api/v1/resource-initializations` accepts `{kind, operationKey}` for
`watchlist` or `channel_follows`, authenticated with the owner's Firebase token.
It preserves existing items and added times, creates a stable source reference
and incarnation, and starts at revision 1 for nonempty or 0 for empty lists. An
already initialized source never resets its identity, revision or source epoch.
Inconsistent metadata/content cannot be repaired by calling initialization.

Initialization operations are namespaced by owner and kind, with at most 32
receipts in one aggregate record. Retrying an existing operation returns its
original metadata result, after current content integrity and source epoch are
checked, even when the budget is full. A new key at capacity returns a fixed 409
with no writes; callers must reuse an existing operation key. No receipt query,
per-operation document growth, TTL or additional cloud resource is introduced.

For local development, list APIs and resource APIs must share one SQLite file.
`CHANNEL_FOLLOWS_DB_PATH`, when set, must match `WATCHLIST_DB_PATH`; resource APIs
fail closed on split files instead of creating a second mutable copy. Cloud Run
continues using the existing configured User database and runtime identity.

## Internal v2 metadata only

The following interfaces are separate from frozen v1 plaintext projections:

- `GET /internal/v2/resources/catalogue` lists only signed-authorized source
  kinds; optional `?kind=watchlist` or `?kind=channel_follows` narrows that set.
- `POST /internal/v2/resources/projections/read` takes
  `{contractVersion, refs}` and returns source reference/state/revision/epoch
  metadata. There are at most two refs, one per source kind.
- `POST /internal/v2/resources/states/read` uses the same request shape and reads
  current source revision/epoch on every request.

All require `X-FolioView-Contract: folioview.agent-workspace.v2.0` and both a signed
Google workload token in `Authorization: Bearer ...` and a Hub-issued signed
`X-FolioView-Delegation` token. The delegated purpose must be `browser_catalog`
with `resources:catalog` and the selected kinds. Owner partition comes only from
the signed delegation; unknown/foreign refs and stale incarnations share the
same 404. These endpoints reject `agent_run`, Firebase user tokens, arbitrary
owner selectors, unknown query fields and v1 contracts; no plaintext fallback is
implemented. They return no list items, titles, ticker symbols, counts or
low-entropy content digests. Trusted clients still read their own User lists to
form encrypted Run evidence.

Production trust is disabled unless every explicit setting is valid:

| Setting                    | Purpose                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `USER_SERVICE_AUDIENCE`    | This service's trusted Google workload-token audience                                           |
| `USER_DELEGATION_AUDIENCE` | Exactly that audience plus `/internal/v2`                                                       |
| `USER_DELEGATION_ISSUER`   | Trusted Hub HTTPS origin; its fixed `/.well-known/jwks.json` supplies public verification keys  |
| `USER_TRUSTED_HUB_CALLERS` | JSON mapping of pinned numeric service-account IDs to their exact emails, maximum eight callers |

Missing/invalid configuration returns a fixed 503; health and existing private
list routes remain available. Public keys may be cached by the shared verifier,
but source state and authorization results are not cached. INF-007 must
separately configure actual cloud trust; no production caller was enabled here.
Run/source-fence consumers remain subsequent Hub work, not simulated by trusting
self-reported Run claims.

V2 failures use the shared closed `{contractVersion, error: {code, retryable,
requestId}}` contract with no diagnostic message. Raw writes are limited to
128 KiB and a five-second total read deadline. Malformed/slow v2 requests map to
`400 malformed_request`; auth failures use the shared codes. Unknown v2 paths,
method errors and CORS denials receive the same closed framing and `no-store`.
Legacy User routes retain their existing success/error shapes.
