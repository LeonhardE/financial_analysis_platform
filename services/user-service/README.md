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
change does not claim encrypted holdings or agent-ready resource projection,
and it does not introduce a second editable list in Hub. Resource initialization,
watchlist versioning and restricted metadata projections are separate follow-up
work.

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
