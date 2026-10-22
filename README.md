# Financial Analysis Platform

A monorepo for a US-stock watchlist and portfolio risk tracking product.

The MVP shows daily market data through yfinance in Lightweight Charts. Anonymous visitors can
browse the S&P 500, Nasdaq Composite, Dow Jones Industrial Average and Magnificent Seven, or search
for other US stocks. Optional Google sign-in uses Firebase Authentication, with the API independently
verifying identity before returning a profile. Signed-in users can save a personal watchlist that
survives refreshes and sign-in on another device. YouTube summaries remain planned follow-up work.

## Repository structure

```text
apps/
  web/                         Next.js web client
services/
  market-data-service/         FastAPI market data and identity API
infra/gcp/                     Cloud Build deployment configurations and release guard
.github/workflows/             Pull request quality checks
changelog/                     One Markdown record per material tracked change
```

## Local setup

Use Node.js 24.12 or newer and Python 3.13. Install the web workspace and repository tooling:

```bash
npm install
```

Create the Python environment and install the API dependencies:

```bash
python3 -m venv services/market-data-service/.venv
services/market-data-service/.venv/bin/pip install \
  -r services/market-data-service/requirements-dev.txt
```

Start the API:

```bash
cd services/market-data-service
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Start the web client from another terminal:

```bash
npm run dev:web
```

The web client runs at `http://localhost:3000`; API documentation is at `http://localhost:8000/docs`.
The default data source is yfinance, with a persistent local SQLite cache; Firebase configuration is
optional for anonymous browsing. To work offline with fictional fixtures, explicitly set
`MARKET_DATA_SOURCE=mock` in the API process. The page labels this mode as mock data. Real-data
failures never fall back to fictional prices.

## Daily market data and caching

The API fetches adjusted daily OHLCV from Yahoo Finance using yfinance. It uses the actual index
symbols `^GSPC`, `^IXIC` and `^DJI`, with public IDs `SPX`, `IXIC` and `DJI`. Index levels display as
points; stocks display in USD. The daily percentage change compares the latest bar with the previous
trading day's bar. Historical OHLC is adjusted for splits and dividends.

The latest daily bar can still change during a trading session. The page includes the trading date,
fetch time and a partial-session indicator; it does not promise exchange-grade real-time prices.
Failed refreshes may serve previously fetched data with a stale warning. Without usable cached data,
prices are unavailable and the chart offers a retry.

Cloud Run uses Firestore for shared cached data, refresh leases and an atomic daily upstream budget.
This preserves cache contents and limits across cold starts and multiple instances. Create a
**Standard edition, Native mode** Firestore database named `(default)` in the API's region. Keep
browser Security Rules in production mode (deny all reads and writes); only the API server accesses
the database using its attached identity. Grant the API runtime **Cloud Datastore User**
(`roles/datastore.user`). The browser and web runtime need no Firestore access. No service-account
key is required. Cloud Run refuses to fetch upstream data if its shared cache is unavailable.

The API does not automatically load `.env` files. Set its environment directly, or use Uvicorn's
`--env-file .env` option locally. Relevant settings are:

| Variable                      | Default                                      | Purpose                                                         |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `MARKET_DATA_SOURCE`          | `yfinance`                                   | Real daily data; explicit `mock` enables fixtures.              |
| `MARKET_CACHE_BACKEND`        | `firestore` on Cloud Run, otherwise `sqlite` | Shared production storage or local file storage.                |
| `MARKET_CACHE_PATH`           | `/tmp/financial-analysis/market.sqlite3`     | Local SQLite file only.                                         |
| `MARKET_FIRESTORE_DATABASE`   | `(default)`                                  | Firestore database ID.                                          |
| `MARKET_CACHE_TTL_SECONDS`    | `3600`                                       | Cache reuse during trading hours; bounded to 900–86400 seconds. |
| `MARKET_UPSTREAM_DAILY_LIMIT` | `200`                                        | Shared refresh units per UTC day; bounded to 10–1000.           |

A ten-instrument batch consumes ten refresh units; a search or additional-stock refresh consumes
one. Units describe application work, not an exact count of Yahoo HTTP requests. A second shared
limit allows 20 units per minute. Unavailable refreshes cool down for five minutes, or fifteen minutes
for detected provider rate limits. Off-hours reuse can extend until the next weekday at 09:35 New
York time; this approximation does not include an exchange holiday calendar. There is no automatic
polling or paid scheduler. Cached data is usable for up to seven days; this age limit does not delete
stored documents or enable paid TTL deletion.

Local development uses SQLite without Google credentials. The upstream budget limits provider work,
not total Google Cloud charges; public HTTP traffic, database access and Cloud Run usage remain
billable under their own quotas. Keep minimum instances at zero, maximum instances small, and
optional Firestore TTL deletion, backups and point-in-time recovery disabled for this phase.

yfinance is an unofficial Yahoo client intended for personal research. See its
[maintainer documentation](https://github.com/ranaroussi/yfinance) for data-use terms. It requires no
paid stock-data subscription or API key. Cloud IPs may be rate limited; test actual Cloud Run access
after deployment, and retain the explicit unavailable/stale states if that occurs.

## Google sign-in configuration

Add Firebase to the existing Google Cloud project, enable the Google sign-in provider, register a
Firebase Web app, and add your frontend hostname to Authentication's authorized domains. Ensure
`localhost` is listed when testing locally, adding it if absent. No Firebase Hosting deployment is needed.

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in all four public Firebase values from
that Web app's configuration: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
`NEXT_PUBLIC_FIREBASE_PROJECT_ID`, and `NEXT_PUBLIC_FIREBASE_APP_ID`. Keep `authDomain` exactly as
Firebase provides it; it is separate from the frontend's authorized hostname. Leaving all four empty
keeps anonymous browsing available with sign-in unavailable. Restart local Next.js after changes.

Set `FIREBASE_PROJECT_ID` in the API process to the same Firebase project ID. The API uses Application
Default Credentials (ADC); on Cloud Run, use its attached runtime service account. Grant that account
**Firebase Authentication Viewer** (`roles/firebaseauth.viewer`) on the project so it can check whether
users have been disabled, deleted, or their tokens revoked. Do not download a service-account JSON key.
For local real-project testing, configure local ADC separately; the API does not automatically load
`.env` files. For example, use Uvicorn's `--env-file .env` when starting inside the service directory.

The browser signs in with Google's popup and sends a Firebase ID token in the Authorization header to
`GET /api/v1/me`. Only the backend-verified profile is shown as signed in. Invalid identities return
401; missing configuration or upstream failures return 503. Identity responses are not cached. The
existing health, stock list and candle endpoints remain public, even if Firebase is unavailable.
The shared market cache contains public market data, not user profiles or watchlists. Sign-in
requests no YouTube access.

Firebase's SDK manages session persistence and token refresh; application code does not copy tokens
into custom storage. Sign-out clears this browser's session. It does not revoke sessions on other
devices. Do not configure shared caches to cache authenticated API responses.

For local QA, the official Firebase Authentication emulator can be selected using
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` on the API and
`NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099` on a development frontend, with matching
project IDs. Use a `demo-` project and synthetic accounts. Never set emulator configuration in
production: the frontend rejects it in production and the API rejects it on Cloud Run.

## Personal watchlist

The separate **My watchlist** section saves up to 50 validated US stocks or default indices. Open an
instrument and choose **Add to watchlist**, or remove it from the chart or saved list. Public indices,
the Magnificent Seven and search stay available without signing in. Saved rows contain metadata;
opening a row uses the existing cached market endpoint rather than fetching prices for every saved
instrument.

Private routes require a Firebase token and derive ownership exclusively from its verified UID:

| Method | Route                        | Result                                                 |
| ------ | ---------------------------- | ------------------------------------------------------ |
| GET    | `/api/v1/watchlist`          | Read this account's saved instruments.                 |
| PUT    | `/api/v1/watchlist/{symbol}` | Add once; repeated additions do not create duplicates. |
| DELETE | `/api/v1/watchlist/{symbol}` | Remove if present.                                     |

The API stores one bounded document per account in the existing Firestore `user_watchlists`
collection, using a hash of the UID as its key. The cap is checked inside an atomic transaction.
Existing API runtime database permissions and `MARKET_*` database settings are reused; no new
production key, database or browser Firestore permission is required. Local SQLite storage uses
`WATCHLIST_DB_PATH`, defaulting to `/tmp/financial-analysis/watchlists.sqlite3`, and is refused on
Cloud Run.

Private responses, including errors, use `Cache-Control: no-store`. The page clears private data on
logout or account changes, obtains tokens from the Firebase SDK for each request, and rejects late
responses from a previous session. Lists load on verified session changes or explicit retry, with no
polling or persistent listeners. Removing or reading saved items does not depend on Yahoo being
available. A failed write requires reloading the list before editing again, because the server may
have completed a request whose response was lost.

## Quality checks

Run every check from the repository root:

```bash
npm run check
npm run build:web
```

`check` includes frontend types, formatting and request/session race tests, backend Ruff checks, and
API tests for authentication, private watchlist isolation, market validation, caching and refresh
limits. Infrastructure tests exercise deployment ordering, conflicts and runtime-setting
preservation. Unit tests mock external providers; live Yahoo access, Firestore IAM and the Google
popup require deployment smoke tests as well.

Format TypeScript/CSS/Markdown and Python code with `npm run format`. The local pre-commit hook runs
`npm run check`.

## Cloud Run deployment

Both public Cloud Run services use port 8080 and a regional Artifact Registry repository named
`financial-analysis`. The configuration defaults to `northamerica-northeast2` (Toronto). The two
services must already exist; deployment updates their images while preserving runtime settings.

GitHub Actions runs **Quality checks** for pull requests and pushes to `main`: repository checks plus
a production frontend build. It receives no Google Cloud credentials. Protect `main` with required
pull requests and this status check so a `main` push represents an approved merge. The workflow runs
for documentation-only PRs as well, keeping required checks from remaining pending.

The existing Cloud Build triggers use `infra/gcp/cloudbuild.api.yaml` and
`infra/gcp/cloudbuild.web.yaml`. Configure them for pushes matching `^main$`, with the included-file
filters and scoped IAM grants in the [Console setup guide](infra/gcp/README.md). Each builds and
explicitly pushes an image tagged by Build ID, then updates its existing service and directs traffic
to the new ready revision. A creation-time ordering guard and Cloud Run etag checks prevent a
late-finishing, earlier-created build from replacing a newer accepted deployment. This orders build
creation times rather than Git ancestry.

For the existing project, finish these one-time Console settings before merging the first release:

1. Keep the existing Artifact Registry repository, services and dedicated runtime identities.
2. Set the API runtime's `FIREBASE_PROJECT_ID` and attach
   the runtime identity with the Firebase Authentication Viewer role described above. Before
   switching to real data, create the Firestore database and grant Cloud Datastore User as described
   in the caching section. Set `MARKET_DATA_SOURCE=yfinance` and `MARKET_CACHE_BACKEND=firestore`.
3. In the web trigger, set `_API_BASE_URL` to the existing API origin,
   without a path or trailing slash. For sign-in, also set `_FIREBASE_API_KEY`, `_FIREBASE_AUTH_DOMAIN`,
   `_FIREBASE_PROJECT_ID` and `_FIREBASE_APP_ID` from the Firebase Web app. All four may remain empty
   for an anonymous-only deployment.
4. Set the API's `CORS_ORIGINS` runtime variable to the exact frontend origin, without a trailing
   slash. Multiple explicit origins are comma-separated. Add the frontend
   hostname, without protocol or path, to Firebase Authentication's authorized domains.
5. Give the build identity **Cloud Run Developer** on each service and **Service Account User** on
   the matching runtime identities, retaining its existing build/artifact permissions. Update the
   two triggers to the main-branch events and included-file filters in the setup guide.
6. Merge the checked PR and follow both Cloud Build runs. The services release independently;
   keep API changes backward compatible with the previously deployed frontend.
7. Test all three indices, an additional stock found through search, daily data dates, cache reuse,
   Google sign-in, refresh, sign-out and unauthenticated rejection of `/api/v1/me`. Verify both
   services serve the new revisions. The health endpoint reports the configured source without
   contacting Yahoo; a healthy process alone does not prove that market refreshes succeed. Test
   watchlist add/remove, refresh/relogin restoration and isolation using two real accounts.

Use Cloud Run **Revision History → Manage traffic** to return traffic to a retained revision when
needed. A future successful main-branch build deploys forward again. The deployment helper uses the
existing build identity; no downloaded key or new always-running service is introduced. GitHub
Actions checks are free on standard hosted runners for public repositories; Cloud Build, image
storage and runtime usage still follow their quotas and billing.

Frontend `NEXT_PUBLIC_*` values are compiled into the browser bundle. Changing Cloud Run runtime
variables does not update them: rebuild and redeploy the frontend image. Firebase Web configuration
is public, but OAuth client secrets, service-account keys and ID tokens must never be build arguments.

Use dedicated build and runtime service accounts. Only the API runtime needs the Firebase read role;
the web runtime needs no application resource role. Keep minimum instances at zero and a small maximum
instance count. The existing alerts-only budget is not a spending cap. Cloud Run, build, storage and
network charges remain separate from Authentication. Do not enable paid market data, SMS sign-in,
Cloud SQL or Redis for this phase. Firestore has a free usage allowance for one database; it is not
an unlimited free service. See [Firestore pricing](https://firebase.google.com/docs/firestore/pricing).

The local bilingual deployment, authentication and real-data runbooks remain excluded from Git in
`local-docs/`.

## Change records

Every material change outside `local-docs/` should add one file under `changelog/`. Local-only
documentation changes do not require a change record. See `changelog/README.md` for the convention.
